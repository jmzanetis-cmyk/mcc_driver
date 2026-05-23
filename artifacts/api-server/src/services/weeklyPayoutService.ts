// ============================================================
// MCC API — Weekly Standard Payout Service
// ============================================================
// Replaces the stub runWeeklyPayouts() in payouts.ts.
// This version actually calls Stripe to move money.
//
// Runs every Wednesday at 06:00 UTC via the existing setTimeout
// scheduler in lib/weeklyPayoutScheduler.ts.
//
// For each driver with available earnings:
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
  earnings: Array<{ id: string; amount_cents: number }>;
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

  // ── 1. Fetch all available earnings grouped by driver ───────────
  const { data: availableEarnings, error: fetchError } = await supabaseAdmin
    .from("driver_earnings")
    .select(
      `
      id,
      amount_cents,
      driver_id,
      drivers!inner (
        id,
        stripe_account_id
      )
    `,
    )
    .eq("payout_status", "available");

  if (fetchError) {
    logger.error({ err: fetchError }, "Failed to fetch available earnings");
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, results: [] };
  }

  if (!availableEarnings || availableEarnings.length === 0) {
    logger.info("No available earnings found for weekly payout");
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, results: [] };
  }

  // ── 2. Group by driver ─────────────────────────────────────────
  const driverMap = new Map<string, DriverWithEarnings>();

  for (const earning of availableEarnings) {
    const driverData = (earning as unknown as { drivers: { stripe_account_id: string } }).drivers;
    const driverId = earning.driver_id as string;

    if (!driverMap.has(driverId)) {
      driverMap.set(driverId, {
        driver_id: driverId,
        stripe_account_id: driverData?.stripe_account_id ?? "",
        earnings: [],
      });
    }

    driverMap.get(driverId)!.earnings.push({
      id: earning.id as string,
      amount_cents: (earning.amount_cents as number) ?? 0,
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

    const grossCents = driver.earnings.reduce(
      (sum, e) => sum + e.amount_cents,
      0,
    );

    if (grossCents < 100) {
      logger.info({ driverId, grossCents }, "Skipping driver below minimum payout");
      results.push({ driverId, status: "skipped", amount: grossCents / 100, error: "Below $1.00 minimum" });
      skipped++;
      continue;
    }

    const earningIds = driver.earnings.map((e) => e.id);

    // ── Create DB record ──────────────────────────────────────
    const { data: cashoutRow, error: insertError } = await supabaseAdmin
      .from("driver_cashouts")
      .insert({
        driver_id: driverId,
        amount_cents: grossCents,
        fee_cents: 0,
        method: "standard",
        status: "processing",
        initiated_by_kind: "system",
        requested_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError || !cashoutRow) {
      logger.error({ err: insertError, driverId }, "Failed to create cashout record");
      results.push({ driverId, status: "failed", amount: grossCents / 100, error: "DB insert failed" });
      failed++;
      continue;
    }

    // ── Stripe: Transfer ──────────────────────────────────────
    let transfer: Stripe.Transfer;
    try {
      transfer = await stripe.transfers.create({
        amount: grossCents,
        currency: "usd",
        destination: driver.stripe_account_id,
        description: `MCC weekly payout – ${earningIds.length} earning(s)`,
        metadata: { mcc_cashout_id: cashoutRow.id, driver_id: driverId, method: "standard" },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Transfer creation failed";
      logger.error({ err, driverId, cashoutId: cashoutRow.id }, "Stripe transfer failed for weekly payout");
      await supabaseAdmin
        .from("driver_cashouts")
        .update({ status: "failed", error: msg })
        .eq("id", cashoutRow.id);
      results.push({ driverId, status: "failed", amount: grossCents / 100, error: "Stripe transfer failed" });
      failed++;
      continue;
    }

    // ── Stripe: Payout (standard) ─────────────────────────────
    let payout: Stripe.Payout;
    try {
      payout = await stripe.payouts.create(
        {
          amount: grossCents,
          currency: "usd",
          method: "standard",
          description: "MCC Weekly Payout",
          metadata: { mcc_cashout_id: cashoutRow.id, driver_id: driverId },
        },
        { stripeAccount: driver.stripe_account_id },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Standard payout creation failed";
      logger.error(
        { err, driverId, cashoutId: cashoutRow.id, transferId: transfer.id },
        "Stripe payout.create (standard) failed",
      );
      // Transfer succeeded, payout didn't — funds are in the connected account balance
      await supabaseAdmin
        .from("driver_cashouts")
        .update({ status: "failed", stripe_transfer_id: transfer.id, error: msg })
        .eq("id", cashoutRow.id);
      results.push({ driverId, status: "failed", amount: grossCents / 100, error: "Stripe payout failed (transfer succeeded)" });
      failed++;
      continue;
    }

    // ── Update cashout row with Stripe IDs ────────────────────
    await supabaseAdmin
      .from("driver_cashouts")
      .update({
        stripe_transfer_id: transfer.id,
        stripe_payout_id: payout.id,
        status: "in_transit",
      })
      .eq("id", cashoutRow.id);

    await supabaseAdmin
      .from("driver_earnings")
      .update({
        payout_status: "paid",
        cashout_id: cashoutRow.id,
        paid_at: new Date().toISOString(),
        stripe_transfer_id: transfer.id,
      })
      .in("id", earningIds);

    logger.info(
      {
        driverId,
        cashoutId: cashoutRow.id,
        transferId: transfer.id,
        stripePayoutId: payout.id,
        grossCents,
        earningCount: earningIds.length,
      },
      "Weekly payout processed successfully",
    );

    results.push({ driverId, status: "success", amount: grossCents / 100 });
    succeeded++;
  }

  logger.info(
    { processed: driverMap.size, succeeded, failed, skipped, elapsed_ms: Date.now() - startTime },
    "Weekly payout run complete",
  );

  return { processed: driverMap.size, succeeded, failed, skipped, results };
}
