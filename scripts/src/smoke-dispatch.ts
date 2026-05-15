#!/usr/bin/env tsx
/**
 * Dispatch smoke test — verifies the full ride dispatch path end-to-end:
 *   1. Inserts a temporary test driver (active, online, with location)
 *   2. POST /api/rides/dispatch → expects 201 + rideId + assignmentId
 *   3. Queries the DB to confirm rows were created in rides + driver_assignments
 *   4. Cleans up all test rows
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run smoke-dispatch
 *
 * Requires: DATABASE_URL env var pointing to the Supabase Postgres instance.
 * The API server must be running (localhost:80/api proxied by the shared proxy).
 */

import pg from "pg";

const { Client } = pg;

const TEST_DRIVER_ID = "00000000-0000-0000-ffff-000000000001";
const API_BASE = "http://localhost:80/api";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set");
    process.exit(1);
  }

  const db = new Client({ connectionString: dbUrl });
  await db.connect();

  console.log("=== MCC Dispatch Smoke Test ===\n");

  // ── 1. Insert test driver ─────────────────────────────────────────────────
  console.log("[1] Inserting test driver...");
  await db.query(`
    INSERT INTO drivers (id, user_id, first_name, last_name, email, phone,
                         status, is_online, can_drive_member_vehicle,
                         current_lat, current_lng)
    VALUES ($1, 'smoke_test_user', 'Smoke', 'Driver', 'smoke@example.com',
            '5550000001', 'active', true, true, 40.7357, -74.1724)
    ON CONFLICT (id) DO UPDATE
      SET status = 'active', is_online = true,
          current_lat = 40.7357, current_lng = -74.1724
  `, [TEST_DRIVER_ID]);
  console.log("    ✓ Test driver inserted\n");

  let rideId: string | null = null;

  try {
    // ── 2. POST /api/rides/dispatch ─────────────────────────────────────────
    console.log("[2] Calling POST /api/rides/dispatch...");
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
      assignmentIds?: string[];
      driversNotified?: number;
      error?: string;
    };

    if (!resp.ok || !body.rideId) {
      console.error(`    ✗ Dispatch failed (HTTP ${resp.status}):`, body);
      process.exit(1);
    }

    rideId = body.rideId;
    console.log(`    ✓ Dispatch succeeded`);
    console.log(`      rideId:          ${body.rideId}`);
    console.log(`      assignmentIds:   ${body.assignmentIds?.join(", ")}`);
    console.log(`      driversNotified: ${body.driversNotified}\n`);

    // ── 3. Verify DB rows ───────────────────────────────────────────────────
    console.log("[3] Verifying database rows...");
    const rideRow = await db.query(
      "SELECT id, scenario, status FROM rides WHERE id = $1",
      [rideId],
    );
    if (rideRow.rowCount === 0) {
      console.error("    ✗ No ride row found in DB");
      process.exit(1);
    }
    console.log(`    ✓ rides row: scenario=${rideRow.rows[0].scenario}, status=${rideRow.rows[0].status}`);

    const assignRow = await db.query(
      "SELECT id, driver_id, role, status FROM driver_assignments WHERE ride_id = $1",
      [rideId],
    );
    if (assignRow.rowCount === 0) {
      console.error("    ✗ No driver_assignments row found in DB");
      process.exit(1);
    }
    console.log(`    ✓ driver_assignments row: role=${assignRow.rows[0].role}, status=${assignRow.rows[0].status}`);
    console.log();
  } finally {
    // ── 4. Clean up ─────────────────────────────────────────────────────────
    console.log("[4] Cleaning up test data...");
    if (rideId) {
      await db.query("DELETE FROM driver_assignments WHERE ride_id = $1", [rideId]);
      await db.query("DELETE FROM rides WHERE id = $1", [rideId]);
    }
    await db.query("DELETE FROM drivers WHERE id = $1", [TEST_DRIVER_ID]);
    console.log("    ✓ Test rows removed\n");

    await db.end();
  }

  console.log("=== All checks passed ✓ ===");
}

main().catch((err) => {
  console.error("Smoke test error:", err);
  process.exit(1);
});
