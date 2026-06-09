#!/usr/bin/env tsx
/**
 * Seed (or refresh) the App Review reviewer driver account.
 *
 * Why this exists:
 *   Apple's App Reviewers cannot receive a real Supabase phone OTP on
 *   their internal review devices. The supported workaround is to
 *   register the reviewer's phone number as a Supabase Auth "Test Phone
 *   Number" (Authentication → Providers → Phone → Test OTP) with a
 *   fixed 6-digit code. This script then:
 *     1. Creates (or finds) the matching Supabase auth user.
 *     2. Inserts (or refreshes) a fully-approved driver row in local
 *        Postgres so the reviewer can go online immediately after
 *        signing in — no admin approval step required.
 *
 * Usage:
 *   REVIEWER_PHONE='+15555550199' \
 *   REVIEWER_FIRST_NAME='App' REVIEWER_LAST_NAME='Reviewer' \
 *   REVIEWER_EMAIL='appreview@mycarconcierge.com' \
 *   pnpm --filter @workspace/scripts run seed-reviewer-driver
 *
 * Requires:
 *   DATABASE_URL                — local Postgres connection string
 *   VITE_SUPABASE_URL           — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY   — Supabase service role key
 *
 * Idempotent — safe to re-run before every submission. The auth-user
 * lookup pages through the full user list (not just the first page)
 * and the create path treats "phone already exists" as a non-fatal
 * second-lookup case so a race / replication lag can't make the
 * script flap.
 */

import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { Client } = pg;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const REVIEWER_PHONE = requireEnv("REVIEWER_PHONE");
const REVIEWER_FIRST_NAME = process.env.REVIEWER_FIRST_NAME ?? "App";
const REVIEWER_LAST_NAME = process.env.REVIEWER_LAST_NAME ?? "Reviewer";
const REVIEWER_EMAIL =
  process.env.REVIEWER_EMAIL ?? "appreview@mycarconcierge.com";

// Supabase stores phones in E.164 without the leading "+".
const PHONE_KEY = REVIEWER_PHONE.replace(/^\+/, "");

async function ensureSupabaseUser(): Promise<string> {
  const supabase = createClient(
    requireEnv("VITE_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Page through every user — listUsers default is 50/page, we use 200
  // and walk until the returned page is short of perPage. Required for
  // idempotency: if the reviewer already exists on page 4, page 1
  // alone would miss them and we'd try to create a duplicate.
  const findByPhone = async (): Promise<{ id: string } | null> => {
    const perPage = 200;
    for (let page = 1; page < 1000; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const hit = data.users.find((u) => u.phone === PHONE_KEY);
      if (hit) return { id: hit.id };
      if (data.users.length < perPage) return null;
    }
    return null;
  };

  const existing = await findByPhone();
  if (existing) {
    console.log(`[ok] supabase auth user already exists: ${existing.id}`);
    return existing.id;
  }

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    phone: REVIEWER_PHONE,
    phone_confirm: true,
    user_metadata: { reviewer: true },
  });
  if (createErr) {
    // Most commonly "User already registered" if a concurrent
    // operation beat us. Re-resolve by phone and use that id rather
    // than failing — keeps the "safe to re-run" contract.
    const conflict = await findByPhone();
    if (conflict) {
      console.log(
        `[ok] supabase auth user resolved after create conflict: ${conflict.id}`,
      );
      return conflict.id;
    }
    throw createErr;
  }
  if (!created.user) throw new Error("createUser returned no user");
  console.log(`[ok] created supabase auth user: ${created.user.id}`);
  return created.user.id;
}

async function upsertDriverRow(userId: string): Promise<void> {
  const client = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await client.connect();
  try {
    // `drivers.user_id` has no unique constraint in the schema, so we
    // can't use a single ON CONFLICT statement — do an explicit
    // lookup + UPDATE or INSERT.
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM drivers WHERE profile_id = $1 LIMIT 1",
      [userId],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      const id = existing.rows[0]!.id;
      await client.query(
        `UPDATE drivers SET
           first_name=$1, last_name=$2, email=$3, phone=$4,
           status='active', background_check_passed=true,
           can_drive_member_vehicle=true, can_do_rideshare=true,
           can_do_delivery=true
         WHERE id=$5`,
        [
          REVIEWER_FIRST_NAME,
          REVIEWER_LAST_NAME,
          REVIEWER_EMAIL,
          REVIEWER_PHONE,
          id,
        ],
      );
      console.log(`[ok] refreshed reviewer driver row: ${id}`);
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO drivers (
           profile_id, first_name, last_name, email, phone,
           status, background_check_passed,
           can_drive_member_vehicle, can_do_rideshare, can_do_delivery,
           is_online
         ) VALUES ($1,$2,$3,$4,$5,'active',true,true,true,true,false)
         RETURNING id`,
        [
          userId,
          REVIEWER_FIRST_NAME,
          REVIEWER_LAST_NAME,
          REVIEWER_EMAIL,
          REVIEWER_PHONE,
        ],
      );
      console.log(`[ok] inserted reviewer driver row: ${inserted.rows[0]!.id}`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  console.log(`[seed] reviewer phone: ${REVIEWER_PHONE}`);
  const userId = await ensureSupabaseUser();
  await upsertDriverRow(userId);
  console.log("");
  console.log("✓ Reviewer account ready.");
  console.log("  Reminder: also add this phone number to Supabase Auth →");
  console.log("  Providers → Phone → Test OTP, with a fixed 6-digit code");
  console.log("  the reviewer can use without receiving a real SMS.");
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
