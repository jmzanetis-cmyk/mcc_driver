// ============================================================
// MCC API — Schedule routes
// GET  /api/schedule              — list driver's scheduled rides
// POST /api/schedule/accept       — accept a scheduled ride
// POST /api/schedule/reminders    — send 30-min-before reminders (cron)
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";
import { createDriverNotification } from "./notifications";
import { sendNativePush } from "../lib/webPush";

const router = Router();

async function getDriver(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .eq("user_id", user.id)
    .single();
  return data as { id: string } | null;
}

// ── GET /api/schedule ────────────────────────────────────────────────────────
router.get("/schedule", async (req: Request, res: Response) => {
  try {
    const driver = await getDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { data, error } = await supabaseAdmin
      .from("scheduled_rides")
      .select(`
        id, scheduled_at, status, reminder_sent,
        rides (
          id, scenario, tier, pickup_address, dropoff_address,
          estimated_fare, estimated_distance_miles, service_type
        )
      `)
      .eq("driver_id", driver.id)
      .in("status", ["pending", "accepted"])
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(20);

    if (error) { res.status(500).json({ error: "Failed to fetch schedule" }); return; }

    // Also fetch driver_assignments that the driver self-reserved via the map screen
    const { data: reservedData } = await supabaseAdmin
      .from("driver_assignments")
      .select(`
        id, status, created_at,
        rides (
          id, scenario, tier, pickup_address, dropoff_address,
          estimated_fare, estimated_distance_miles, service_type, scheduled_at
        )
      `)
      .eq("driver_id", driver.id)
      .eq("status", "reserved")
      .gte("response_deadline", new Date().toISOString())
      .order("response_deadline", { ascending: true })
      .limit(20);

    res.status(200).json({ schedule: data ?? [], reservedJobs: reservedData ?? [] });
  } catch (err) {
    logger.error({ err }, "schedule.get unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/schedule/accept ────────────────────────────────────────────────
router.post("/schedule/accept", async (req: Request, res: Response) => {
  try {
    const driver = await getDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { scheduleId } = req.body as { scheduleId?: unknown };
    if (typeof scheduleId !== "string") {
      res.status(400).json({ error: "scheduleId is required" }); return;
    }

    const { data: existing } = await supabaseAdmin
      .from("scheduled_rides")
      .select("id, driver_id, status")
      .eq("id", scheduleId)
      .maybeSingle();

    if (!existing) { res.status(404).json({ error: "Scheduled ride not found" }); return; }

    const row = existing as { id: string; driver_id: string | null; status: string };
    if (row.driver_id && row.driver_id !== driver.id) {
      res.status(403).json({ error: "Not your scheduled ride" }); return;
    }

    await supabaseAdmin
      .from("scheduled_rides")
      .update({ driver_id: driver.id, status: "accepted" })
      .eq("id", scheduleId);

    void createDriverNotification(
      driver.id,
      "system",
      "📅 Scheduled Ride Accepted",
      "You've confirmed an advance booking. We'll remind you 30 minutes before.",
      { scheduleId },
    );

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err }, "schedule.accept unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/schedule/reminders ─────────────────────────────────────────────
// Intended to be called by a cron (e.g., every 5 minutes) to send
// push notifications for rides starting within the next 30 minutes.
router.post("/schedule/reminders", async (req: Request, res: Response) => {
  // Protect with DISPATCH_API_KEY
  const key = req.headers["x-api-key"];
  if (key !== process.env["DISPATCH_API_KEY"]) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }

  try {
    const windowEnd = new Date(Date.now() + 31 * 60 * 1000).toISOString();
    const windowStart = new Date(Date.now() + 28 * 60 * 1000).toISOString();

    const { data } = await supabaseAdmin
      .from("scheduled_rides")
      .select("id, driver_id, scheduled_at, rides(scenario, pickup_address)")
      .eq("status", "accepted")
      .eq("reminder_sent", false)
      .gte("scheduled_at", windowStart)
      .lte("scheduled_at", windowEnd);

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      driver_id: string;
      scheduled_at: string;
      rides: { scenario: string; pickup_address: string } | null;
    }>;

    for (const row of rows) {
      if (!row.driver_id || !row.rides) continue;
      const pickup = row.rides.pickup_address.split(",")[0] ?? "pickup";
      void createDriverNotification(
        row.driver_id,
        "system",
        "📅 Ride in 30 minutes",
        `Your scheduled ride to ${pickup} starts soon. Tap to prepare.`,
        { scheduleId: row.id },
      );
      void sendNativePush(
        { kind: "driver", id: row.driver_id },
        { event: "schedule.reminder", title: "Ride in 30 minutes", body: `Your scheduled ride to ${pickup} starts soon.` },
      );
      await supabaseAdmin
        .from("scheduled_rides")
        .update({ reminder_sent: true })
        .eq("id", row.id);
    }

    res.status(200).json({ sent: rows.length });
  } catch (err) {
    logger.error({ err }, "schedule.reminders unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
