// ============================================================
// MCC API — GET /api/milestones
// ============================================================
// Returns driver's earned achievement badges.
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

async function getDriverId(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data } = await supabaseAdmin.from("drivers").select("id").eq("user_id", user.id).single();
  return (data as { id: string } | null)?.id ?? null;
}

router.get("/milestones", async (req: Request, res: Response) => {
  try {
    const driverId = await getDriverId(req.headers.authorization);
    if (!driverId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { data, error } = await supabaseAdmin
      .from("driver_milestones")
      .select("id, kind, label, icon, earned_at")
      .eq("driver_id", driverId)
      .order("earned_at", { ascending: true });

    if (error) { res.status(500).json({ error: "Failed to fetch milestones" }); return; }
    res.json({ milestones: data ?? [] });
  } catch (err) {
    logger.error({ err }, "milestones.get unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
