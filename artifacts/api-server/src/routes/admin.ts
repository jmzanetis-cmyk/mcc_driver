// ============================================================
// MCC API — Admin Router
// ============================================================
// Handles admin operations: listing, approving, and rejecting
// driver applications. Protected by Supabase JWT + ADMIN_EMAILS
// environment variable check.
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { driversTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Auth helpers ──────────────────────────────────────────────────────────────

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
 * Requires the caller to be an authenticated Supabase admin.
 * Admin check: user email must be in ADMIN_EMAILS env var (comma-separated).
 * If ADMIN_EMAILS is not set, falls back to allowing any authenticated user
 * in development, or blocking all in production.
 */
async function requireAdminAuth(req: Request, res: Response): Promise<SupabaseUser | null> {
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

  const adminEmailsEnv = process.env.ADMIN_EMAILS;
  if (adminEmailsEnv) {
    const adminEmails = adminEmailsEnv
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (!user.email || !adminEmails.includes(user.email.toLowerCase())) {
      res.status(403).json({ error: "Forbidden — not an admin" });
      return null;
    }
  } else if (process.env.NODE_ENV === "production") {
    logger.warn("ADMIN_EMAILS not set — blocking admin access in production");
    res.status(403).json({ error: "Forbidden — admin access not configured" });
    return null;
  } else {
    logger.warn("ADMIN_EMAILS not set — admin endpoint unprotected in dev mode");
  }

  return user;
}

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
