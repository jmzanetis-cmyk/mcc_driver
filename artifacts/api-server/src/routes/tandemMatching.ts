// ============================================================
// MCC API — Tandem Matching Router (Phase 3a)
// ============================================================
// Mode B (Platform Matching) backend: broadcast a tandem job to
// eligible Ride-Along Drivers, atomically accept the first
// responder, record declines for re-broadcast filtering, and
// expire unmatched broadcasts after 2 hours via a background sweep.
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, inArray, notInArray, lt, gte, lte, isNotNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  tandemJobsTable,
  tandemJobDeclinesTable,
  rideAlongDriversTable,
  ridesTable,
  driversTable,
} from "@workspace/db/schema";
import { logger } from "../lib/logger";
import {
  verifySupabaseToken,
  extractBearerToken,
  type SupabaseUser,
} from "../lib/adminAuth";
import { tandemEvents } from "../lib/tandemEvents";
import {
  notifyApprovalOutcome,
  notifyBroadcastToDrivers,
  notifyMatchExpired,
  notifyMemberAwaitingApproval,
  notifyProviderMatched,
} from "../lib/notifications";
import { upsertTandemJobViaSupabase } from "../lib/supabaseAdmin";

const router: IRouter = Router();

const BROADCAST_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
// Two tandem jobs whose rides were requested within this window of each
// other are considered overlapping for driver-busy purposes. Rides don't
// carry an explicit scheduled-for column today, so requestedAt is the
// best available anchor; ±4 hours covers typical concierge ride durations.
const OVERLAP_WINDOW_MS = 4 * 60 * 60 * 1000;

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

async function resolveCallerRideAlongDriver(
  user: SupabaseUser,
  res: Response,
): Promise<(typeof rideAlongDriversTable.$inferSelect) | null> {
  const [record] = await db
    .select()
    .from(rideAlongDriversTable)
    .where(eq(rideAlongDriversTable.userId, user.id))
    .limit(1);
  if (!record) {
    res.status(403).json({ error: "No ride-along driver profile found" });
    return null;
  }
  return record;
}

// ── Eligibility helpers ──────────────────────────────────────────────────────

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.7613; // earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function isExpiryFuture(value: string | null): boolean {
  if (!value) return false;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}

export interface EligibleDriverRow {
  driver: typeof rideAlongDriversTable.$inferSelect;
  distanceMiles: number | null;
  priorJobsWithProvider: number;
  rankScore: number;
}

/**
 * Compute the eligible ride-along driver list for a tandem job.
 *
 * Filters (all must pass):
 *   - verified = true
 *   - status = 'active'
 *   - license + insurance expiry parse to a future date
 *   - ZIP within max_distance_miles of ride pickup (Haversine) — drivers
 *     with unresolved zip_lat/zip_lng are ineligible (the Phase 3b ZIP
 *     lookup populates these at signup)
 *   - no overlapping tandem job (excludes drivers attached to another
 *     non-terminal tandem job whose ride was created within ±4h of this
 *     ride's createdAt)
 *   - not in the per-job decline list
 *
 * Ranking:
 *   - rating desc, with a +0.25 bonus per prior completed tandem job for the
 *     same provider, then totalJobs desc as a tie-break.
 */
export async function computeEligibleDrivers(
  tandemJobId: string,
): Promise<EligibleDriverRow[]> {
  const [job] = await db
    .select()
    .from(tandemJobsTable)
    .where(eq(tandemJobsTable.id, tandemJobId))
    .limit(1);
  if (!job) return [];

  const [ride] = await db
    .select()
    .from(ridesTable)
    .where(eq(ridesTable.id, job.rideId))
    .limit(1);
  if (!ride) return [];

  // Drivers already declined for this job
  const declines = await db
    .select({ driverId: tandemJobDeclinesTable.rideAlongDriverId })
    .from(tandemJobDeclinesTable)
    .where(eq(tandemJobDeclinesTable.tandemJobId, tandemJobId));
  const declinedIds = declines.map((d) => d.driverId);

  // Window-based overlap exclusion: drivers attached to another non-terminal
  // tandem job whose ride was created within ±OVERLAP_WINDOW_MS of this
  // job's ride are considered busy and excluded. Rides don't yet carry an
  // explicit scheduled-for column, so createdAt is the best available anchor.
  const TERMINAL = ["completed", "cancelled", "expired", "dispatch_failed"];
  const anchor = ride.createdAt ?? new Date();
  const windowStart = new Date(anchor.getTime() - OVERLAP_WINDOW_MS);
  const windowEnd = new Date(anchor.getTime() + OVERLAP_WINDOW_MS);
  const busyRows = await db
    .select({ driverId: tandemJobsTable.matchedRideAlongDriverId })
    .from(tandemJobsTable)
    .innerJoin(ridesTable, eq(ridesTable.id, tandemJobsTable.rideId))
    .where(
      and(
        isNotNull(tandemJobsTable.matchedRideAlongDriverId),
        notInArray(ridesTable.status, TERMINAL),
        inArray(tandemJobsTable.matchStatus, ["matched", "confirmed", "member_pending"]),
        notInArray(tandemJobsTable.id, [tandemJobId]),
        isNotNull(ridesTable.createdAt),
        gte(ridesTable.createdAt, windowStart),
        lte(ridesTable.createdAt, windowEnd),
      ),
    );
  const busyIds = busyRows
    .map((r) => r.driverId)
    .filter((id): id is string => id != null);

  const excludeIds = Array.from(new Set([...declinedIds, ...busyIds]));

  const candidates = await db
    .select()
    .from(rideAlongDriversTable)
    .where(
      and(
        eq(rideAlongDriversTable.verified, true),
        eq(rideAlongDriversTable.status, "active"),
        excludeIds.length > 0
          ? notInArray(rideAlongDriversTable.id, excludeIds)
          : undefined,
      ),
    );

  // Count prior completed tandem jobs per driver for this provider
  const candidateIds = candidates.map((c) => c.id);
  const priorCountByDriver = new Map<string, number>();
  if (candidateIds.length > 0) {
    const priorRows = await db
      .select({
        driverId: tandemJobsTable.matchedRideAlongDriverId,
        count: sql<number>`count(*)::int`,
      })
      .from(tandemJobsTable)
      .innerJoin(ridesTable, eq(ridesTable.id, tandemJobsTable.rideId))
      .where(
        and(
          eq(tandemJobsTable.providerId, job.providerId),
          eq(ridesTable.status, "completed"),
          inArray(
            tandemJobsTable.matchedRideAlongDriverId,
            candidateIds,
          ),
        ),
      )
      .groupBy(tandemJobsTable.matchedRideAlongDriverId);
    for (const r of priorRows) {
      if (r.driverId) priorCountByDriver.set(r.driverId, r.count);
    }
  }

  const rows: EligibleDriverRow[] = [];
  for (const driver of candidates) {
    if (!isExpiryFuture(driver.licenseExpiry) || !isExpiryFuture(driver.insuranceExpiry)) {
      continue;
    }

    // Strict distance gate: a driver whose ZIP we cannot resolve to coords
    // cannot satisfy max_distance_miles and is therefore ineligible. The
    // Phase 3b ZIP-lookup task populates zip_lat/zip_lng at signup so this
    // filter will admit valid drivers.
    if (driver.zipLat == null || driver.zipLng == null) continue;
    const distanceMiles = haversineMiles(
      ride.pickupLat,
      ride.pickupLng,
      driver.zipLat,
      driver.zipLng,
    );
    if (distanceMiles > driver.maxDistanceMiles) continue;

    const priorJobs = priorCountByDriver.get(driver.id) ?? 0;
    const rankScore = driver.rating + priorJobs * 0.25;

    rows.push({ driver, distanceMiles, priorJobsWithProvider: priorJobs, rankScore });
  }

  rows.sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    return b.driver.totalJobs - a.driver.totalJobs;
  });

  return rows;
}

// ── Shared broadcast helper ──────────────────────────────────────────────────
// Opens (or re-opens) the broadcast window for a Mode B tandem job: clears any
// previously matched ride-along driver, marks the job as `broadcast`, sets a
// fresh 2-hour deadline, and emits the broadcast.opened event. Used by the
// provider-initiated /broadcast and /request-rematch routes and by the
// /member-decline route which re-broadcasts on member rejection.

interface BroadcastResult {
  tandemJob: typeof tandemJobsTable.$inferSelect;
  eligible: EligibleDriverRow[];
  matchDeadline: Date;
}

async function reopenBroadcast(tandemJobId: string): Promise<BroadcastResult> {
  const matchDeadline = new Date(Date.now() + BROADCAST_WINDOW_MS);
  const [updated] = await db
    .update(tandemJobsTable)
    .set({
      matchStatus: "broadcast",
      matchDeadline,
      matchedRideAlongDriverId: null,
      rideAlongDriverId: null,
      memberApproved: null,
      updatedAt: new Date(),
    })
    .where(eq(tandemJobsTable.id, tandemJobId))
    .returning();

  if (!updated) {
    throw new Error(`tandem job ${tandemJobId} not found during reopenBroadcast`);
  }

  // Mirror the row to Supabase so the ride-along driver dashboard's Realtime
  // INSERT/UPDATE subscription on tandem_jobs fires. Failure here is logged
  // but non-fatal: local Drizzle remains the source of truth and the
  // dashboard can still pick up the job via its initial fetch.
  try {
    await upsertTandemJobViaSupabase(tandemJobId, {
      ride_id: updated.rideId,
      provider_id: updated.providerId,
      tandem_mode: updated.tandemMode,
      match_status: updated.matchStatus,
      match_deadline: matchDeadline.toISOString(),
      matched_ride_along_driver_id: null,
      ride_along_driver_id: null,
      member_approved: null,
      ride_along_fee: updated.rideAlongFee,
    });
  } catch (err) {
    logger.error({ err, tandemJobId }, "tandem.broadcast.supabase_mirror_failed");
  }

  const eligible = await computeEligibleDrivers(tandemJobId);

  const eligibleDriverIds = eligible.map((r) => r.driver.id);
  tandemEvents.emit("tandem.broadcast.opened", {
    tandemJobId,
    eligibleDriverIds,
    matchDeadline,
  });

  // Phase 3c: fan-out push (Realtime) + SMS to every eligible ride-along driver.
  // Fire-and-forget; per-recipient failures are logged inside the helper.
  void notifyBroadcastToDrivers(tandemJobId, eligibleDriverIds).catch((err) =>
    logger.error({ err, tandemJobId }, "tandem.notify.broadcast_failed"),
  );

  return { tandemJob: updated, eligible, matchDeadline };
}

function summarizeEligible(rows: EligibleDriverRow[]) {
  return rows.map((r) => ({
    id: r.driver.id,
    firstName: r.driver.firstName,
    lastName: r.driver.lastName,
    rating: r.driver.rating,
    totalJobs: r.driver.totalJobs,
    distanceMiles: r.distanceMiles,
    priorJobsWithProvider: r.priorJobsWithProvider,
  }));
}

// ── POST /tandem-jobs/:id/broadcast ──────────────────────────────────────────
// Provider opens the broadcast window: marks job as `broadcast` with a
// 2-hour deadline. Phase 3c will fan-out push/SMS to the eligible list.

router.post(
  "/tandem-jobs/:id/broadcast",
  async (req: Request, res: Response): Promise<void> => {
    const user = await requireUserAuth(req, res);
    if (!user) return;
    const provider = await resolveCallerDriver(user, res);
    if (!provider) return;

    const tandemJobId = String(req.params["id"]);

    try {
      const [job] = await db
        .select()
        .from(tandemJobsTable)
        .where(eq(tandemJobsTable.id, tandemJobId))
        .limit(1);

      if (!job) {
        res.status(404).json({ error: "Tandem job not found" });
        return;
      }
      if (job.providerId !== provider.id) {
        res.status(403).json({ error: "Not your tandem job" });
        return;
      }
      if (job.tandemMode !== "B") {
        res.status(422).json({
          error: "Broadcast is only valid for Mode B tandem jobs",
          currentMode: job.tandemMode,
        });
        return;
      }
      if (
        job.matchStatus === "matched" ||
        job.matchStatus === "confirmed" ||
        job.matchStatus === "member_pending"
      ) {
        res.status(409).json({
          error: "Tandem job already matched",
          matchStatus: job.matchStatus,
        });
        return;
      }

      const result = await reopenBroadcast(tandemJobId);
      req.log.info(
        { tandemJobId, eligibleCount: result.eligible.length, matchDeadline: result.matchDeadline },
        "tandem.broadcast.opened",
      );

      res.status(200).json({
        tandemJob: result.tandemJob,
        eligibleCount: result.eligible.length,
        eligibleDrivers: summarizeEligible(result.eligible),
      });
    } catch (err) {
      logger.error({ err }, "tandem.broadcast failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── GET /tandem-jobs/:id/eligible-drivers ────────────────────────────────────
// Provider can preview the eligibility list (useful for Phase 3b dashboards
// and for ops debugging).

router.get(
  "/tandem-jobs/:id/eligible-drivers",
  async (req: Request, res: Response): Promise<void> => {
    const user = await requireUserAuth(req, res);
    if (!user) return;
    const provider = await resolveCallerDriver(user, res);
    if (!provider) return;

    const tandemJobId = String(req.params["id"]);
    const [job] = await db
      .select()
      .from(tandemJobsTable)
      .where(eq(tandemJobsTable.id, tandemJobId))
      .limit(1);
    if (!job) {
      res.status(404).json({ error: "Tandem job not found" });
      return;
    }
    if (job.providerId !== provider.id) {
      res.status(403).json({ error: "Not your tandem job" });
      return;
    }

    try {
      const eligible = await computeEligibleDrivers(tandemJobId);
      res.json({
        eligibleCount: eligible.length,
        eligibleDrivers: eligible.map((r) => ({
          id: r.driver.id,
          firstName: r.driver.firstName,
          lastName: r.driver.lastName,
          rating: r.driver.rating,
          totalJobs: r.driver.totalJobs,
          distanceMiles: r.distanceMiles,
          priorJobsWithProvider: r.priorJobsWithProvider,
        })),
      });
    } catch (err) {
      logger.error({ err }, "tandem.eligible_drivers failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── GET /ride-along/eligible-broadcasts ──────────────────────────────────────
// Authenticated ride-along driver fetches the list of currently-broadcast
// tandem jobs the caller is eligible for. Eligibility reuses the same
// computeEligibleDrivers() filters that the broadcast worker applies, so
// declined jobs, busy-overlap jobs, and out-of-range jobs are excluded
// server-side and clients can't see jobs they couldn't actually accept.

router.get(
  "/ride-along/eligible-broadcasts",
  async (req: Request, res: Response): Promise<void> => {
    const user = await requireUserAuth(req, res);
    if (!user) return;
    const partner = await resolveCallerRideAlongDriver(user, res);
    if (!partner) return;

    try {
      const openJobs = await db
        .select()
        .from(tandemJobsTable)
        .where(eq(tandemJobsTable.matchStatus, "broadcast"));

      const visible: Array<{
        id: string;
        rideId: string;
        providerId: string;
        tandemMode: string;
        matchStatus: string;
        matchDeadline: string | null;
        rideAlongFee: number | string | null;
        matchedRideAlongDriverId: string | null;
      }> = [];

      for (const job of openJobs) {
        const eligible = await computeEligibleDrivers(job.id);
        if (eligible.some((r) => r.driver.id === partner.id)) {
          visible.push({
            id: job.id,
            rideId: job.rideId,
            providerId: job.providerId,
            tandemMode: job.tandemMode,
            matchStatus: job.matchStatus,
            matchDeadline: job.matchDeadline
              ? job.matchDeadline.toISOString()
              : null,
            rideAlongFee: job.rideAlongFee,
            matchedRideAlongDriverId: job.matchedRideAlongDriverId,
          });
        }
      }

      res.json({ broadcasts: visible });
    } catch (err) {
      logger.error({ err }, "tandem.eligible_broadcasts failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── GET /tandem-jobs/:id/match-detail ────────────────────────────────────────
// PUBLIC (no auth) — used by the Member Approval deep link. Returns the
// tandem job with the two driver summaries (provider + matched ride-along).
// Phase 3b: deep link itself is the credential. Phase 3c will replace this
// with signed-token verification.

router.get(
  "/tandem-jobs/:id/match-detail",
  async (req: Request, res: Response): Promise<void> => {
    const tandemJobId = String(req.params["id"]);

    const [job] = await db
      .select()
      .from(tandemJobsTable)
      .where(eq(tandemJobsTable.id, tandemJobId))
      .limit(1);
    if (!job) {
      res.status(404).json({ error: "Tandem job not found" });
      return;
    }

    const [primary] = await db
      .select({
        id: driversTable.id,
        firstName: driversTable.firstName,
        lastName: driversTable.lastName,
        rating: driversTable.averageRating,
        totalJobs: driversTable.totalRidesCompleted,
        profilePhotoPath: driversTable.profilePhotoUrl,
      })
      .from(driversTable)
      .where(eq(driversTable.id, job.providerId))
      .limit(1);

    let rideAlong: {
      id: string;
      firstName: string;
      lastName: string;
      rating: number;
      totalJobs: number;
      profilePhotoPath: string | null;
    } | null = null;

    if (job.matchedRideAlongDriverId) {
      const [r] = await db
        .select({
          id: rideAlongDriversTable.id,
          firstName: rideAlongDriversTable.firstName,
          lastName: rideAlongDriversTable.lastName,
          rating: rideAlongDriversTable.rating,
          totalJobs: rideAlongDriversTable.totalJobs,
          profilePhotoPath: rideAlongDriversTable.profilePhotoPath,
        })
        .from(rideAlongDriversTable)
        .where(eq(rideAlongDriversTable.id, job.matchedRideAlongDriverId))
        .limit(1);
      rideAlong = r ?? null;
    }

    res.json({
      id: job.id,
      rideId: job.rideId,
      matchStatus: job.matchStatus,
      memberApproved: job.memberApproved,
      rideAlongFee: job.rideAlongFee,
      primaryDriver: primary ?? null,
      rideAlongDriver: rideAlong,
    });
  },
);

// ── POST /tandem-jobs/:id/ridealong-accept ───────────────────────────────────
// Atomic accept: only the first ride-along driver to call wins. Subsequent
// callers receive 409. Mirrors the ride-accept pattern in routes/rides.ts.

router.post(
  "/tandem-jobs/:id/ridealong-accept",
  async (req: Request, res: Response): Promise<void> => {
    const user = await requireUserAuth(req, res);
    if (!user) return;
    const partner = await resolveCallerRideAlongDriver(user, res);
    if (!partner) return;

    if (!partner.verified || partner.status !== "active") {
      res.status(403).json({ error: "Partner is not verified or not active" });
      return;
    }

    const tandemJobId = String(req.params["id"]);
    const now = new Date();

    try {
      // Verify the job is still open before attempting the atomic update — gives
      // friendlier error messages than a bare 409.
      const [job] = await db
        .select()
        .from(tandemJobsTable)
        .where(eq(tandemJobsTable.id, tandemJobId))
        .limit(1);

      if (!job) {
        res.status(404).json({ error: "Tandem job not found" });
        return;
      }
      if (job.tandemMode !== "B") {
        res.status(422).json({ error: "Tandem job is not in Mode B" });
        return;
      }

      // Eligibility gate: caller must be in the freshly computed eligible
      // set for this job (verified+active+license/insurance+distance+busy+
      // decline filters all enforced). Prevents broken access control where
      // a driver who knows a job id could claim an unrelated broadcast.
      const eligible = await computeEligibleDrivers(tandemJobId);
      if (!eligible.some((r) => r.driver.id === partner.id)) {
        res.status(403).json({ error: "Not eligible for this tandem job" });
        return;
      }

      // Atomic accept: only update when still broadcast + not past deadline +
      // not already matched. The WHERE guard means concurrent callers will
      // produce an empty `returning()` for all but the winner.
      const winner = await db
        .update(tandemJobsTable)
        .set({
          matchStatus: "matched",
          matchedRideAlongDriverId: partner.id,
          rideAlongDriverId: partner.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(tandemJobsTable.id, tandemJobId),
            eq(tandemJobsTable.matchStatus, "broadcast"),
            isNotNull(tandemJobsTable.matchDeadline),
            // matchDeadline > now
            sql`${tandemJobsTable.matchDeadline} > ${now}`,
          ),
        )
        .returning();

      if (winner.length === 0) {
        res.status(409).json({ error: "Job already taken" });
        return;
      }

      // Mirror the matched state to Supabase so other ride-along dashboards
      // see the UPDATE event and remove this job from their broadcast list.
      try {
        await upsertTandemJobViaSupabase(tandemJobId, {
          ride_id: winner[0]!.rideId,
          provider_id: winner[0]!.providerId,
          tandem_mode: winner[0]!.tandemMode,
          match_status: winner[0]!.matchStatus,
          match_deadline: winner[0]!.matchDeadline?.toISOString() ?? null,
          matched_ride_along_driver_id: partner.id,
          ride_along_driver_id: partner.id,
        });
      } catch (err) {
        logger.error({ err, tandemJobId }, "tandem.matching.accept.supabase_mirror_failed");
      }

      req.log.info(
        { tandemJobId, rideAlongDriverId: partner.id },
        "tandem.matching.accepted",
      );
      tandemEvents.emit("tandem.matching.accepted", {
        tandemJobId,
        rideAlongDriverId: partner.id,
      });
      // Phase 3c: notify the provider that a ride-along driver matched.
      void notifyProviderMatched(tandemJobId).catch((err) =>
        logger.error({ err, tandemJobId }, "tandem.notify.provider_matched_failed"),
      );
      res.status(200).json(winner[0]);
    } catch (err) {
      logger.error({ err }, "tandem.matching.accept failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── POST /tandem-jobs/:id/ridealong-decline ──────────────────────────────────
// Records the decline so the driver is excluded from re-broadcasts of the
// same job. Idempotent (unique index swallows duplicate declines).

router.post(
  "/tandem-jobs/:id/ridealong-decline",
  async (req: Request, res: Response): Promise<void> => {
    const user = await requireUserAuth(req, res);
    if (!user) return;
    const partner = await resolveCallerRideAlongDriver(user, res);
    if (!partner) return;

    const tandemJobId = String(req.params["id"]);
    const { reason } = req.body as { reason?: string };

    try {
      const [job] = await db
        .select({ id: tandemJobsTable.id })
        .from(tandemJobsTable)
        .where(eq(tandemJobsTable.id, tandemJobId))
        .limit(1);
      if (!job) {
        res.status(404).json({ error: "Tandem job not found" });
        return;
      }

      // Idempotent insert: rely on the unique index on (tandem_job_id,
      // ride_along_driver_id) via onConflictDoNothing. Real DB errors still
      // propagate to the outer catch so we don't silently lose declines.
      await db
        .insert(tandemJobDeclinesTable)
        .values({
          tandemJobId,
          rideAlongDriverId: partner.id,
          reason: reason ?? null,
        })
        .onConflictDoNothing({
          target: [
            tandemJobDeclinesTable.tandemJobId,
            tandemJobDeclinesTable.rideAlongDriverId,
          ],
        });

      req.log.info(
        { tandemJobId, rideAlongDriverId: partner.id },
        "tandem.matching.declined",
      );
      tandemEvents.emit("tandem.matching.declined", {
        tandemJobId,
        rideAlongDriverId: partner.id,
        reason: reason ?? null,
      });
      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error({ err }, "tandem.matching.decline failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── PATCH /tandem-jobs/:id/member-approve ────────────────────────────────────
// Member confirms the matched ride-along driver. Transitions
// matched/member_pending → confirmed and stamps memberApproved=true.
// Phase 3b: no member auth yet — the deep-link itself is the bearer
// credential (Phase 3c will wire signed tokens / member sessions).

router.patch(
  "/tandem-jobs/:id/member-approve",
  async (req: Request, res: Response): Promise<void> => {
    const tandemJobId = String(req.params["id"]);

    try {
      const [job] = await db
        .select()
        .from(tandemJobsTable)
        .where(eq(tandemJobsTable.id, tandemJobId))
        .limit(1);

      if (!job) {
        res.status(404).json({ error: "Tandem job not found" });
        return;
      }
      if (job.matchStatus === "confirmed") {
        // Idempotent: already approved
        res.status(200).json(job);
        return;
      }

      // Atomic compare-and-set: only flip when still in matched/member_pending.
      // Loses the race to a concurrent rematch/decline => 409.
      const updatedRows = await db
        .update(tandemJobsTable)
        .set({
          matchStatus: "confirmed",
          memberApproved: true,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tandemJobsTable.id, tandemJobId),
            inArray(tandemJobsTable.matchStatus, ["matched", "member_pending"]),
          ),
        )
        .returning();

      if (updatedRows.length === 0) {
        res.status(409).json({
          error: "Tandem job is not awaiting member approval",
        });
        return;
      }
      const updated = updatedRows[0]!;

      // Mirror the confirmed state to Supabase so the provider dashboard
      // sees the UPDATE event in real time.
      try {
        await upsertTandemJobViaSupabase(tandemJobId, {
          ride_id: updated.rideId,
          provider_id: updated.providerId,
          tandem_mode: updated.tandemMode,
          match_status: updated.matchStatus,
          match_deadline: updated.matchDeadline?.toISOString() ?? null,
          matched_ride_along_driver_id: updated.matchedRideAlongDriverId,
          ride_along_driver_id: updated.rideAlongDriverId,
          member_approved: updated.memberApproved,
        });
      } catch (err) {
        logger.error({ err, tandemJobId }, "tandem.member.approve.supabase_mirror_failed");
      }

      req.log.info({ tandemJobId }, "tandem.member.approved");
      // Phase 3c: notify provider + matched ride-along driver of the approval.
      void notifyApprovalOutcome(tandemJobId, true).catch((err) =>
        logger.error({ err, tandemJobId }, "tandem.notify.approval_outcome_failed"),
      );
      res.status(200).json(updated);
    } catch (err) {
      logger.error({ err }, "tandem.member.approve failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── PATCH /tandem-jobs/:id/provider-accept ───────────────────────────────────
// Provider explicitly confirms the matched ride-along driver and forwards the
// approval request to the member. Atomic compare-and-set: only flips while
// the job is still `matched`. Member approval remains a separate step.

router.patch(
  "/tandem-jobs/:id/provider-accept",
  async (req: Request, res: Response): Promise<void> => {
    const user = await requireUserAuth(req, res);
    if (!user) return;
    const provider = await resolveCallerDriver(user, res);
    if (!provider) return;

    const tandemJobId = String(req.params["id"]);
    try {
      const [job] = await db
        .select()
        .from(tandemJobsTable)
        .where(eq(tandemJobsTable.id, tandemJobId))
        .limit(1);
      if (!job) {
        res.status(404).json({ error: "Tandem job not found" });
        return;
      }
      if (job.providerId !== provider.id) {
        res.status(403).json({ error: "Not your tandem job" });
        return;
      }
      if (job.tandemMode !== "B") {
        res.status(422).json({ error: "Provider-accept only valid for Mode B" });
        return;
      }
      if (job.matchStatus === "member_pending" || job.matchStatus === "confirmed") {
        res.status(200).json(job);
        return;
      }

      const [updated] = await db
        .update(tandemJobsTable)
        .set({ matchStatus: "member_pending", updatedAt: new Date() })
        .where(
          and(
            eq(tandemJobsTable.id, tandemJobId),
            eq(tandemJobsTable.matchStatus, "matched"),
          ),
        )
        .returning();

      if (!updated) {
        res.status(409).json({ error: "Tandem job is no longer in matched state" });
        return;
      }

      try {
        await upsertTandemJobViaSupabase(tandemJobId, {
          ride_id: updated.rideId,
          provider_id: updated.providerId,
          tandem_mode: updated.tandemMode,
          match_status: updated.matchStatus,
          matched_ride_along_driver_id: updated.matchedRideAlongDriverId,
          ride_along_driver_id: updated.rideAlongDriverId,
          member_approved: updated.memberApproved,
          ride_along_fee: updated.rideAlongFee,
        });
      } catch (err) {
        logger.error({ err, tandemJobId }, "tandem.provider_accept.supabase_mirror_failed");
      }

      req.log.info({ tandemJobId }, "tandem.provider.accepted");
      // Phase 3c: forward the approval request to the member.
      void notifyMemberAwaitingApproval(tandemJobId).catch((err) =>
        logger.error({ err, tandemJobId }, "tandem.notify.member_awaiting_failed"),
      );
      res.status(200).json(updated);
    } catch (err) {
      logger.error({ err }, "tandem.provider.accept failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── PATCH /tandem-jobs/:id/member-decline ────────────────────────────────────
// Member rejects the matched ride-along driver. The previously matched driver
// is recorded as a decline so they are excluded from re-matching, then the
// job is re-broadcast to the remaining eligible drivers.

router.patch(
  "/tandem-jobs/:id/member-decline",
  async (req: Request, res: Response): Promise<void> => {
    const tandemJobId = String(req.params["id"]);
    const { reason } = (req.body ?? {}) as { reason?: string };

    try {
      const [job] = await db
        .select()
        .from(tandemJobsTable)
        .where(eq(tandemJobsTable.id, tandemJobId))
        .limit(1);

      if (!job) {
        res.status(404).json({ error: "Tandem job not found" });
        return;
      }
      if (job.tandemMode !== "B") {
        res.status(422).json({ error: "Re-broadcast only valid for Mode B" });
        return;
      }

      // Atomic claim: only proceed when still in the rematchable window.
      // Losing the race (e.g., concurrent member-approve) yields 409.
      const claimed = await db
        .update(tandemJobsTable)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(tandemJobsTable.id, tandemJobId),
            inArray(tandemJobsTable.matchStatus, ["matched", "member_pending"]),
          ),
        )
        .returning({ id: tandemJobsTable.id });

      if (claimed.length === 0) {
        res.status(409).json({ error: "Tandem job is not awaiting member approval" });
        return;
      }

      // Exclude the rejected driver from any subsequent broadcast for this job
      // by recording a decline (idempotent on the unique index).
      if (job.matchedRideAlongDriverId) {
        await db
          .insert(tandemJobDeclinesTable)
          .values({
            tandemJobId,
            rideAlongDriverId: job.matchedRideAlongDriverId,
            reason: reason ?? "member_declined",
          })
          .onConflictDoNothing({
            target: [
              tandemJobDeclinesTable.tandemJobId,
              tandemJobDeclinesTable.rideAlongDriverId,
            ],
          });
      }

      // Capture the previously-matched ride-along driver id BEFORE reopening
      // the broadcast — `reopenBroadcast` clears `matchedRideAlongDriverId`,
      // so we'd otherwise lose the recipient for the decline notification.
      const [preDeclineJob] = await db
        .select({
          matchedRideAlongDriverId: tandemJobsTable.matchedRideAlongDriverId,
          rideAlongDriverId: tandemJobsTable.rideAlongDriverId,
        })
        .from(tandemJobsTable)
        .where(eq(tandemJobsTable.id, tandemJobId))
        .limit(1);
      const previouslyMatchedId =
        preDeclineJob?.matchedRideAlongDriverId ??
        preDeclineJob?.rideAlongDriverId ??
        null;

      const result = await reopenBroadcast(tandemJobId);

      req.log.info(
        { tandemJobId, eligibleCount: result.eligible.length },
        "tandem.member.declined",
      );
      // Phase 3c: notify provider + previously matched driver of the decline.
      // (The re-broadcast fan-out is fired inside reopenBroadcast above.)
      void notifyApprovalOutcome(tandemJobId, false, previouslyMatchedId).catch((err) =>
        logger.error({ err, tandemJobId }, "tandem.notify.approval_outcome_failed"),
      );
      res.status(200).json({
        tandemJob: result.tandemJob,
        eligibleCount: result.eligible.length,
        eligibleDrivers: summarizeEligible(result.eligible),
      });
    } catch (err) {
      logger.error({ err }, "tandem.member.decline failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── PATCH /tandem-jobs/:id/request-rematch ───────────────────────────────────
// Provider rejects the matched ride-along driver and asks for a different
// match. Records the decline and re-broadcasts.

router.patch(
  "/tandem-jobs/:id/request-rematch",
  async (req: Request, res: Response): Promise<void> => {
    const user = await requireUserAuth(req, res);
    if (!user) return;
    const provider = await resolveCallerDriver(user, res);
    if (!provider) return;

    const tandemJobId = String(req.params["id"]);
    const { reason } = (req.body ?? {}) as { reason?: string };

    try {
      const [job] = await db
        .select()
        .from(tandemJobsTable)
        .where(eq(tandemJobsTable.id, tandemJobId))
        .limit(1);

      if (!job) {
        res.status(404).json({ error: "Tandem job not found" });
        return;
      }
      if (job.providerId !== provider.id) {
        res.status(403).json({ error: "Not your tandem job" });
        return;
      }
      if (job.tandemMode !== "B") {
        res.status(422).json({ error: "Rematch only valid for Mode B tandem jobs" });
        return;
      }

      // Atomic claim: lose to concurrent member-approve/decline => 409.
      const claimed = await db
        .update(tandemJobsTable)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(tandemJobsTable.id, tandemJobId),
            inArray(tandemJobsTable.matchStatus, ["matched", "member_pending"]),
          ),
        )
        .returning({ id: tandemJobsTable.id });

      if (claimed.length === 0) {
        res.status(409).json({ error: "Tandem job is not in a rematchable state" });
        return;
      }

      // Exclude the rejected driver from re-broadcasts.
      if (job.matchedRideAlongDriverId) {
        await db
          .insert(tandemJobDeclinesTable)
          .values({
            tandemJobId,
            rideAlongDriverId: job.matchedRideAlongDriverId,
            reason: reason ?? "provider_rematch",
          })
          .onConflictDoNothing({
            target: [
              tandemJobDeclinesTable.tandemJobId,
              tandemJobDeclinesTable.rideAlongDriverId,
            ],
          });
      }

      const result = await reopenBroadcast(tandemJobId);

      req.log.info(
        { tandemJobId, eligibleCount: result.eligible.length },
        "tandem.provider.rematch_requested",
      );
      res.status(200).json({
        tandemJob: result.tandemJob,
        eligibleCount: result.eligible.length,
        eligibleDrivers: summarizeEligible(result.eligible),
      });
    } catch (err) {
      logger.error({ err }, "tandem.provider.rematch failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── Background expiry sweep ──────────────────────────────────────────────────
// Flips overdue broadcasts to `match_status = expired`. Phase 3c will hook
// into this to notify the provider that no match was found.

export function startTandemExpiryWorker(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  logger.info({ intervalMs }, "tandem.expiryWorker: started");

  const sweep = async () => {
    try {
      const now = new Date();
      const expired = await db
        .update(tandemJobsTable)
        .set({ matchStatus: "expired", updatedAt: now })
        .where(
          and(
            eq(tandemJobsTable.matchStatus, "broadcast"),
            isNotNull(tandemJobsTable.matchDeadline),
            lt(tandemJobsTable.matchDeadline, now),
          ),
        )
        .returning({ id: tandemJobsTable.id });

      if (expired.length > 0) {
        const ids = expired.map((e) => e.id);
        logger.info(
          { count: expired.length, ids },
          "tandem.expiryWorker: expired overdue broadcasts",
        );
        // Mirror the expired state to Supabase so subscribed dashboards drop
        // the job from their broadcast list.
        for (const id of ids) {
          try {
            await upsertTandemJobViaSupabase(id, {
              match_status: "expired",
            });
          } catch (err) {
            logger.error({ err, tandemJobId: id }, "tandem.expiryWorker.supabase_mirror_failed");
          }
        }
        // Internal event for downstream provider notifications (Phase 3c).
        tandemEvents.emit("tandem.expired", { tandemJobIds: ids });

        // Phase 3c: SMS + push the provider so they can switch to Mode A/C.
        for (const id of ids) {
          void notifyMatchExpired(id).catch((err) =>
            logger.error({ err, tandemJobId: id }, "tandem.notify.expired_failed"),
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "tandem.expiryWorker: sweep error");
    }
  };

  // Run an initial sweep on startup; suppress unused-var by void.
  void sweep();
  return setInterval(() => { void sweep(); }, intervalMs);
}

export default router;
