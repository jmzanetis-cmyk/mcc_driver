// ============================================================
// MCC API — Promotions routes
// GET  /api/promotions          — list driver's promotions
// POST /api/promotions/check    — evaluate progress after a ride
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";
import { createDriverNotification } from "./notifications";

const router = Router();

async function getDriverId(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data } = await supabaseAdmin.from("drivers").select("id").eq("profile_id", user.id).single();
  return (data as { id: string } | null)?.id ?? null;
}

// ── GET /api/promotions ──────────────────────────────────────────────────────
router.get("/promotions", async (req: Request, res: Response) => {
  try {
    const driverId = await getDriverId(req.headers.authorization);
    if (!driverId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { data, error } = await supabaseAdmin
      .from("driver_promotions")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) { res.status(500).json({ error: "Failed to fetch promotions" }); return; }
    res.status(200).json({ promotions: data ?? [] });
  } catch (err) {
    logger.error({ err }, "promotions.get unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/promotions/check ───────────────────────────────────────────────
// Called after ride completion to:
//  1. Advance progress on active promotions (with streak-date logic for streak type)
//  2. Check and award earnings/ride-count milestones
router.post("/promotions/check", async (req: Request, res: Response) => {
  try {
    const driverId = await getDriverId(req.headers.authorization);
    if (!driverId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const nowIso = now.toISOString();

    // ── 1. Advance active promotions ─────────────────────────────────────────
    const { data: promos } = await supabaseAdmin
      .from("driver_promotions")
      .select("id, type, title, target_count, current_count, reward_amount, ends_at, streak_last_date")
      .eq("driver_id", driverId)
      .eq("status", "active");

    type Promo = {
      id: string; type: string; title: string;
      target_count: number; current_count: number; reward_amount: number;
      ends_at: string | null; streak_last_date: string | null;
    };

    const active = (promos as Promo[] | null ?? [])
      .filter((p) => !p.ends_at || p.ends_at > nowIso);

    let updated = 0;

    for (const p of active) {
      let newCount = p.current_count;
      const updates: Record<string, unknown> = {};

      if (p.type === "streak") {
        // Consecutive-day streak logic
        const last = p.streak_last_date;
        if (last === todayStr) {
          // Already counted today — skip
          continue;
        } else if (last) {
          const lastDate = new Date(last);
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          const isConsecutive = lastDate.toISOString().slice(0, 10) === yesterday.toISOString().slice(0, 10);
          newCount = isConsecutive ? p.current_count + 1 : 1; // reset if broken
        } else {
          newCount = 1; // first ride
        }
        updates["streak_last_date"] = todayStr;
      } else {
        newCount = p.current_count + 1;
      }

      const completed = newCount >= p.target_count;
      updates["current_count"] = newCount;
      updates["status"] = completed ? "completed" : "active";
      if (completed) updates["completed_at"] = nowIso;

      await supabaseAdmin.from("driver_promotions").update(updates).eq("id", p.id);

      if (completed) {
        void createDriverNotification(
          driverId,
          "system",
          "🎯 Quest Complete!",
          `You completed "${p.title}" and earned $${p.reward_amount.toFixed(2)}!`,
          { promotionId: p.id, reward: p.reward_amount },
        );
      }
      updated++;
    }

    // ── 2. Check earnings + ride milestones ───────────────────────────────────
    await checkAndAwardMilestones(driverId, nowIso);

    res.status(200).json({ updated });
  } catch (err) {
    logger.error({ err }, "promotions.check unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Milestone definitions ─────────────────────────────────────────────────────
const EARNINGS_MILESTONES: Array<{ kind: string; threshold: number; label: string; icon: string }> = [
  { kind: "earnings_100",    threshold: 100,   label: "First $100 Earned",     icon: "💰" },
  { kind: "earnings_500",    threshold: 500,   label: "$500 Earned",            icon: "💸" },
  { kind: "earnings_1000",   threshold: 1000,  label: "$1,000 Earned",          icon: "🌟" },
  { kind: "earnings_5000",   threshold: 5000,  label: "$5,000 Earned",          icon: "👑" },
  { kind: "earnings_10000",  threshold: 10000, label: "$10,000 Earned",         icon: "🏦" },
];

const RIDE_MILESTONES: Array<{ kind: string; threshold: number; label: string; icon: string }> = [
  { kind: "rides_1",   threshold: 1,   label: "First Ride",       icon: "🚗" },
  { kind: "rides_10",  threshold: 10,  label: "10 Rides",         icon: "🎯" },
  { kind: "rides_25",  threshold: 25,  label: "25 Rides",         icon: "⭐" },
  { kind: "rides_50",  threshold: 50,  label: "50 Rides",         icon: "🏆" },
  { kind: "rides_100", threshold: 100, label: "100 Rides",        icon: "💫" },
  { kind: "rides_250", threshold: 250, label: "250 Rides",        icon: "🔥" },
  { kind: "rides_500", threshold: 500, label: "500 Rides",        icon: "💎" },
];

async function checkAndAwardMilestones(driverId: string, nowIso: string): Promise<void> {
  try {
    // Fetch already earned milestone kinds to avoid re-awarding
    const { data: earned } = await supabaseAdmin
      .from("driver_milestones")
      .select("kind")
      .eq("driver_id", driverId);
    const earnedKinds = new Set((earned ?? []).map((r: { kind: string }) => r.kind));

    // Check earnings milestones
    const { data: earningsRow } = await supabaseAdmin
      .from("driver_earnings")
      .select("amount_cents")
      .eq("driver_id", driverId)
      .not("kind", "eq", "adjustment");
    const totalEarningsCents = (earningsRow ?? [])
      .reduce((sum: number, r: { amount_cents: number }) => sum + r.amount_cents, 0);
    const totalEarnings = totalEarningsCents / 100;

    for (const m of EARNINGS_MILESTONES) {
      if (!earnedKinds.has(m.kind) && totalEarnings >= m.threshold) {
        await awardMilestone(driverId, m, nowIso);
        earnedKinds.add(m.kind);
      }
    }

    // Check ride milestones using driver's total_rides_completed
    const { data: driverRow } = await supabaseAdmin
      .from("drivers")
      .select("total_rides_completed")
      .eq("id", driverId)
      .single();
    const totalRides = (driverRow as { total_rides_completed: number } | null)?.total_rides_completed ?? 0;

    for (const m of RIDE_MILESTONES) {
      if (!earnedKinds.has(m.kind) && totalRides >= m.threshold) {
        await awardMilestone(driverId, m, nowIso);
      }
    }
  } catch (err) {
    logger.error({ err, driverId }, "checkAndAwardMilestones failed");
  }
}

async function awardMilestone(
  driverId: string,
  m: { kind: string; label: string; icon: string },
  nowIso: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from("driver_milestones").insert({
    driver_id: driverId,
    kind: m.kind,
    label: m.label,
    icon: m.icon,
    earned_at: nowIso,
  });

  if (!error) {
    void createDriverNotification(
      driverId,
      "milestone",
      `${m.icon} Achievement Unlocked!`,
      `You earned the "${m.label}" badge!`,
      { milestoneKind: m.kind },
    );
  }
}

export default router;
