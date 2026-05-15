// ============================================================
// MCC API — Ride-Along Drivers Router
// ============================================================
// Handles Ride-Along Driver onboarding and admin management.
// Ride-Along Drivers are a separate gig role from regular MCC Drivers.
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { rideAlongDriversTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Auth helpers (same pattern as admin.ts) ────────────────────────────────────

interface SupabaseUser {
  id: string;
  email?: string;
}

async function verifySupabaseToken(token: string): Promise<SupabaseUser | null> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
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
    const adminEmails = adminEmailsEnv.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!user.email || !adminEmails.includes(user.email.toLowerCase())) {
      res.status(403).json({ error: "Forbidden — not an admin" });
      return null;
    }
  } else if (process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "Forbidden — admin access not configured" });
    return null;
  }
  return user;
}

function formatRecord(r: typeof rideAlongDriversTable.$inferSelect) {
  return {
    id: r.id,
    userId: r.userId,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    zipCode: r.zipCode ?? null,
    maxDistanceMiles: r.maxDistanceMiles,
    licenseNumber: r.licenseNumber ?? null,
    licenseState: r.licenseState ?? null,
    licenseExpiry: r.licenseExpiry ?? null,
    licenseDocumentPath: r.licenseDocumentPath ?? null,
    insuranceDocumentPath: r.insuranceDocumentPath ?? null,
    insuranceExpiry: r.insuranceExpiry ?? null,
    backgroundCheckStatus: r.backgroundCheckStatus,
    verified: r.verified,
    profilePhotoPath: r.profilePhotoPath ?? null,
    agreementSignedAt: r.agreementSignedAt?.toISOString() ?? null,
    rating: r.rating,
    totalJobs: r.totalJobs,
    status: r.status,
    createdAt: r.createdAt?.toISOString() ?? null,
    updatedAt: r.updatedAt?.toISOString() ?? null,
  };
}

// ── POST /api/ride-along-drivers ──────────────────────────────────────────────

router.post("/ride-along-drivers", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const body = req.body as {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    zipCode?: string;
    maxDistanceMiles?: number;
    licenseNumber?: string;
    licenseState?: string;
    licenseExpiry?: string;
    licenseDocumentPath?: string;
    insuranceDocumentPath?: string;
    insuranceExpiry?: string;
    profilePhotoPath?: string;
    agreementSigned?: boolean;
  };

  if (!body.firstName || !body.lastName || !body.email || !body.phone) {
    res.status(400).json({ error: "Missing required fields: firstName, lastName, email, phone" });
    return;
  }

  try {
    // Check for existing profile
    const [existing] = await db
      .select({ id: rideAlongDriversTable.id })
      .from(rideAlongDriversTable)
      .where(eq(rideAlongDriversTable.userId, user.id))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: "A Ride-Along Driver profile already exists for this account" });
      return;
    }

    const [record] = await db
      .insert(rideAlongDriversTable)
      .values({
        userId: user.id,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        zipCode: body.zipCode ?? null,
        maxDistanceMiles: body.maxDistanceMiles ?? 20,
        licenseNumber: body.licenseNumber ?? null,
        licenseState: body.licenseState ?? null,
        licenseExpiry: body.licenseExpiry ?? null,
        licenseDocumentPath: body.licenseDocumentPath ?? null,
        insuranceDocumentPath: body.insuranceDocumentPath ?? null,
        insuranceExpiry: body.insuranceExpiry ?? null,
        profilePhotoPath: body.profilePhotoPath ?? null,
        agreementSignedAt: body.agreementSigned ? new Date() : null,
        status: "pending_approval",
        backgroundCheckStatus: "pending",
        verified: false,
      })
      .returning();

    req.log.info({ id: record!.id, userId: user.id }, "ride-along-drivers.create.success");
    res.status(201).json(formatRecord(record!));
  } catch (err) {
    logger.error({ err }, "ride-along-drivers.create failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /api/ride-along-drivers/me ───────────────────────────────────────────

router.get("/ride-along-drivers/me", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  try {
    const [record] = await db
      .select()
      .from(rideAlongDriversTable)
      .where(eq(rideAlongDriversTable.userId, user.id))
      .limit(1);

    if (!record) {
      res.status(404).json({ error: "No Ride-Along Driver profile found for this account" });
      return;
    }

    res.json(formatRecord(record));
  } catch (err) {
    logger.error({ err }, "ride-along-drivers.me failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── PATCH /api/ride-along-drivers/:id ────────────────────────────────────────

router.patch("/ride-along-drivers/:id", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const id = String(req.params["id"]);

  try {
    const [existing] = await db
      .select()
      .from(rideAlongDriversTable)
      .where(eq(rideAlongDriversTable.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Ride-Along Driver profile not found" });
      return;
    }

    if (existing.userId !== user.id) {
      res.status(403).json({ error: "Forbidden — this profile belongs to a different user" });
      return;
    }

    const body = req.body as {
      zipCode?: string;
      maxDistanceMiles?: number;
      licenseNumber?: string;
      licenseState?: string;
      licenseExpiry?: string;
      licenseDocumentPath?: string;
      insuranceDocumentPath?: string;
      insuranceExpiry?: string;
      profilePhotoPath?: string;
      agreementSigned?: boolean;
    };

    const updates: Partial<typeof rideAlongDriversTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.zipCode !== undefined) updates.zipCode = body.zipCode;
    if (body.maxDistanceMiles !== undefined) updates.maxDistanceMiles = body.maxDistanceMiles;
    if (body.licenseNumber !== undefined) updates.licenseNumber = body.licenseNumber;
    if (body.licenseState !== undefined) updates.licenseState = body.licenseState;
    if (body.licenseExpiry !== undefined) updates.licenseExpiry = body.licenseExpiry;
    if (body.licenseDocumentPath !== undefined) updates.licenseDocumentPath = body.licenseDocumentPath;
    if (body.insuranceDocumentPath !== undefined) updates.insuranceDocumentPath = body.insuranceDocumentPath;
    if (body.insuranceExpiry !== undefined) updates.insuranceExpiry = body.insuranceExpiry;
    if (body.profilePhotoPath !== undefined) updates.profilePhotoPath = body.profilePhotoPath;
    if (body.agreementSigned) updates.agreementSignedAt = new Date();

    const [updated] = await db
      .update(rideAlongDriversTable)
      .set(updates)
      .where(eq(rideAlongDriversTable.id, id))
      .returning();

    req.log.info({ id }, "ride-along-drivers.update.success");
    res.json(formatRecord(updated!));
  } catch (err) {
    logger.error({ err }, "ride-along-drivers.update failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /api/admin/ride-along-drivers ────────────────────────────────────────

router.get("/admin/ride-along-drivers", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const status = typeof req.query["status"] === "string" ? req.query["status"] : "pending_approval";

  try {
    const records = await db
      .select()
      .from(rideAlongDriversTable)
      .where(eq(rideAlongDriversTable.status, status))
      .orderBy(rideAlongDriversTable.createdAt);

    req.log.info({ status, count: records.length }, "admin.ride-along-drivers.list");
    res.json(records.map(formatRecord));
  } catch (err) {
    logger.error({ err }, "admin.ride-along-drivers.list failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/admin/ride-along-drivers/:id/approve ────────────────────────────

router.post("/admin/ride-along-drivers/:id/approve", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const id = String(req.params["id"]);

  try {
    const [updated] = await db
      .update(rideAlongDriversTable)
      .set({ status: "active", verified: true, updatedAt: new Date() })
      .where(eq(rideAlongDriversTable.id, id))
      .returning({ id: rideAlongDriversTable.id, status: rideAlongDriversTable.status });

    if (!updated) {
      res.status(404).json({ error: "Ride-Along Driver not found" });
      return;
    }

    req.log.info({ id, adminEmail: admin.email }, "admin.ride-along-driver.approved");
    res.json({ success: true, driverId: updated.id, status: updated.status });
  } catch (err) {
    logger.error({ err }, "admin.ride-along-driver.approve failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/admin/ride-along-drivers/:id/reject ─────────────────────────────

router.post("/admin/ride-along-drivers/:id/reject", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const id = String(req.params["id"]);

  try {
    const [updated] = await db
      .update(rideAlongDriversTable)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(eq(rideAlongDriversTable.id, id))
      .returning({ id: rideAlongDriversTable.id, status: rideAlongDriversTable.status });

    if (!updated) {
      res.status(404).json({ error: "Ride-Along Driver not found" });
      return;
    }

    req.log.info({ id, adminEmail: admin.email }, "admin.ride-along-driver.rejected");
    res.json({ success: true, driverId: updated.id, status: updated.status });
  } catch (err) {
    logger.error({ err }, "admin.ride-along-driver.reject failed");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
