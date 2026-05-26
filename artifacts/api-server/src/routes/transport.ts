// ============================================================
// MCC API — Transport routes
// GET  /api/transport/estimate              — fare estimator (public)
// GET  /api/transport/scheduled-available   — open scheduled jobs near driver
// POST /api/transport/scheduled/:rideId/reserve — self-reserve a scheduled job
// ============================================================

import { Router, type Request, type Response } from "express";
import { eq, and, sql, asc, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { driversTable, ridesTable, driverAssignmentsTable } from "@workspace/db/schema";
import {
  calculateTransportFare,
  calculateMemberPrice,
  TRANSPORT_RATES,
} from "@workspace/shared/transportRates";
import { insertAssignmentViaSupabase } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

// ── Auth helper ──────────────────────────────────────────────────────────────
async function verifyDriver(
  authHeader: string | undefined,
): Promise<(typeof driversTable.$inferSelect) | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    });
    if (!userRes.ok) return null;
    const user = await userRes.json() as { id?: string };
    if (!user.id) return null;
    const [driver] = await db.select().from(driversTable).where(eq(driversTable.userId, user.id));
    return driver ?? null;
  } catch {
    return null;
  }
}

// ── GET /api/transport/estimate ──────────────────────────────────────────────
router.get("/transport/estimate", async (req: Request, res: Response) => {
  const milesRaw   = req.query.miles   as string | undefined;
  const tandemRaw  = req.query.tandem  as string | undefined;
  const subsidyRaw = req.query.subsidy as string | undefined;

  const miles = parseFloat(milesRaw ?? "");
  if (!Number.isFinite(miles) || miles <= 0) {
    res.status(400).json({ error: "miles must be a positive number" });
    return;
  }

  const isTandem       = tandemRaw === "true";
  const subsidyPercent = Math.min(100, Math.max(0, parseFloat(subsidyRaw ?? "0") || 0));

  let onlineDriverCount = 0;
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(driversTable)
      .where(and(eq(driversTable.isOnline, true), eq(driversTable.status, "active")));
    onlineDriverCount = row?.n ?? 0;
  } catch {
    // Non-fatal
  }

  const fare    = calculateTransportFare(miles, isTandem, { requestTime: new Date(), onlineDriverCount });
  const pricing = calculateMemberPrice(fare.totalCents, subsidyPercent);

  res.json({
    miles,
    isTandem,
    subsidyPercent,
    tierLabel:           fare.tierLabel,
    baseFareCents:       fare.baseFareCents,
    adjustedFareCents:   fare.adjustedFareCents,
    totalCents:          fare.totalCents,
    multiplierRate:      fare.multiplierRate,
    multiplierLabel:     fare.multiplierLabel,
    driverCents:         fare.driverCents,
    insuranceCents:      fare.insuranceCents,
    platformCents:       fare.platformCents,
    primaryDriverCents:  fare.primaryDriverCents,
    chaseDriverCents:    fare.chaseDriverCents,
    memberPaysCents:     pricing.memberPaysCents,
    providerPaysCents:   pricing.providerPaysCents,
    tipPresets:          TRANSPORT_RATES.tipPresets,
    tipWindowHours:      TRANSPORT_RATES.tipWindowHours,
  });
});

// ── GET /api/transport/scheduled-available ───────────────────────────────────
// Returns open scheduled rides within ~25 miles that have no active assignment.
// Query params: lat, lng, date (today|tomorrow|week|all), minFare (dollars), airportOnly
router.get("/transport/scheduled-available", async (req: Request, res: Response) => {
  try {
    const driver = await verifyDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radiusMiles = 25;
    const effectiveLat = Number.isFinite(lat) ? lat : 40.0;
    const latDelta = radiusMiles / 69;
    const lngDelta = radiusMiles / (69 * Math.cos(effectiveLat * Math.PI / 180));

    const dateFilter    = (req.query.date as string) || "all";
    const minFareDollars = parseFloat((req.query.minFare as string) || "0") || 0;
    const airportOnly   = req.query.airportOnly === "true";

    // Build date range condition
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const tomorrowEnd   = new Date(todayEnd);   tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
    const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);

    let dateCondition: SQL<unknown>;
    if (dateFilter === "today") {
      dateCondition = sql`${ridesTable.scheduledAt} BETWEEN ${todayStart.toISOString()}::timestamptz AND ${todayEnd.toISOString()}::timestamptz`;
    } else if (dateFilter === "tomorrow") {
      dateCondition = sql`${ridesTable.scheduledAt} BETWEEN ${tomorrowStart.toISOString()}::timestamptz AND ${tomorrowEnd.toISOString()}::timestamptz`;
    } else if (dateFilter === "week") {
      dateCondition = sql`${ridesTable.scheduledAt} <= ${weekEnd.toISOString()}::timestamptz`;
    } else {
      dateCondition = sql`TRUE`;
    }

    const conditions: (SQL<unknown> | undefined)[] = [
      eq(ridesTable.status, "scheduled"),
      sql`${ridesTable.scheduledAt} > NOW()`,
      // Exclude rides that already have an active or reserved assignment
      sql`NOT EXISTS (
        SELECT 1 FROM driver_assignments
        WHERE ride_id = rides.id
        AND status IN ('reserved', 'dispatched', 'accepted', 'en_route', 'arrived', 'started', 'completed')
      )`,
      dateCondition,
    ];

    // Bounding box filter (only when driver location is known)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      conditions.push(
        sql`${ridesTable.pickupLat} BETWEEN ${lat - latDelta} AND ${lat + latDelta}`,
        sql`${ridesTable.pickupLng} BETWEEN ${lng - lngDelta} AND ${lng + lngDelta}`,
      );
    }

    if (minFareDollars > 0) {
      conditions.push(sql`${ridesTable.estimatedFare} >= ${minFareDollars}`);
    }

    if (airportOnly) {
      conditions.push(
        sql`(LOWER(${ridesTable.pickupAddress}) LIKE '%airport%' OR LOWER(${ridesTable.dropoffAddress}) LIKE '%airport%')`,
      );
    }

    const jobs = await db
      .select({
        id:                    ridesTable.id,
        scenario:              ridesTable.scenario,
        tier:                  ridesTable.tier,
        pickupAddress:         ridesTable.pickupAddress,
        pickupLat:             ridesTable.pickupLat,
        pickupLng:             ridesTable.pickupLng,
        dropoffAddress:        ridesTable.dropoffAddress,
        scheduledAt:           ridesTable.scheduledAt,
        estimatedFare:         ridesTable.estimatedFare,
        estimatedDistanceMiles: ridesTable.estimatedDistanceMiles,
        serviceType:           ridesTable.serviceType,
        multiplierRate:        ridesTable.multiplierRate,
        multiplierLabel:       ridesTable.multiplierLabel,
      })
      .from(ridesTable)
      .where(and(...conditions))
      .orderBy(asc(ridesTable.scheduledAt))
      .limit(50);

    res.json({ jobs });
  } catch (err) {
    logger.error({ err }, "transport.scheduled-available unhandled error");
    res.status(500).json({ error: "Failed to fetch scheduled jobs" });
  }
});

// ── POST /api/transport/scheduled/:rideId/reserve ────────────────────────────
// Driver self-reserves an open scheduled job. Creates a driver_assignment
// with status='reserved'. The ride remains 'scheduled' until formal dispatch.
router.post("/transport/scheduled/:rideId/reserve", async (req: Request, res: Response) => {
  try {
    const driver = await verifyDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const rideId = String(req.params.rideId ?? '');
    if (!rideId) { res.status(400).json({ error: "Missing rideId" }); return; }

    // Verify ride is still available
    const [ride] = await db
      .select({ id: ridesTable.id, status: ridesTable.status, scheduledAt: ridesTable.scheduledAt })
      .from(ridesTable)
      .where(eq(ridesTable.id, rideId));

    if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
    if (ride.status !== "scheduled") { res.status(409).json({ error: "Ride is no longer available" }); return; }
    if (!ride.scheduledAt || ride.scheduledAt <= new Date()) {
      res.status(409).json({ error: "Ride time has already passed" }); return;
    }
    const scheduledAtIso = ride.scheduledAt.toISOString();

    // Check for existing active assignment
    const [existing] = await db
      .select({ id: driverAssignmentsTable.id })
      .from(driverAssignmentsTable)
      .where(
        and(
          eq(driverAssignmentsTable.rideId, rideId),
          sql`${driverAssignmentsTable.status} IN ('reserved', 'dispatched', 'accepted', 'en_route', 'arrived', 'started', 'completed')`,
        ),
      );

    if (existing) { res.status(409).json({ error: "Ride already reserved or in progress" }); return; }

    const [assignment] = await insertAssignmentViaSupabase({
      ride_id:              rideId,
      driver_id:            driver.id,
      role:                 "primary",
      status:               "reserved",
      drives_member_vehicle: false,
      carries_passenger:    false,
      response_deadline:    scheduledAtIso,
    });

    res.json({ success: true, assignmentId: assignment?.id });
  } catch (err) {
    logger.error({ err }, "transport.reserve unhandled error");
    res.status(500).json({ error: "Failed to reserve job" });
  }
});

export default router;
