// ============================================================
// MCC API — Transport Request Endpoints
// ============================================================
// Two intake flows for vehicle relocation / concierge jobs:
//
//   FLOW 1 — MEMBER SELF-SERVICE (Supabase JWT auth)
//     POST   /api/transport/request
//     GET    /api/transport/request/:rideId/status
//     POST   /api/transport/request/:rideId/cancel
//
//   FLOW 2 — PROVIDER-INITIATED (DISPATCH_API_KEY auth)
//     POST   /api/transport/provider-request
//     GET    /api/transport/provider-requests
//
// Dispatch logic:
//   - Find online, capable drivers within 15 miles of pickup
//   - Sort by distance ASC → averageRating DESC → totalRidesCompleted ASC
//   - Offer to top N drivers (N = driversRequired for scenario)
//   - cascadeDispatch handles decline/timeout fallback (inherited from rides.ts)
// ============================================================

import { Router, type Request, type Response } from "express";
import { eq, and, inArray, isNotNull, asc, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { ridesTable, driverAssignmentsTable, driversTable, driverEarningsTable } from "@workspace/db/schema";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";
import { SCENARIO_CONFIG } from "../lib/scenarioConfig";
import { insertAssignmentViaSupabase, updateAssignmentViaSupabase, updateRideViaSupabase } from "../lib/supabaseAdmin";
import { notifyRideOffer } from "../lib/notifications";
import { calculateTransportFare } from "@workspace/shared/transportRates";
import { cascadeDispatch } from "./rides";

const router = Router();

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_DISPATCH_RADIUS_MILES = 15;
const RESPONSE_DEADLINE_SECONDS = 30;
const CANCEL_FEE_PERCENT = 25;

// Statuses where the driver has already started driving to pickup
const EN_ROUTE_STATUSES = new Set(["driver_en_route", "driver_arrived"]);
// Statuses where cancellation is impossible
const LOCKED_STATUSES = new Set(["in_progress", "completed", "cancelled", "dispatch_failed"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function verifySupabaseJwt(token: string): Promise<{ id: string } | null> {
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

function requireMemberAuth(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

function requireProviderAuth(req: Request, res: Response): boolean {
  const key = process.env.DISPATCH_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "Provider API not configured" });
      return false;
    }
    return true;
  }
  if (req.headers["x-api-key"] !== key) {
    res.status(401).json({ error: "Unauthorized — invalid provider key" });
    return false;
  }
  return true;
}

interface DriverWithDistance {
  id: string;
  lat: number;
  lng: number;
  averageRating: number;
  totalRidesCompleted: number;
  distanceMiles: number;
}

async function findNearestDrivers(
  pickupLat: number,
  pickupLng: number,
  drivesMemberVehicle: boolean,
  excludeIds: string[],
): Promise<DriverWithDistance[]> {
  const activeStatuses = ["pending", "accepted", "en_route", "arrived", "in_progress"];
  const busyRows = await db
    .select({ driverId: driverAssignmentsTable.driverId })
    .from(driverAssignmentsTable)
    .where(inArray(driverAssignmentsTable.status, activeStatuses));

  const busyIds = new Set(busyRows.map((r) => r.driverId));
  const allExclude = Array.from(new Set([...excludeIds, ...busyIds]));

  const whereClause = and(
    eq(driversTable.isOnline, true),
    eq(driversTable.status, "active"),
    isNotNull(driversTable.currentLat),
    isNotNull(driversTable.currentLng),
    drivesMemberVehicle ? eq(driversTable.canDriveMemberVehicle, true) : undefined,
    allExclude.length > 0 ? inArray(driversTable.id, allExclude) : undefined,
  );

  // Pull all online drivers (with GPS) then compute distance in JS.
  // For transport jobs the driver pool is small enough that this is fast.
  // A production scale-up would push the Haversine into Postgres.
  let candidates = await db
    .select({
      id: driversTable.id,
      currentLat: driversTable.currentLat,
      currentLng: driversTable.currentLng,
      averageRating: driversTable.averageRating,
      totalRidesCompleted: driversTable.totalRidesCompleted,
    })
    .from(driversTable)
    .where(
      and(
        eq(driversTable.isOnline, true),
        eq(driversTable.status, "active"),
        isNotNull(driversTable.currentLat),
        isNotNull(driversTable.currentLng),
        drivesMemberVehicle ? eq(driversTable.canDriveMemberVehicle, true) : undefined,
      ),
    )
    .orderBy(desc(driversTable.averageRating), asc(driversTable.totalRidesCompleted));

  // Exclude busy + previously-tried drivers
  if (allExclude.length > 0) {
    const excludeSet = new Set(allExclude);
    candidates = candidates.filter((d) => !excludeSet.has(d.id));
  }

  return candidates
    .map((d) => ({
      id: d.id,
      lat: d.currentLat!,
      lng: d.currentLng!,
      averageRating: d.averageRating,
      totalRidesCompleted: d.totalRidesCompleted,
      distanceMiles: haversineDistance(pickupLat, pickupLng, d.currentLat!, d.currentLng!),
    }))
    .filter((d) => d.distanceMiles <= MAX_DISPATCH_RADIUS_MILES)
    .sort((a, b) => {
      if (Math.abs(a.distanceMiles - b.distanceMiles) > 0.1) return a.distanceMiles - b.distanceMiles;
      if (a.averageRating !== b.averageRating) return b.averageRating - a.averageRating;
      return a.totalRidesCompleted - b.totalRidesCompleted;
    });
}

// ── Core dispatch helper ──────────────────────────────────────────────────────
// Creates the ride record and dispatches to nearest eligible drivers.
// Returns the created ride row or throws.

async function createAndDispatchTransportRide(params: {
  scenario: string;
  tier: string;
  requestSource: string;
  requestedByUserId: string;
  memberId?: string;
  memberName?: string;
  memberPhone?: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  distanceMiles: number;
  memberVehicleYear?: number;
  memberVehicleMake?: string;
  memberVehicleModel?: string;
  memberVehicleColor?: string;
  memberVehiclePlate?: string;
  subsidyPercent?: number;
  notes?: string;
  scheduledAt?: Date | null;
}): Promise<typeof ridesTable.$inferSelect> {
  const config = SCENARIO_CONFIG[params.scenario];
  if (!config) throw new Error(`Unknown scenario: ${params.scenario}`);

  const fareResult = calculateTransportFare(
    params.distanceMiles,
    params.tier === "tier_3_vehicle_paired" || params.tier === "tier_4_full_concierge",
  );

  const isScheduled = params.scheduledAt && params.scheduledAt > new Date();
  const initialStatus = isScheduled ? "scheduled" : "pending_dispatch";

  const memberVehicleDesc =
    params.memberVehicleYear && params.memberVehicleMake
      ? `${params.memberVehicleYear} ${params.memberVehicleColor ?? ""} ${params.memberVehicleMake} ${params.memberVehicleModel ?? ""}`.trim()
      : null;

  const [ride] = await db
    .insert(ridesTable)
    .values({
      scenario: params.scenario,
      tier: params.tier,
      serviceType: "concierge",
      status: initialStatus,
      memberId: params.memberId ?? params.requestedByUserId,
      memberName: params.memberName ?? null,
      memberPhone: params.memberPhone ?? null,
      pickupAddress: params.pickupAddress,
      pickupLat: params.pickupLat,
      pickupLng: params.pickupLng,
      dropoffAddress: params.dropoffAddress,
      dropoffLat: params.dropoffLat,
      dropoffLng: params.dropoffLng,
      estimatedFare: fareResult.totalCents / 100,
      estimatedDistanceMiles: params.distanceMiles,
      memberVehicleYear: params.memberVehicleYear ?? null,
      memberVehicleMake: params.memberVehicleMake ?? null,
      memberVehicleModel: params.memberVehicleModel ?? null,
      memberVehicleColor: params.memberVehicleColor ?? null,
      memberVehiclePlate: params.memberVehiclePlate ?? null,
      subsidyPercent: params.subsidyPercent ?? null,
      requestSource: params.requestSource,
      requestedByUserId: params.requestedByUserId,
      scheduledAt: params.scheduledAt ?? null,
      packageDescription: params.notes ?? null,
      tandemRequired: config.driversRequired > 1,
    })
    .returning();

  if (!ride) throw new Error("Failed to create ride record");

  // Scheduled rides are not dispatched now — a scheduler fires 30 min before scheduledAt.
  if (isScheduled) {
    logger.info({ rideId: ride.id, scheduledAt: params.scheduledAt }, "transport: scheduled ride created, dispatch deferred");
    return ride;
  }

  // ── Immediate dispatch ───────────────────────────────────────────────────
  const responseDeadline = new Date(Date.now() + RESPONSE_DEADLINE_SECONDS * 1000);

  // Find nearest eligible drivers per role
  for (const assignmentCfg of config.assignments) {
    const nearestDrivers = await findNearestDrivers(
      params.pickupLat,
      params.pickupLng,
      assignmentCfg.drivesMemberVehicle,
      [],
    );

    if (nearestDrivers.length === 0) {
      logger.warn({ rideId: ride.id, role: assignmentCfg.role }, "transport: no eligible drivers within radius");
      await db.update(ridesTable).set({ status: "dispatch_failed" }).where(eq(ridesTable.id, ride.id));
      throw new Error("No drivers available within 15 miles. Try scheduling for a later time.");
    }

    const targetDriver = nearestDrivers[0]!;

    const [inserted] = await insertAssignmentViaSupabase({
      ride_id: ride.id,
      driver_id: targetDriver.id,
      role: assignmentCfg.role,
      status: "pending",
      drives_member_vehicle: assignmentCfg.drivesMemberVehicle,
      carries_passenger: assignmentCfg.carriesPassenger,
      response_deadline: responseDeadline.toISOString(),
      member_vehicle_description: assignmentCfg.drivesMemberVehicle ? memberVehicleDesc : null,
    });

    if (inserted) {
      void notifyRideOffer(
        inserted.driver_id,
        ride.id,
        inserted.id,
        ride.estimatedFare,
        ride.pickupAddress,
      ).catch((err) => logger.warn({ err, rideId: ride.id }, "transport: push notification failed"));
    }
  }

  logger.info({ rideId: ride.id, scenario: params.scenario }, "transport: dispatched");
  return ride;
}

// ── POST /api/transport/request ───────────────────────────────────────────────

router.post("/transport/request", async (req: Request, res: Response) => {
  const token = requireMemberAuth(req);
  if (!token) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  const user = await verifySupabaseJwt(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const body = req.body as {
    pickupAddress?: string;
    pickupLat?: number;
    pickupLng?: number;
    dropoffAddress?: string;
    dropoffLat?: number;
    dropoffLng?: number;
    memberVehicleYear?: number;
    memberVehicleMake?: string;
    memberVehicleModel?: string;
    memberVehicleColor?: string;
    memberVehiclePlate?: string;
    isTandem?: boolean;
    notes?: string;
    scheduledAt?: string;
  };

  if (!body.pickupAddress || body.pickupLat == null || body.pickupLng == null ||
      !body.dropoffAddress || body.dropoffLat == null || body.dropoffLng == null) {
    res.status(400).json({ error: "Missing required location fields" });
    return;
  }

  if (!body.memberVehicleMake || !body.memberVehicleModel) {
    res.status(400).json({ error: "memberVehicleMake and memberVehicleModel are required" });
    return;
  }

  const isTandem = !!body.isTandem;
  const scenario = isTandem ? "member_direct_tandem" : "member_direct_solo";
  const tier = isTandem ? "tier_3_vehicle_paired" : "tier_2_vehicle_solo";

  const distanceMiles = haversineDistance(body.pickupLat, body.pickupLng, body.dropoffLat, body.dropoffLng);
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;

  try {
    const fareResult = calculateTransportFare(distanceMiles, isTandem);

    const ride = await createAndDispatchTransportRide({
      scenario,
      tier,
      requestSource: "member_direct",
      requestedByUserId: user.id,
      pickupAddress: body.pickupAddress,
      pickupLat: body.pickupLat,
      pickupLng: body.pickupLng,
      dropoffAddress: body.dropoffAddress,
      dropoffLat: body.dropoffLat,
      dropoffLng: body.dropoffLng,
      distanceMiles,
      memberVehicleYear: body.memberVehicleYear,
      memberVehicleMake: body.memberVehicleMake,
      memberVehicleModel: body.memberVehicleModel,
      memberVehicleColor: body.memberVehicleColor,
      memberVehiclePlate: body.memberVehiclePlate,
      notes: body.notes,
      scheduledAt,
    });

    res.status(201).json({
      rideId: ride.id,
      status: ride.status,
      estimatedFareCents: fareResult.totalCents,
      driverShareCents: fareResult.driverCents,
      tierLabel: fareResult.tierLabel,
      scheduledAt: scheduledAt?.toISOString() ?? null,
      distanceMiles: Math.round(distanceMiles * 10) / 10,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    if (msg.includes("No drivers available")) {
      res.status(503).json({ error: msg, code: "NO_DRIVERS" });
    } else {
      logger.error({ err, userId: user.id }, "transport.request failed");
      res.status(500).json({ error: "Failed to create transport request" });
    }
  }
});

// ── GET /api/transport/request/:rideId/status ─────────────────────────────────

router.get("/transport/request/:rideId/status", async (req: Request, res: Response) => {
  const token = requireMemberAuth(req);
  if (!token) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  const user = await verifySupabaseJwt(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const rideId = req.params["rideId"] as string;

  try {
    const [ride] = await db
      .select()
      .from(ridesTable)
      .where(eq(ridesTable.id, rideId))
      .limit(1);

    if (!ride) {
      res.status(404).json({ error: "Ride not found" });
      return;
    }

    // Caller must have requested this ride
    if (ride.requestedByUserId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Find the active primary assignment
    const assignments = await db
      .select()
      .from(driverAssignmentsTable)
      .where(
        and(
          eq(driverAssignmentsTable.rideId, rideId),
          eq(driverAssignmentsTable.role, "primary"),
        ),
      )
      .orderBy(desc(driverAssignmentsTable.createdAt))
      .limit(1);

    const assignment = assignments[0] ?? null;
    let driverInfo: {
      driverId: string;
      driverName: string;
      driverPhone: string | null;
      driverPhoto: string | null;
      currentLat: number | null;
      currentLng: number | null;
    } | null = null;

    if (assignment && !["rejected", "expired"].includes(assignment.status)) {
      const [driver] = await db
        .select({
          id: driversTable.id,
          firstName: driversTable.firstName,
          lastName: driversTable.lastName,
          phone: driversTable.phone,
          profilePhotoUrl: driversTable.profilePhotoUrl,
          currentLat: driversTable.currentLat,
          currentLng: driversTable.currentLng,
        })
        .from(driversTable)
        .where(eq(driversTable.id, assignment.driverId))
        .limit(1);

      if (driver) {
        driverInfo = {
          driverId: driver.id,
          driverName: `${driver.firstName} ${driver.lastName}`,
          driverPhone: driver.phone,
          driverPhoto: driver.profilePhotoUrl,
          currentLat: driver.currentLat,
          currentLng: driver.currentLng,
        };
      }
    }

    // Map ride status to a current stage string for display
    const stageMap: Record<string, string> = {
      scheduled: "scheduled",
      pending_dispatch: "finding_driver",
      dispatch_failed: "no_driver_found",
      driver_accepted: "driver_accepted",
      driver_en_route: "driver_en_route",
      driver_arrived: "driver_arrived",
      in_progress: "in_progress",
      completed: "completed",
      cancelled: "cancelled",
    };

    res.json({
      rideId: ride.id,
      status: ride.status,
      currentStage: stageMap[ride.status] ?? ride.status,
      scheduledAt: ride.scheduledAt?.toISOString() ?? null,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      estimatedFareCents: Math.round(ride.estimatedFare * 100),
      ...driverInfo,
    });
  } catch (err) {
    logger.error({ err, rideId }, "transport.status failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/transport/request/:rideId/cancel ────────────────────────────────

router.post("/transport/request/:rideId/cancel", async (req: Request, res: Response) => {
  const token = requireMemberAuth(req);
  if (!token) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  const user = await verifySupabaseJwt(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const rideId = req.params["rideId"] as string;

  try {
    const [ride] = await db
      .select()
      .from(ridesTable)
      .where(eq(ridesTable.id, rideId))
      .limit(1);

    if (!ride) {
      res.status(404).json({ error: "Ride not found" });
      return;
    }

    if (ride.requestedByUserId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (LOCKED_STATUSES.has(ride.status)) {
      res.status(409).json({
        error: `Cannot cancel a ride with status '${ride.status}'`,
        status: ride.status,
      });
      return;
    }

    // Determine cancel fee
    const isEnRoute = EN_ROUTE_STATUSES.has(ride.status);
    const cancelFeeCents = isEnRoute
      ? Math.round(ride.estimatedFare * 100 * CANCEL_FEE_PERCENT / 100)
      : 0;

    // Mark ride cancelled
    await db
      .update(ridesTable)
      .set({ status: "cancelled" })
      .where(eq(ridesTable.id, rideId));

    await updateRideViaSupabase(rideId, { status: "cancelled" });

    // Cancel all pending/accepted/en_route assignments so drivers get notified
    const activeAssignments = await db
      .select({ id: driverAssignmentsTable.id, driverId: driverAssignmentsTable.driverId })
      .from(driverAssignmentsTable)
      .where(
        and(
          eq(driverAssignmentsTable.rideId, rideId),
          inArray(driverAssignmentsTable.status, ["pending", "accepted", "en_route"]),
        ),
      );

    if (activeAssignments.length > 0) {
      await updateAssignmentViaSupabase(
        activeAssignments.map((a) => a.id),
        { status: "cancelled" },
      );
    }

    // If en_route, compensate the driver with a cancel fee earning
    if (isEnRoute && cancelFeeCents > 0 && activeAssignments.length > 0) {
      const primaryAssignment = activeAssignments[0]!;
      await supabaseAdmin.from("driver_earnings").insert({
        driver_id: primaryAssignment.driverId,
        job_id: rideId,
        amount_cents: cancelFeeCents,
        kind: "adjustment",
        payout_status: "pending",
        notes: `Cancel fee (${CANCEL_FEE_PERCENT}% of estimated fare — driver was en route)`,
        recorded_at: new Date().toISOString(),
      });
    }

    logger.info({ rideId, cancelFeeCents, isEnRoute }, "transport: cancelled");

    res.json({
      success: true,
      rideId,
      cancelFeeCents,
      cancelFeeApplied: isEnRoute,
      message: isEnRoute
        ? `Cancellation fee of $${(cancelFeeCents / 100).toFixed(2)} applied — driver was already en route.`
        : "Cancelled at no charge.",
    });
  } catch (err) {
    logger.error({ err, rideId }, "transport.cancel failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/transport/provider-request ──────────────────────────────────────

router.post("/transport/provider-request", async (req: Request, res: Response) => {
  if (!requireProviderAuth(req, res)) return;

  const body = req.body as {
    providerId?: string;
    memberProfileId?: string;
    memberName?: string;
    memberPhone?: string;
    packageId?: string;
    pickupAddress?: string;
    pickupLat?: number;
    pickupLng?: number;
    dropoffAddress?: string;
    dropoffLat?: number;
    dropoffLng?: number;
    vehicleYear?: number;
    vehicleMake?: string;
    vehicleModel?: string;
    vehicleColor?: string;
    vehiclePlate?: string;
    isTandem?: boolean;
    subsidyPercent?: number;
    notes?: string;
    scheduledAt?: string;
  };

  if (!body.providerId || typeof body.providerId !== "string") {
    res.status(400).json({ error: "providerId is required" });
    return;
  }

  if (!body.pickupAddress || body.pickupLat == null || body.pickupLng == null ||
      !body.dropoffAddress || body.dropoffLat == null || body.dropoffLng == null) {
    res.status(400).json({ error: "Missing required location fields" });
    return;
  }

  if (!body.vehicleMake || !body.vehicleModel) {
    res.status(400).json({ error: "vehicleMake and vehicleModel are required" });
    return;
  }

  const isTandem = !!body.isTandem;
  const scenario = isTandem ? "provider_requested_tandem" : "provider_requested_solo";
  const tier = isTandem ? "tier_3_vehicle_paired" : "tier_2_vehicle_solo";

  const subsidyPct = Math.min(100, Math.max(0, body.subsidyPercent ?? 0));
  const distanceMiles = haversineDistance(body.pickupLat, body.pickupLng, body.dropoffLat, body.dropoffLng);
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;

  try {
    const fareResult = calculateTransportFare(distanceMiles, isTandem);
    const providerPaysCents = Math.round(fareResult.totalCents * subsidyPct / 100);
    const memberPaysCents = fareResult.totalCents - providerPaysCents;

    const ride = await createAndDispatchTransportRide({
      scenario,
      tier,
      requestSource: "provider_requested",
      requestedByUserId: body.providerId,
      memberId: body.memberProfileId,
      memberName: body.memberName,
      memberPhone: body.memberPhone,
      pickupAddress: body.pickupAddress,
      pickupLat: body.pickupLat,
      pickupLng: body.pickupLng,
      dropoffAddress: body.dropoffAddress,
      dropoffLat: body.dropoffLat,
      dropoffLng: body.dropoffLng,
      distanceMiles,
      memberVehicleYear: body.vehicleYear,
      memberVehicleMake: body.vehicleMake,
      memberVehicleModel: body.vehicleModel,
      memberVehicleColor: body.vehicleColor,
      memberVehiclePlate: body.vehiclePlate,
      subsidyPercent: subsidyPct,
      notes: body.notes ? `[pkg:${body.packageId ?? "—"}] ${body.notes}` : body.packageId ? `[pkg:${body.packageId}]` : undefined,
      scheduledAt,
    });

    logger.info({ rideId: ride.id, providerId: body.providerId, subsidyPct }, "provider transport request created");

    res.status(201).json({
      rideId: ride.id,
      status: ride.status,
      totalFareCents: fareResult.totalCents,
      driverShareCents: fareResult.driverCents,
      providerPaysCents,
      memberPaysCents,
      tierLabel: fareResult.tierLabel,
      scheduledAt: scheduledAt?.toISOString() ?? null,
      distanceMiles: Math.round(distanceMiles * 10) / 10,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    if (msg.includes("No drivers available")) {
      res.status(503).json({ error: msg, code: "NO_DRIVERS" });
    } else {
      logger.error({ err, providerId: body.providerId }, "transport.provider-request failed");
      res.status(500).json({ error: "Failed to create provider transport request" });
    }
  }
});

// ── GET /api/transport/provider-requests ─────────────────────────────────────

router.get("/transport/provider-requests", async (req: Request, res: Response) => {
  if (!requireProviderAuth(req, res)) return;

  const providerId = req.query["providerId"] as string | undefined;
  if (!providerId) {
    res.status(400).json({ error: "providerId query param is required" });
    return;
  }

  const limit = Math.min(100, parseInt(String(req.query["limit"] ?? "20")));
  const statusFilter = req.query["status"] as string | undefined;

  try {
    const rides = await db
      .select({
        id: ridesTable.id,
        status: ridesTable.status,
        scenario: ridesTable.scenario,
        pickupAddress: ridesTable.pickupAddress,
        dropoffAddress: ridesTable.dropoffAddress,
        estimatedFare: ridesTable.estimatedFare,
        actualFare: ridesTable.actualFare,
        subsidyPercent: ridesTable.subsidyPercent,
        memberVehicleMake: ridesTable.memberVehicleMake,
        memberVehicleModel: ridesTable.memberVehicleModel,
        memberVehicleYear: ridesTable.memberVehicleYear,
        memberVehiclePlate: ridesTable.memberVehiclePlate,
        tandemRequired: ridesTable.tandemRequired,
        scheduledAt: ridesTable.scheduledAt,
        createdAt: ridesTable.createdAt,
        packageDescription: ridesTable.packageDescription,
      })
      .from(ridesTable)
      .where(
        and(
          eq(ridesTable.requestedByUserId, providerId),
          eq(ridesTable.requestSource, "provider_requested"),
          statusFilter ? eq(ridesTable.status, statusFilter) : undefined,
        ),
      )
      .orderBy(desc(ridesTable.createdAt))
      .limit(limit);

    res.json({
      providerId,
      count: rides.length,
      rides: rides.map((r) => ({
        ...r,
        estimatedFareCents: Math.round((r.estimatedFare ?? 0) * 100),
        actualFareCents: r.actualFare != null ? Math.round(r.actualFare * 100) : null,
        providerPaysCents: r.subsidyPercent != null && r.estimatedFare != null
          ? Math.round(r.estimatedFare * 100 * r.subsidyPercent / 100)
          : null,
        scheduledAt: r.scheduledAt?.toISOString() ?? null,
        createdAt: r.createdAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    logger.error({ err, providerId }, "transport.provider-requests list failed");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
