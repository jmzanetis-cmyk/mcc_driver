// ============================================================
// MCC API — GET/POST/DELETE /api/mileage
// ============================================================
// Per-trip odometer log for IRS standard mileage deduction.
// IRS rate for 2026: $0.70 / mile.
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

export const IRS_RATE_2026 = 0.70;

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
    .select("id")
    .eq("profile_id", user.id)
    .single();
  if (driverError || !driver) {
    res.status(404).json({ error: "Driver profile not found" });
    return null;
  }
  return driver.id as string;
}

// ── GET /api/mileage ──────────────────────────────────────────────────────────

router.get("/mileage", async (req: Request, res: Response) => {
  try {
    const driverId = await resolveDriver(req, res);
    if (!driverId) return;

    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const yearStart = `${year}-01-01T00:00:00Z`;
    const yearEnd = `${year + 1}-01-01T00:00:00Z`;

    const { data: logs, error } = await supabaseAdmin
      .from("driver_mileage_logs")
      .select("id, trip_date, start_miles, end_miles, total_miles, notes, created_at")
      .eq("driver_id", driverId)
      .gte("trip_date", yearStart)
      .lt("trip_date", yearEnd)
      .order("trip_date", { ascending: false });

    if (error) {
      logger.error({ err: error }, "Failed to fetch mileage logs");
      res.status(500).json({ error: "Failed to fetch mileage logs" });
      return;
    }

    const totalMiles = (logs ?? []).reduce((sum, l) => sum + (l.total_miles ?? 0), 0);
    const deductionDollars = totalMiles * IRS_RATE_2026;

    res.json({
      logs: logs ?? [],
      summary: {
        totalMiles: Math.round(totalMiles * 10) / 10,
        irsRate: IRS_RATE_2026,
        deductionDollars: Math.round(deductionDollars * 100) / 100,
        year,
      },
    });
  } catch (err) {
    logger.error({ err }, "Unhandled error in GET /mileage");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/mileage ─────────────────────────────────────────────────────────

router.post("/mileage", async (req: Request, res: Response) => {
  try {
    const driverId = await resolveDriver(req, res);
    if (!driverId) return;

    const { tripDate, startMiles, endMiles, notes } = req.body as {
      tripDate: string;
      startMiles: number;
      endMiles: number;
      notes?: string;
    };

    if (!tripDate || startMiles == null || endMiles == null) {
      res.status(400).json({ error: "tripDate, startMiles, and endMiles are required" });
      return;
    }
    if (endMiles <= startMiles) {
      res.status(400).json({ error: "endMiles must be greater than startMiles" });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from("driver_mileage_logs")
      .insert({
        driver_id: driverId,
        trip_date: tripDate,
        start_miles: startMiles,
        end_miles: endMiles,
        // total_miles is GENERATED ALWAYS — do not insert
        notes: notes ?? null,
      })
      .select("id, trip_date, start_miles, end_miles, total_miles, notes, created_at")
      .single();

    if (error) {
      logger.error({ err: error }, "Failed to insert mileage log");
      res.status(500).json({ error: "Failed to save mileage log" });
      return;
    }

    res.status(201).json({ log: data });
  } catch (err) {
    logger.error({ err }, "Unhandled error in POST /mileage");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/mileage/:id ───────────────────────────────────────────────────

router.delete("/mileage/:id", async (req: Request, res: Response) => {
  try {
    const driverId = await resolveDriver(req, res);
    if (!driverId) return;

    const { error } = await supabaseAdmin
      .from("driver_mileage_logs")
      .delete()
      .eq("id", req.params.id)
      .eq("driver_id", driverId);

    if (error) {
      logger.error({ err: error }, "Failed to delete mileage log");
      res.status(500).json({ error: "Failed to delete mileage log" });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Unhandled error in DELETE /mileage/:id");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
