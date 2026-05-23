// ============================================================
// MCC API — POST /api/payouts/instant
// ============================================================
// Moves money from the MCC platform balance → driver's connected
// Stripe account → driver's debit card (instant payout).
//
// Two Stripe calls:
//   1. stripe.transfers.create()  — platform → connected account
//   2. stripe.payouts.create()    — connected account → debit card
//
// Prerequisites:
//   - Driver has completed Stripe Connect onboarding
//   - Driver has a debit card on file (not just a bank account)
//   - Driver has earnings with payout_status = 'available'
// ============================================================

import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { getDriverPayoutCapabilities } from "../lib/stripeCapabilities";
import { logger } from "../lib/logger";
import { createDriverNotification } from "./notifications";

function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

const router = Router();

const INSTANT_PAYOUT_FEE_PERCENT = 1.5;

interface AvailableEarning {
  id: string;
  amount_cents: number;
}

router.post("/payouts/instant", async (req: Request, res: Response) => {
  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({ error: "Stripe is not configured on this server." });
    return;
  }

  try {
    // ── 1. Authenticate ──────────────────────────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing authorization token" });
      return;
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    // ── 2. Look up driver & Stripe account ───────────────────
    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id, stripe_account_id, first_name, last_name")
      .eq("user_id", user.id)
      .single();

    if (driverError || !driver) {
      res.status(404).json({ error: "Driver profile not found" });
      return;
    }

    if (!driver.stripe_account_id) {
      res.status(400).json({
        error: "Stripe Connect account not set up. Complete onboarding first.",
      });
      return;
    }

    // ── 3. Verify debit card capability ──────────────────────
    const caps = await getDriverPayoutCapabilities(driver.stripe_account_id);

    if (!caps.hasDebitCard) {
      res.status(400).json({
        error: "Instant payouts require a debit card. Add one in your payment settings.",
        code: "NO_DEBIT_CARD",
      });
      return;
    }

    if (!caps.chargesEnabled || !caps.payoutsEnabled) {
      res.status(400).json({
        error: "Your Stripe account is not fully activated. Complete onboarding first.",
        code: "ACCOUNT_NOT_ACTIVE",
      });
      return;
    }

    // ── 4. Fetch available earnings ──────────────────────────
    const { data: availableEarnings, error: earningsError } =
      await supabaseAdmin
        .from("driver_earnings")
        .select("id, amount_cents")
        .eq("driver_id", driver.id)
        .eq("payout_status", "available")
        .returns<AvailableEarning[]>();

    if (earningsError) {
      logger.error({ err: earningsError }, "Failed to fetch available earnings");
      res.status(500).json({ error: "Failed to fetch available earnings" });
      return;
    }

    if (!availableEarnings || availableEarnings.length === 0) {
      res.status(400).json({
        error: "No available earnings for payout",
        code: "NO_UNPAID_EARNINGS",
      });
      return;
    }

    // ── 5. Calculate amounts (all in cents) ──────────────────
    const grossCents = availableEarnings.reduce(
      (sum, e) => sum + (e.amount_cents || 0),
      0,
    );
    const feeCents = Math.round((grossCents * INSTANT_PAYOUT_FEE_PERCENT) / 100);
    const netCents = grossCents - feeCents;

    if (netCents < 100) {
      res.status(400).json({
        error: "Minimum payout amount is $1.00 after fees",
        code: "BELOW_MINIMUM",
        gross: grossCents / 100,
        fee: feeCents / 100,
        net: netCents / 100,
      });
      return;
    }

    // ── 6. Create driver_cashouts DB row ─────────────────────
    const earningIds = availableEarnings.map((e) => e.id);

    const { data: cashoutRow, error: insertError } = await supabaseAdmin
      .from("driver_cashouts")
      .insert({
        driver_id: driver.id,
        amount_cents: grossCents,
        fee_cents: feeCents,
        method: "instant",
        status: "processing",
        initiated_by_kind: "driver",
        initiated_by_id: driver.id,
        requested_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError || !cashoutRow) {
      logger.error({ err: insertError }, "Failed to create cashout record");
      res.status(500).json({ error: "Failed to initiate payout" });
      return;
    }

    // ── 7. Stripe: Transfer from platform → connected account
    let transfer: Stripe.Transfer;
    try {
      transfer = await stripe.transfers.create({
        amount: netCents,
        currency: "usd",
        destination: driver.stripe_account_id,
        description: `MCC instant payout – ${earningIds.length} earning(s)`,
        metadata: {
          mcc_cashout_id: cashoutRow.id,
          driver_id: driver.id,
          method: "instant",
        },
      });
    } catch (stripeErr: unknown) {
      const msg =
        stripeErr instanceof Error ? stripeErr.message : "Transfer creation failed";
      logger.error({ err: stripeErr, cashoutId: cashoutRow.id }, "Stripe transfer.create failed");

      await supabaseAdmin
        .from("driver_cashouts")
        .update({ status: "failed", error: msg })
        .eq("id", cashoutRow.id);

      res.status(502).json({
        error: "Payment transfer failed. Please try again.",
        code: "STRIPE_TRANSFER_FAILED",
      });
      return;
    }

    // ── 8. Stripe: Payout from connected account → debit card
    let payout: Stripe.Payout;
    try {
      payout = await stripe.payouts.create(
        {
          amount: netCents,
          currency: "usd",
          method: "instant",
          description: "MCC Instant Payout",
          metadata: { mcc_cashout_id: cashoutRow.id, driver_id: driver.id },
        },
        { stripeAccount: driver.stripe_account_id },
      );
    } catch (stripeErr: unknown) {
      const msg =
        stripeErr instanceof Error ? stripeErr.message : "Instant payout creation failed";
      logger.error(
        { err: stripeErr, cashoutId: cashoutRow.id, transferId: transfer.id },
        "Stripe payout.create (instant) failed",
      );

      // Transfer succeeded but instant payout failed — funds are sitting in
      // the connected account balance. Mark failed so ops can investigate;
      // the driver will receive the balance via the next standard payout.
      await supabaseAdmin
        .from("driver_cashouts")
        .update({ status: "failed", stripe_transfer_id: transfer.id, error: msg })
        .eq("id", cashoutRow.id);

      res.status(502).json({
        error: "Funds transferred but instant payout failed. They will arrive via standard payout.",
        code: "STRIPE_PAYOUT_FAILED",
      });
      return;
    }

    // ── 9. Update cashout row with Stripe IDs ────────────────
    await supabaseAdmin
      .from("driver_cashouts")
      .update({
        stripe_transfer_id: transfer.id,
        stripe_payout_id: payout.id,
      })
      .eq("id", cashoutRow.id);

    // ── 10. Mark swept earnings as paid ──────────────────────
    await supabaseAdmin
      .from("driver_earnings")
      .update({
        payout_status: "paid",
        cashout_id: cashoutRow.id,
        paid_at: new Date().toISOString(),
        stripe_transfer_id: transfer.id,
      })
      .in("id", earningIds);

    const netDollars = netCents / 100;

    logger.info(
      {
        cashoutId: cashoutRow.id,
        transferId: transfer.id,
        stripePayoutId: payout.id,
        netDollars,
        driverId: driver.id,
        earningCount: earningIds.length,
      },
      "Instant payout initiated successfully",
    );

    void createDriverNotification(
      driver.id,
      "payout_success",
      "Instant Payout Initiated",
      `$${netDollars.toFixed(2)} is on its way to your debit card (typically within 30 min).`,
      { payoutId: cashoutRow.id, net: netDollars, method: "instant" },
    );

    res.status(200).json({
      success: true,
      payout: {
        id: cashoutRow.id,
        gross: grossCents / 100,
        fee: feeCents / 100,
        net: netDollars,
        method: "instant",
        status: "processing",
        earningCount: earningIds.length,
      },
    });
  } catch (err) {
    logger.error({ err }, "Unhandled error in instant payout");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
