// ============================================================
// MCC API — notifications routes
//
// GET  /api/notifications          — list driver's notifications
// POST /api/notifications          — create a notification (internal/server use)
// PATCH /api/notifications/read-all — mark all as read
// PATCH /api/notifications/:id/read — mark one as read
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

// ── Auth helper ────────────────────────────────────────────────────────────

async function resolveDriver(
  req: Request,
  res: Response,
): Promise<{ userId: string; driverId: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authorization token" });
    return null;
  }
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }

  const { data: driver, error: driverError } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (driverError || !driver) {
    res.status(404).json({ error: "Driver profile not found" });
    return null;
  }

  return { userId: user.id, driverId: (driver as { id: string }).id };
}

// ── GET /api/notifications ────────────────────────────────────────────────

router.get("/notifications", async (req: Request, res: Response) => {
  try {
    const caller = await resolveDriver(req, res);
    if (!caller) return;

    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const { data, error } = await supabaseAdmin
      .from("driver_notifications")
      .select("id, type, title, body, data, read, created_at")
      .eq("driver_id", caller.driverId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ err: error }, "Failed to fetch notifications");
      res.status(500).json({ error: "Failed to fetch notifications" });
      return;
    }

    const unreadCount = (data ?? []).filter((n: { read: boolean }) => !n.read).length;

    res.status(200).json({ notifications: data ?? [], unreadCount });
  } catch (err) {
    logger.error({ err }, "Unhandled error in GET /notifications");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/notifications (internal — called by other routes) ───────────

router.post("/notifications", async (req: Request, res: Response) => {
  try {
    const caller = await resolveDriver(req, res);
    if (!caller) return;

    const { type, title, body, data } = req.body as {
      type?: string;
      title?: string;
      body?: string;
      data?: Record<string, unknown>;
    };

    if (!type || !title || !body) {
      res.status(400).json({ error: "type, title, and body are required" });
      return;
    }

    const { error } = await supabaseAdmin.from("driver_notifications").insert({
      driver_id: caller.driverId,
      type,
      title,
      body,
      data: data ?? null,
    });

    if (error) {
      logger.error({ err: error }, "Failed to create notification");
      res.status(500).json({ error: "Failed to create notification" });
      return;
    }

    res.status(201).json({ success: true });
  } catch (err) {
    logger.error({ err }, "Unhandled error in POST /notifications");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/notifications/read-all ────────────────────────────────────

router.patch("/notifications/read-all", async (req: Request, res: Response) => {
  try {
    const caller = await resolveDriver(req, res);
    if (!caller) return;

    await supabaseAdmin
      .from("driver_notifications")
      .update({ read: true })
      .eq("driver_id", caller.driverId)
      .eq("read", false);

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err }, "Unhandled error in PATCH /notifications/read-all");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/notifications/:id/read ────────────────────────────────────

router.patch("/notifications/:id/read", async (req: Request, res: Response) => {
  try {
    const caller = await resolveDriver(req, res);
    if (!caller) return;

    const { id } = req.params;

    await supabaseAdmin
      .from("driver_notifications")
      .update({ read: true })
      .eq("id", id)
      .eq("driver_id", caller.driverId);

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err }, "Unhandled error in PATCH /notifications/:id/read");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Exported helper so other routes can insert notifications ───────────────

export async function createDriverNotification(
  driverId: string,
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabaseAdmin.from("driver_notifications").insert({
      driver_id: driverId,
      type,
      title,
      body,
      data: data ?? null,
    });
  } catch (err) {
    logger.warn({ err, driverId, type }, "createDriverNotification failed (non-fatal)");
  }
}

export default router;
