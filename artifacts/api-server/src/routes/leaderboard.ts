// ============================================================
// MCC API — GET /api/leaderboard
// ============================================================
// Returns top drivers by earnings, rating, and rides completed.
// The requesting driver's own rank is highlighted in each category.
//
// Query params:
//   period  'weekly' | 'monthly'  (default: weekly)
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

// ── Auth helper ───────────────────────────────────────────────────────────────

async function resolveDriver(req: Request, res: Response) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authorization token" });
    return null;
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }
  const { data: driver, error: driverError } = await supabaseAdmin
    .from("drivers")
    .select("id, first_name, average_rating, total_rides_completed")
    .eq("profile_id", user.id)
    .single();
  if (driverError || !driver) {
    res.status(404).json({ error: "Driver profile not found" });
    return null;
  }
  return driver as { id: string; first_name: string; average_rating: number; total_rides_completed: number };
}

// ── GET /api/leaderboard ──────────────────────────────────────────────────────

router.get("/leaderboard", async (req: Request, res: Response) => {
  try {
    const driver = await resolveDriver(req, res);
    if (!driver) return;

    const period = (req.query.period as string) === "monthly" ? "monthly" : "weekly";
    const now = new Date();
    let periodStart: string;

    if (period === "monthly") {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    } else {
      const weekStart = new Date(now.getTime() - now.getDay() * 86_400_000);
      weekStart.setHours(0, 0, 0, 0);
      periodStart = weekStart.toISOString();
    }

    // ── Earnings leaderboard ─────────────────────────────────
    // Fetch earnings in period, group by driver in application layer
    const { data: earningsRows, error: earningsError } = await supabaseAdmin
      .from("driver_earnings")
      .select("driver_id, amount_cents, drivers!inner(id, first_name)")
      .gte("recorded_at", periodStart)
      .neq("payout_status", "pending");

    if (earningsError) {
      logger.error({ err: earningsError }, "Leaderboard: failed to fetch earnings");
      res.status(500).json({ error: "Failed to fetch leaderboard" });
      return;
    }

    // Group earnings by driver
    const earningsByDriver = new Map<string, { driverId: string; firstName: string; totalCents: number }>();
    for (const row of (earningsRows ?? [])) {
      const d = (row as unknown as { drivers: { id: string; first_name: string } }).drivers;
      const driverId = row.driver_id as string;
      if (!earningsByDriver.has(driverId)) {
        earningsByDriver.set(driverId, { driverId, firstName: d.first_name, totalCents: 0 });
      }
      earningsByDriver.get(driverId)!.totalCents += (row.amount_cents as number) ?? 0;
    }

    const earningsBoard = Array.from(earningsByDriver.values())
      .sort((a, b) => b.totalCents - a.totalCents)
      .slice(0, 10)
      .map((e, i) => ({
        rank: i + 1,
        driverId: e.driverId,
        firstName: e.firstName,
        value: e.totalCents / 100,
        isYou: e.driverId === driver.id,
      }));

    // Own earnings rank
    const earningsAll = Array.from(earningsByDriver.values())
      .sort((a, b) => b.totalCents - a.totalCents);
    const myEarningsRank = earningsAll.findIndex(e => e.driverId === driver.id) + 1;
    const myEarnings = earningsByDriver.get(driver.id)?.totalCents ?? 0;

    // ── Rating leaderboard ────────────────────────────────────
    // All-time from drivers table (period doesn't affect rating avg)
    const { data: ratingRows, error: ratingError } = await supabaseAdmin
      .from("drivers")
      .select("id, first_name, average_rating, total_rides_completed")
      .eq("status", "active")
      .gte("total_rides_completed", 5)  // require at least 5 rides for ranking
      .order("average_rating", { ascending: false })
      .limit(10);

    if (ratingError) {
      logger.error({ err: ratingError }, "Leaderboard: failed to fetch ratings");
      res.status(500).json({ error: "Failed to fetch leaderboard" });
      return;
    }

    const ratingBoard = (ratingRows ?? []).map((d, i) => ({
      rank: i + 1,
      driverId: d.id as string,
      firstName: d.first_name as string,
      value: d.average_rating as number,
      isYou: (d.id as string) === driver.id,
    }));

    // ── Rides completed leaderboard ───────────────────────────
    const { data: ridesRows, error: ridesError } = await supabaseAdmin
      .from("drivers")
      .select("id, first_name, total_rides_completed")
      .eq("status", "active")
      .order("total_rides_completed", { ascending: false })
      .limit(10);

    if (ridesError) {
      logger.error({ err: ridesError }, "Leaderboard: failed to fetch rides");
      res.status(500).json({ error: "Failed to fetch leaderboard" });
      return;
    }

    const ridesBoard = (ridesRows ?? []).map((d, i) => ({
      rank: i + 1,
      driverId: d.id as string,
      firstName: d.first_name as string,
      value: d.total_rides_completed as number,
      isYou: (d.id as string) === driver.id,
    }));

    res.json({
      period,
      periodStart,
      earnings: {
        board: earningsBoard,
        myRank: myEarningsRank || null,
        myValue: myEarnings / 100,
      },
      rating: {
        board: ratingBoard,
        myRank: ratingBoard.find(r => r.isYou)?.rank ?? null,
        myValue: driver.average_rating,
      },
      rides: {
        board: ridesBoard,
        myRank: ridesBoard.find(r => r.isYou)?.rank ?? null,
        myValue: driver.total_rides_completed,
      },
    });
  } catch (err) {
    logger.error({ err }, "Unhandled error in GET /leaderboard");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
