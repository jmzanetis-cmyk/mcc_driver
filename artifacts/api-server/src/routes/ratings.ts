// ============================================================
// MCC API — POST /api/ratings
// ============================================================
// Driver rates a member (or member rates a driver) after a
// completed ride. Updates the rated user's rolling average_rating
// and total_ratings on their profile table.
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";
import { createDriverNotification } from "./notifications";

const router = Router();

router.post("/ratings", async (req: Request, res: Response) => {
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

    // ── 2. Validate body ─────────────────────────────────────
    const { rideId, stars, comment } = req.body as {
      rideId?: string;
      stars?: unknown;
      comment?: unknown;
    };

    if (!rideId || typeof rideId !== "string") {
      res.status(400).json({ error: "rideId is required" });
      return;
    }

    const starsNum = Number(stars);
    if (!Number.isInteger(starsNum) || starsNum < 1 || starsNum > 5) {
      res.status(400).json({ error: "stars must be an integer 1-5" });
      return;
    }

    const commentStr =
      typeof comment === "string" && comment.trim().length > 0
        ? comment.trim().slice(0, 1000)
        : null;

    // ── 3. Look up driver (rater) ────────────────────────────
    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("profile_id", user.id)
      .single();

    if (driverError || !driver) {
      res.status(404).json({ error: "Driver profile not found" });
      return;
    }

    // ── 4. Verify the ride was assigned to this driver ───────
    const { data: assignment } = await supabaseAdmin
      .from("driver_assignments")
      .select("id")
      .eq("ride_id", rideId)
      .eq("driver_id", driver.id)
      .maybeSingle();

    if (!assignment) {
      res.status(403).json({ error: "Driver was not assigned to this ride" });
      return;
    }

    // ── 5. Look up the ride to find member's user_id ─────────
    const { data: ride, error: rideError } = await supabaseAdmin
      .from("rides")
      .select("member_user_id")
      .eq("id", rideId)
      .maybeSingle();

    if (rideError) {
      logger.error({ err: rideError, rideId }, "Failed to fetch ride for rating");
      res.status(500).json({ error: "Failed to look up ride" });
      return;
    }

    // member_user_id may not exist in older schemas — use a placeholder
    const ratedUserId =
      (ride as { member_user_id?: string | null } | null)?.member_user_id ?? `member:${rideId}`;

    // ── 6. Insert rating (idempotent via unique index) ────────
    const { error: insertError } = await supabaseAdmin
      .from("ride_ratings")
      .upsert(
        {
          ride_id: rideId,
          rater_id: user.id,
          rater_role: "driver",
          rated_id: ratedUserId,
          rated_role: "member",
          stars: starsNum,
          comment: commentStr,
        },
        { onConflict: "ride_id,rater_id" },
      );

    if (insertError) {
      logger.error({ err: insertError, rideId }, "Failed to insert rating");
      res.status(500).json({ error: "Failed to save rating" });
      return;
    }

    // ── 7. Also store driver_rating on the ride row ───────────
    // (existing field used by the earnings hook)
    await supabaseAdmin
      .from("rides")
      .update({ driver_rating: starsNum, driver_feedback: commentStr })
      .eq("id", rideId);

    // ── 8. Update driver's own average_rating & total_ratings ─
    // Re-compute from the ride_ratings table for correctness.
    const { data: agg } = await supabaseAdmin
      .from("ride_ratings")
      .select("stars")
      .eq("rater_id", user.id)
      .eq("rater_role", "driver");

    if (agg && agg.length > 0) {
      const rows = agg as { stars: number }[];
      const avg = rows.reduce((s, r) => s + r.stars, 0) / rows.length;
      await supabaseAdmin
        .from("drivers")
        .update({
          average_rating: Math.round(avg * 100) / 100,
          total_ratings: rows.length,
        })
        .eq("id", driver.id);
    }

    logger.info({ rideId, driverId: driver.id, stars: starsNum }, "Rating submitted");

    void createDriverNotification(
      driver.id,
      "rating_received",
      "Member Rating Recorded",
      `You rated your member ${"★".repeat(starsNum)}${"☆".repeat(5 - starsNum)} for ride ${rideId.slice(0, 8)}…`,
      { rideId, stars: starsNum },
    );

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err }, "Unhandled error in ratings route");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
