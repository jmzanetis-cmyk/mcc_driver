// ============================================================
// MCC API — POST /api/tips
// ============================================================
// Records a tip from the member and transfers the amount to
// the driver's Stripe Connect account.
//
// Flow:
//   1. Authenticate the driver
//   2. Verify the ride belongs to this driver
//   3. Check no duplicate tip exists
//   4. Transfer tip amount from platform → connected account
//   5. Insert driver_tips row
//   6. Update rides.tip_amount
// ============================================================

import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";
import { createDriverNotification } from "./notifications";

function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

const router = Router();

router.post("/tips", async (req: Request, res: Response) => {
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

    // ── 2. Validate request body ─────────────────────────────
    const { rideId, amount } = req.body as { rideId?: string; amount?: unknown };

    if (!rideId || typeof rideId !== "string") {
      res.status(400).json({ error: "rideId is required" });
      return;
    }

    const tipAmount = Number(amount);
    if (!Number.isFinite(tipAmount) || tipAmount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }

    // ── 3. Look up driver ────────────────────────────────────
    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id, stripe_account_id")
      .eq("user_id", user.id)
      .single();

    if (driverError || !driver) {
      res.status(404).json({ error: "Driver profile not found" });
      return;
    }

    if (!driver.stripe_account_id) {
      res.status(400).json({
        error: "Driver does not have a Stripe Connect account",
        code: "NO_STRIPE_ACCOUNT",
      });
      return;
    }

    // ── 4. Verify driver was assigned to this ride ───────────
    const { data: assignment, error: assignmentError } = await supabaseAdmin
      .from("driver_assignments")
      .select("id")
      .eq("ride_id", rideId)
      .eq("driver_id", driver.id)
      .maybeSingle();

    if (assignmentError) {
      logger.error({ err: assignmentError }, "Failed to verify assignment");
      res.status(500).json({ error: "Failed to verify ride assignment" });
      return;
    }

    if (!assignment) {
      res.status(403).json({ error: "Driver was not assigned to this ride" });
      return;
    }

    // ── 5. Check for duplicate tip ───────────────────────────
    const { data: existingTip } = await supabaseAdmin
      .from("driver_tips")
      .select("id")
      .eq("ride_id", rideId)
      .maybeSingle();

    if (existingTip) {
      res.status(409).json({ error: "A tip has already been recorded for this ride" });
      return;
    }

    const tipCents = Math.round(tipAmount * 100);

    // ── 6. Stripe transfer: platform → connected account ─────
    let transfer: Stripe.Transfer;
    try {
      transfer = await stripe.transfers.create({
        amount: tipCents,
        currency: "usd",
        destination: driver.stripe_account_id,
        description: `MCC tip for ride ${rideId}`,
        metadata: { ride_id: rideId, driver_id: driver.id, type: "tip" },
      });
    } catch (stripeErr: unknown) {
      const msg =
        stripeErr instanceof Error ? stripeErr.message : "Transfer creation failed";
      logger.error({ err: stripeErr, rideId }, "Stripe transfer for tip failed");
      res.status(502).json({ error: "Payment failed. Please try again.", code: "STRIPE_FAILED", detail: msg });
      return;
    }

    // ── 7. Insert driver_tips row ────────────────────────────
    const { error: insertError } = await supabaseAdmin.from("driver_tips").insert({
      ride_id: rideId,
      driver_id: driver.id,
      amount: tipAmount,
      stripe_transfer_id: transfer.id,
      status: "completed",
    });

    if (insertError) {
      logger.error({ err: insertError, rideId }, "Failed to insert driver_tips row");
    }

    // ── 8. Update rides.tip_amount ───────────────────────────
    await supabaseAdmin
      .from("rides")
      .update({ tip_amount: tipAmount })
      .eq("id", rideId);

    logger.info({ rideId, driverId: driver.id, amount: tipAmount, transferId: transfer.id }, "Tip processed");

    void createDriverNotification(
      driver.id,
      "tip_received",
      "Tip Received",
      `You received a $${tipAmount.toFixed(2)} tip for ride ${rideId.slice(0, 8)}…`,
      { rideId, amount: tipAmount },
    );

    res.status(200).json({ success: true, amount: tipAmount, transferId: transfer.id });
  } catch (err) {
    logger.error({ err }, "Unhandled error in tips route");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
