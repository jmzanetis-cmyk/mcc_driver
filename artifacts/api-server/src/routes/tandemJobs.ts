import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, inArray, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  tandemJobsTable,
  rideAlongDriversTable,
  ridesTable,
  driversTable,
  driverAssignmentsTable,
} from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { computeRideAlongFee } from "../lib/tandemFee";
import { verifySupabaseToken, extractBearerToken, type SupabaseUser } from "../lib/adminAuth";

const router: IRouter = Router();

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function requireUserAuth(req: Request, res: Response): Promise<SupabaseUser | null> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  const user = await verifySupabaseToken(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired token" });
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
    res.status(403).json({ error: "No driver profile found" });
    return null;
  }
  return driver;
}

// ── Shared helper: resolve a ride-along driver by email OR id ────────────────

async function findRideAlongDriver(emailOrId: string) {
  // Try as UUID (id field) first; if the value doesn't look like a UUID fall
  // through to email lookup.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUuid = UUID_RE.test(emailOrId);

  const [record] = await db
    .select()
    .from(rideAlongDriversTable)
    .where(
      isUuid
        ? eq(rideAlongDriversTable.id, emailOrId)
        : eq(rideAlongDriversTable.email, emailOrId.toLowerCase()),
    )
    .limit(1);

  return record ?? null;
}

// ── IMPORTANT: static paths MUST be registered before parameterised ones ─────

// GET /api/tandem-jobs/lookup-partner?email=xxx  -or-  ?id=xxx
// Validates a potential partner without modifying any records.

router.get("/tandem-jobs/lookup-partner", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const emailParam = String(req.query["email"] ?? "").trim();
  const idParam = String(req.query["id"] ?? "").trim();
  const lookup = emailParam || idParam;

  if (!lookup) {
    res.status(400).json({ error: "Provide 'email' or 'id' query parameter" });
    return;
  }

  try {
    const partnerRecord = await findRideAlongDriver(lookup);
    if (!partnerRecord) {
      res.status(404).json({ error: "No MCC ride-along driver found" });
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

// POST /api/tandem-jobs

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
    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
    if (!ride) {
      res.status(404).json({ error: "Ride not found" });
      return;
    }

    if (!ride.tandemRequired) {
      res.status(400).json({ error: "This ride does not require a tandem partner" });
      return;
    }

    // Authorisation: caller must hold an accepted assignment for this ride.
    const [assignment] = await db
      .select({ id: driverAssignmentsTable.id })
      .from(driverAssignmentsTable)
      .where(
        and(
          eq(driverAssignmentsTable.rideId, rideId),
          eq(driverAssignmentsTable.driverId, provider.id),
          inArray(driverAssignmentsTable.status, ["accepted", "active"]),
        ),
      )
      .limit(1);

    if (!assignment) {
      res.status(403).json({ error: "You are not the assigned provider for this ride" });
      return;
    }

    // Idempotency: return existing record if one already exists.
    const [existing] = await db
      .select()
      .from(tandemJobsTable)
      .where(and(eq(tandemJobsTable.rideId, rideId), eq(tandemJobsTable.providerId, provider.id)))
      .limit(1);

    if (existing) {
      res.status(200).json(existing);
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

// GET /api/tandem-jobs/:id

router.get("/tandem-jobs/:id", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const provider = await resolveCallerDriver(user, res);
  if (!provider) return;

  try {
    const [tandemJob] = await db
      .select()
      .from(tandemJobsTable)
      .where(eq(tandemJobsTable.id, String(req.params["id"])))
      .limit(1);

    if (!tandemJob) {
      res.status(404).json({ error: "Tandem job not found" });
      return;
    }

    if (tandemJob.providerId !== provider.id) {
      res.status(403).json({ error: "Not your tandem job" });
      return;
    }

    res.json(tandemJob);
  } catch (err) {
    logger.error({ err }, "tandem.get failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// PATCH /api/tandem-jobs/:id/mode

router.patch("/tandem-jobs/:id/mode", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const provider = await resolveCallerDriver(user, res);
  if (!provider) return;

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
      .where(eq(tandemJobsTable.id, String(req.params["id"])))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Tandem job not found" });
      return;
    }
    if (existing.providerId !== provider.id) {
      res.status(403).json({ error: "Not your tandem job" });
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
      .where(eq(tandemJobsTable.id, existing.id))
      .returning();

    req.log.info({ tandemJobId: existing.id, tandemMode }, "tandem.mode.updated");
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "tandem.mode.update failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// POST /api/tandem-jobs/:id/known-partner

router.post(
  "/tandem-jobs/:id/known-partner",
  async (req: Request, res: Response): Promise<void> => {
    const user = await requireUserAuth(req, res);
    if (!user) return;

    const provider = await resolveCallerDriver(user, res);
    if (!provider) return;

    const { partnerEmailOrId } = req.body as { partnerEmailOrId?: string };
    if (!partnerEmailOrId) {
      res.status(400).json({ error: "partnerEmailOrId is required" });
      return;
    }

    try {
      const [tandemJob] = await db
        .select()
        .from(tandemJobsTable)
        .where(eq(tandemJobsTable.id, String(req.params["id"])))
        .limit(1);

      if (!tandemJob) {
        res.status(404).json({ error: "Tandem job not found" });
        return;
      }
      if (tandemJob.providerId !== provider.id) {
        res.status(403).json({ error: "Not your tandem job" });
        return;
      }

      const partnerRecord = await findRideAlongDriver(partnerEmailOrId);
      if (!partnerRecord) {
        res.status(404).json({ error: "No MCC ride-along driver found" });
        return;
      }
      if (!partnerRecord.verified || partnerRecord.status !== "active") {
        res.status(422).json({
          error: "Partner is not verified or not active",
          partnerStatus: partnerRecord.status,
          verified: partnerRecord.verified,
        });
        return;
      }

      const [updated] = await db
        .update(tandemJobsTable)
        .set({ rideAlongDriverId: partnerRecord.id, matchStatus: "confirmed", updatedAt: new Date() })
        .where(eq(tandemJobsTable.id, tandemJob.id))
        .returning();

      req.log.info({ tandemJobId: tandemJob.id, partnerId: partnerRecord.id }, "tandem.known_partner.set");
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
  },
);

// DELETE /api/tandem-jobs/:id/known-partner

router.delete(
  "/tandem-jobs/:id/known-partner",
  async (req: Request, res: Response): Promise<void> => {
    const user = await requireUserAuth(req, res);
    if (!user) return;

    const provider = await resolveCallerDriver(user, res);
    if (!provider) return;

    try {
      const [tandemJob] = await db
        .select()
        .from(tandemJobsTable)
        .where(eq(tandemJobsTable.id, String(req.params["id"])))
        .limit(1);

      if (!tandemJob) {
        res.status(404).json({ error: "Tandem job not found" });
        return;
      }
      if (tandemJob.providerId !== provider.id) {
        res.status(403).json({ error: "Not your tandem job" });
        return;
      }

      const [updated] = await db
        .update(tandemJobsTable)
        .set({ rideAlongDriverId: null, matchStatus: "pending", updatedAt: new Date() })
        .where(eq(tandemJobsTable.id, tandemJob.id))
        .returning();

      req.log.info({ tandemJobId: tandemJob.id }, "tandem.known_partner.removed");
      res.json(updated);
    } catch (err) {
      logger.error({ err }, "tandem.known_partner.remove failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── Driver preferred-partner endpoints ────────────────────────────────────────
// Persists a driver's standing preferred tandem partner to their profile row.

// GET /api/drivers/me/preferred-partner

router.get("/drivers/me/preferred-partner", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const driver = await resolveCallerDriver(user, res);
  if (!driver) return;

  if (!driver.preferredPartnerId) {
    res.status(404).json({ error: "No preferred partner saved" });
    return;
  }

  try {
    const [partnerRecord] = await db
      .select()
      .from(rideAlongDriversTable)
      .where(eq(rideAlongDriversTable.id, driver.preferredPartnerId))
      .limit(1);

    if (!partnerRecord) {
      res.status(404).json({ error: "Saved partner record not found" });
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
    logger.error({ err }, "drivers.preferred_partner.get failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// POST /api/drivers/me/preferred-partner   body: { partnerEmailOrId }

router.post(
  "/drivers/me/preferred-partner",
  async (req: Request, res: Response): Promise<void> => {
    const user = await requireUserAuth(req, res);
    if (!user) return;

    const driver = await resolveCallerDriver(user, res);
    if (!driver) return;

    const { partnerEmailOrId } = req.body as { partnerEmailOrId?: string };
    if (!partnerEmailOrId) {
      res.status(400).json({ error: "partnerEmailOrId is required" });
      return;
    }

    try {
      const partnerRecord = await findRideAlongDriver(partnerEmailOrId);
      if (!partnerRecord) {
        res.status(404).json({ error: "No MCC ride-along driver found" });
        return;
      }
      if (!partnerRecord.verified || partnerRecord.status !== "active") {
        res.status(422).json({
          error: "Partner is not verified or not active",
          partnerStatus: partnerRecord.status,
          verified: partnerRecord.verified,
        });
        return;
      }

      await db
        .update(driversTable)
        .set({ preferredPartnerId: partnerRecord.id })
        .where(eq(driversTable.id, driver.id));

      req.log.info({ driverId: driver.id, partnerId: partnerRecord.id }, "driver.preferred_partner.set");
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
        eligible: true,
      });
    } catch (err) {
      logger.error({ err }, "drivers.preferred_partner.set failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// DELETE /api/drivers/me/preferred-partner

router.delete(
  "/drivers/me/preferred-partner",
  async (req: Request, res: Response): Promise<void> => {
    const user = await requireUserAuth(req, res);
    if (!user) return;

    const driver = await resolveCallerDriver(user, res);
    if (!driver) return;

    try {
      await db
        .update(driversTable)
        .set({ preferredPartnerId: null })
        .where(eq(driversTable.id, driver.id));

      req.log.info({ driverId: driver.id }, "driver.preferred_partner.cleared");
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "drivers.preferred_partner.clear failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

export default router;
