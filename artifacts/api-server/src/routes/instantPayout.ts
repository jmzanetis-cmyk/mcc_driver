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
//   - Driver has unpaid completed assignments
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

interface UnpaidAssignment {
  id: string;
  driver_payout_amount: number;
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

    // ── 4. Fetch unpaid completed assignments ────────────────
    const { data: unpaidAssignments, error: assignmentError } =
      await supabaseAdmin
        .from("driver_assignments")
        .select("id, driver_payout_amount")
        .eq("driver_id", driver.id)
        .eq("status", "completed")
        .eq("payout_status", "unpaid")
        .returns<UnpaidAssignment[]>();

    if (assignmentError) {
      logger.error({ err: assignmentError }, "Failed to fetch assignments");
      res.status(500).json({ error: "Failed to fetch unpaid earnings" });
      return;
    }

    if (!unpaidAssignments || unpaidAssignments.length === 0) {
      res.status(400).json({
        error: "No unpaid earnings available for payout",
        code: "NO_UNPAID_EARNINGS",
      });
      return;
    }

    // ── 5. Calculate amounts ─────────────────────────────────
    const grossDollars = unpaidAssignments.reduce(
      (sum, a) => sum + (a.driver_payout_amount || 0),
      0,
    );

    const feeDollars = Number(
      ((grossDollars * INSTANT_PAYOUT_FEE_PERCENT) / 100).toFixed(2),
    );
    const netDollars = Number((grossDollars - feeDollars).toFixed(2));
    const netCents = Math.round(netDollars * 100);

    if (netCents < 100) {
      res.status(400).json({
        error: "Minimum payout amount is $1.00 after fees",
        code: "BELOW_MINIMUM",
        gross: grossDollars,
        fee: feeDollars,
        net: netDollars,
      });
      return;
    }

    // ── 6. Create driver_payouts DB row ──────────────────────
    const assignmentIds = unpaidAssignments.map((a) => a.id);

    const { data: payoutRow, error: insertError } = await supabaseAdmin
      .from("driver_payouts")
      .insert({
        driver_id: driver.id,
        amount: grossDollars,
        net_payout: netDollars,
        platform_fee: feeDollars,
        method: "instant",
        status: "processing",
        requested_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError || !payoutRow) {
      logger.error({ err: insertError }, "Failed to create payout record");
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
        description: `MCC instant payout – ${assignmentIds.length} assignment(s)`,
        metadata: {
          mcc_payout_id: payoutRow.id,
          driver_id: driver.id,
          method: "instant",
        },
      });
    } catch (stripeErr: unknown) {
      const msg =
        stripeErr instanceof Error ? stripeErr.message : "Transfer creation failed";
      logger.error({ err: stripeErr, payoutId: payoutRow.id }, "Stripe transfer.create failed");

      await supabaseAdmin
        .from("driver_payouts")
        .update({ status: "failed", failed_reason: msg })
        .eq("id", payoutRow.id);

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
          metadata: { mcc_payout_id: payoutRow.id, driver_id: driver.id },
        },
        { stripeAccount: driver.stripe_account_id },
      );
    } catch (stripeErr: unknown) {
      const msg =
        stripeErr instanceof Error ? stripeErr.message : "Instant payout creation failed";
      logger.error(
        { err: stripeErr, payoutId: payoutRow.id, transferId: transfer.id },
        "Stripe payout.create (instant) failed",
      );

      // Transfer succeeded but payout failed — funds are in the connected
      // account balance. Webhook cannot fire (no payout ID). Mark as failed
      // so ops can investigate and retry.
      await supabaseAdmin
        .from("driver_payouts")
        .update({ status: "failed", stripe_transfer_id: transfer.id, failed_reason: msg })
        .eq("id", payoutRow.id);

      res.status(502).json({
        error: "Funds transferred but instant payout failed. They will arrive via standard payout.",
        code: "STRIPE_PAYOUT_FAILED",
      });
      return;
    }

    // ── 9. Update DB with Stripe IDs ─────────────────────────
    await supabaseAdmin
      .from("driver_payouts")
      .update({
        stripe_transfer_id: transfer.id,
        status: "in_transit",
      })
      .eq("id", payoutRow.id);

    // ── 10. Mark assignments as paid ─────────────────────────
    await supabaseAdmin
      .from("driver_assignments")
      .update({ payout_status: "paid", payout_id: payoutRow.id })
      .in("id", assignmentIds);

    logger.info(
      {
        payoutId: payoutRow.id,
        transferId: transfer.id,
        stripePayoutId: payout.id,
        amount: netDollars,
        driverId: driver.id,
      },
      "Instant payout initiated successfully",
    );

    void createDriverNotification(
      driver.id,
      "payout_success",
      "Instant Payout Initiated",
      `$${netDollars.toFixed(2)} is on its way to your debit card (typically within 30 min).`,
      { payoutId: payoutRow.id, net: netDollars, method: "instant" },
    );

    res.status(200).json({
      success: true,
      payout: {
        id: payoutRow.id,
        gross: grossDollars,
        fee: feeDollars,
        net: netDollars,
        method: "instant",
        status: "in_transit",
        assignmentCount: assignmentIds.length,
      },
    });
  } catch (err) {
    logger.error({ err }, "Unhandled error in instant payout");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
