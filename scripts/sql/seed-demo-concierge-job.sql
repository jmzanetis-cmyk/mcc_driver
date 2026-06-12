-- ============================================================
-- MCC Live Tracking — Demo Job Seed (Step 8)
-- ============================================================
-- Seeds the demo concierge job and custody handoff that the
-- App Review driver account uses during the live tracking demo.
--
-- Prerequisites:
--   1. Migration 20260611c_demo_job.sql applied (adds is_demo column)
--   2. Migration 20260611a_live_tracking.sql applied (tracking schema)
--   3. App Review driver account seeded (create-app-review-driver-account.sql)
--      — its profile UUID must be pasted into review_uid_text below
--   4. A demo member auth user created (see STEP 1 below)
--
-- ── STEP 1: Create demo member auth user ────────────────────
-- In Supabase Dashboard → Authentication → Users → Invite user:
--   Email:    demo-member@mycarconcierge.com
--   Password: DemoMember2026!
-- Copy the resulting UUID; paste into demo_member_uid below.
--
-- Configure the same test phone for OTP if needed:
--   Phone: +15555550100   OTP: 123456
--
-- ── STEP 2: Paste UUIDs, then run this in SQL Editor ────────
--
-- Fixed job/handoff UUIDs (from demoReplay.ts constants):
--   Job ID:     d0000000-0000-0000-0000-000000000001
--   Handoff ID: d0000000-0000-0000-0000-000000000002
-- ============================================================

DO $$
DECLARE
  -- Paste the UUID of the App Review driver profile here:
  review_uid_text     text := '7ea30444-47d8-40b8-8e84-db70e1fdf68a';
  demo_member_uid     text := '83a05113-75bc-4f4e-8969-2498b58a2339';
  -- Alpha Auto Body (profiles.id):
  demo_provider_uid   text := 'dbb15523-2441-4ad9-8d2d-c6d8812c7ca2';

  review_uid          uuid;
  member_uid          uuid;
  provider_uid        uuid;
  driver_id           uuid;

  -- Fixed UUIDs — must match demoReplay.ts constants
  demo_job_id         uuid := 'd0000000-0000-0000-0000-000000000001';
  demo_handoff_id     uuid := 'd0000000-0000-0000-0000-000000000002';

BEGIN

  -- ── Validate ────────────────────────────────────────────────────────────────
  IF review_uid_text = 'PASTE-UUID-HERE'
     OR length(review_uid_text) <> 36
     OR review_uid_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION 'review_uid_text is not a valid UUID. Run create-app-review-driver-account.sql first.';
  END IF;

  IF demo_member_uid = 'PASTE-MEMBER-UUID-HERE'
     OR length(demo_member_uid) <> 36
     OR demo_member_uid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION 'demo_member_uid is not a valid UUID. Create the demo member account in Supabase Dashboard first.';
  END IF;

  review_uid   := review_uid_text::uuid;
  member_uid   := demo_member_uid::uuid;
  provider_uid := demo_provider_uid::uuid;

  -- ── Resolve driver row ───────────────────────────────────────────────────────
  SELECT id INTO driver_id
    FROM public.drivers
   WHERE profile_id = review_uid;

  IF driver_id IS NULL THEN
    RAISE EXCEPTION 'Driver row not found for profile %. Run create-app-review-driver-account.sql first.', review_uid_text;
  END IF;

  -- ── Demo concierge job ───────────────────────────────────────────────────────
  INSERT INTO public.concierge_jobs (
    id,
    member_id,
    provider_id,
    tier,
    scenario,
    status,
    is_demo,
    live_tracking_enabled,
    pickup_address,
    pickup_lat,
    pickup_lng,
    dropoff_address,
    dropoff_lat,
    dropoff_lng,
    scheduled_start_at,
    notes
  ) VALUES (
    demo_job_id,
    member_uid,
    provider_uid,  -- Alpha Auto Body
    2,   -- Tier 2
    3,   -- Scenario 3 (vehicle shuttle)
    'in_progress',
    true,
    true,
    '200 Main St, Hackensack, NJ 07601',
    40.8858,
    -74.0507,
    '100 Route 17 S, Paramus, NJ 07652',
    40.9315,
    -74.0750,
    now(),
    'App Review / QA demo job — do not use in production analytics'
  )
  ON CONFLICT (id) DO UPDATE SET
    status                = 'in_progress',
    provider_id           = provider_uid,
    is_demo               = true,
    live_tracking_enabled = true,
    scheduled_start_at    = now();

  RAISE NOTICE 'Demo concierge job: %', demo_job_id;

  -- ── Demo custody handoff (member_to_driver leg) ──────────────────────────────
  INSERT INTO public.custody_handoffs (
    id,
    job_id,
    sequence,
    leg,
    releasing_party_id,
    releasing_party_role,
    receiving_party_id,
    receiving_party_role,
    status
  ) VALUES (
    demo_handoff_id,
    demo_job_id,
    1,
    'member_to_driver',
    member_uid,
    'member',
    review_uid,
    'driver',
    'accepted'
  )
  ON CONFLICT (id) DO UPDATE SET
    status = 'accepted';

  RAISE NOTICE 'Demo handoff: %', demo_handoff_id;
  RAISE NOTICE '';
  RAISE NOTICE '=== Demo ready ===';
  RAISE NOTICE 'Driver login:  +15555550199  OTP: 123456  →  /demo-job';
  RAISE NOTICE 'Member login:  demo-member@mycarconcierge.com  /  DemoMember2026!';
  RAISE NOTICE 'Member tracking: mycarconcierge.com/member/jobs/d0000000-0000-0000-0000-000000000001';

END $$;


-- ============================================================
-- CLEANUP  (uncomment and run to reset demo data)
-- ============================================================
-- DELETE FROM public.custody_handoffs WHERE id = 'd0000000-0000-0000-0000-000000000002';
-- DELETE FROM public.tracking_pings     WHERE job_id = 'd0000000-0000-0000-0000-000000000001';
-- DELETE FROM public.road_test_events   WHERE job_id = 'd0000000-0000-0000-0000-000000000001';
-- DELETE FROM public.concierge_jobs     WHERE id     = 'd0000000-0000-0000-0000-000000000001';
