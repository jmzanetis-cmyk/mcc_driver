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
//   - Driver has unpaid completed assignments
// ============================================================

import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { getDriverPayoutCapabilities } from "../lib/stripeCapabilities";
import { logger } from "../lib/logger";

function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

const router = Router();

const STANDARD_PAYOUT_MINIMUM = 1.0;

interface UnpaidAssignment {
  id: string;
  driver_payout_amount: number;
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
      .eq("user_id", user.id)
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

    // ── 5. Calculate amounts (no fee for standard) ───────────
    const totalDollars = Number(
      unpaidAssignments
        .reduce((sum, a) => sum + (a.driver_payout_amount || 0), 0)
        .toFixed(2),
    );
    const totalCents = Math.round(totalDollars * 100);

    if (totalCents < Math.round(STANDARD_PAYOUT_MINIMUM * 100)) {
      res.status(400).json({
        error: `Minimum payout amount is $${STANDARD_PAYOUT_MINIMUM.toFixed(2)}`,
        code: "BELOW_MINIMUM",
        amount: totalDollars,
      });
      return;
    }

    // ── 6. Create driver_payouts DB row ──────────────────────
    const assignmentIds = unpaidAssignments.map((a) => a.id);
    const arrivalDate = nextWednesdayISO();

    const { data: payoutRow, error: insertError } = await supabaseAdmin
      .from("driver_payouts")
      .insert({
        driver_id: driver.id,
        amount: totalDollars,
        net_payout: totalDollars,
        platform_fee: 0,
        method: "standard",
        status: "processing",
        scheduled_date: arrivalDate,
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
        amount: totalCents,
        currency: "usd",
        destination: driver.stripe_account_id,
        description: `MCC standard payout – ${assignmentIds.length} assignment(s)`,
        metadata: {
          mcc_payout_id: payoutRow.id,
          driver_id: driver.id,
          method: "standard",
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

    // ── 8. Stripe: Payout from connected account → bank ─────
    let payout: Stripe.Payout;
    try {
      payout = await stripe.payouts.create(
        {
          amount: totalCents,
          currency: "usd",
          method: "standard",
          description: "MCC Standard Payout",
          metadata: { mcc_payout_id: payoutRow.id, driver_id: driver.id },
        },
        { stripeAccount: driver.stripe_account_id },
      );
    } catch (stripeErr: unknown) {
      const msg =
        stripeErr instanceof Error ? stripeErr.message : "Standard payout creation failed";
      logger.error(
        { err: stripeErr, payoutId: payoutRow.id, transferId: transfer.id },
        "Stripe payout.create (standard) failed",
      );

      // Transfer succeeded but payout failed — funds are in the connected
      // account balance. Mark failed with the transfer ID so ops can investigate.
      await supabaseAdmin
        .from("driver_payouts")
        .update({ status: "failed", stripe_transfer_id: transfer.id, failed_reason: msg })
        .eq("id", payoutRow.id);

      res.status(502).json({
        error: "Funds transferred but standard payout failed. Contact support.",
        code: "STRIPE_PAYOUT_FAILED",
      });
      return;
    }

    // ── 9. Update DB with Stripe IDs ─────────────────────────
    await supabaseAdmin
      .from("driver_payouts")
      .update({ stripe_transfer_id: transfer.id, status: "in_transit" })
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
        amount: totalDollars,
        driverId: driver.id,
        assignmentCount: assignmentIds.length,
      },
      "Standard payout initiated successfully",
    );

    res.status(200).json({
      success: true,
      payout: {
        id: payoutRow.id,
        amount: totalDollars,
        method: "standard",
        status: "in_transit",
        assignmentCount: assignmentIds.length,
        arrivalDate,
      },
    });
  } catch (err) {
    logger.error({ err }, "Unhandled error in standard payout");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
