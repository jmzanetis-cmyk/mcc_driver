// ============================================================
// MCC API — POST /api/tips/share
// ============================================================
// Lets the primary driver voluntarily share a portion of their
// tip with their co-driver (ride-along or chase driver).
//
// Rules:
//   - Caller must be the primary driver on the ride
//   - Share is 1–50% of the tip earning (enforced server-side)
//   - One tip_share row allowed per tip earning per co-driver
//   - Co-driver receives a push notification
//
// Body:
//   { rideId: string, earningId: string, sharePercent: number }
// ============================================================

import { Router, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { driverEarningsTable, driverAssignmentsTable, driversTable } from "@workspace/db/schema";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";
import { createDriverNotification } from "./notifications";

const router = Router();

router.post("/tips/share", async (req: Request, res: Response) => {
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
    const { rideId, earningId, sharePercent } = req.body as {
      rideId?: string;
      earningId?: string;
      sharePercent?: unknown;
    };

    if (!rideId || typeof rideId !== "string") {
      res.status(400).json({ error: "rideId is required" });
      return;
    }
    if (!earningId || typeof earningId !== "string") {
      res.status(400).json({ error: "earningId is required" });
      return;
    }
    const pct = Number(sharePercent);
    if (!Number.isFinite(pct) || pct < 1 || pct > 50) {
      res.status(400).json({ error: "sharePercent must be between 1 and 50" });
      return;
    }

    // ── Resolve caller driver ────────────────────────────────
    const [callerDriver] = await db
      .select({ id: driversTable.id })
      .from(driversTable)
      .where(eq(driversTable.userId, user.id))
      .limit(1);

    if (!callerDriver) {
      res.status(404).json({ error: "Driver profile not found" });
      return;
    }

    // ── Verify the earning belongs to caller and is a tip ────
    const [earning] = await db
      .select()
      .from(driverEarningsTable)
      .where(
        and(
          eq(driverEarningsTable.id, earningId),
          eq(driverEarningsTable.driverId, callerDriver.id),
          eq(driverEarningsTable.jobId, rideId as unknown as string),
        ),
      )
      .limit(1);

    // jobId column is uuid but we pass a string — use supabase for the lookup
    const { data: earnRow } = await supabaseAdmin
      .from("driver_earnings")
      .select("id, driver_id, job_id, amount_cents, kind, tip_shared_from")
      .eq("id", earningId)
      .eq("driver_id", callerDriver.id)
      .maybeSingle();

    if (!earnRow) {
      res.status(404).json({ error: "Tip earning not found or does not belong to you" });
      return;
    }

    const typedRow = earnRow as {
      id: string; driver_id: string; job_id: string;
      amount_cents: number; kind: string; tip_shared_from: string | null;
    };

    if (typedRow.kind !== "tip") {
      res.status(400).json({ error: "Only tip earnings can be shared" });
      return;
    }

    // ── Guard: one share per tip per ride ────────────────────
    const { data: existingShare } = await supabaseAdmin
      .from("driver_earnings")
      .select("id")
      .eq("tip_shared_from", earningId)
      .maybeSingle();

    if (existingShare) {
      res.status(409).json({ error: "This tip has already been shared" });
      return;
    }

    // ── Find the co-driver assignment on this ride ───────────
    const { data: assignments } = await supabaseAdmin
      .from("driver_assignments")
      .select("driver_id, role")
      .eq("ride_id", rideId)
      .eq("status", "completed");

    const coDriverRow = (assignments as Array<{ driver_id: string; role: string }> | null)
      ?.find(a => a.driver_id !== callerDriver.id);

    if (!coDriverRow) {
      res.status(404).json({ error: "No co-driver found on this ride" });
      return;
    }

    // ── Compute share amount ─────────────────────────────────
    const shareCents = Math.round(typedRow.amount_cents * pct / 100);
    if (shareCents < 1) {
      res.status(400).json({ error: "Share amount rounds to zero" });
      return;
    }

    // ── Insert tip_share earning for co-driver ────────────────
    const { error: insertError } = await supabaseAdmin
      .from("driver_earnings")
      .insert({
        driver_id:       coDriverRow.driver_id,
        job_id:          rideId,
        amount_cents:    shareCents,
        kind:            "tip_share",
        payout_status:   "pending",
        tip_shared_from: earningId,
        notes:           `Shared ${pct}% of tip by primary driver`,
        recorded_at:     new Date().toISOString(),
      });

    if (insertError) {
      logger.error({ err: insertError, rideId, earningId }, "Failed to insert tip_share earning");
      res.status(500).json({ error: "Failed to record tip share" });
      return;
    }

    logger.info(
      { rideId, fromDriver: callerDriver.id, toDriver: coDriverRow.driver_id, shareCents, pct },
      "Tip shared",
    );

    void createDriverNotification(
      coDriverRow.driver_id,
      "tip_share_received",
      "Tip Shared With You",
      `Your primary driver shared $${(shareCents / 100).toFixed(2)} from their tip for ride ${rideId.slice(0, 8)}…`,
      { rideId, amountCents: shareCents },
    );

    res.json({ success: true, shareCents, sharePercent: pct });
  } catch (err) {
    logger.error({ err }, "Unhandled error in tip-share route");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
