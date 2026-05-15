// ============================================================
// Weekly Payout Scheduler
// ============================================================
// Fires runWeeklyPayouts() every Wednesday at 06:00 UTC.
// Uses a lightweight setTimeout chain — no external cron
// dependency needed.
// ============================================================

import { logger } from "./logger";
import { runWeeklyPayouts } from "../routes/payouts";

const WEDNESDAY = 3; // getDay() value for Wednesday
const PAYOUT_HOUR_UTC = 6; // 06:00 UTC

/**
 * Calculates the number of milliseconds until the next
 * Wednesday at PAYOUT_HOUR_UTC:00:00 UTC.
 */
function msUntilNextWednesdayRun(): number {
  const now = new Date();
  const target = new Date(now);

  // Advance to the next Wednesday
  const dayOfWeek = now.getUTCDay();
  let daysUntil = (WEDNESDAY - dayOfWeek + 7) % 7;

  // If today is Wednesday but the run hour hasn't arrived yet, run today
  if (daysUntil === 0 && now.getUTCHours() < PAYOUT_HOUR_UTC) {
    daysUntil = 0;
  } else if (daysUntil === 0) {
    // Today is Wednesday but past the run hour — wait until next Wednesday
    daysUntil = 7;
  }

  target.setUTCDate(now.getUTCDate() + daysUntil);
  target.setUTCHours(PAYOUT_HOUR_UTC, 0, 0, 0);

  return target.getTime() - now.getTime();
}

async function runAndReschedule(): Promise<void> {
  logger.info("Weekly payout scheduler: starting run");
  try {
    const summary = await runWeeklyPayouts();
    logger.info(
      {
        processedDrivers: summary.processedDrivers,
        skippedDrivers: summary.skippedDrivers,
        totalAmount: summary.totalAmount,
        errorCount: summary.errors.length,
      },
      "Weekly payout scheduler: run complete",
    );
  } catch (err) {
    logger.error({ err }, "Weekly payout scheduler: run failed");
  }

  // Schedule the next run (7 days from now)
  const nextMs = 7 * 24 * 60 * 60 * 1000;
  logger.info(
    { nextRunInHours: Math.round(nextMs / 3600000) },
    "Weekly payout scheduler: next run scheduled",
  );
  setTimeout(() => { void runAndReschedule(); }, nextMs);
}

/**
 * Starts the weekly payout scheduler.
 * Call once at server startup.
 */
export function startWeeklyPayoutScheduler(): void {
  const msUntilFirst = msUntilNextWednesdayRun();
  const hoursUntilFirst = Math.round(msUntilFirst / 3600000);

  logger.info(
    { hoursUntilFirst, payoutHourUTC: PAYOUT_HOUR_UTC },
    "Weekly payout scheduler: armed — first run scheduled",
  );

  setTimeout(() => { void runAndReschedule(); }, msUntilFirst);
}
