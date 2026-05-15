// ============================================================
// MCC API — Tandem Jobs Router
// ============================================================
// Manages tandem job records — created when a tandem-required
// ride has a driver (provider) who selects their tandem mode:
//   Mode A — Known Partner (pre-approved MCC ride-along driver)
//   Mode B — Platform Match (coming in Phase 3)
//   Mode C — Self-Sufficient (provider drives both vehicles)
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { tandemJobsTable, rideAlongDriversTable, ridesTable, driversTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { computeRideAlongFee } from "../lib/tandemFee";
import { verifySupabaseToken, extractBearerToken, type SupabaseUser } from "../lib/adminAuth";

const router: IRouter = Router();

// ── Auth helpers ─────────────────────────────────────────────────────────────

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
    res.status(403).json({ error: "Forbidden — no driver profile found" });
    return null;
  }
  return driver;
}

// ── POST /api/tandem-jobs ────────────────────────────────────────────────────
// Create a tandem job for a ride. Caller must be an active driver (provider).

router.post("/tandem-jobs", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const provider = await resolveCallerDriver(user, res);
  if (!provider) return;

  const { rideId, tandemMode } = req.body as { rideId?: string; tandemMode?: string };

  if (!rideId || !tandemMode) {
    res.status(400).json({ error: "rideId and tandemMode are required" });
    return;
  }

  const VALID_MODES = ["A", "B", "C"] as const;
  if (!VALID_MODES.includes(tandemMode as "A" | "B" | "C")) {
    res.status(400).json({ error: "tandemMode must be A, B, or C" });
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

    if (!ride.tandemRequired) {
      res.status(400).json({ error: "This ride does not require a tandem partner" });
      return;
    }

    // Check for existing tandem job for this ride + provider
    const [existing] = await db
      .select({ id: tandemJobsTable.id })
      .from(tandemJobsTable)
      .where(and(eq(tandemJobsTable.rideId, rideId), eq(tandemJobsTable.providerId, provider.id)))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: "Tandem job already exists for this ride and provider" });
      return;
    }

    const { totalFee } = computeRideAlongFee(ride.estimatedDistanceMiles);

    const [tandemJob] = await db
      .insert(tandemJobsTable)
      .values({
        rideId,
        providerId: provider.id,
        tandemMode,
        matchStatus: tandemMode === "B" ? "pending_match" : "pending",
        rideAlongFee: totalFee,
      })
      .returning();

    req.log.info({ tandemJobId: tandemJob!.id, rideId, tandemMode }, "tandem.job.created");

    res.status(201).json(tandemJob);
  } catch (err) {
    logger.error({ err }, "tandem.create failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /api/tandem-jobs/:id ─────────────────────────────────────────────────

router.get("/tandem-jobs/:id", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const provider = await resolveCallerDriver(user, res);
  if (!provider) return;

  const id = String(req.params["id"]);

  try {
    const [tandemJob] = await db
      .select()
      .from(tandemJobsTable)
      .where(eq(tandemJobsTable.id, id))
      .limit(1);

    if (!tandemJob) {
      res.status(404).json({ error: "Tandem job not found" });
      return;
    }

    if (tandemJob.providerId !== provider.id) {
      res.status(403).json({ error: "Forbidden — not your tandem job" });
      return;
    }

    res.json(tandemJob);
  } catch (err) {
    logger.error({ err }, "tandem.get failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── PATCH /api/tandem-jobs/:id/mode ─────────────────────────────────────────

router.patch("/tandem-jobs/:id/mode", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const provider = await resolveCallerDriver(user, res);
  if (!provider) return;

  const id = String(req.params["id"]);
  const { tandemMode } = req.body as { tandemMode?: string };

  const VALID_MODES = ["A", "B", "C"] as const;
  if (!tandemMode || !VALID_MODES.includes(tandemMode as "A" | "B" | "C")) {
    res.status(400).json({ error: "tandemMode must be A, B, or C" });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(tandemJobsTable)
      .where(eq(tandemJobsTable.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Tandem job not found" });
      return;
    }

    if (existing.providerId !== provider.id) {
      res.status(403).json({ error: "Forbidden — not your tandem job" });
      return;
    }

    const [updated] = await db
      .update(tandemJobsTable)
      .set({
        tandemMode,
        rideAlongDriverId: tandemMode !== "A" ? null : existing.rideAlongDriverId,
        matchStatus: tandemMode === "B" ? "pending_match" : "pending",
        updatedAt: new Date(),
      })
      .where(eq(tandemJobsTable.id, id))
      .returning();

    req.log.info({ tandemJobId: id, tandemMode }, "tandem.mode.updated");
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "tandem.mode.update failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/tandem-jobs/:id/known-partner ──────────────────────────────────
// Validates partner eligibility (verified ride-along driver), then links them.

router.post("/tandem-jobs/:id/known-partner", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const provider = await resolveCallerDriver(user, res);
  if (!provider) return;

  const id = String(req.params["id"]);
  const { partnerEmail } = req.body as { partnerEmail?: string };

  if (!partnerEmail) {
    res.status(400).json({ error: "partnerEmail is required" });
    return;
  }

  try {
    const [tandemJob] = await db
      .select()
      .from(tandemJobsTable)
      .where(eq(tandemJobsTable.id, id))
      .limit(1);

    if (!tandemJob) {
      res.status(404).json({ error: "Tandem job not found" });
      return;
    }

    if (tandemJob.providerId !== provider.id) {
      res.status(403).json({ error: "Forbidden — not your tandem job" });
      return;
    }

    // Validate partner: must have an active, verified ride-along driver record
    const [partnerRecord] = await db
      .select()
      .from(rideAlongDriversTable)
      .where(eq(rideAlongDriversTable.email, partnerEmail.toLowerCase()))
      .limit(1);

    if (!partnerRecord) {
      res.status(404).json({ error: "No MCC ride-along driver found with that email" });
      return;
    }

    if (!partnerRecord.verified || partnerRecord.status !== "active") {
      res.status(422).json({
        error: "Partner is not yet verified or is not active",
        partnerStatus: partnerRecord.status,
        verified: partnerRecord.verified,
      });
      return;
    }

    const [updated] = await db
      .update(tandemJobsTable)
      .set({ rideAlongDriverId: partnerRecord.id, matchStatus: "confirmed", updatedAt: new Date() })
      .where(eq(tandemJobsTable.id, id))
      .returning();

    req.log.info({ tandemJobId: id, partnerId: partnerRecord.id }, "tandem.known_partner.set");

    res.json({
      ...updated,
      partner: {
        id: partnerRecord.id,
        firstName: partnerRecord.firstName,
        lastName: partnerRecord.lastName,
        email: partnerRecord.email,
        verified: partnerRecord.verified,
        rating: partnerRecord.rating,
        totalJobs: partnerRecord.totalJobs,
        profilePhotoPath: partnerRecord.profilePhotoPath,
      },
    });
  } catch (err) {
    logger.error({ err }, "tandem.known_partner.set failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── DELETE /api/tandem-jobs/:id/known-partner ────────────────────────────────

router.delete("/tandem-jobs/:id/known-partner", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const provider = await resolveCallerDriver(user, res);
  if (!provider) return;

  const id = String(req.params["id"]);

  try {
    const [tandemJob] = await db
      .select()
      .from(tandemJobsTable)
      .where(eq(tandemJobsTable.id, id))
      .limit(1);

    if (!tandemJob) {
      res.status(404).json({ error: "Tandem job not found" });
      return;
    }

    if (tandemJob.providerId !== provider.id) {
      res.status(403).json({ error: "Forbidden — not your tandem job" });
      return;
    }

    const [updated] = await db
      .update(tandemJobsTable)
      .set({ rideAlongDriverId: null, matchStatus: "pending", updatedAt: new Date() })
      .where(eq(tandemJobsTable.id, id))
      .returning();

    req.log.info({ tandemJobId: id }, "tandem.known_partner.removed");
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "tandem.known_partner.remove failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /api/tandem-jobs/lookup-partner ──────────────────────────────────────
// Validates a potential known partner without creating/modifying a tandem job.
// Used by the Settings UI to preview a partner before they accept a job.

router.get("/tandem-jobs/lookup-partner", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const email = String(req.query["email"] ?? "").toLowerCase().trim();

  if (!email) {
    res.status(400).json({ error: "email query param is required" });
    return;
  }

  try {
    const [partnerRecord] = await db
      .select()
      .from(rideAlongDriversTable)
      .where(eq(rideAlongDriversTable.email, email))
      .limit(1);

    if (!partnerRecord) {
      res.status(404).json({ error: "No MCC ride-along driver found with that email" });
      return;
    }

    res.json({
      id: partnerRecord.id,
      firstName: partnerRecord.firstName,
      lastName: partnerRecord.lastName,
      email: partnerRecord.email,
      verified: partnerRecord.verified,
      status: partnerRecord.status,
      rating: partnerRecord.rating,
      totalJobs: partnerRecord.totalJobs,
      profilePhotoPath: partnerRecord.profilePhotoPath,
      eligible: partnerRecord.verified && partnerRecord.status === "active",
    });
  } catch (err) {
    logger.error({ err }, "tandem.lookup_partner failed");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
