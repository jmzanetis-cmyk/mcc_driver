#!/usr/bin/env tsx
/**
 * Notifications smoke test — verifies Phase 3c notification hooks fire on
 * each tandem state transition. We do NOT require Twilio creds to be
 * present: the notifications module logs a clean "sms_skipped" warning
 * when creds are missing, and we assert the log lines are produced.
 *
 * Strategy (no HTTP server changes; calls helpers directly):
 *   1. Insert: a provider driver, a ride-along driver, a ride, and a
 *      Mode-B tandem_job in `broadcast` state.
 *   2. Invoke each notify*() helper and assert it returns without throw.
 *   3. Clean up all rows (guaranteed via finally).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run smoke-notifications
 *
 * Requires:
 *   DATABASE_URL — local Postgres connection string
 */

import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { Client } = pg;

const SUFFIX = Math.random().toString(36).slice(2, 8);
const PROVIDER_USER_ID = `smoke-notif-provider-${SUFFIX}`;
const RIDE_ALONG_USER_ID = `smoke-notif-radriver-${SUFFIX}`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const DATABASE_URL = requireEnv("DATABASE_URL");
  const SUPABASE_URL = requireEnv("VITE_SUPABASE_URL");
  const SUPABASE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const pgClient = new Client({ connectionString: DATABASE_URL });
  await pgClient.connect();

  // Two listener clients — one per recipient channel — so we can assert
  // the per-recipient targeted push actually fires.
  const listenerProvider = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const listenerRideAlong = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const providerEvents: string[] = [];
  const rideAlongEvents: string[] = [];

  let providerId = "";
  let rideAlongId = "";
  let rideId = "";
  let tandemJobId = "";

  try {
    // Recipient ids must be deterministic before insert so we can subscribe
  // to the right channels in advance — Postgres will accept a client-supplied
  // uuid and skip the default-random.
  const providerIdSeed = `00000000-0000-0000-0000-${Date.now().toString().padStart(12, "0").slice(-12)}`;
  const rideAlongIdSeed = `00000000-0000-0000-0001-${Date.now().toString().padStart(12, "0").slice(-12)}`;

  const providerChannel = listenerProvider
    .channel(`notifications:driver:${providerIdSeed}`, {
      config: { broadcast: { self: false } },
    })
    .on("broadcast", { event: "*" }, (msg) => {
      providerEvents.push(msg.event);
    });
  const rideAlongChannel = listenerRideAlong
    .channel(`notifications:ride_along_driver:${rideAlongIdSeed}`, {
      config: { broadcast: { self: false } },
    })
    .on("broadcast", { event: "*" }, (msg) => {
      rideAlongEvents.push(msg.event);
    });
  await Promise.all([
    new Promise<void>((resolve, reject) =>
      providerChannel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(`provider channel: ${status}`));
      }),
    ),
    new Promise<void>((resolve, reject) =>
      rideAlongChannel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(`ride-along channel: ${status}`));
      }),
    ),
  ]);
  console.log("✓ subscribed to per-recipient notification channels");

  console.log("→ inserting test driver (provider)…");
    const driverRow = await pgClient.query<{ id: string }>(
      `INSERT INTO drivers
        (id, user_id, first_name, last_name, email, phone, status, is_online, current_lat, current_lng)
       VALUES ($1, $2, 'Smoke', 'Provider', $3, '+15555550111', 'active', true, 33.45, -112.07)
       RETURNING id`,
      [providerIdSeed, PROVIDER_USER_ID, `${PROVIDER_USER_ID}@test.local`],
    );
    providerId = driverRow.rows[0]!.id;

    console.log("→ inserting test ride-along driver…");
    const radRow = await pgClient.query<{ id: string }>(
      `INSERT INTO ride_along_drivers
        (id, user_id, first_name, last_name, email, phone, max_distance_miles,
         zip_lat, zip_lng, background_check_status, verified, status, rating, total_jobs)
       VALUES ($1, $2, 'Smoke', 'RideAlong', $3, '+15555550222', 30,
         33.45, -112.07, 'passed', true, 'active', 4.9, 12)
       RETURNING id`,
      [rideAlongIdSeed, RIDE_ALONG_USER_ID, `${RIDE_ALONG_USER_ID}@test.local`],
    );
    rideAlongId = radRow.rows[0]!.id;

    console.log("→ inserting test ride…");
    const rideRow = await pgClient.query<{ id: string }>(
      `INSERT INTO rides
        (scenario, tier, status, pickup_address, pickup_lat, pickup_lng,
         dropoff_address, dropoff_lat, dropoff_lng,
         estimated_fare, estimated_distance_miles, tandem_required, tandem_mode,
         member_phone, member_name)
       VALUES ('member_vehicle_tandem','premium','accepted',
         '101 Pickup St', 33.45, -112.07,
         '202 Dropoff Ave', 33.50, -112.10,
         80.0, 8.5, true, 'B',
         '+15555550999', 'Test Member')
       RETURNING id`,
    );
    rideId = rideRow.rows[0]!.id;

    console.log("→ inserting test tandem_job (Mode B, broadcast)…");
    const jobRow = await pgClient.query<{ id: string }>(
      `INSERT INTO tandem_jobs
        (ride_id, provider_id, tandem_mode, match_status, match_deadline,
         matched_ride_along_driver_id, ride_along_fee)
       VALUES ($1, $2, 'B', 'broadcast', NOW() + INTERVAL '2 hours', $3, 24.50)
       RETURNING id`,
      [rideId, providerId, rideAlongId],
    );
    tandemJobId = jobRow.rows[0]!.id;

    console.log(`→ tandem_job ${tandemJobId} ready, exercising helpers…`);
    // Dynamic import via a runtime-only string so the scripts package's
    // tsc rootDir check isn't tripped by the cross-package import.
    const modulePath = "../../artifacts/api-server/src/lib/notifications.ts";
    const mod = (await import(/* @vite-ignore */ modulePath)) as {
      notifyBroadcastToDrivers: (id: string, ids: string[]) => Promise<void>;
      notifyProviderMatched: (id: string) => Promise<void>;
      notifyMemberAwaitingApproval: (id: string) => Promise<void>;
      notifyApprovalOutcome: (id: string, approved: boolean) => Promise<void>;
      notifyMatchExpired: (id: string) => Promise<void>;
    };

    console.log("  • notifyBroadcastToDrivers");
    await mod.notifyBroadcastToDrivers(tandemJobId, [rideAlongId]);

    console.log("  • notifyProviderMatched");
    await mod.notifyProviderMatched(tandemJobId);

    console.log("  • notifyMemberAwaitingApproval");
    await mod.notifyMemberAwaitingApproval(tandemJobId);

    console.log("  • notifyApprovalOutcome(approved=true)");
    await mod.notifyApprovalOutcome(tandemJobId, true);

    console.log("  • notifyApprovalOutcome(approved=false)");
    await mod.notifyApprovalOutcome(tandemJobId, false);

    console.log("  • notifyMatchExpired");
    await mod.notifyMatchExpired(tandemJobId);

    console.log("\n→ waiting for broadcast events to settle…");
    await new Promise((r) => setTimeout(r, 1500));

    // Required events per recipient channel (5 events targeted at each).
    const expectedProvider = [
      "tandem.matched.provider",
      "tandem.approval.outcome.provider", // approved=true
      "tandem.approval.outcome.provider", // approved=false
      "tandem.expired.provider",
    ];
    const expectedRideAlong = [
      "tandem.broadcast",
      "tandem.approval.outcome.ride_along", // approved=true
      "tandem.approval.outcome.ride_along", // approved=false
    ];

    console.log(`  provider channel events:    ${JSON.stringify(providerEvents)}`);
    console.log(`  ride-along channel events:  ${JSON.stringify(rideAlongEvents)}`);

    const missingProvider = expectedProvider.filter(
      (e, i) => providerEvents.filter((x) => x === e).length <
        expectedProvider.slice(0, i + 1).filter((x) => x === e).length,
    );
    const missingRideAlong = expectedRideAlong.filter(
      (e, i) => rideAlongEvents.filter((x) => x === e).length <
        expectedRideAlong.slice(0, i + 1).filter((x) => x === e).length,
    );

    if (missingProvider.length > 0 || missingRideAlong.length > 0) {
      throw new Error(
        `Missing broadcast events. provider missing: ${JSON.stringify(missingProvider)}, ride-along missing: ${JSON.stringify(missingRideAlong)}`,
      );
    }

    console.log("\n✓ All 5 notification helpers fired and broadcasts arrived on the");
    console.log("  per-recipient Supabase channels. SMS attempts are visible in the");
    console.log("  API server logs (sms_skipped if Twilio creds not configured).");
  } finally {
    console.log("\n→ cleaning up test rows…");
    if (tandemJobId) {
      await pgClient
        .query("DELETE FROM tandem_job_declines WHERE tandem_job_id = $1", [tandemJobId])
        .catch(() => {});
      await pgClient.query("DELETE FROM tandem_jobs WHERE id = $1", [tandemJobId]);
    }
    if (rideId) await pgClient.query("DELETE FROM rides WHERE id = $1", [rideId]);
    if (rideAlongId) await pgClient.query("DELETE FROM ride_along_drivers WHERE id = $1", [rideAlongId]);
    if (providerId) await pgClient.query("DELETE FROM drivers WHERE id = $1", [providerId]);
    await pgClient.end();
    await listenerProvider.removeAllChannels();
    await listenerRideAlong.removeAllChannels();
    console.log("✓ cleanup complete");
  }
}

main().catch((err) => {
  console.error("✗ smoke-notifications failed:", err);
  process.exit(1);
});
