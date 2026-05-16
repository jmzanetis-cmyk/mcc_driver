// ============================================================
// MCC API — Admin Router
// ============================================================
// Handles admin operations: listing, approving, and rejecting
// driver applications. Protected by Supabase JWT + a database-
// backed admin role check (admin_users table) — see lib/adminAuth.ts.
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, inArray, and, desc, notInArray, isNotNull, asc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { driversTable, ridesTable, driverAssignmentsTable, driverAuditLogTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { requireAdminAuth } from "../lib/adminAuth";
import { sendDriverApprovedEmail, sendDriverRejectedEmail } from "../lib/email";
import { updateRideViaSupabase, updateAssignmentViaSupabase, insertAssignmentViaSupabase } from "../lib/supabaseAdmin";
import { SCENARIO_CONFIG } from "../lib/scenarioConfig";
import { computeFare } from "./rides";

const RejectDocumentsBody = z.object({
  reason: z.string().trim().min(1).max(1000),
});

const RejectDriverBody = z.object({
  reason: z.string().trim().min(1).max(1000),
});

const router: IRouter = Router();

// All admin mutation endpoints below wrap the driver status change and the
// matching driver_audit_log insert in a single db.transaction so a failed
// audit write rolls back the status change. Audit persistence is a hard
// requirement of the task and must never silently fail.

// ── GET /api/admin/drivers ────────────────────────────────────────────────────

router.get("/admin/drivers", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const status = typeof req.query["status"] === "string" ? req.query["status"] : "pending_approval";
  const reviewerEmailParam = typeof req.query["reviewerEmail"] === "string"
    ? req.query["reviewerEmail"].trim().toLowerCase()
    : "";

  try {
    let driverIdFilter: string[] | null = null;
    if (reviewerEmailParam) {
      // Match the contract: only drivers whose MOST RECENT audit entry was
      // written by this reviewer. Uses DISTINCT ON to pick the latest row
      // per driver_id, then keeps only those where that latest admin email
      // equals the requested reviewer.
      const reviewerRows = await db.execute<{ driver_id: string }>(sql`
        SELECT driver_id FROM (
          SELECT DISTINCT ON (driver_id) driver_id, admin_email
          FROM ${driverAuditLogTable}
          ORDER BY driver_id, created_at DESC
        ) latest
        WHERE latest.admin_email = ${reviewerEmailParam}
      `);
      driverIdFilter = reviewerRows.rows.map((r) => r.driver_id);
      if (driverIdFilter.length === 0) {
        res.json([]);
        return;
      }
    }

    const drivers = await db
      .select({
        id: driversTable.id,
        firstName: driversTable.firstName,
        lastName: driversTable.lastName,
        email: driversTable.email,
        phone: driversTable.phone,
        status: driversTable.status,
        licenseDocumentPath: driversTable.licenseDocumentPath,
        insuranceDocumentPath: driversTable.insuranceDocumentPath,
        profilePhotoUrl: driversTable.profilePhotoUrl,
        backgroundCheckPassed: driversTable.backgroundCheckPassed,
        canDriveMemberVehicle: driversTable.canDriveMemberVehicle,
        canDoRideshare: driversTable.canDoRideshare,
        canDoDelivery: driversTable.canDoDelivery,
        totalRidesCompleted: driversTable.totalRidesCompleted,
        averageRating: driversTable.averageRating,
        documentRejectionReason: driversTable.documentRejectionReason,
        createdAt: driversTable.createdAt,
      })
      .from(driversTable)
      .where(
        driverIdFilter
          ? and(eq(driversTable.status, status), inArray(driversTable.id, driverIdFilter))
          : eq(driversTable.status, status),
      )
      .orderBy(driversTable.createdAt);

    req.log.info(
      { status, count: drivers.length, reviewerEmail: reviewerEmailParam || undefined },
      "admin.drivers.list",
    );

    res.json(
      drivers.map((d) => ({
        id: d.id,
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email,
        phone: d.phone,
        status: d.status,
        licenseDocumentPath: d.licenseDocumentPath ?? null,
        insuranceDocumentPath: d.insuranceDocumentPath ?? null,
        profilePhotoUrl: d.profilePhotoUrl ?? null,
        backgroundCheckPassed: d.backgroundCheckPassed,
        canDriveMemberVehicle: d.canDriveMemberVehicle,
        canDoRideshare: d.canDoRideshare,
        canDoDelivery: d.canDoDelivery,
        totalRidesCompleted: d.totalRidesCompleted,
        averageRating: d.averageRating,
        documentRejectionReason: d.documentRejectionReason ?? null,
        createdAt: d.createdAt?.toISOString() ?? null,
      })),
    );
  } catch (err) {
    logger.error({ err }, "admin.drivers.list failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/admin/drivers/:driverId/approve ─────────────────────────────────

router.post("/admin/drivers/:driverId/approve", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const driverId = String(req.params["driverId"]);

  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(driversTable)
        .set({ status: "active" })
        .where(eq(driversTable.id, driverId))
        .returning({
          id: driversTable.id,
          status: driversTable.status,
          email: driversTable.email,
          firstName: driversTable.firstName,
        });

      if (!row) return null;

      await tx.insert(driverAuditLogTable).values({
        driverId,
        action: "approve",
        adminEmail: admin.email!.trim().toLowerCase(),
        resultingStatus: row.status,
      });

      return row;
    });

    if (!updated) {
      res.status(404).json({ error: "Driver not found" });
      return;
    }

    req.log.info({ driverId, adminEmail: admin.email }, "admin.driver.approved");

    const emailResult = await sendDriverApprovedEmail({
      to: updated.email,
      firstName: updated.firstName,
    });
    if (!emailResult.ok && !emailResult.skipped) {
      req.log.warn(
        { driverId, error: emailResult.error },
        "admin.driver.approved.email_failed",
      );
    } else if (emailResult.ok) {
      req.log.info({ driverId, to: updated.email }, "admin.driver.approved.email_sent");
    }

    res.json({
      success: true,
      driverId: updated.id,
      status: updated.status,
    });
  } catch (err) {
    logger.error({ err }, "admin.driver.approve failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/admin/drivers/:driverId/reject ──────────────────────────────────

router.post("/admin/drivers/:driverId/reject", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const driverId = String(req.params["driverId"]);

  const parsed = RejectDriverBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "reason is required and must be a non-empty string (max 1000 chars)" });
    return;
  }
  const { reason } = parsed.data;

  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(driversTable)
        .set({ status: "inactive" })
        .where(eq(driversTable.id, driverId))
        .returning({
          id: driversTable.id,
          status: driversTable.status,
          email: driversTable.email,
          firstName: driversTable.firstName,
        });

      if (!row) return null;

      await tx.insert(driverAuditLogTable).values({
        driverId,
        action: "reject",
        adminEmail: admin.email!.trim().toLowerCase(),
        resultingStatus: row.status,
        reason,
      });

      return row;
    });

    if (!updated) {
      res.status(404).json({ error: "Driver not found" });
      return;
    }

    req.log.info({ driverId, adminEmail: admin.email }, "admin.driver.rejected");

    const emailResult = await sendDriverRejectedEmail({
      to: updated.email,
      firstName: updated.firstName,
      reason,
    });
    if (!emailResult.ok && !emailResult.skipped) {
      req.log.warn(
        { driverId, error: emailResult.error },
        "admin.driver.rejected.email_failed",
      );
    } else if (emailResult.ok) {
      req.log.info({ driverId, to: updated.email }, "admin.driver.rejected.email_sent");
    }

    res.json({
      success: true,
      driverId: updated.id,
      status: updated.status,
    });
  } catch (err) {
    logger.error({ err }, "admin.driver.reject failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/admin/drivers/:driverId/reject-documents ────────────────────────
// Flags specific documents as rejected without changing the driver's status.
// The driver remains in pending_approval and is prompted to resubmit.

router.post("/admin/drivers/:driverId/reject-documents", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const driverId = String(req.params["driverId"]);

  const parsed = RejectDocumentsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "reason is required and must be a non-empty string (max 1000 chars)" });
    return;
  }

  const { reason } = parsed.data;

  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(driversTable)
        .set({ documentRejectionReason: reason })
        .where(eq(driversTable.id, driverId))
        .returning({ id: driversTable.id, status: driversTable.status });

      if (!row) return null;

      await tx.insert(driverAuditLogTable).values({
        driverId,
        action: "reject_documents",
        adminEmail: admin.email!.trim().toLowerCase(),
        resultingStatus: row.status,
        reason,
      });

      return row;
    });

    if (!updated) {
      res.status(404).json({ error: "Driver not found" });
      return;
    }

    req.log.info({ driverId, adminEmail: admin.email, reason }, "admin.driver.documents_rejected");

    res.json({
      success: true,
      driverId: updated.id,
      status: updated.status,
      documentRejectionReason: reason,
    });
  } catch (err) {
    logger.error({ err }, "admin.driver.reject-documents failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/admin/drivers/:driverId/clear-document-rejection ────────────────
// Clears the rejection reason (e.g. after admin manually verifies new docs).

router.post("/admin/drivers/:driverId/clear-document-rejection", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const driverId = String(req.params["driverId"]);

  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(driversTable)
        .set({ documentRejectionReason: null })
        .where(eq(driversTable.id, driverId))
        .returning({ id: driversTable.id, status: driversTable.status });

      if (!row) return null;

      await tx.insert(driverAuditLogTable).values({
        driverId,
        action: "clear_document_rejection",
        adminEmail: admin.email!.trim().toLowerCase(),
        resultingStatus: row.status,
      });

      return row;
    });

    if (!updated) {
      res.status(404).json({ error: "Driver not found" });
      return;
    }

    req.log.info({ driverId, adminEmail: admin.email }, "admin.driver.document_rejection_cleared");

    res.json({ success: true, driverId: updated.id, status: updated.status });
  } catch (err) {
    logger.error({ err }, "admin.driver.clear-document-rejection failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /api/admin/rides ──────────────────────────────────────────────────────
// Lists rides, optionally filtered by status. Defaults to all non-terminal
// statuses (pending_dispatch, dispatched, accepted, en_route, arrived,
// in_progress) so admins see the live queue.

router.get("/admin/rides", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const statusParam = req.query["status"] as string | undefined;
  const TERMINAL = ["completed", "cancelled", "dispatch_failed"];

  try {
    const rows = await db
      .select({
        id: ridesTable.id,
        scenario: ridesTable.scenario,
        tier: ridesTable.tier,
        serviceType: ridesTable.serviceType,
        packageDescription: ridesTable.packageDescription,
        status: ridesTable.status,
        memberId: ridesTable.memberId,
        pickupAddress: ridesTable.pickupAddress,
        dropoffAddress: ridesTable.dropoffAddress,
        estimatedFare: ridesTable.estimatedFare,
        actualFare: ridesTable.actualFare,
        estimatedDistanceMiles: ridesTable.estimatedDistanceMiles,
        createdAt: ridesTable.createdAt,
        startedAt: ridesTable.startedAt,
      })
      .from(ridesTable)
      .where(
        statusParam
          ? eq(ridesTable.status, statusParam)
          : notInArray(ridesTable.status, TERMINAL),
      )
      .orderBy(desc(ridesTable.createdAt))
      .limit(200);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "admin.rides.list failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/admin/rides/:rideId/cancel ─────────────────────────────────────
// Cancels a ride in any non-terminal status and mirrors the cancellation to
// Supabase so connected drivers receive the real-time notification.

router.post("/admin/rides/:rideId/cancel", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const rideId = String(req.params["rideId"]);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : undefined;

  try {
    const [ride] = await db
      .select({ id: ridesTable.id, status: ridesTable.status })
      .from(ridesTable)
      .where(eq(ridesTable.id, rideId))
      .limit(1);

    if (!ride) {
      res.status(404).json({ error: "Ride not found" });
      return;
    }

    const TERMINAL = ["completed", "cancelled", "dispatch_failed"];
    if (TERMINAL.includes(ride.status)) {
      res.status(400).json({ error: `Ride is already in terminal state: ${ride.status}` });
      return;
    }

    const ACTIVE_ASSIGNMENT_STATUSES = ["pending", "accepted", "en_route", "arrived", "in_progress"] as const;

    const activeAssignments = await db
      .select({ id: driverAssignmentsTable.id })
      .from(driverAssignmentsTable)
      .where(
        and(
          eq(driverAssignmentsTable.rideId, rideId),
          inArray(driverAssignmentsTable.status, [...ACTIVE_ASSIGNMENT_STATUSES]),
        ),
      );

    // ── Phase 1: Local Postgres writes ───────────────────────────────────────
    await db
      .update(ridesTable)
      .set({ status: "cancelled" })
      .where(eq(ridesTable.id, rideId));

    if (activeAssignments.length > 0) {
      await db
        .update(driverAssignmentsTable)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(driverAssignmentsTable.rideId, rideId),
            inArray(driverAssignmentsTable.status, [...ACTIVE_ASSIGNMENT_STATUSES]),
          ),
        );
    }

    // ── Phase 2: Supabase mirrors (fire-and-forget for Realtime) ─────────────
    const assignmentIds = activeAssignments.map((a) => a.id);
    await Promise.allSettled([
      updateRideViaSupabase(rideId, { status: "cancelled" }).catch((err) =>
        logger.warn({ err, rideId }, "admin.rides.cancel: Supabase ride mirror failed"),
      ),
      assignmentIds.length > 0
        ? updateAssignmentViaSupabase(assignmentIds, { status: "cancelled" }).catch((err) =>
            logger.warn({ err, rideId }, "admin.rides.cancel: Supabase assignment mirror failed"),
          )
        : Promise.resolve(),
    ]);

    req.log.info(
      { rideId, adminEmail: admin.email, reason, driversNotified: activeAssignments.length },
      "admin.rides.cancel.success",
    );

    res.json({ success: true, rideId, driversNotified: activeAssignments.length });
  } catch (err) {
    logger.error({ err }, "admin.rides.cancel failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/admin/rides/dispatch ────────────────────────────────────────────
// Admin-auth–protected ride dispatch. Same logic as the service-key–protected
// /api/rides/dispatch, but authenticated by admin JWT instead of DISPATCH_API_KEY.

const AdminDispatchBody = z.object({
  scenario: z.string().min(1),
  tier: z.string().min(1),
  serviceType: z.enum(["concierge", "rideshare", "delivery"]).optional(),
  packageDescription: z.string().max(500).optional(),
  pickupAddress: z.string().min(1),
  pickupLat: z.number(),
  pickupLng: z.number(),
  dropoffAddress: z.string().min(1),
  dropoffLat: z.number(),
  dropoffLng: z.number(),
  estimatedDistanceMiles: z.number().min(0),
  memberId: z.string().min(1).optional(),
  memberPhone: z.string().min(1).max(32).optional(),
  memberName: z.string().min(1).max(120).optional(),
  responseDeadlineSeconds: z.number().int().min(10).max(120).optional(),
});

router.post("/admin/rides/dispatch", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const parsed = AdminDispatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const body = parsed.data;
  const config = SCENARIO_CONFIG[body.scenario];
  if (!config) {
    res.status(400).json({ error: `Unknown scenario: ${body.scenario}` });
    return;
  }

  // Validate scenario↔tier consistency so capability gating cannot be bypassed.
  if (body.tier !== config.tier) {
    res.status(400).json({
      error: `tier "${body.tier}" does not match scenario "${body.scenario}" (expected "${config.tier}")`,
    });
    return;
  }

  // Derive service type authoritatively from the scenario-validated tier.
  const serviceType = config.tier === "tier_0_rideshare" ? "rideshare"
    : config.tier === "tier_0_delivery" ? "delivery"
    : "concierge";

  // Reject explicit serviceType that contradicts what we derived from the scenario.
  if (body.serviceType && body.serviceType !== serviceType) {
    res.status(400).json({
      error: `serviceType "${body.serviceType}" is inconsistent with scenario "${body.scenario}" (expected "${serviceType}")`,
    });
    return;
  }

  try {
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
          serviceType === "rideshare" ? eq(driversTable.canDoRideshare, true) : undefined,
          serviceType === "delivery" ? eq(driversTable.canDoDelivery, true) : undefined,
        ),
      )
      .orderBy(asc(driversTable.totalRidesCompleted), asc(driversTable.createdAt));

    let targetDriverIds = eligibleDrivers
      .map((d) => d.id)
      .filter((id) => !busyIds.includes(id));

    // Mirror the main dispatch path: when any assignment requires driving the
    // member's vehicle, restrict the pool to drivers with canDriveMemberVehicle.
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

    if (targetDriverIds.length < config.driversRequired) {
      res.status(404).json({
        error: `Not enough eligible drivers. Need ${config.driversRequired}, found ${targetDriverIds.length}.`,
      });
      return;
    }

    const deadlineSeconds = body.responseDeadlineSeconds ?? 30;
    const responseDeadline = new Date(Date.now() + deadlineSeconds * 1000);

    const [ride] = await db
      .insert(ridesTable)
      .values({
        scenario: body.scenario,
        tier: body.tier,
        serviceType,
        packageDescription: body.packageDescription ?? null,
        status: "pending_dispatch",
        memberId: body.memberId ?? null,
        memberPhone: body.memberPhone ?? null,
        memberName: body.memberName ?? null,
        pickupAddress: body.pickupAddress,
        pickupLat: body.pickupLat,
        pickupLng: body.pickupLng,
        dropoffAddress: body.dropoffAddress,
        dropoffLat: body.dropoffLat,
        dropoffLng: body.dropoffLng,
        estimatedFare: computeFare(body.tier, body.estimatedDistanceMiles),
        estimatedDistanceMiles: body.estimatedDistanceMiles,
      })
      .returning();

    const selectedDriverIds = targetDriverIds.slice(0, config.driversRequired);

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

    await db
      .update(ridesTable)
      .set({ status: "dispatched" })
      .where(eq(ridesTable.id, ride!.id));

    req.log.info(
      { rideId: ride!.id, scenario: body.scenario, serviceType, adminEmail: admin.email },
      "admin.rides.dispatch.success",
    );

    res.status(201).json({
      rideId: ride!.id,
      estimatedFare: ride!.estimatedFare,
      driversNotified: selectedDriverIds.length,
    });
  } catch (err) {
    logger.error({ err }, "admin.rides.dispatch failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /api/admin/drivers/:driverId/audit-log ───────────────────────────────

router.get("/admin/drivers/:driverId/audit-log", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const driverId = String(req.params["driverId"]);

  try {
    const rows = await db
      .select()
      .from(driverAuditLogTable)
      .where(eq(driverAuditLogTable.driverId, driverId))
      .orderBy(desc(driverAuditLogTable.createdAt));

    res.json(
      rows.map((r) => ({
        id: r.id,
        driverId: r.driverId,
        action: r.action,
        adminEmail: r.adminEmail,
        resultingStatus: r.resultingStatus ?? null,
        reason: r.reason ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    logger.error({ err }, "admin.driver.audit-log failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /api/admin/reviewers ──────────────────────────────────────────────────

router.get("/admin/reviewers", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  try {
    const rows = await db
      .selectDistinct({ email: driverAuditLogTable.adminEmail })
      .from(driverAuditLogTable)
      .orderBy(asc(driverAuditLogTable.adminEmail));

    res.json(rows.map((r) => r.email));
  } catch (err) {
    logger.error({ err }, "admin.reviewers.list failed");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
