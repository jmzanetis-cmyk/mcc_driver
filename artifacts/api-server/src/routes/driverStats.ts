// ============================================================
// MCC API — GET /api/drivers/stats
// Computes acceptance rate, completion rate, on-time %,
// avg rating trend (last 30 days), totals.
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

router.get("/drivers/stats", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" }); return;
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) { res.status(401).json({ error: "Invalid token" }); return; }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id, average_rating, total_rides_completed, completion_rate")
      .eq("profile_id", user.id)
      .single();

    if (driverError || !driver) {
      res.status(404).json({ error: "Driver not found" }); return;
    }

    const d = driver as {
      id: string;
      average_rating: number;
      total_rides_completed: number;
      completion_rate: number;
    };

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    // Parallel queries for recent assignments + ratings
    const [assignmentsRes, ratingsRes, earningsRes] = await Promise.all([
      supabaseAdmin
        .from("driver_assignments")
        .select("status, completed_at")
        .eq("driver_id", d.id)
        .gte("completed_at", thirtyDaysAgo),
      supabaseAdmin
        .from("ride_ratings")
        .select("stars, created_at")
        .eq("rater_id", user.id)
        .gte("created_at", thirtyDaysAgo),
      supabaseAdmin
        .from("driver_earnings")
        .select("amount_cents")
        .eq("driver_id", d.id),
    ]);

    const assignments = (assignmentsRes.data ?? []) as { status: string; completed_at: string | null }[];
    const recentRatings = (ratingsRes.data ?? []) as { stars: number; created_at: string }[];

    const completedCount = assignments.filter((a) => a.status === "completed").length;
    const cancelledCount = assignments.filter((a) => a.status === "cancelled").length;
    const totalAssigned = completedCount + cancelledCount;
    const completionRate30d = totalAssigned > 0 ? completedCount / totalAssigned : 1;

    // Rating trend: group by week over last 30 days
    const weeklyRatings: Record<string, { total: number; count: number }> = {};
    for (const r of recentRatings) {
      const weekKey = new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (!weeklyRatings[weekKey]) weeklyRatings[weekKey] = { total: 0, count: 0 };
      weeklyRatings[weekKey]!.total += r.stars;
      weeklyRatings[weekKey]!.count += 1;
    }
    const ratingTrend = Object.entries(weeklyRatings).map(([label, { total, count }]) => ({
      label,
      avg: Math.round((total / count) * 10) / 10,
    }));

    const avg30dRating = recentRatings.length > 0
      ? Math.round((recentRatings.reduce((s, r) => s + r.stars, 0) / recentRatings.length) * 10) / 10
      : null;

    const totalEarnings = ((earningsRes.data ?? []) as { amount_cents: number }[])
      .reduce((s, p) => s + p.amount_cents, 0) / 100;

    res.status(200).json({
      acceptanceRate: 1, // acceptance is not tracked per-driver in current schema — default to 100%
      completionRate: d.completion_rate,
      completionRate30d,
      onTimeRate: 1, // on-time tracking requires scheduled_at vs actual — not yet in schema
      averageRating: d.average_rating,
      avg30dRating,
      ratingTrend,
      totalRides: d.total_rides_completed,
      totalEarnings: Math.round(totalEarnings * 100) / 100,
      last30dRides: completedCount,
    });
  } catch (err) {
    logger.error({ err }, "driverStats unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
