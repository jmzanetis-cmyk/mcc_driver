// ============================================================
// MCC API — Weekly Standard Payout Service
// ============================================================
// Replaces the stub runWeeklyPayouts() in payouts.ts.
// This version actually calls Stripe to move money.
//
// Runs every Wednesday at 06:00 UTC via the existing setTimeout
// scheduler in lib/weeklyPayoutScheduler.ts.
//
// For each driver with unpaid completed assignments:
//   1. stripe.transfers.create()  — platform → connected account
//   2. stripe.payouts.create()    — connected account → bank (standard)
//   3. DB update with Stripe IDs
//
// Standard payouts go to bank accounts (1-2 business days).
// No debit card required.
// ============================================================

import Stripe from "stripe";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { getDriverPayoutCapabilities } from "../lib/stripeCapabilities";
import { logger } from "../lib/logger";

function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

interface DriverWithEarnings {
  driver_id: string;
  stripe_account_id: string;
  assignments: Array<{ id: string; driver_payout_amount: number }>;
}

export interface WeeklyPayoutResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: Array<{
    driverId: string;
    status: "success" | "failed" | "skipped";
    amount?: number;
    error?: string;
  }>;
}

export async function runWeeklyPayouts(): Promise<WeeklyPayoutResult> {
  const stripe = getStripeClient();
  if (!stripe) {
    logger.error("STRIPE_SECRET_KEY not set — weekly payouts skipped");
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, results: [] };
  }

  const startTime = Date.now();
  logger.info("Starting weekly payout run");

  // ── 1. Fetch all unpaid completed assignments grouped by driver ──
  const { data: unpaidAssignments, error: fetchError } = await supabaseAdmin
    .from("driver_assignments")
    .select(
      `
      id,
      driver_payout_amount,
      driver_id,
      drivers!inner (
        id,
        stripe_account_id
      )
    `,
    )
    .eq("status", "completed")
    .eq("payout_status", "unpaid");

  if (fetchError) {
    logger.error({ err: fetchError }, "Failed to fetch unpaid assignments");
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, results: [] };
  }

  if (!unpaidAssignments || unpaidAssignments.length === 0) {
    logger.info("No unpaid assignments found for weekly payout");
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, results: [] };
  }

  // ── 2. Group by driver ─────────────────────────────────────────
  const driverMap = new Map<string, DriverWithEarnings>();

  for (const assignment of unpaidAssignments) {
    const driverData = (assignment as unknown as { drivers: { stripe_account_id: string } }).drivers;
    const driverId = assignment.driver_id as string;

    if (!driverMap.has(driverId)) {
      driverMap.set(driverId, {
        driver_id: driverId,
        stripe_account_id: driverData?.stripe_account_id ?? "",
        assignments: [],
      });
    }

    driverMap.get(driverId)!.assignments.push({
      id: assignment.id as string,
      driver_payout_amount: (assignment.driver_payout_amount as number) ?? 0,
    });
  }

  // ── 3. Process each driver ─────────────────────────────────────
  const results: WeeklyPayoutResult["results"] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const [driverId, driver] of driverMap) {
    if (!driver.stripe_account_id) {
      logger.warn({ driverId }, "Skipping driver without Stripe account");
      results.push({ driverId, status: "skipped", error: "No Stripe Connect account" });
      skipped++;
      continue;
    }

    // Verify the Stripe account can receive payouts
    let caps;
    try {
      caps = await getDriverPayoutCapabilities(driver.stripe_account_id);
    } catch (err) {
      logger.error({ err, driverId }, "Failed to verify Stripe account");
      results.push({ driverId, status: "skipped", error: "Could not verify Stripe account" });
      skipped++;
      continue;
    }

    if (!caps.payoutsEnabled) {
      logger.warn({ driverId, stripeAccountId: driver.stripe_account_id }, "Skipping driver with disabled payouts");
      results.push({ driverId, status: "skipped", error: "Stripe payouts not enabled" });
      skipped++;
      continue;
    }

    const grossDollars = driver.assignments.reduce(
      (sum, a) => sum + a.driver_payout_amount,
      0,
    );
    const netDollars = Number(grossDollars.toFixed(2));
    const netCents = Math.round(netDollars * 100);

    if (netCents < 100) {
      logger.info({ driverId, amount: netDollars }, "Skipping driver below minimum payout");
      results.push({ driverId, status: "skipped", amount: netDollars, error: "Below $1.00 minimum" });
      skipped++;
      continue;
    }

    const assignmentIds = driver.assignments.map((a) => a.id);

    // ── Create DB record ──────────────────────────────────────
    const { data: payoutRow, error: insertError } = await supabaseAdmin
      .from("driver_payouts")
      .insert({
        driver_id: driverId,
        amount: grossDollars,
        net_payout: netDollars,
        platform_fee: 0,
        method: "standard",
        status: "processing",
        requested_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError || !payoutRow) {
      logger.error({ err: insertError, driverId }, "Failed to create payout record");
      results.push({ driverId, status: "failed", amount: netDollars, error: "DB insert failed" });
      failed++;
      continue;
    }

    // ── Stripe: Transfer ──────────────────────────────────────
    let transfer: Stripe.Transfer;
    try {
      transfer = await stripe.transfers.create({
        amount: netCents,
        currency: "usd",
        destination: driver.stripe_account_id,
        description: `MCC weekly payout – ${assignmentIds.length} assignment(s)`,
        metadata: { mcc_payout_id: payoutRow.id, driver_id: driverId, method: "standard" },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Transfer creation failed";
      logger.error({ err, driverId, payoutId: payoutRow.id }, "Stripe transfer failed for weekly payout");
      await supabaseAdmin
        .from("driver_payouts")
        .update({ status: "failed", failed_reason: msg })
        .eq("id", payoutRow.id);
      results.push({ driverId, status: "failed", amount: netDollars, error: "Stripe transfer failed" });
      failed++;
      continue;
    }

    // ── Stripe: Payout (standard) ─────────────────────────────
    let payout: Stripe.Payout;
    try {
      payout = await stripe.payouts.create(
        {
          amount: netCents,
          currency: "usd",
          method: "standard",
          description: "MCC Weekly Payout",
          metadata: { mcc_payout_id: payoutRow.id, driver_id: driverId },
        },
        { stripeAccount: driver.stripe_account_id },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Standard payout creation failed";
      logger.error(
        { err, driverId, payoutId: payoutRow.id, transferId: transfer.id },
        "Stripe payout.create (standard) failed",
      );
      // Transfer succeeded, payout didn't — funds are in the connected account balance
      await supabaseAdmin
        .from("driver_payouts")
        .update({ status: "failed", stripe_transfer_id: transfer.id, failed_reason: msg })
        .eq("id", payoutRow.id);
      results.push({ driverId, status: "failed", amount: netDollars, error: "Stripe payout failed (transfer succeeded)" });
      failed++;
      continue;
    }

    // ── Update DB with Stripe IDs ─────────────────────────────
    await supabaseAdmin
      .from("driver_payouts")
      .update({ stripe_transfer_id: transfer.id, status: "in_transit" })
      .eq("id", payoutRow.id);

    await supabaseAdmin
      .from("driver_assignments")
      .update({ payout_status: "paid", payout_id: payoutRow.id })
      .in("id", assignmentIds);

    logger.info(
      {
        driverId,
        payoutId: payoutRow.id,
        transferId: transfer.id,
        stripePayoutId: payout.id,
        amount: netDollars,
        assignments: assignmentIds.length,
      },
      "Weekly payout processed successfully",
    );

    results.push({ driverId, status: "success", amount: netDollars });
    succeeded++;
  }

  logger.info(
    { processed: driverMap.size, succeeded, failed, skipped, elapsed_ms: Date.now() - startTime },
    "Weekly payout run complete",
  );

  return { processed: driverMap.size, succeeded, failed, skipped, results };
}
