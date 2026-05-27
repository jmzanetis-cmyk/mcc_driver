// ============================================================
// MCC API — Announcements
// GET  /api/announcements        — active announcements + read status
// POST /api/announcements/:id/read — mark one as read
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

async function resolveDriver(authHeader: string | undefined): Promise<{ driverId: string } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data } = await supabaseAdmin.from("drivers").select("id").eq("user_id", user.id).single();
  const driverId = (data as { id: string } | null)?.id;
  if (!driverId) return null;
  return { driverId };
}

// ── GET /api/announcements ───────────────────────────────────────────────────
router.get("/announcements", async (req: Request, res: Response) => {
  try {
    const ctx = await resolveDriver(req.headers.authorization);
    if (!ctx) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { data: announcements, error } = await supabaseAdmin
      .from("driver_announcements")
      .select("id, title, body, type, published_at")
      .eq("active", true)
      .order("published_at", { ascending: false })
      .limit(50);

    if (error) { res.status(500).json({ error: "Failed to fetch announcements" }); return; }

    const ids = (announcements ?? []).map((a: { id: string }) => a.id);
    let readSet = new Set<string>();

    if (ids.length > 0) {
      const { data: reads } = await supabaseAdmin
        .from("driver_announcement_reads")
        .select("announcement_id")
        .eq("driver_id", ctx.driverId)
        .in("announcement_id", ids);
      readSet = new Set((reads ?? []).map((r: { announcement_id: string }) => r.announcement_id));
    }

    type AnnRow = { id: string; title: string; body: string; type: string; published_at: string };
    const result = (announcements ?? [] as AnnRow[]).map((a: AnnRow) => ({
      ...a,
      read: readSet.has(a.id),
    }));

    const unreadCount = result.filter((a) => !a.read).length;
    res.json({ announcements: result, unreadCount });
  } catch (err) {
    logger.error({ err }, "announcements.get unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/announcements/:id/read ────────────────────────────────────────
router.post("/announcements/:id/read", async (req: Request, res: Response) => {
  try {
    const ctx = await resolveDriver(req.headers.authorization);
    if (!ctx) { res.status(401).json({ error: "Unauthorized" }); return; }

    const announcementId = String(req.params.id ?? "");
    if (!announcementId) { res.status(400).json({ error: "Missing announcement id" }); return; }

    await supabaseAdmin.from("driver_announcement_reads").upsert({
      announcement_id: announcementId,
      driver_id: ctx.driverId,
    }, { onConflict: "announcement_id,driver_id" });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "announcements.read unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
