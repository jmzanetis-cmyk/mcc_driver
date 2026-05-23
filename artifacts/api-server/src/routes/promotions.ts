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
  const { data } = await supabaseAdmin.from("drivers").select("id").eq("user_id", user.id).single();
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
// Called after ride completion to advance progress on active promotions.
router.post("/promotions/check", async (req: Request, res: Response) => {
  try {
    const driverId = await getDriverId(req.headers.authorization);
    if (!driverId) { res.status(401).json({ error: "Unauthorized" }); return; }

    // Fetch active promotions that haven't ended
    const now = new Date().toISOString();
    const { data: promos } = await supabaseAdmin
      .from("driver_promotions")
      .select("id, title, target_count, current_count, reward_amount, ends_at")
      .eq("driver_id", driverId)
      .eq("status", "active");

    if (!promos || promos.length === 0) {
      res.status(200).json({ updated: 0 }); return;
    }

    type Promo = { id: string; title: string; target_count: number; current_count: number; reward_amount: number; ends_at: string | null };
    const active = (promos as Promo[]).filter((p) => !p.ends_at || p.ends_at > now);
    let updated = 0;

    for (const p of active) {
      const newCount = p.current_count + 1;
      const completed = newCount >= p.target_count;

      await supabaseAdmin.from("driver_promotions").update({
        current_count: newCount,
        status: completed ? "completed" : "active",
        completed_at: completed ? now : null,
      }).eq("id", p.id);

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

    res.status(200).json({ updated });
  } catch (err) {
    logger.error({ err }, "promotions.check unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
