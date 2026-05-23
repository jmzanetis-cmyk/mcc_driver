// ============================================================
// MCC API — Co-driver evaluation routes
// POST /api/evaluations/co-driver   — submit co-driver evaluation
// GET  /api/evaluations/pending-codriver — rides needing eval
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

async function getDriver(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data } = await supabaseAdmin
    .from("drivers").select("id").eq("user_id", user.id).single();
  return data as { id: string } | null;
}

// ── POST /api/evaluations/co-driver ──────────────────────────────────────────
router.post("/evaluations/co-driver", async (req: Request, res: Response) => {
  try {
    const driver = await getDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { rideId, communication, punctuality, safety, professionalism, comment } =
      req.body as {
        rideId?: string;
        communication?: number;
        punctuality?: number;
        safety?: number;
        professionalism?: number;
        comment?: string;
      };

    if (!rideId || !communication || !punctuality || !safety || !professionalism) {
      res.status(400).json({ error: "rideId and all four rating criteria are required" }); return;
    }

    const toRating = (v: number) => Math.max(1, Math.min(5, Math.round(v)));
    const comm = toRating(communication);
    const punct = toRating(punctuality);
    const safe = toRating(safety);
    const prof = toRating(professionalism);

    // Find the other driver on this ride
    const assignmentsRes = await supabaseAdmin
      .from("driver_assignments")
      .select("driver_id")
      .eq("ride_id", rideId)
      .neq("driver_id", driver.id)
      .limit(1);

    const evaluateeId = (assignmentsRes.data?.[0] as { driver_id: string } | undefined)?.driver_id ?? null;

    const { error: insertErr } = await supabaseAdmin
      .from("co_driver_evaluations")
      .insert({
        ride_id: rideId,
        evaluator_id: driver.id,
        evaluatee_id: evaluateeId,
        communication: comm,
        punctuality: punct,
        safety: safe,
        professionalism: prof,
        comment: comment ?? null,
      });

    if (insertErr) {
      if (insertErr.code === "23505") {
        // Already submitted — return success idempotently
        res.status(200).json({ ok: true, alreadySubmitted: true }); return;
      }
      throw insertErr;
    }

    // Update the evaluatee's rolling co_driver_rating
    if (evaluateeId) {
      const { data: allEvals } = await supabaseAdmin
        .from("co_driver_evaluations")
        .select("communication, punctuality, safety, professionalism")
        .eq("evaluatee_id", evaluateeId);

      if (allEvals && allEvals.length > 0) {
        type EvalRow = { communication: number; punctuality: number; safety: number; professionalism: number };
        const avg =
          (allEvals as EvalRow[]).reduce((sum, e) => sum + (e.communication + e.punctuality + e.safety + e.professionalism) / 4, 0) /
          allEvals.length;

        await supabaseAdmin
          .from("drivers")
          .update({ co_driver_rating: Math.round(avg * 100) / 100 })
          .eq("id", evaluateeId);
      }
    }

    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "evaluations.codriver unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/evaluations/pending-codriver ────────────────────────────────────
// Returns tandem rides the driver completed but hasn't yet evaluated their co-driver for
router.get("/evaluations/pending-codriver", async (req: Request, res: Response) => {
  try {
    const driver = await getDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    // Get completed tandem rides this driver was assigned to
    const { data: assignments } = await supabaseAdmin
      .from("driver_assignments")
      .select("ride_id")
      .eq("driver_id", driver.id)
      .eq("status", "completed");

    if (!assignments || assignments.length === 0) {
      res.status(200).json({ pendingCount: 0, rides: [] }); return;
    }

    const rideIds = (assignments as { ride_id: string }[]).map((a) => a.ride_id);

    // Fetch the rides that were tandem jobs
    const { data: tandemRides } = await supabaseAdmin
      .from("rides")
      .select("id, pickup_address, dropoff_address, completed_at")
      .in("id", rideIds)
      .eq("tandem_required", true)
      .order("completed_at", { ascending: false })
      .limit(20);

    if (!tandemRides || tandemRides.length === 0) {
      res.status(200).json({ pendingCount: 0, rides: [] }); return;
    }

    // Find which of those rides already have an evaluation from this driver
    const tandemRideIds = (tandemRides as { id: string }[]).map((r) => r.id);
    const { data: existingEvals } = await supabaseAdmin
      .from("co_driver_evaluations")
      .select("ride_id")
      .eq("evaluator_id", driver.id)
      .in("ride_id", tandemRideIds);

    const evaluatedRideIds = new Set((existingEvals ?? []).map((e: { ride_id: string }) => e.ride_id));

    type TandemRide = { id: string; pickup_address: string; dropoff_address: string; completed_at: string };
    const pending = (tandemRides as TandemRide[]).filter((r) => !evaluatedRideIds.has(r.id));

    res.status(200).json({ pendingCount: pending.length, rides: pending });
  } catch (err) {
    logger.error({ err }, "evaluations.pending unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
