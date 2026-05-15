// ============================================================
// MCC API — Ride-Along Drivers Router
// ============================================================
// Handles Ride-Along Driver onboarding and admin management.
// Ride-Along Drivers are a separate gig role from regular MCC Drivers.
//
// Verification rule (verified=true iff all of):
//   1. background_check_status === 'passed'
//   2. licenseDocumentPath is non-null
//   3. licenseExpiry is non-null and in the future
//   4. insuranceDocumentPath is non-null
//   5. insuranceExpiry is non-null and in the future
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { rideAlongDriversTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Auth helpers ────────────────────────────────────────────────────────────

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

// ── Verification helper ──────────────────────────────────────────────────────
// verified = true only when ALL conditions are met.

function computeVerified(record: {
  backgroundCheckStatus: string;
  licenseDocumentPath: string | null;
  licenseExpiry: string | null;
  insuranceDocumentPath: string | null;
  insuranceExpiry: string | null;
}): boolean {
  if (record.backgroundCheckStatus !== "passed") return false;
  if (!record.licenseDocumentPath) return false;
  if (!record.licenseExpiry || new Date(record.licenseExpiry) <= new Date()) return false;
  if (!record.insuranceDocumentPath) return false;
  if (!record.insuranceExpiry || new Date(record.insuranceExpiry) <= new Date()) return false;
  return true;
}

// ── Zod validation schemas ───────────────────────────────────────────────────

const futureDate = z.string().refine(
  (val: string) => new Date(val) > new Date(),
  { message: "Date must be in the future (document must not be expired)" },
);

const createSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(7, "Phone number is required"),
  zipCode: z.string().optional(),
  maxDistanceMiles: z.number().int().min(1).max(200).optional(),
  licenseNumber: z.string().optional(),
  licenseState: z.string().optional(),
  licenseExpiry: futureDate.optional(),
  licenseDocumentPath: z.string().optional(),
  insuranceDocumentPath: z.string().optional(),
  insuranceExpiry: futureDate.optional(),
  profilePhotoPath: z.string().optional(),
  agreementSigned: z.literal(true, { error: "You must agree to the Ride-Along Driver terms to submit your application" }),
});

const updateSchema = z.object({
  zipCode: z.string().optional(),
  maxDistanceMiles: z.number().int().min(1).max(200).optional(),
  licenseNumber: z.string().optional(),
  licenseState: z.string().optional(),
  licenseExpiry: futureDate.optional(),
  licenseDocumentPath: z.string().optional(),
  insuranceDocumentPath: z.string().optional(),
  insuranceExpiry: futureDate.optional(),
  profilePhotoPath: z.string().optional(),
  agreementSigned: z.boolean().optional(),
});

// ── Response formatter ───────────────────────────────────────────────────────

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

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i: { message: string }) => i.message).join("; ");
    res.status(400).json({ error: message });
    return;
  }
  const body = parsed.data;

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
        // verified starts false; admin approve recomputes it
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

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i: { message: string }) => i.message).join("; ");
    res.status(400).json({ error: message });
    return;
  }
  const body = parsed.data;

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

    const updates: Partial<typeof rideAlongDriversTable.$inferInsert> = {
      updatedAt: new Date(),
    };

    // Resubmit semantics: if a rejected applicant updates their profile,
    // automatically return them to pending_approval for re-review.
    if (existing.status === "inactive") {
      updates.status = "pending_approval";
      updates.backgroundCheckStatus = "pending";
    }

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

    // After a document update, recompute verified in case conditions are now met
    const merged = { ...existing, ...updates };
    updates.verified = computeVerified({
      backgroundCheckStatus: merged.backgroundCheckStatus ?? "pending",
      licenseDocumentPath: merged.licenseDocumentPath ?? null,
      licenseExpiry: merged.licenseExpiry ?? null,
      insuranceDocumentPath: merged.insuranceDocumentPath ?? null,
      insuranceExpiry: merged.insuranceExpiry ?? null,
    });

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

// ── PATCH /api/admin/ride-along-drivers/:id/approve ───────────────────────────
// Sets background_check_status=passed and activates the account.
// verified is computed from the verification rule — NOT forced to true.

router.patch("/admin/ride-along-drivers/:id/approve", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const id = String(req.params["id"]);

  try {
    const [record] = await db
      .select()
      .from(rideAlongDriversTable)
      .where(eq(rideAlongDriversTable.id, id))
      .limit(1);

    if (!record) {
      res.status(404).json({ error: "Ride-Along Driver not found" });
      return;
    }

    // Compute verified using the authoritative rule
    const verified = computeVerified({
      backgroundCheckStatus: "passed", // approval sets this
      licenseDocumentPath: record.licenseDocumentPath,
      licenseExpiry: record.licenseExpiry,
      insuranceDocumentPath: record.insuranceDocumentPath,
      insuranceExpiry: record.insuranceExpiry,
    });

    const [updated] = await db
      .update(rideAlongDriversTable)
      .set({
        status: "active",
        backgroundCheckStatus: "passed",
        verified,
        updatedAt: new Date(),
      })
      .where(eq(rideAlongDriversTable.id, id))
      .returning({ id: rideAlongDriversTable.id, status: rideAlongDriversTable.status });

    req.log.info({ id, adminEmail: admin.email, verified }, "admin.ride-along-driver.approved");
    res.json({ success: true, driverId: updated!.id, status: updated!.status });
  } catch (err) {
    logger.error({ err }, "admin.ride-along-driver.approve failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── PATCH /api/admin/ride-along-drivers/:id/reject ────────────────────────────

router.patch("/admin/ride-along-drivers/:id/reject", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const id = String(req.params["id"]);

  try {
    const [updated] = await db
      .update(rideAlongDriversTable)
      .set({ status: "inactive", verified: false, updatedAt: new Date() })
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
