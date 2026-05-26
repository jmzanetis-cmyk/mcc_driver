// ============================================================
// MCC API — POST /api/tips
// ============================================================
// Records a tip from the member and creates a driver_earnings
// row (kind='tip'). Optionally transfers via Stripe Connect.
//
// Supports solo and tandem rides:
//   - Solo: caller is the tipped driver
//   - Tandem: pass targetDriverId to tip a specific driver
//     (caller must be assigned to same ride)
//
// Returns earningId so the client can offer co-driver tip sharing.
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
  try {
    // ── Auth ─────────────────────────────────────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing authorization token" });
      return;
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    // ── Validate body ────────────────────────────────────────
    const { rideId, amount, targetDriverId, sharePercent: sharePercentRaw } = req.body as {
      rideId?: string;
      amount?: unknown;
      targetDriverId?: string;
      sharePercent?: unknown;
    };

    if (!rideId || typeof rideId !== "string") {
      res.status(400).json({ error: "rideId is required" });
      return;
    }
    const tipAmount = Number(amount);
    if (!Number.isFinite(tipAmount) || tipAmount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }

    // ── Resolve caller driver (must be assigned to ride) ─────
    const { data: callerDriver } = await supabaseAdmin
      .from("drivers")
      .select("id, stripe_account_id")
      .eq("user_id", user.id)
      .single();

    if (!callerDriver) {
      res.status(404).json({ error: "Driver profile not found" });
      return;
    }

    // Caller must have an assignment on this ride
    const { data: callerAssignment } = await supabaseAdmin
      .from("driver_assignments")
      .select("id")
      .eq("ride_id", rideId)
      .eq("driver_id", callerDriver.id)
      .maybeSingle();

    if (!callerAssignment) {
      res.status(403).json({ error: "Driver was not assigned to this ride" });
      return;
    }

    // ── Resolve tipped driver ────────────────────────────────
    // targetDriverId: tip a different driver (tandem co-driver)
    // default: tip the caller
    let tippedDriverId: string;
    let tippedStripeAccountId: string | null;

    if (targetDriverId && targetDriverId !== callerDriver.id) {
      const { data: targetDriver } = await supabaseAdmin
        .from("drivers")
        .select("id, stripe_account_id")
        .eq("id", targetDriverId)
        .single();

      if (!targetDriver) {
        res.status(404).json({ error: "Target driver not found" });
        return;
      }

      // Target must also be assigned to this ride
      const { data: targetAssignment } = await supabaseAdmin
        .from("driver_assignments")
        .select("id")
        .eq("ride_id", rideId)
        .eq("driver_id", targetDriverId)
        .maybeSingle();

      if (!targetAssignment) {
        res.status(403).json({ error: "Target driver was not assigned to this ride" });
        return;
      }

      tippedDriverId       = targetDriver.id;
      tippedStripeAccountId = (targetDriver as { stripe_account_id?: string | null }).stripe_account_id ?? null;
    } else {
      tippedDriverId        = callerDriver.id;
      tippedStripeAccountId = (callerDriver as { stripe_account_id?: string | null }).stripe_account_id ?? null;
    }

    // ── Duplicate guard — one tip per driver per ride ────────
    const { data: existingEarning } = await supabaseAdmin
      .from("driver_earnings")
      .select("id")
      .eq("driver_id", tippedDriverId)
      .eq("job_id", rideId)
      .eq("kind", "tip")
      .maybeSingle();

    if (existingEarning) {
      res.status(409).json({ error: "A tip has already been recorded for this driver on this ride" });
      return;
    }

    const tipCents = Math.round(tipAmount * 100);

    // ── Inline tip share — compute split before any DB writes ─
    // Only applies when the caller is tipping themselves (not targetDriverId),
    // meaning the primary driver is voluntarily splitting their own tip.
    const sharePct = Number(sharePercentRaw ?? 0);
    const validSharePct = !targetDriverId && Number.isFinite(sharePct) && sharePct >= 1 && sharePct <= 50
      ? Math.floor(sharePct) : 0;

    let primaryTipCents = tipCents;
    let shareCents = 0;
    let coDriverIdForShare: string | null = null;

    if (validSharePct > 0) {
      const { data: assignments } = await supabaseAdmin
        .from("driver_assignments")
        .select("driver_id, role, status")
        .eq("ride_id", rideId)
        .in("status", ["completed", "started", "arrived"]);

      const coAss = (assignments as Array<{ driver_id: string; role: string; status: string }> | null)
        ?.find((a) => a.driver_id !== tippedDriverId);

      if (coAss) {
        shareCents      = Math.round(tipCents * validSharePct / 100);
        primaryTipCents = tipCents - shareCents;
        coDriverIdForShare = coAss.driver_id;
      }
    }

    // ── Stripe transfer — only for primary driver's kept portion ─
    let stripeTransferId: string | null = null;
    const stripe = getStripeClient();

    if (stripe && tippedStripeAccountId) {
      try {
        const transfer = await stripe.transfers.create({
          amount: primaryTipCents,
          currency: "usd",
          destination: tippedStripeAccountId,
          description: `MCC tip for ride ${rideId}`,
          metadata: { ride_id: rideId, driver_id: tippedDriverId, type: "tip" },
        });
        stripeTransferId = transfer.id;
      } catch (stripeErr) {
        const msg = stripeErr instanceof Error ? stripeErr.message : "Transfer creation failed";
        logger.error({ err: stripeErr, rideId }, "Stripe transfer for tip failed");
        res.status(502).json({ error: "Payment failed. Please try again.", code: "STRIPE_FAILED", detail: msg });
        return;
      }
    }

    // ── Insert driver_earnings row for primary (kind='tip') ───
    const { data: earningRow, error: insertError } = await supabaseAdmin
      .from("driver_earnings")
      .insert({
        driver_id:          tippedDriverId,
        job_id:             rideId,
        amount_cents:       primaryTipCents,
        kind:               "tip",
        payout_status:      stripeTransferId ? "available" : "pending",
        stripe_transfer_id: stripeTransferId ?? undefined,
        recorded_at:        new Date().toISOString(),
        notes:              validSharePct > 0
          ? `Member tip (kept ${100 - validSharePct}% after sharing ${validSharePct}% with co-driver)`
          : `Member tip`,
      })
      .select("id")
      .single();

    if (insertError) {
      logger.error({ err: insertError, rideId }, "Failed to insert driver_earnings tip row");
      res.status(500).json({ error: "Failed to record tip" });
      return;
    }

    const earningId = (earningRow as { id: string }).id;

    // ── Insert tip_share earning for co-driver ────────────────
    if (coDriverIdForShare && shareCents > 0) {
      const { error: shareErr } = await supabaseAdmin
        .from("driver_earnings")
        .insert({
          driver_id:       coDriverIdForShare,
          job_id:          rideId,
          amount_cents:    shareCents,
          kind:            "tip_share",
          payout_status:   "pending",
          tip_shared_from: earningId,
          notes:           `Shared ${validSharePct}% of tip by primary driver`,
          recorded_at:     new Date().toISOString(),
        });

      if (shareErr) {
        logger.error({ err: shareErr, rideId, earningId }, "Failed to insert tip_share earning");
      } else {
        void createDriverNotification(
          coDriverIdForShare,
          "tip_share_received",
          "Tip Shared With You",
          `Your co-driver shared $${(shareCents / 100).toFixed(2)} from their tip for this ride`,
          { rideId, amountCents: shareCents },
        );
      }
    }

    // ── Update rides.tip_amount (full member-paid amount) ─────
    const { data: existingRide } = await supabaseAdmin
      .from("rides")
      .select("tip_amount")
      .eq("id", rideId)
      .single();
    const prevTip = (existingRide as { tip_amount?: number | null } | null)?.tip_amount ?? 0;
    await supabaseAdmin
      .from("rides")
      .update({ tip_amount: prevTip + tipAmount })
      .eq("id", rideId);

    logger.info(
      { rideId, driverId: tippedDriverId, amount: tipAmount, validSharePct, coDriverIdForShare, stripeTransferId },
      "Tip processed",
    );

    void createDriverNotification(
      tippedDriverId,
      "tip_received",
      "Tip Received",
      `You received a $${(primaryTipCents / 100).toFixed(2)} tip for ride ${rideId.slice(0, 8)}…`,
      { rideId, amount: primaryTipCents / 100 },
    );

    res.status(200).json({
      success: true,
      amount: tipAmount,
      earningId,
      stripeTransferId,
      sharePercent: validSharePct,
      shareCents,
      primaryTipCents,
    });
  } catch (err) {
    logger.error({ err }, "Unhandled error in tips route");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
