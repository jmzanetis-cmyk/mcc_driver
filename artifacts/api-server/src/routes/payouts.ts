// ============================================================
// MCC API — Payouts Router
// ============================================================
// Exposes POST /api/payouts/run-weekly to trigger the weekly
// auto-payout job for all eligible drivers.
// Protected by DISPATCH_API_KEY so only trusted callers (the
// internal scheduler or an ops script) can invoke it.
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  driversTable,
  driverAssignmentsTable,
  driverPayoutsTable,
} from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router: IRouter = Router();

export const WEEKLY_PAYOUT_MINIMUM = 5.0;

// ── Auth helper ───────────────────────────────────────────────────────────────

function requireApiKey(req: Request, res: Response): boolean {
  const configuredKey = process.env.DISPATCH_API_KEY;
  if (!configuredKey) {
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "Payout service not configured" });
      return false;
    }
    logger.warn("DISPATCH_API_KEY not set — weekly payout endpoint unprotected in dev mode");
    return true;
  }

  const provided = req.headers["x-api-key"];
  if (provided !== configuredKey) {
    res.status(401).json({ error: "Unauthorized — invalid API key" });
    return false;
  }
  return true;
}

// ── Core payout logic (exported so the scheduler can call it directly) ────────

export interface WeeklyPayoutSummary {
  processedDrivers: number;
  skippedDrivers: number;
  totalAmount: number;
  payouts: Array<{
    driverId: string;
    amount: number;
    payoutId: string;
    assignmentCount: number;
  }>;
  errors: Array<{ driverId: string; reason: string }>;
}

export async function runWeeklyPayouts(): Promise<WeeklyPayoutSummary> {
  const summary: WeeklyPayoutSummary = {
    processedDrivers: 0,
    skippedDrivers: 0,
    totalAmount: 0,
    payouts: [],
    errors: [],
  };

  // Find all non-partner active/approved drivers
  const drivers = await db
    .select({ id: driversTable.id, partnerId: driversTable.partnerId })
    .from(driversTable)
    .where(
      and(
        eq(driversTable.status, "active"),
        isNull(driversTable.partnerId),
      ),
    );

  logger.info({ driverCount: drivers.length }, "Weekly payout: found eligible drivers");

  const scheduledDate = getNextWednesday();

  for (const driver of drivers) {
    try {
      // Fetch all unpaid completed assignments for this driver
      const unpaidAssignments = await db
        .select({
          id: driverAssignmentsTable.id,
          driverPayoutAmount: driverAssignmentsTable.driverPayoutAmount,
        })
        .from(driverAssignmentsTable)
        .where(
          and(
            eq(driverAssignmentsTable.driverId, driver.id),
            eq(driverAssignmentsTable.status, "completed"),
            eq(driverAssignmentsTable.payoutStatus, "unpaid"),
          ),
        );

      const totalAmount = unpaidAssignments.reduce(
        (sum, a) => sum + (a.driverPayoutAmount ?? 0),
        0,
      );
      const roundedAmount = Math.round(totalAmount * 100) / 100;

      if (roundedAmount < WEEKLY_PAYOUT_MINIMUM) {
        summary.skippedDrivers++;
        continue;
      }

      const payoutId = crypto.randomUUID();

      // Insert the payout record
      await db.insert(driverPayoutsTable).values({
        id: payoutId,
        driverId: driver.id,
        amount: roundedAmount,
        netPayout: roundedAmount,
        platformFee: 0,
        method: "standard",
        status: "scheduled",
        scheduledDate: new Date(scheduledDate),
        requestedAt: new Date(),
      });

      // Mark assignments as paid
      if (unpaidAssignments.length > 0) {
        const assignmentIds = unpaidAssignments.map((a) => a.id);
        await db
          .update(driverAssignmentsTable)
          .set({ payoutStatus: "paid", payoutId })
          .where(
            and(
              eq(driverAssignmentsTable.driverId, driver.id),
              sql`${driverAssignmentsTable.id} = ANY(${sql.raw(`'{${assignmentIds.join(",")}}'::uuid[]`)})`,
            ),
          );
      }

      summary.processedDrivers++;
      summary.totalAmount = Math.round((summary.totalAmount + roundedAmount) * 100) / 100;
      summary.payouts.push({
        driverId: driver.id,
        amount: roundedAmount,
        payoutId,
        assignmentCount: unpaidAssignments.length,
      });

      logger.info(
        { driverId: driver.id, amount: roundedAmount, payoutId, assignmentCount: unpaidAssignments.length },
        "Weekly payout: scheduled payout for driver",
      );
    } catch (err) {
      logger.error({ err, driverId: driver.id }, "Weekly payout: failed for driver");
      summary.errors.push({
        driverId: driver.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(
    {
      processedDrivers: summary.processedDrivers,
      skippedDrivers: summary.skippedDrivers,
      totalAmount: summary.totalAmount,
      errorCount: summary.errors.length,
    },
    "Weekly payout: run complete",
  );

  return summary;
}

function getNextWednesday(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilWednesday = (3 - dayOfWeek + 7) % 7 || 7;
  const nextWed = new Date(now.getTime() + daysUntilWednesday * 86400000);
  return nextWed.toISOString().split("T")[0]!;
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/payouts/run-weekly
 *
 * Triggers the weekly standard payout for all eligible drivers.
 * Requires the x-api-key header matching DISPATCH_API_KEY.
 */
router.post("/payouts/run-weekly", async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;

  try {
    const summary = await runWeeklyPayouts();
    res.status(200).json({
      ok: true,
      ...summary,
    });
  } catch (err) {
    logger.error({ err }, "Weekly payout route: unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
