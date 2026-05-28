// ============================================================
// MCC API — POST /api/payouts/standard
// ============================================================
// Moves money from the MCC platform balance → driver's connected
// Stripe account → driver's bank account (standard payout, 1-2 days).
//
// Two Stripe calls:
//   1. stripe.transfers.create()  — platform → connected account
//   2. stripe.payouts.create()    — connected account → bank (standard)
//
// Prerequisites:
//   - Driver has completed Stripe Connect onboarding
//   - payoutsEnabled on the account (no debit card required)
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

interface AvailableEarning {
  id: string;
  amount_cents: number;
}

function nextWednesdayISO(): string {
  const now = new Date();
  const daysUntil = (3 - now.getDay() + 7) % 7 || 7;
  const next = new Date(now.getTime() + daysUntil * 86_400_000);
  return next.toISOString().split("T")[0]!;
}

router.post("/payouts/standard", async (req: Request, res: Response) => {
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
      .select("id, stripe_account_id, partner_id")
      .eq("profile_id", user.id)
      .single();

    if (driverError || !driver) {
      res.status(404).json({ error: "Driver profile not found" });
      return;
    }

    if (driver.partner_id) {
      res.status(400).json({
        error: "Partner drivers are paid through their partner company.",
        code: "PARTNER_DRIVER",
      });
      return;
    }

    if (!driver.stripe_account_id) {
      res.status(400).json({
        error: "Stripe Connect account not set up. Complete onboarding first.",
        code: "NO_STRIPE",
      });
      return;
    }

    // ── 3. Verify account can receive payouts ────────────────
    const caps = await getDriverPayoutCapabilities(driver.stripe_account_id);

    if (!caps.payoutsEnabled) {
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
      res.status(500).json({ error: "Failed to fetch unpaid earnings" });
      return;
    }

    if (!availableEarnings || availableEarnings.length === 0) {
      res.status(400).json({
        error: "No available earnings for payout",
        code: "NO_UNPAID_EARNINGS",
      });
      return;
    }

    // ── 5. Calculate amounts (all in cents; no fee for standard)
    const grossCents = availableEarnings.reduce(
      (sum, e) => sum + (e.amount_cents || 0),
      0,
    );

    if (grossCents < 100) {
      res.status(400).json({
        error: "Minimum payout amount is $1.00",
        code: "BELOW_MINIMUM",
        gross: grossCents / 100,
      });
      return;
    }

    // ── 6. Create driver_cashouts DB row ─────────────────────
    const earningIds = availableEarnings.map((e) => e.id);
    const arrivalDate = nextWednesdayISO();

    const { data: cashoutRow, error: insertError } = await supabaseAdmin
      .from("driver_cashouts")
      .insert({
        driver_id: driver.id,
        amount_cents: grossCents,
        fee_cents: 0,
        method: "standard",
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
        amount: grossCents,
        currency: "usd",
        destination: driver.stripe_account_id,
        description: `MCC standard payout – ${earningIds.length} earning(s)`,
        metadata: {
          mcc_cashout_id: cashoutRow.id,
          driver_id: driver.id,
          method: "standard",
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

    // ── 8. Stripe: Payout from connected account → bank ─────
    let payout: Stripe.Payout;
    try {
      payout = await stripe.payouts.create(
        {
          amount: grossCents,
          currency: "usd",
          method: "standard",
          description: "MCC Standard Payout",
          metadata: { mcc_cashout_id: cashoutRow.id, driver_id: driver.id },
        },
        { stripeAccount: driver.stripe_account_id },
      );
    } catch (stripeErr: unknown) {
      const msg =
        stripeErr instanceof Error ? stripeErr.message : "Standard payout creation failed";
      logger.error(
        { err: stripeErr, cashoutId: cashoutRow.id, transferId: transfer.id },
        "Stripe payout.create (standard) failed",
      );

      // Transfer succeeded but payout failed — funds are in the connected
      // account balance. Mark failed with the transfer ID so ops can investigate.
      await supabaseAdmin
        .from("driver_cashouts")
        .update({ status: "failed", stripe_transfer_id: transfer.id, error: msg })
        .eq("id", cashoutRow.id);

      res.status(502).json({
        error: "Funds transferred but standard payout failed. Contact support.",
        code: "STRIPE_PAYOUT_FAILED",
      });
      return;
    }

    // ── 9. Update cashout row with Stripe IDs + in_transit ───
    await supabaseAdmin
      .from("driver_cashouts")
      .update({
        stripe_transfer_id: transfer.id,
        stripe_payout_id: payout.id,
        status: "in_transit",
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

    const grossDollars = grossCents / 100;

    logger.info(
      {
        cashoutId: cashoutRow.id,
        transferId: transfer.id,
        stripePayoutId: payout.id,
        grossDollars,
        driverId: driver.id,
        earningCount: earningIds.length,
      },
      "Standard payout initiated successfully",
    );

    void createDriverNotification(
      driver.id,
      "payout_success",
      "Standard Payout Scheduled",
      `$${grossDollars.toFixed(2)} will arrive in your bank account by ${arrivalDate}.`,
      { payoutId: cashoutRow.id, gross: grossDollars, method: "standard", arrivalDate },
    );

    res.status(200).json({
      success: true,
      payout: {
        id: cashoutRow.id,
        gross: grossDollars,
        fee: 0,
        net: grossDollars,
        method: "standard",
        status: "in_transit",
        earningCount: earningIds.length,
        arrivalDate,
      },
    });
  } catch (err) {
    logger.error({ err }, "Unhandled error in standard payout");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
