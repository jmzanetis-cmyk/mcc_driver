-- ============================================================
-- MCC Driver — Migrate-Forward: Add Missing Driver Columns
-- ============================================================
-- Run once in Supabase SQL Editor.
-- All ALTER statements are idempotent (ADD COLUMN IF NOT EXISTS).
-- The live drivers table was created independently of the Drizzle
-- migration files in lib/db/drizzle/ — this script bridges the gap
-- by adding only the columns the driver app requires, without
-- touching any column already used by the member app or dispatch agents.
-- ============================================================

BEGIN;

-- ── 1. Add columns the driver app expects ───────────────────
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS first_name                text,
  ADD COLUMN IF NOT EXISTS last_name                 text,
  ADD COLUMN IF NOT EXISTS is_online                 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_drive_member_vehicle  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_do_rideshare          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_do_delivery           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completion_rate           real    NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS background_check_passed   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partner_id                uuid,
  ADD COLUMN IF NOT EXISTS profile_photo_url         text,
  ADD COLUMN IF NOT EXISTS license_document_path     text,
  ADD COLUMN IF NOT EXISTS insurance_document_path   text,
  ADD COLUMN IF NOT EXISTS document_rejection_reason text,
  ADD COLUMN IF NOT EXISTS current_lat               real,
  ADD COLUMN IF NOT EXISTS current_lng               real,
  ADD COLUMN IF NOT EXISTS license_expiry            date,
  ADD COLUMN IF NOT EXISTS insurance_expiry          date;

-- ── 2. Backfill: split full_name into first_name / last_name ─
-- Single-word names get an empty last_name.
-- Only touches rows where first_name hasn't been set yet.
UPDATE public.drivers
SET
  first_name = split_part(full_name, ' ', 1),
  last_name  = CASE
    WHEN full_name LIKE '% %'
    THEN trim(substring(full_name FROM position(' ' IN full_name) + 1))
    ELSE ''
  END
WHERE full_name IS NOT NULL
  AND first_name IS NULL;

-- ── 3. Backfill: background_check_passed from bgc_status ────
UPDATE public.drivers
SET background_check_passed = true
WHERE bgc_status = 'passed'
  AND background_check_passed = false;

-- ── 4. App Review driver — capability flags ──────────────────
UPDATE public.drivers
SET
  can_do_rideshare         = true,
  can_do_delivery          = true,
  can_drive_member_vehicle = true,
  completion_rate          = 0.98
WHERE id = 'b64c232e-c88b-4b50-a269-b3df8d3c11c4';

COMMIT;

-- ── 5. Verify the App Review driver row ─────────────────────
SELECT
  id, profile_id,
  first_name, last_name, status,
  is_online,
  can_do_rideshare, can_do_delivery, can_drive_member_vehicle,
  completion_rate, background_check_passed, bgc_status
FROM public.drivers
WHERE profile_id = '7ea30444-47d8-40b8-8e84-db70e1fdf68a';
