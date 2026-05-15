// ============================================================
// MCC API — Admin Router
// ============================================================
// Handles admin operations: listing, approving, and rejecting
// driver applications. Protected by Supabase JWT + a database-
// backed admin role check (admin_users table) — see lib/adminAuth.ts.
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { driversTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { requireAdminAuth } from "../lib/adminAuth";

const router: IRouter = Router();

// ── GET /api/admin/drivers ────────────────────────────────────────────────────

router.get("/admin/drivers", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const status = typeof req.query["status"] === "string" ? req.query["status"] : "pending_approval";

  try {
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
        totalRidesCompleted: driversTable.totalRidesCompleted,
        averageRating: driversTable.averageRating,
        createdAt: driversTable.createdAt,
      })
      .from(driversTable)
      .where(eq(driversTable.status, status))
      .orderBy(driversTable.createdAt);

    req.log.info({ status, count: drivers.length }, "admin.drivers.list");

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
        totalRidesCompleted: d.totalRidesCompleted,
        averageRating: d.averageRating,
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
    const [updated] = await db
      .update(driversTable)
      .set({ status: "active" })
      .where(eq(driversTable.id, driverId))
      .returning({ id: driversTable.id, status: driversTable.status });

    if (!updated) {
      res.status(404).json({ error: "Driver not found" });
      return;
    }

    req.log.info({ driverId, adminEmail: admin.email }, "admin.driver.approved");

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

  try {
    const [updated] = await db
      .update(driversTable)
      .set({ status: "inactive" })
      .where(eq(driversTable.id, driverId))
      .returning({ id: driversTable.id, status: driversTable.status });

    if (!updated) {
      res.status(404).json({ error: "Driver not found" });
      return;
    }

    req.log.info({ driverId, adminEmail: admin.email }, "admin.driver.rejected");

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

export default router;
