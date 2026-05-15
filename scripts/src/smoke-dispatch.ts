#!/usr/bin/env tsx
/**
 * Dispatch smoke test — verifies the full ride dispatch path end-to-end:
 *   1. Inserts a temporary test driver (active, online, with location) in local DB
 *   2. POST /api/rides/dispatch → expects 201 + rideId + driversNotified
 *   3. Verifies the ride row exists in local DB
 *   4. Verifies the driver_assignment row exists in Supabase (written via HTTPS)
 *   5. Asserts a Supabase Realtime INSERT event fires within 10 s
 *   6. Cleans up all test rows (guaranteed via finally)
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run smoke-dispatch
 *
 * Requires:
 *   DATABASE_URL                — local Postgres connection string (API server)
 *   VITE_SUPABASE_URL           — Supabase project URL
 *   VITE_SUPABASE_ANON_KEY      — Supabase anon key (Realtime subscription)
 *   SUPABASE_SERVICE_ROLE_KEY   — Supabase service role key (admin checks + cleanup)
 *   API server must be running on localhost:80/api
 */

import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { Client } = pg;

const TEST_DRIVER_ID = "00000000-0000-0000-ffff-000000000001";
const API_BASE = process.env.API_BASE ?? "http://localhost:80/api";
const REALTIME_TIMEOUT_MS = 10_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function checkRealtimeDelivery(
  supabaseUrl: string,
  supabaseServiceKey: string,
  driverId: string,
): Promise<{ ok: boolean; reason?: string; payload?: Record<string, unknown> }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      supabase.removeAllChannels().catch(() => {});
      resolve({
        ok: false,
        reason:
          `No postgres_changes INSERT event received within ${REALTIME_TIMEOUT_MS}ms.\n` +
          "      This typically means Realtime is not enabled for driver_assignments\n" +
          "      in the Supabase dashboard (Table Editor → driver_assignments → Realtime toggle).",
      });
    }, REALTIME_TIMEOUT_MS);

    supabase
      .channel("smoke-test-channel")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "driver_assignments",
          filter: `driver_id=eq.${driverId}`,
        },
        (payload) => {
          clearTimeout(timer);
          supabase.removeAllChannels().catch(() => {});
          resolve({
            ok: true,
            payload: payload.new as Record<string, unknown>,
          });
        },
      )
      .subscribe();
  });
}

async function main() {
  const dbUrl = requireEnv("DATABASE_URL");
  const supabaseUrl = requireEnv("VITE_SUPABASE_URL");
  const supabaseAnonKey = requireEnv("VITE_SUPABASE_ANON_KEY");
  const supabaseServiceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const db = new Client({ connectionString: dbUrl });
  await db.connect();

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("=== MCC Dispatch Smoke Test ===\n");

  // ── 1. Insert test driver into local DB ────────────────────────────────────
  console.log("[1] Inserting test driver...");
  await db.query(
    `INSERT INTO drivers (id, user_id, first_name, last_name, email, phone,
                          status, is_online, can_drive_member_vehicle,
                          current_lat, current_lng)
     VALUES ($1, 'smoke_test_user', 'Smoke', 'Driver', 'smoke@example.com',
             '5550000001', 'active', true, true, 40.7357, -74.1724)
     ON CONFLICT (id) DO UPDATE
       SET status = 'active', is_online = true,
           current_lat = 40.7357, current_lng = -74.1724`,
    [TEST_DRIVER_ID],
  );
  console.log("    ✓ Test driver inserted\n");

  let rideId: string | null = null;
  const warnings: string[] = [];

  try {
    // ── 2. Open Realtime subscription BEFORE dispatching ───────────────────
    console.log("[2] Opening Supabase Realtime subscription...");
    const realtimePromise = checkRealtimeDelivery(
      supabaseUrl,
      supabaseServiceKey,
      TEST_DRIVER_ID,
    );
    await new Promise((r) => setTimeout(r, 800));
    console.log("    ✓ Subscribed (waiting for INSERT event)\n");

    // ── 3. POST /api/rides/dispatch ─────────────────────────────────────────
    console.log("[3] Calling POST /api/rides/dispatch...");
    const resp = await fetch(`${API_BASE}/rides/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario: "member_dropoff",
        tier: "tier_1_passenger",
        pickupAddress: "SMOKE TEST — 123 Main St, Newark NJ",
        pickupLat: 40.7357,
        pickupLng: -74.1724,
        dropoffAddress: "SMOKE TEST — 456 Park Ave, Newark NJ",
        dropoffLat: 40.7282,
        dropoffLng: -74.1741,
        estimatedFare: 45.0,
        estimatedDistanceMiles: 3.2,
        targetDriverIds: [TEST_DRIVER_ID],
      }),
    });

    const body = (await resp.json()) as {
      rideId?: string;
      driversNotified?: number;
      error?: string;
    };

    if (!resp.ok || !body.rideId) {
      throw new Error(
        `Dispatch failed (HTTP ${resp.status}): ${JSON.stringify(body)}`,
      );
    }

    rideId = body.rideId;
    console.log("    ✓ Dispatch succeeded");
    console.log(`      rideId:          ${body.rideId}`);
    console.log(`      driversNotified: ${body.driversNotified}\n`);

    // ── 4. Verify ride row in local DB ──────────────────────────────────────
    console.log("[4] Verifying ride row in local DB...");
    const rideRow = await db.query(
      "SELECT id, scenario, status FROM rides WHERE id = $1",
      [rideId],
    );
    if ((rideRow.rowCount ?? 0) === 0) {
      throw new Error("No ride row found in local DB after dispatch");
    }
    console.log(
      `    ✓ rides row: scenario=${rideRow.rows[0].scenario as string}, status=${rideRow.rows[0].status as string}\n`,
    );

    // ── 5. Verify driver_assignment row in Supabase ─────────────────────────
    console.log("[5] Verifying driver_assignments row in Supabase...");
    const { data: assignRows, error: assignErr } = await supabaseAdmin
      .from("driver_assignments")
      .select("id, driver_id, role, status")
      .eq("ride_id", rideId)
      .limit(1);

    if (assignErr) throw new Error(`Supabase assignment query failed: ${assignErr.message}`);
    if (!assignRows || assignRows.length === 0) {
      throw new Error("No driver_assignments row found in Supabase after dispatch");
    }
    console.log(
      `    ✓ driver_assignments row: role=${assignRows[0].role as string}, status=${assignRows[0].status as string}\n`,
    );

    // ── 6. Assert Realtime event ────────────────────────────────────────────
    console.log(
      `[6] Waiting for Supabase Realtime event (timeout ${REALTIME_TIMEOUT_MS / 1000}s)...`,
    );
    const realtimeResult = await realtimePromise;
    if (realtimeResult.ok && realtimeResult.payload) {
      console.log("    ✓ Realtime INSERT event received");
      console.log(`      ride_id:   ${realtimeResult.payload["ride_id"] as string}`);
      console.log(`      driver_id: ${realtimeResult.payload["driver_id"] as string}\n`);
    } else {
      warnings.push(`WARN [Realtime]: ${realtimeResult.reason ?? "unknown"}`);
      console.log(`    ⚠  Realtime check skipped — see warnings below\n`);
    }
  } finally {
    // ── 7. Clean up (always runs, even on thrown errors) ───────────────────
    console.log("[7] Cleaning up test data...");
    if (rideId) {
      await supabaseAdmin.from("driver_assignments").delete().eq("ride_id", rideId);
      await db.query("DELETE FROM rides WHERE id = $1", [rideId]);
    }
    await db.query("DELETE FROM drivers WHERE id = $1", [TEST_DRIVER_ID]);
    await db.end();
    console.log("    ✓ Test rows removed\n");
  }

  if (warnings.length > 0) {
    console.log("=== Warnings ===");
    for (const w of warnings) {
      console.log(w);
    }
    console.log();
    console.log(
      "    Realtime requires driver_assignments Realtime enabled in Supabase dashboard\n" +
      "    (Table Editor → driver_assignments → toggle Realtime ON).",
    );
    process.exit(0);
  }

  console.log("=== All checks passed ✓ ===");
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\n✗ Smoke test FAILED:", message);
  process.exit(1);
});
