// ============================================================
// MCC API — Rides Router
// ============================================================
// Handles ride dispatch and lifecycle transitions.
// Inserting into driver_assignments triggers Supabase Realtime,
// which delivers the request to the driver app in real time.
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, inArray, notInArray, isNotNull, lt, asc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  ridesTable,
  driverAssignmentsTable,
  driversTable,
  driverPayoutsTable,
} from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { SCENARIO_CONFIG } from "../lib/scenarioConfig";
import { insertAssignmentViaSupabase, updateAssignmentViaSupabase, updateRideViaSupabase } from "../lib/supabaseAdmin";

const router: IRouter = Router();

// ── Auth / identity helpers ───────────────────────────────────────────────────

interface SupabaseUser {
  id: string;
  email?: string;
}

async function verifySupabaseToken(token: string): Promise<SupabaseUser | null> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    logger.warn("Supabase env vars not configured — cannot verify JWT");
    return null;
  }

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as SupabaseUser;
    if (!user?.id) return null;
    return user;
  } catch {
    return null;
  }
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

/**
 * Requires the caller to be an authenticated Supabase user.
 * Returns the Supabase user on success, or sends 401 and returns null.
 */
async function requireUserAuth(req: Request, res: Response): Promise<SupabaseUser | null> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized — authentication required" });
    return null;
  }

  const user = await verifySupabaseToken(token);
  if (!user) {
    res.status(401).json({ error: "Unauthorized — invalid or expired token" });
    return null;
  }

  return user;
}

/**
 * Requires the DISPATCH_API_KEY service credential.
 * Used for privileged operations that must not be accessible to regular drivers.
 */
function requireDispatchKey(req: Request, res: Response): boolean {
  const dispatchKey = process.env.DISPATCH_API_KEY;
  if (!dispatchKey) {
    // If no key is configured, block all calls in production; allow in dev for setup convenience
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "Dispatch service not configured" });
      return false;
    }
    logger.warn("DISPATCH_API_KEY not set — dispatch endpoint unprotected in dev mode");
    return true;
  }

  const provided = req.headers["x-api-key"];
  if (provided !== dispatchKey) {
    res.status(401).json({ error: "Unauthorized — invalid service key" });
    return false;
  }

  return true;
}

/**
 * Looks up the driver record for an authenticated user.
 * Returns the driver row or sends 403/404 and returns null.
 */
async function resolveCallerDriver(
  user: SupabaseUser,
  res: Response,
): Promise<(typeof driversTable.$inferSelect) | null> {
  const [driver] = await db
    .select()
    .from(driversTable)
    .where(eq(driversTable.userId, user.id))
    .limit(1);

  if (!driver) {
    res.status(403).json({ error: "Forbidden — no driver profile found for this account" });
    return null;
  }

  return driver;
}

// ── Cascade dispatch helper ───────────────────────────────────────────────────
// When an assignment is declined or expires, attempt to re-offer the ride to
// the next available eligible driver for the same role. If no drivers remain,
// mark the ride as 'dispatch_failed'.

async function cascadeDispatch(
  rideId: string,
  declinedAssignment: typeof driverAssignmentsTable.$inferSelect,
): Promise<void> {
  // Fetch the ride — bail out if it's already in a terminal state
  const [ride] = await db
    .select()
    .from(ridesTable)
    .where(eq(ridesTable.id, rideId))
    .limit(1);

  if (!ride) {
    logger.warn({ rideId }, "cascadeDispatch: ride not found");
    return;
  }

  const terminalStatuses = ["completed", "dispatch_failed", "cancelled"];
  if (terminalStatuses.includes(ride.status)) {
    logger.info({ rideId, status: ride.status }, "cascadeDispatch: ride already in terminal state, skipping");
    return;
  }

  const config = SCENARIO_CONFIG[ride.scenario];
  if (!config) {
    logger.warn({ rideId, scenario: ride.scenario }, "cascadeDispatch: unknown scenario");
    return;
  }

  // Find the assignment config entry for this role
  const assignmentCfg = config.assignments.find((a) => a.role === declinedAssignment.role);
  if (!assignmentCfg) {
    logger.warn({ rideId, role: declinedAssignment.role }, "cascadeDispatch: role not found in scenario config");
    return;
  }

  // Collect all driver IDs already tried for this ride (any status) to avoid re-offering
  const priorAssignments = await db
    .select({ driverId: driverAssignmentsTable.driverId })
    .from(driverAssignmentsTable)
    .where(eq(driverAssignmentsTable.rideId, rideId));

  const triedDriverIds = priorAssignments.map((a) => a.driverId);

  // Exclude drivers currently busy on other rides
  const activeStatuses = ["pending", "accepted", "en_route", "arrived", "in_progress"];
  const busyDriverRows = await db
    .select({ driverId: driverAssignmentsTable.driverId })
    .from(driverAssignmentsTable)
    .where(inArray(driverAssignmentsTable.status, activeStatuses));

  const busyOnOtherRides = busyDriverRows
    .map((r) => r.driverId)
    .filter((id) => !triedDriverIds.includes(id));

  // Build exclusion list: tried for this ride OR busy elsewhere
  const excludeIds = Array.from(new Set([...triedDriverIds, ...busyOnOtherRides]));

  // Query for eligible drivers — ordered by totalRidesCompleted ASC (prefer less busy drivers)
  // then by createdAt ASC for a deterministic, fair tie-break
  const baseWhere = and(
    eq(driversTable.isOnline, true),
    eq(driversTable.status, "active"),
    isNotNull(driversTable.currentLat),
    isNotNull(driversTable.currentLng),
    excludeIds.length > 0 ? notInArray(driversTable.id, excludeIds) : undefined,
  );

  let eligibleDrivers = await db
    .select({ id: driversTable.id })
    .from(driversTable)
    .where(baseWhere)
    .orderBy(asc(driversTable.totalRidesCompleted), asc(driversTable.createdAt));

  // If this role requires driving the member's vehicle, restrict to capable drivers only
  if (assignmentCfg.drivesMemberVehicle) {
    eligibleDrivers = await db
      .select({ id: driversTable.id })
      .from(driversTable)
      .where(
        and(
          baseWhere,
          eq(driversTable.canDriveMemberVehicle, true),
        ),
      )
      .orderBy(asc(driversTable.totalRidesCompleted), asc(driversTable.createdAt));
  }

  // Guard: if a pending assignment already exists for this ride+role, skip insertion
  // (prevents duplicate re-offers from concurrent cascade invocations)
  const [existingPending] = await db
    .select({ id: driverAssignmentsTable.id })
    .from(driverAssignmentsTable)
    .where(
      and(
        eq(driverAssignmentsTable.rideId, rideId),
        eq(driverAssignmentsTable.role, declinedAssignment.role),
        eq(driverAssignmentsTable.status, "pending"),
      ),
    )
    .limit(1);

  if (existingPending) {
    logger.info({ rideId, role: declinedAssignment.role }, "cascadeDispatch: pending assignment already exists, skipping");
    return;
  }

  if (eligibleDrivers.length === 0) {
    logger.info({ rideId }, "cascadeDispatch: no eligible drivers remaining — marking dispatch_failed");
    await db
      .update(ridesTable)
      .set({ status: "dispatch_failed" })
      .where(eq(ridesTable.id, rideId));
    return;
  }

  const nextDriverId = eligibleDrivers[0]!.id;
  const deadlineSeconds = 30;
  const responseDeadline = new Date(Date.now() + deadlineSeconds * 1000);

  const memberVehicleDesc =
    ride.memberVehicleYear && ride.memberVehicleMake
      ? `${ride.memberVehicleYear} ${ride.memberVehicleColor ?? ""} ${ride.memberVehicleMake} ${ride.memberVehicleModel ?? ""}`.trim()
      : null;

  await insertAssignmentViaSupabase({
    ride_id: rideId,
    driver_id: nextDriverId,
    role: declinedAssignment.role,
    status: "pending",
    drives_member_vehicle: assignmentCfg.drivesMemberVehicle,
    carries_passenger: assignmentCfg.carriesPassenger,
    response_deadline: responseDeadline.toISOString(),
    member_vehicle_description: assignmentCfg.drivesMemberVehicle ? memberVehicleDesc : null,
  });

  logger.info({ rideId, nextDriverId, role: declinedAssignment.role }, "cascadeDispatch: re-offered ride to next driver");
}

// ── Background expiry sweep ───────────────────────────────────────────────────
// Periodically scans for pending assignments past their responseDeadline and
// triggers cascadeDispatch so rides are automatically re-offered without any
// driver action required (covers the case where a driver ignores the countdown).

export function startExpiryWorker(intervalMs = 15_000): NodeJS.Timeout {
  logger.info({ intervalMs }, "rides.expiryWorker: started");

  const sweep = async () => {
    try {
      const now = new Date();

      // Atomically mark all overdue pending assignments as expired in one statement.
      // The WHERE status='pending' guard prevents double-expiry under concurrent sweeps.
      const expired = await db
        .update(driverAssignmentsTable)
        .set({ status: "expired" })
        .where(
          and(
            eq(driverAssignmentsTable.status, "pending"),
            lt(driverAssignmentsTable.responseDeadline, now),
          ),
        )
        .returning();

      if (expired.length > 0) {
        logger.info({ count: expired.length }, "rides.expiryWorker: expired overdue assignments");
      }

      // Cascade each expired assignment to the next available driver
      for (const assignment of expired) {
        await cascadeDispatch(assignment.rideId, assignment);
      }
    } catch (err) {
      logger.error({ err }, "rides.expiryWorker: sweep error");
    }
  };

  return setInterval(() => { void sweep(); }, intervalMs);
}

// ── POST /api/rides/dispatch ──────────────────────────────────────────────────
// Restricted to service callers only (DISPATCH_API_KEY).
// Creates a ride and inserts driver_assignments rows. Supabase Realtime fires
// postgres_changes INSERT events to the subscribed driver apps immediately.

router.post("/rides/dispatch", async (req: Request, res: Response) => {
  if (!requireDispatchKey(req, res)) return;

  const body = req.body as {
    scenario: string;
    tier: string;
    pickupAddress: string;
    pickupLat: number;
    pickupLng: number;
    dropoffAddress: string;
    dropoffLat: number;
    dropoffLng: number;
    estimatedFare: number;
    estimatedDistanceMiles: number;
    memberId?: string;
    memberVehicleYear?: number;
    memberVehicleMake?: string;
    memberVehicleModel?: string;
    memberVehicleColor?: string;
    targetDriverIds?: string[];
    responseDeadlineSeconds?: number;
  };

  if (
    !body.scenario ||
    !body.tier ||
    !body.pickupAddress ||
    body.pickupLat == null ||
    body.pickupLng == null ||
    !body.dropoffAddress ||
    body.dropoffLat == null ||
    body.dropoffLng == null ||
    body.estimatedFare == null ||
    body.estimatedDistanceMiles == null
  ) {
    res.status(400).json({ error: "Missing required ride fields" });
    return;
  }

  const config = SCENARIO_CONFIG[body.scenario];
  if (!config) {
    res.status(400).json({ error: `Unknown scenario: ${body.scenario}` });
    return;
  }

  const deadlineSeconds = body.responseDeadlineSeconds ?? 30;
  const responseDeadline = new Date(Date.now() + deadlineSeconds * 1000);

  try {
    let targetDriverIds: string[] = body.targetDriverIds ?? [];

    if (targetDriverIds.length === 0) {
      const activeStatuses = ["pending", "accepted", "en_route", "arrived", "in_progress"];

      const busyDriverRows = await db
        .select({ driverId: driverAssignmentsTable.driverId })
        .from(driverAssignmentsTable)
        .where(inArray(driverAssignmentsTable.status, activeStatuses));

      const busyIds = busyDriverRows.map((r) => r.driverId);

      const eligibleDrivers = await db
        .select({ id: driversTable.id })
        .from(driversTable)
        .where(
          and(
            eq(driversTable.isOnline, true),
            eq(driversTable.status, "active"),
            isNotNull(driversTable.currentLat),
            isNotNull(driversTable.currentLng),
          ),
        );

      targetDriverIds = eligibleDrivers
        .map((d) => d.id)
        .filter((id) => !busyIds.includes(id));

      if (config.assignments.some((a) => a.drivesMemberVehicle)) {
        const capableDrivers = await db
          .select({ id: driversTable.id })
          .from(driversTable)
          .where(
            and(
              eq(driversTable.isOnline, true),
              eq(driversTable.status, "active"),
              eq(driversTable.canDriveMemberVehicle, true),
            ),
          );
        const capableIds = new Set(capableDrivers.map((d) => d.id));
        targetDriverIds = targetDriverIds.filter((id) => capableIds.has(id));
      }
    }

    const driversNeeded = config.driversRequired;
    if (targetDriverIds.length < driversNeeded) {
      res.status(404).json({
        error: `Not enough eligible drivers. Need ${driversNeeded}, found ${targetDriverIds.length}.`,
      });
      return;
    }

    const memberVehicleDesc =
      body.memberVehicleYear && body.memberVehicleMake
        ? `${body.memberVehicleYear} ${body.memberVehicleColor ?? ""} ${body.memberVehicleMake} ${body.memberVehicleModel ?? ""}`.trim()
        : null;

    const [ride] = await db
      .insert(ridesTable)
      .values({
        scenario: body.scenario,
        tier: body.tier,
        status: "pending_dispatch",
        memberId: body.memberId ?? null,
        pickupAddress: body.pickupAddress,
        pickupLat: body.pickupLat,
        pickupLng: body.pickupLng,
        dropoffAddress: body.dropoffAddress,
        dropoffLat: body.dropoffLat,
        dropoffLng: body.dropoffLng,
        estimatedFare: body.estimatedFare,
        estimatedDistanceMiles: body.estimatedDistanceMiles,
        memberVehicleYear: body.memberVehicleYear ?? null,
        memberVehicleMake: body.memberVehicleMake ?? null,
        memberVehicleModel: body.memberVehicleModel ?? null,
        memberVehicleColor: body.memberVehicleColor ?? null,
      })
      .returning();

    const selectedDriverIds = targetDriverIds.slice(0, driversNeeded);

    const assignmentValues = config.assignments.map((assignmentCfg, idx) => ({
      ride_id: ride!.id,
      driver_id: selectedDriverIds[idx]!,
      role: assignmentCfg.role,
      status: "pending",
      drives_member_vehicle: assignmentCfg.drivesMemberVehicle,
      carries_passenger: assignmentCfg.carriesPassenger,
      response_deadline: responseDeadline.toISOString(),
    }));

    await insertAssignmentViaSupabase(assignmentValues);

    req.log.info(
      { rideId: ride!.id, driversNotified: assignmentValues.length },
      "rides.dispatch.success",
    );

    res.status(201).json({
      rideId: ride!.id,
      driversNotified: assignmentValues.length,
    });
  } catch (err) {
    logger.error({ err }, "rides.dispatch failed");
    res.status(500).json({ error: "Internal error while dispatching ride" });
  }
});

// ── POST /api/rides/assignments/:assignmentId/accept ──────────────────────────

router.post("/rides/assignments/:assignmentId/accept", async (req: Request, res: Response) => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const driver = await resolveCallerDriver(user, res);
  if (!driver) return;

  const assignmentId = String(req.params["assignmentId"]);

  try {
    const [assignment] = await db
      .select()
      .from(driverAssignmentsTable)
      .where(eq(driverAssignmentsTable.id, assignmentId))
      .limit(1);

    if (!assignment) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    // Ownership check: only the assigned driver can accept
    if (assignment.driverId !== driver.id) {
      res.status(403).json({ error: "Forbidden — this assignment belongs to a different driver" });
      return;
    }

    if (assignment.status !== "pending") {
      res.status(400).json({
        error: `Assignment is already ${assignment.status} — cannot accept`,
      });
      return;
    }

    if (new Date() > assignment.responseDeadline) {
      // Atomic update: only succeeds if still pending, preventing double-expiry
      // if the background sweep fires at the same moment
      const [expiredRow] = await db
        .update(driverAssignmentsTable)
        .set({ status: "expired" })
        .where(
          and(
            eq(driverAssignmentsTable.id, assignmentId),
            eq(driverAssignmentsTable.status, "pending"),
          ),
        )
        .returning();

      // Only cascade if this request won the expiry race (expiredRow is defined)
      if (expiredRow) {
        cascadeDispatch(expiredRow.rideId, expiredRow).catch((err) =>
          logger.error({ err, rideId: expiredRow.rideId }, "cascadeDispatch failed after expiry"),
        );
      }

      res.status(400).json({ error: "Response deadline has passed" });
      return;
    }

    // Atomic update: only succeeds if still pending (prevents double-accept)
    const [updated] = await db
      .update(driverAssignmentsTable)
      .set({ status: "accepted" })
      .where(
        and(
          eq(driverAssignmentsTable.id, assignmentId),
          eq(driverAssignmentsTable.status, "pending"),
        ),
      )
      .returning();

    if (!updated) {
      res.status(400).json({ error: "Assignment was already claimed" });
      return;
    }

    // Update ride status when all required assignments are accepted.
    // We must ignore superseded (rejected/expired) rows from previous cascade attempts
    // — only "active" assignments (not rejected/expired) count toward driversRequired.
    const [ride] = await db
      .select({ scenario: ridesTable.scenario })
      .from(ridesTable)
      .where(eq(ridesTable.id, updated.rideId))
      .limit(1);

    const rideScenario = ride ? SCENARIO_CONFIG[ride.scenario] : null;
    const driversRequired = rideScenario?.driversRequired ?? 1;

    const allAssignments = await db
      .select()
      .from(driverAssignmentsTable)
      .where(eq(driverAssignmentsTable.rideId, updated.rideId));

    // Filter to only the current "active" assignments (exclude superseded rows)
    const supersededStatuses = ["rejected", "expired"];
    const activeAssignments = allAssignments.filter(
      (a) => !supersededStatuses.includes(a.status),
    );

    // All required drivers have accepted when: active count matches driversRequired
    // AND every active assignment is in "accepted" status
    const allAccepted =
      activeAssignments.length === driversRequired &&
      activeAssignments.every((a) => a.status === "accepted");

    if (allAccepted) {
      await db
        .update(ridesTable)
        .set({ status: "driver_accepted" })
        .where(eq(ridesTable.id, updated.rideId));
    }

    req.log.info({ assignmentId, rideId: updated.rideId, driverId: driver.id }, "rides.assignment.accepted");

    res.json({
      success: true,
      assignmentId: updated.id,
      rideId: updated.rideId,
    });
  } catch (err) {
    logger.error({ err }, "rides.accept failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/rides/assignments/:assignmentId/decline ─────────────────────────

router.post("/rides/assignments/:assignmentId/decline", async (req: Request, res: Response) => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const driver = await resolveCallerDriver(user, res);
  if (!driver) return;

  const assignmentId = String(req.params["assignmentId"]);

  try {
    const [assignment] = await db
      .select()
      .from(driverAssignmentsTable)
      .where(eq(driverAssignmentsTable.id, assignmentId))
      .limit(1);

    if (!assignment) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    // Ownership check: only the assigned driver can decline
    if (assignment.driverId !== driver.id) {
      res.status(403).json({ error: "Forbidden — this assignment belongs to a different driver" });
      return;
    }

    // Transition guard: only pending assignments can be declined
    if (assignment.status !== "pending") {
      res.status(400).json({
        error: `Cannot decline an assignment with status '${assignment.status}' — only pending assignments can be declined`,
      });
      return;
    }

    const [updated] = await db
      .update(driverAssignmentsTable)
      .set({ status: "rejected" })
      .where(
        and(
          eq(driverAssignmentsTable.id, assignmentId),
          eq(driverAssignmentsTable.status, "pending"),
        ),
      )
      .returning();

    // Guard: if zero rows were updated, a concurrent change won the race
    if (!updated) {
      res.status(409).json({ error: "Assignment was already modified by a concurrent request — please retry" });
      return;
    }

    req.log.info({ assignmentId, rideId: updated.rideId, driverId: driver.id }, "rides.assignment.declined");

    // Cascade to next driver asynchronously — do not block the response
    cascadeDispatch(updated.rideId, updated).catch((err) =>
      logger.error({ err, rideId: updated.rideId }, "cascadeDispatch failed after decline"),
    );

    res.json({
      success: true,
      assignmentId: updated.id,
      rideId: updated.rideId,
    });
  } catch (err) {
    logger.error({ err }, "rides.decline failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── PATCH /api/rides/assignments/:assignmentId/stage ──────────────────────────

const VALID_STAGES = ["en_route", "arrived", "in_progress"] as const;
type RideStage = (typeof VALID_STAGES)[number];

const STAGE_TO_ASSIGNMENT_STATUS: Record<RideStage, string> = {
  en_route: "en_route",
  arrived: "arrived",
  in_progress: "in_progress",
};

const STAGE_TO_RIDE_STATUS: Record<RideStage, string> = {
  en_route: "driver_en_route",
  arrived: "driver_arrived",
  in_progress: "in_progress",
};

router.patch("/rides/assignments/:assignmentId/stage", async (req: Request, res: Response) => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const driver = await resolveCallerDriver(user, res);
  if (!driver) return;

  const assignmentId = String(req.params["assignmentId"]);
  const { stage } = req.body as { stage: string };

  if (!stage || !VALID_STAGES.includes(stage as RideStage)) {
    res.status(400).json({
      error: `Invalid stage. Must be one of: ${VALID_STAGES.join(", ")}`,
    });
    return;
  }

  try {
    const [assignment] = await db
      .select()
      .from(driverAssignmentsTable)
      .where(eq(driverAssignmentsTable.id, assignmentId))
      .limit(1);

    if (!assignment) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    // Ownership check: only the assigned driver can update stage
    if (assignment.driverId !== driver.id) {
      res.status(403).json({ error: "Forbidden — this assignment belongs to a different driver" });
      return;
    }

    const typedStage = stage as RideStage;

    // Transition guard: enforce sequential stage progression
    const ALLOWED_FROM: Record<RideStage, string[]> = {
      en_route: ["accepted"],
      arrived: ["en_route"],
      in_progress: ["arrived"],
    };

    const allowedFrom = ALLOWED_FROM[typedStage];
    if (!allowedFrom.includes(assignment.status)) {
      res.status(400).json({
        error: `Cannot transition to '${typedStage}' from '${assignment.status}'. Expected one of: ${allowedFrom.join(", ")}`,
      });
      return;
    }

    const [updated] = await db
      .update(driverAssignmentsTable)
      .set({ status: STAGE_TO_ASSIGNMENT_STATUS[typedStage] })
      .where(
        and(
          eq(driverAssignmentsTable.id, assignmentId),
          inArray(driverAssignmentsTable.status, allowedFrom),
        ),
      )
      .returning();

    // Guard: if zero rows were updated, a concurrent change won the race
    if (!updated) {
      res.status(409).json({ error: "Assignment was already modified by a concurrent request — please retry" });
      return;
    }

    await db
      .update(ridesTable)
      .set({ status: STAGE_TO_RIDE_STATUS[typedStage] })
      .where(eq(ridesTable.id, assignment.rideId));

    req.log.info({ assignmentId, rideId: assignment.rideId, stage, driverId: driver.id }, "rides.stage.updated");

    res.json({
      success: true,
      assignmentId: updated.id,
      rideId: assignment.rideId,
    });
  } catch (err) {
    logger.error({ err }, "rides.stage failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/rides/:rideId/cancel ───────────────────────────────────────────
// Cancels a ride and notifies all active assigned drivers via Supabase Realtime.
// Can be called by the driver (driver-initiated cancel) or by a privileged
// service caller (member/admin cancel) — caller identity is recorded in the log.

router.post("/rides/:rideId/cancel", async (req: Request, res: Response) => {
  const rideId = String(req.params["rideId"]);
  const { reason, cancelledBy } = req.body as { reason?: string; cancelledBy?: string };

  // Privileged callers (admin/service) provide DISPATCH_API_KEY.
  // Drivers authenticate with their Supabase token.
  const dispatchKey = process.env.DISPATCH_API_KEY;
  const providedKey = req.headers["x-api-key"];
  const isPrivilegedCaller = dispatchKey && providedKey === dispatchKey;

  let driverIdFromAuth: string | null = null;
  if (!isPrivilegedCaller) {
    const user = await requireUserAuth(req, res);
    if (!user) return;
    const driver = await resolveCallerDriver(user, res);
    if (!driver) return;
    driverIdFromAuth = driver.id;
  }

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

    const terminalStatuses = ["completed", "cancelled", "dispatch_failed"];
    if (terminalStatuses.includes(ride.status)) {
      res.status(400).json({ error: `Ride is already in terminal state: ${ride.status}` });
      return;
    }

    // Fetch all active driver_assignments for this ride
    const activeAssignmentStatuses = ["pending", "accepted", "en_route", "arrived", "in_progress"];
    const activeAssignments = await db
      .select({ id: driverAssignmentsTable.id, driverId: driverAssignmentsTable.driverId })
      .from(driverAssignmentsTable)
      .where(
        and(
          eq(driverAssignmentsTable.rideId, rideId),
          inArray(driverAssignmentsTable.status, activeAssignmentStatuses),
        ),
      );

    // If driver-initiated: verify the caller has an assignment on this ride
    if (driverIdFromAuth) {
      const owns = activeAssignments.some((a) => a.driverId === driverIdFromAuth);
      if (!owns) {
        res.status(403).json({ error: "Forbidden — no active assignment for this ride" });
        return;
      }
    }

    // Update ride status to cancelled in local Postgres
    await db
      .update(ridesTable)
      .set({ status: "cancelled" })
      .where(eq(ridesTable.id, rideId));

    // Mirror the ride status change to Supabase Postgres via HTTPS so that
    // Realtime UPDATE events fire to the driver's useRideCancellation hook.
    // Requires: ALTER PUBLICATION supabase_realtime ADD TABLE rides;
    // See scripts/sql/enable-rides-realtime.sql
    // Error propagates — if this write fails, the driver cannot be notified.
    await updateRideViaSupabase(rideId, { status: "cancelled" });

    // Update all active assignments to cancelled in local Postgres
    if (activeAssignments.length > 0) {
      await db
        .update(driverAssignmentsTable)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(driverAssignmentsTable.rideId, rideId),
            inArray(driverAssignmentsTable.status, activeAssignmentStatuses),
          ),
        );

      // Write the same update to Supabase so Realtime UPDATE events also fire
      // for driver_assignments subscribers (belt-and-suspenders notification path)
      const assignmentIds = activeAssignments.map((a) => a.id);
      await updateAssignmentViaSupabase(assignmentIds, { status: "cancelled" });
    }

    req.log.info(
      { rideId, cancelledBy: cancelledBy ?? driverIdFromAuth ?? "unknown", reason, driversNotified: activeAssignments.length },
      "rides.cancel.success",
    );

    res.json({ success: true, rideId, driversNotified: activeAssignments.length });
  } catch (err) {
    logger.error({ err }, "rides.cancel failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/rides/:rideId/complete ─────────────────────────────────────────

const DRIVER_SHARE = 0.85;

const TIER_RATES: Record<string, { base: number; perMile: number; minimum: number }> = {
  tier_1_passenger: { base: 10, perMile: 1.5, minimum: 12 },
  tier_2_vehicle_solo: { base: 20, perMile: 2.0, minimum: 25 },
  tier_3_vehicle_paired: { base: 35, perMile: 2.5, minimum: 40 },
  tier_4_full_concierge: { base: 40, perMile: 3.0, minimum: 45 },
};

router.post("/rides/:rideId/complete", async (req: Request, res: Response) => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const driver = await resolveCallerDriver(user, res);
  if (!driver) return;

  const rideId = String(req.params["rideId"]);
  const { assignmentId, actualDistanceMiles } = req.body as {
    assignmentId: string;
    actualDistanceMiles: number;
  };

  if (!assignmentId || actualDistanceMiles == null) {
    res.status(400).json({ error: "assignmentId and actualDistanceMiles are required" });
    return;
  }

  // Validate distance: must be non-negative and within a sane upper bound (300 miles)
  if (typeof actualDistanceMiles !== "number" || actualDistanceMiles < 0 || actualDistanceMiles > 300) {
    res.status(400).json({ error: "actualDistanceMiles must be a number between 0 and 300" });
    return;
  }

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

    // Idempotency: ride must not already be completed
    if (ride.status === "completed") {
      res.status(400).json({ error: "Ride is already completed" });
      return;
    }

    const [assignment] = await db
      .select()
      .from(driverAssignmentsTable)
      .where(eq(driverAssignmentsTable.id, assignmentId))
      .limit(1);

    if (!assignment || assignment.rideId !== rideId) {
      res.status(404).json({ error: "Assignment not found for this ride" });
      return;
    }

    // Ownership check: only the assigned driver can complete
    if (assignment.driverId !== driver.id) {
      res.status(403).json({ error: "Forbidden — this assignment belongs to a different driver" });
      return;
    }

    // Transition guard: assignment must be in_progress to complete
    if (assignment.status !== "in_progress") {
      res.status(400).json({
        error: `Cannot complete a ride in '${assignment.status}' status — assignment must be in_progress`,
      });
      return;
    }

    const tierRates = TIER_RATES[ride.tier] ?? TIER_RATES["tier_1_passenger"]!;
    const rawFare = tierRates.base + actualDistanceMiles * tierRates.perMile;
    const finalFare = Math.max(rawFare, tierRates.minimum);
    const driverPayout = Math.round(finalFare * DRIVER_SHARE * 100) / 100;

    const now = new Date();

    await db
      .update(driverAssignmentsTable)
      .set({
        status: "completed",
        completedAt: now,
        driverPayoutAmount: driverPayout,
        payoutStatus: "pending",
      })
      .where(eq(driverAssignmentsTable.id, assignmentId));

    await db
      .update(ridesTable)
      .set({
        status: "completed",
        actualFare: finalFare,
        actualDistanceMiles,
        completedAt: now,
      })
      .where(eq(ridesTable.id, rideId));

    await db.insert(driverPayoutsTable).values({
      driverId: assignment.driverId,
      amount: driverPayout,
      netPayout: driverPayout,
      platformFee: Math.round((finalFare - driverPayout) * 100) / 100,
      method: "standard",
      status: "pending",
      requestedAt: now,
    });

    const [currentDriver] = await db
      .select({ totalRidesCompleted: driversTable.totalRidesCompleted })
      .from(driversTable)
      .where(eq(driversTable.id, assignment.driverId))
      .limit(1);

    if (currentDriver) {
      await db
        .update(driversTable)
        .set({ totalRidesCompleted: currentDriver.totalRidesCompleted + 1 })
        .where(eq(driversTable.id, assignment.driverId));
    }

    req.log.info({ rideId, assignmentId, finalFare, driverPayout, driverId: driver.id }, "rides.complete.success");

    res.json({
      success: true,
      rideId,
      finalFare,
      driverPayout,
    });
  } catch (err) {
    logger.error({ err }, "rides.complete failed");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
