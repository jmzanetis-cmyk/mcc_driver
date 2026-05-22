# MCC Driver Monorepo — Code Audit

**Date:** 2026-05-21 (Stripe section updated 2026-05-22)  
**Scope:** All workspace packages under `/Users/jordanzanetis/mcc_driver`

---

## 1. Stack Inventory

Resolved versions come from `pnpm-workspace.yaml` catalog entries plus per-package `package.json` files.

### Shared (catalog)

| Package | Version |
|---|---|
| React | 19.1.0 |
| React DOM | 19.1.0 |
| Vite | ^7.3.2 |
| TypeScript | ~5.9.2 |
| TanStack Query (`@tanstack/react-query`) | ^5.90.21 |
| Tailwind CSS | ^4.1.14 |
| Zod | 3.25.76 |
| Drizzle ORM | ^0.45.2 |
| framer-motion | ^12.23.24 |

### `artifacts/driver` (`@workspace/driver`)

| Package | Version |
|---|---|
| react-router-dom | ^6.30.3 |
| @supabase/supabase-js | ^2.105.4 |
| @capacitor/core | ^8.3.4 |
| @capacitor/ios | ^8.3.4 |
| @capacitor/cli | ^8.3.4 |
| @capacitor/app | ^8.1.0 |
| @capacitor/geolocation | ^8.2.0 |
| @capacitor/keyboard | ^8.0.3 |
| @capacitor/push-notifications | ^8.1.0 |
| @capacitor/splash-screen | ^8.0.1 |
| @capacitor/status-bar | ^8.0.2 |
| @capacitor/network | ^8.0.1 (runtime dep) |
| @sentry/capacitor | ^4.0.0 (runtime dep) |
| @sentry/react | ^10.43.0 (runtime dep) |
| @sentry/vite-plugin | ^5.3.0 |
| @playwright/test | ^1.60.0 |

No `@stripe/stripe-js` in driver — Stripe interactions happen server-side only.

### `artifacts/admin` (`@workspace/admin`)

| Package | Version |
|---|---|
| @supabase/supabase-js | ^2.105.4 |
| wouter | ^3.3.5 |

No Stripe SDK in admin frontend.

### `artifacts/api-server` (`@workspace/api-server`)

| Package | Version |
|---|---|
| stripe | ^22.1.1 |
| @supabase/supabase-js | ^2.105.4 |
| drizzle-orm | ^0.45.2 (from catalog) |
| express | ^5 |
| twilio | ^6.0.2 |
| resend | ^6.12.3 |
| apn | ^2.2.0 |
| web-push | ^3.6.7 |
| zod | 3.25.76 (from catalog) |
| @sentry/node | ^10.53.1 |
| pino | ^9 |

### `artifacts/marketing`

React + Vite only; no auth, no Stripe, no Supabase.

### `lib/db`

| Package | Version |
|---|---|
| drizzle-orm | ^0.45.2 |
| drizzle-zod | ^0.8.3 |
| drizzle-kit | ^0.31.9 |
| pg | ^8.20.0 |
| zod | 3.25.76 |

### `lib/api-spec`

OpenAPI 3.1.0 spec + Orval ^8.5.2 codegen config. No runtime dependencies.

---

## 2. Dead Code / Unused Deps / Duplicate Utils

### Unused hook

| File | Finding |
|---|---|
| `artifacts/driver/src/hooks/use-mobile.tsx` | **Zero import references** in the entire `src/` tree. This hook is dead code. |

All other hooks, screens, and components under `src/screens/`, `src/components/`, and `src/hooks/` have at least one import site.

### Radix UI — driver package cleanup complete

All 26 `@radix-ui/*` packages have been removed from `artifacts/driver/package.json` (commit 8549389). The driver `src/` tree had zero `@radix-ui` imports and no `src/components/ui/` directory, so none of these packages were used in the driver bundle.

The admin `src/components/ui/` directory contains shadcn wrappers that import every declared `@radix-ui` package, so the same set is legitimately used in admin.

### Duplicate formatDate inline function

`artifacts/admin/src/pages/` defines a `formatDate` inline arrow function in four separate page files:

- `artifacts/admin/src/pages/Drivers.tsx:112`
- `artifacts/admin/src/pages/DriverDetail.tsx:260`
- `artifacts/admin/src/pages/RideAlongDrivers.tsx:137`
- `artifacts/admin/src/pages/RideAlongDrivers.tsx:344` (defined twice in the same file)

Each is an identical `(iso: string | null | undefined) => ...` implementation. The driver app already has a canonical `formatDate` in `artifacts/driver/src/utils/formatters.ts`; the admin has no shared util equivalent.

**Action:** Extract to `artifacts/admin/src/lib/formatters.ts` and replace the four inline copies.

### No other duplicate utility functions found

`formatCurrency`, `formatDistance`, `formatDuration`, and other formatters exist only in `artifacts/driver/src/utils/formatters.ts`. No duplication detected across packages.

---

## 3. Env Vars

### Driver app — `.env.example` (`artifacts/driver/.env.example`)

Declared variables:

| Variable | Required? | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `VITE_API_BASE_URL` | Conditional | Must be set for native iOS builds; leave unset for web/dev |
| `VITE_APP_ENV` | No | `production` \| `staging` \| `development` |
| `VITE_SENTRY_DSN` | No | Leave unset to disable telemetry |
| `VITE_SENTRY_ENV` | No | Sentry environment label |
| `VITE_SENTRY_RELEASE` | No | Auto-computed; override only if needed |

**No `.env.example` exists** for `artifacts/admin`, `lib/db`, or `scripts`. `artifacts/api-server/.env.example` now documents all 29 server-side variables.

### Driver app — vars referenced in code (`import.meta.env.*`)

| Variable | Files |
|---|---|
| `VITE_SUPABASE_URL` | `src/services/supabase/client.ts` (and similar) |
| `VITE_SUPABASE_ANON_KEY` | same |
| `VITE_API_BASE_URL` | `src/services/api/baseUrl.ts` |
| `VITE_APP_ENV` | `src/components/EnvBadge.tsx` |
| `VITE_GOOGLE_MAPS_API_KEY` | `src/components/MapView.tsx` — optional; maps degrade gracefully when unset |
| `VITE_SENTRY_DSN` | `src/services/telemetry/sentry.ts` |
| `VITE_SENTRY_RELEASE` | `src/services/telemetry/sentry.ts` |
| `VITE_SENTRY_ENV` | `src/services/telemetry/sentry.ts` |
| `BASE_URL` | `src/hooks/useTandemBroadcasts.ts` (Vite built-in) |
| `DEV` / `PROD` | Vite built-ins |

All 7 declared variables are actually referenced. No mismatch.

### API server — vars referenced in code (`process.env.*`)

No `.env.example` exists; the following are inferred from code:

| Variable | File(s) |
|---|---|
| `SUPABASE_URL` | `src/lib/supabaseAdmin.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/lib/supabaseAdmin.ts` |
| `SUPABASE_ANON_KEY` | `src/lib/supabaseAdmin.ts` |
| `STRIPE_SECRET_KEY` | `src/routes/stripeConnect.ts` |
| `ANTHROPIC_API_KEY` | `src/routes/ai.ts` |
| `DISPATCH_API_KEY` | `src/routes/payouts.ts`, `src/routes/rides.ts` |
| `DRIVER_APP_URL` | `src/routes/stripeConnect.ts` (Stripe return URL) |
| `RESEND_API_KEY` | `src/lib/email.ts` |
| `DRIVER_EMAIL_FROM` | `src/lib/email.ts` |
| `DRIVER_SIGN_IN_URL` | `src/lib/email.ts` |
| `TWILIO_ACCOUNT_SID` | `src/lib/notifications.ts` |
| `TWILIO_AUTH_TOKEN` | `src/lib/notifications.ts` |
| `TWILIO_FROM_NUMBER` | `src/lib/notifications.ts` |
| `APP_BASE_URL` | `src/lib/notifications.ts` |
| `APNS_KEY_ID` | `src/lib/apnsPush.ts` |
| `APNS_TEAM_ID` | `src/lib/apnsPush.ts` |
| `APNS_AUTH_KEY` | `src/lib/apnsPush.ts` |
| `APNS_BUNDLE_ID` | `src/lib/apnsPush.ts` |
| `APNS_PRODUCTION` | `src/lib/apnsPush.ts` |
| `VAPID_PUBLIC_KEY` | `src/lib/webPush.ts` |
| `VAPID_PRIVATE_KEY` | `src/lib/webPush.ts` |
| `VAPID_SUBJECT` | `src/lib/webPush.ts` |
| `STRIPE_WEBHOOK_SECRET` | `src/routes/stripeWebhook.ts` — Stripe dashboard signing secret for `POST /api/stripe/webhook` |
| `SENTRY_DSN` | `src/lib/sentry.ts` |
| `SENTRY_ENV` | `src/lib/sentry.ts` |
| `SENTRY_RELEASE` | `src/lib/sentry.ts` |
| `ADMIN_EMAILS` | legacy — referenced but superseded by `admin_users` table |
| `LOG_LEVEL` | `src/lib/logger.ts` |
| `NODE_ENV` | throughout |
| `PORT` | `src/index.ts` |
| `REPLIT_DOMAINS` | `src/lib/email.ts`, `src/lib/notifications.ts` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | `lib/db/src/index.ts` — used in drizzle config for local dev |
| `DATABASE_URL` | `scripts/src/*.ts` |
| `API_BASE` | `scripts/src/smoke-*.ts` |

**Mismatch flags:**
- `ADMIN_EMAILS` is referenced in `src/lib/adminAuth.ts` as a legacy fallback but the system has migrated to the `admin_users` DB table. The env var should be documented as deprecated.
- No `.env.example` exists for the API server. This is a documentation gap — there are 29 distinct variables but none are documented anywhere in the repo.

---

## 4. Supabase Tables / Columns / RPCs

> **Schema cross-reference requires Supabase MCP — not performed.** The tables below are what the code references. Cross-check each against the live Supabase project to verify the table exists in the correct schema and that RLS policies are properly scoped.

### Tables defined in `lib/db/src/schema/index.ts` (Drizzle schema)

| Table | Key columns |
|---|---|
| `admin_users` | `id`, `email`, `created_by`, `created_at` |
| `driver_audit_log` | `id`, `driver_id`, `action`, `admin_email`, `resulting_status`, `reason`, `created_at` |
| `drivers` | `id`, `user_id`, `first_name`, `last_name`, `email`, `phone`, `status`, `profile_photo_url`, `license_document_path`, `insurance_document_path`, `background_check_passed`, `partner_id`, `is_online`, `can_drive_member_vehicle`, `total_rides_completed`, `average_rating`, `completion_rate`, `stripe_account_id`, `current_lat`, `current_lng`, `location_updated_at`, `preferred_partner_id`, `document_rejection_reason`, `can_do_rideshare`, `can_do_delivery`, `created_at` |
| `rides` | `id`, `scenario`, `tier`, `status`, `member_id`, `member_phone`, `member_name`, `pickup_address`, `pickup_lat`, `pickup_lng`, `dropoff_address`, `dropoff_lat`, `dropoff_lng`, `estimated_fare`, `actual_fare`, `estimated_distance_miles`, `actual_distance_miles`, `tip_amount`, `member_rating`, `started_at`, `completed_at`, `member_vehicle_year`, `member_vehicle_make`, `member_vehicle_model`, `member_vehicle_color`, `tandem_required`, `tandem_mode`, `service_type`, `package_description`, `created_at` |
| `driver_assignments` | `id`, `ride_id`, `driver_id`, `role`, `status`, `driver_payout_amount`, `dispatched_at`, `accepted_at`, `rejected_at`, `en_route_at`, `arrived_at`, `started_at`, `completed_at`, `drives_member_vehicle`, `carries_passenger`, `response_deadline`, `member_vehicle_description`, `member_vehicle_plate`, `dispatch_attempt`, `payout_status`, `payout_id`, `created_at`, `updated_at` |
| `driver_payouts` | `id`, `driver_id`, `amount`, `net_payout`, `platform_fee`, `method`, `status`, `requested_at`, `completed_at`, `scheduled_date`, `stripe_transfer_id`, `card_last4`, `bank_last4`, `failed_reason`, `created_at` |
| `ride_along_drivers` | `id`, `user_id`, `first_name`, `last_name`, `email`, `phone`, `zip_code`, `max_distance_miles`, `license_number`, `license_state`, `license_expiry`, `license_document_path`, `insurance_document_path`, `insurance_expiry`, `zip_lat`, `zip_lng`, `background_check_status`, `verified`, `profile_photo_path`, `agreement_signed_at`, `rating`, `total_jobs`, `status`, `created_at`, `updated_at` |
| `tandem_jobs` | `id`, `ride_id`, `provider_id`, `tandem_mode`, `ride_along_driver_id`, `match_status`, `match_deadline`, `matched_ride_along_driver_id`, `member_approved`, `ride_along_fee`, `ride_along_checkin_at`, `provider_checkin_at`, `photos_json`, `gps_json`, `created_at`, `updated_at` |
| `tandem_job_declines` | `id`, `tandem_job_id`, `ride_along_driver_id`, `reason`, `created_at` |
| `device_tokens` | `id`, `owner_kind`, `owner_id`, `platform`, `token`, `p256dh`, `auth`, `user_agent`, `created_at`, `last_seen_at`, `revoked_at` |
| `app_config` | `id`, `min_supported_version`, `latest_version`, `outage_message`, `app_store_url`, `updated_at`, `updated_by` |

### Tables referenced in client code but NOT defined in the Drizzle schema

These tables exist in Supabase but are not covered by the Drizzle schema in `lib/db`. Verify they exist and have correct RLS.

| Table | Where referenced |
|---|---|
| `transportation_partners` | `artifacts/driver/src/features/auth/provider/AuthProvider.tsx`, `src/services/auth/authService.ts`, `src/services/ai/aiOpsService.ts` |
| `driver_vehicles` | `artifacts/driver/src/services/ai/aiOpsService.ts` |
| `ai_conversations` | `artifacts/driver/src/services/ai/aiOpsService.ts` |
| `ai_messages` | `artifacts/driver/src/services/ai/aiOpsService.ts` |
| `driver_support_issues` | `artifacts/driver/src/services/ai/aiOpsService.ts` |
| `driver-documents` (Storage bucket) | `artifacts/driver/src/screens/RideAlongApplyScreen.tsx` — this is a Storage bucket name, not a DB table |

### RPCs

No `.rpc(` calls found anywhere in the codebase. All data access goes through REST or direct Supabase client queries.

---

## 5. Realtime Channels

### Channel inventory

| Channel key (dynamic) | Table watched | Events | Used in |
|---|---|---|---|
| `ride-requests-{driverId}` | `driver_assignments` | `INSERT` where `driver_id = driverId` | `artifacts/driver/src/hooks/useRideRequests.ts` |
| `ride-cancellation-rides-{rideId}` | `rides` | `UPDATE` where `id = rideId` | `artifacts/driver/src/hooks/useRideCancellation.ts` |
| `ride-cancellation-assignments-{assignmentId}` | `driver_assignments` | `UPDATE` where `id = assignmentId` | `artifacts/driver/src/hooks/useRideCancellation.ts` |
| `tandem-broadcasts` | `tandem_jobs` | `*` (all events) | `artifacts/driver/src/hooks/useTandemBroadcasts.ts` |
| `{channelName}` (dynamic) | Supabase broadcast channel for server-to-driver push | server-initiated broadcast | `artifacts/api-server/src/lib/notifications.ts:127` |

### Notes

- The `rides` realtime channel (`ride-cancellation-rides-*`) requires `ALTER PUBLICATION supabase_realtime ADD TABLE rides` to be run in Supabase. This is documented in `artifacts/driver/src/hooks/useRideCancellation.ts` and `scripts/sql/enable-rides-realtime.sql`.
- The `tandem_jobs` channel similarly requires `scripts/sql/enable-tandem-jobs-realtime.sql`.
- The `useRideCancellation` hook uses a backfill poll on subscribe and on network restore as a fallback for missed cancellations.
- The `useTandemBroadcasts` hook uses realtime only as a cache-invalidation signal; actual data is fetched from the server (`GET /api/ride-along/eligible-broadcasts`).

---

## 6. Stripe Connect Flows

Stripe is used exclusively in `artifacts/api-server`. No Stripe SDK in any frontend.

### Stripe initialization

`artifacts/api-server/src/routes/stripeConnect.ts` — lazy singleton via `new Stripe(process.env.STRIPE_SECRET_KEY)`. SDK version: `stripe ^22.1.1`.

### Connect onboarding flow

| Route | Stripe call | Notes |
|---|---|---|
| `POST /api/stripe/connect/onboard` | `stripe.accounts.create({ type: 'express', ... })` then `stripe.accountLinks.create(...)` | Creates Express account if `stripe_account_id` is null; returns one-time onboarding URL. Saves `stripe_account_id` to `drivers` table. |
| `GET /api/stripe/connect/status` | `stripe.accounts.retrieve(driver.stripeAccountId)` | Returns `onboardingComplete`, `chargesEnabled`, `payoutsEnabled`, `hasDebitCard`. |
| `POST /api/stripe/connect/refresh` | `stripe.accountLinks.create(...)` | Generates fresh link when previous expired. |

### Shared capability helper

`artifacts/api-server/src/lib/stripeCapabilities.ts` — calls `stripe.accounts.retrieve()` and inspects `external_accounts.data` to determine real debit card vs. bank account presence. Exports:
- `getDriverPayoutCapabilities(stripeAccountId)` → `{ chargesEnabled, payoutsEnabled, hasDebitCard, hasBank }`
- `canDriverInstantPayout(stripeAccountId)` → `boolean` (requires both `payoutsEnabled` and `hasDebitCard`)

Used by `instantPayout.ts`, `standardPayout.ts`, and `weeklyPayoutService.ts`.

### Instant Pay flow

| Route | File | Notes |
|---|---|---|
| `POST /api/payouts/instant` | `artifacts/api-server/src/routes/instantPayout.ts` | Auth → capability check (payoutsEnabled + hasDebitCard) → fetch unpaid `driver_assignments` → insert `driver_payouts` row → `stripe.transfers.create()` (platform → connected account) → `stripe.payouts.create({ method: 'instant' }, { stripeAccount })` (connected → debit card) → update DB with `stripe_transfer_id`, `status: 'in_transit'` → mark assignments `payout_status: 'paid'` |

Fee: 1.5% of gross. Minimum: $5.00. Daily limit: 5 cash-outs per driver. Response: `{ payout: { id, gross, fee, net, method, status, assignmentCount } }`.

The client (`artifacts/driver/src/services/payments/instantPayService.ts`) was updated to call `POST /api/payouts/instant` via `fetch` with a Bearer token instead of writing directly to Supabase. The `hasDebitCard` / `instantPayEnabled` state is now derived from `GET /api/stripe/connect/status` (real `stripe.accounts.retrieve()` check) rather than the old `!!stripe_account_id` lie.

### Standard Payout flow

| Route | File | Notes |
|---|---|---|
| `POST /api/payouts/standard` | `artifacts/api-server/src/routes/standardPayout.ts` | Auth → `payoutsEnabled` check (no debit card required) → fetch unpaid assignments → insert `driver_payouts` row → `stripe.transfers.create()` → `stripe.payouts.create({ method: 'standard' }, { stripeAccount })` → update DB → mark assignments paid |

No fee. Minimum: $1.00. Arrival date: next Wednesday. Response: `{ payout: { id, amount, method, status, assignmentCount, arrivalDate } }`.

### Weekly automated payout

`artifacts/api-server/src/services/weeklyPayoutService.ts` — `runWeeklyPayouts()` groups all unpaid `driver_assignments` by driver, calls `getDriverPayoutCapabilities()`, and for each eligible non-partner driver executes the same Stripe transfer + standard payout flow. Returns `{ processed, succeeded, failed, skipped, results[] }`.

Triggered by `POST /api/payouts/run-weekly` (protected by `DISPATCH_API_KEY`) and also on an internal setTimeout schedule via `artifacts/api-server/src/lib/weeklyPayoutScheduler.ts` (fires every Wednesday at 06:00 UTC).

### Webhook handler

`artifacts/api-server/src/routes/stripeWebhook.ts` — mounted as `POST /api/stripe/webhook` directly on the `app` object using `express.raw({ type: 'application/json' })` **before** the global `express.json()` middleware (raw body required for Stripe signature verification). Requires `STRIPE_WEBHOOK_SECRET` env var.

| Event | Action |
|---|---|
| `transfer.created` | Update `driver_payouts` where `stripe_transfer_id = transfer.id` → `status: 'in_transit'` |
| `payout.paid` | Update where `id = payout.metadata.mcc_payout_id` → `status: 'paid'`, set `completed_at` |
| `payout.failed` | → `status: 'failed'`, set `failed_reason` |
| `payout.canceled` | → `status: 'canceled'` |
| `account.updated` | Log only |

Returns 500 on handler errors (triggers Stripe retry), 400 on bad signature.

### Tip flow

Tips (`tip_amount` on the `rides` table) are stored at ride completion. The `RideCompleteScreen.tsx` displays the tip. No Stripe tip charge or transfer is implemented — the tip amount is informational only.

---

## 7. API Routes / Edge Functions

All routes are mounted at `/api` prefix (see `artifacts/api-server/src/app.ts:52`).

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/healthz` | Returns `{ status: 'ok' }` |

### App Status

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/app/status` | Returns `app_config` row (min version, outage message, etc.) for forced update / kill switch |
| `GET` | `/api/admin/app-config` | Admin: read full `app_config` row |
| `PUT` | `/api/admin/app-config` | Admin: update `min_supported_version`, `latest_version`, `outage_message`, `app_store_url` |

### Rides / Dispatch

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/rides/dispatch` | Create ride + dispatch to eligible drivers; returns `rideId`, `assignmentIds`, `driversNotified` |
| `POST` | `/api/rides/assignments/:assignmentId/accept` | Driver accepts; atomically checks deadline |
| `POST` | `/api/rides/assignments/:assignmentId/decline` | Driver declines |
| `PATCH` | `/api/rides/assignments/:assignmentId/stage` | Update stage: `en_route` → `arrived` → `in_progress` |
| `POST` | `/api/rides/:rideId/cancel` | Driver or member cancels ride |
| `POST` | `/api/rides/:rideId/complete` | Complete ride; recalculates fare, creates payout record |
| `PATCH` | `/api/drivers/me/services` | Update driver service capabilities (`canDoRideshare`, `canDoDelivery`) |

### Admin — Drivers

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/drivers` | List drivers by status; optional `reviewerEmail` filter |
| `POST` | `/api/admin/drivers/:driverId/approve` | Set driver status to `active` |
| `POST` | `/api/admin/drivers/:driverId/reject` | Set to `inactive`, send rejection email via Resend |
| `POST` | `/api/admin/drivers/:driverId/reject-documents` | Flag documents for resubmission |
| `POST` | `/api/admin/drivers/:driverId/clear-document-rejection` | Clear document rejection flag |
| `GET` | `/api/admin/drivers/:driverId/audit-log` | Full admin action history for a driver |
| `GET` | `/api/admin/reviewers` | Distinct admin emails that appear in audit log |

### Admin — Rides

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/rides` | List rides by status |
| `POST` | `/api/admin/rides/:rideId/cancel` | Admin cancel + notify driver via Supabase Realtime |
| `POST` | `/api/admin/rides/dispatch` | Admin-initiated dispatch (same logic as `/rides/dispatch`) |

### Stripe Connect

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/stripe/connect/onboard` | Create/retrieve Stripe Express onboarding link |
| `GET` | `/api/stripe/connect/status` | Get account status (`chargesEnabled`, `payoutsEnabled`, `hasDebitCard`) |
| `POST` | `/api/stripe/connect/refresh` | Refresh expired onboarding link |

### Payouts

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/payouts/instant` | Authenticated driver; real Stripe transfer + instant payout to debit card; 1.5% fee |
| `POST` | `/api/payouts/standard` | Authenticated driver; real Stripe transfer + standard payout to bank; no fee; next-Wednesday arrival |
| `POST` | `/api/payouts/run-weekly` | Protected by `DISPATCH_API_KEY`; triggers `runWeeklyPayouts()` for all eligible non-partner drivers |
| `POST` | `/api/stripe/webhook` | Stripe webhook (raw body, signature-verified); updates `driver_payouts` status on transfer/payout events |

### Driver Account

| Method | Path | Description |
|---|---|---|
| `DELETE` | `/api/drivers/me` | Soft-delete driver account (blocked if active ride or unpaid balance) |

### Device Tokens (Push)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/device-tokens/vapid-key` | Return VAPID public key for Web Push subscription |
| `POST` | `/api/device-tokens` | Register push token (`web`, `fcm`, or `apns`) |
| `DELETE` | `/api/device-tokens` | Revoke push token on sign-out |

### Driver Location

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/drivers/me/location` | Update `current_lat`, `current_lng`, `location_updated_at` on `drivers` |

### Ride-Along Drivers

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/ride-along-drivers` | Create ride-along driver application |
| `GET` | `/api/ride-along-drivers/me` | Get authenticated user's ride-along profile |
| `PATCH` | `/api/ride-along-drivers/:id` | Update profile / resubmit documents |
| `GET` | `/api/admin/ride-along-drivers` | Admin: list applications by status |
| `PATCH` | `/api/admin/ride-along-drivers/:id/approve` | Admin: approve application |
| `PATCH` | `/api/admin/ride-along-drivers/:id/reject` | Admin: reject application |

### Tandem Jobs

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tandem-jobs/lookup-partner` | Validate known partner by email or UUID |
| `POST` | `/api/tandem-jobs` | Create tandem job (Mode A / B / C) |
| `GET` | `/api/tandem-jobs/:id` | Get tandem job by ID |
| `PATCH` | `/api/tandem-jobs/:id/mode` | Update tandem mode |
| `GET` | `/api/drivers/me/preferred-partner` | Get driver's preferred standing partner |
| `POST` | `/api/drivers/me/preferred-partner` | Set preferred partner |
| `DELETE` | `/api/drivers/me/preferred-partner` | Clear preferred partner |

### Tandem Matching (Mode B)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/tandem-jobs/:id/broadcast` | Open broadcast window (2-hour deadline) |
| `GET` | `/api/tandem-jobs/:id/eligible-drivers` | List eligible ride-along drivers |
| `GET` | `/api/ride-along/eligible-broadcasts` | Ride-along driver: list open broadcasts they're eligible for |
| `GET` | `/api/tandem-jobs/:id/match-detail` | Get current match detail |
| `POST` | `/api/tandem-jobs/:id/ridealong-accept` | Atomic accept (first caller wins) |
| `POST` | `/api/tandem-jobs/:id/ridealong-decline` | Record decline, exclude from re-broadcast |
| `PATCH` | `/api/tandem-jobs/:id/provider-accept` | Provider confirms matched driver (`matched` → `member_pending`) |
| `PATCH` | `/api/tandem-jobs/:id/member-approve` | Member approves match (`member_pending` → `confirmed`) |
| `PATCH` | `/api/tandem-jobs/:id/member-decline` | Member declines; re-broadcast to remaining eligible |
| `PATCH` | `/api/tandem-jobs/:id/request-rematch` | Provider requests different match |
| `POST` | `/api/tandem-jobs/:id/known-partner` | Set Mode A known partner |
| `DELETE` | `/api/tandem-jobs/:id/known-partner` | Remove Mode A known partner |

### AI

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/ai/chat` | Anthropic-backed AI chat for driver ops questions |

### Dev / Debug (non-production)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/dev/push-test` | Send test push notification (dev only) |
| `GET` | `/_debug/throw` | Intentional error for Sentry testing |

### OpenAPI spec

`lib/api-spec/openapi.yaml` covers: `healthz`, `rides/*`, `ride-along-drivers/*`, `stripe/connect/*`, `device-tokens/*`, `drivers/me/services`, `admin/drivers/*`, `admin/rides/*`, `admin/ride-along-drivers/*`, `tandem-jobs/*`. Missing from spec: `app/status`, `admin/app-config`, `payouts/instant`, `payouts/standard`, `payouts/run-weekly`, `stripe/webhook`, `drivers/me/location`, `drivers/me/preferred-partner`, `ai/chat`, `ride-along/eligible-broadcasts`, `drivers/me` (DELETE).

---

## 8. TODOs / FIXMEs / HACKs

Only one match found across all `*.ts` and `*.tsx` files:

| File | Line | Text |
|---|---|---|
| `artifacts/admin/src/pages/AppConfig.tsx` | 211 | `placeholder="https://apps.apple.com/app/idXXXXXXXXXX"` — `XXXXXXXXXX` is the placeholder for the real App Store ID |

No `TODO`, `FIXME`, `HACK`, `@todo`, or `TEMP` comments exist anywhere in the codebase.

---

## 9. Test Coverage

### Test files found

```
artifacts/driver/tests/visual.spec.ts
artifacts/driver/tests/visual.spec.ts-snapshots/   (directory of .png baselines)
```

That is the entirety of the test suite across all 10 workspace packages.

### Test framework

| Config | Location |
|---|---|
| Playwright `^1.60.0` | `artifacts/driver/playwright.config.ts` |
| Vitest | Not present anywhere |
| Jest | Not present anywhere |

### What is tested

`visual.spec.ts` runs visual-regression snapshot tests against 6 unauthenticated screens in both light and dark themes (12 tests total):

| Screen | Light | Dark |
|---|---|---|
| `signin` | ✓ | ✓ |
| `apply` | ✓ | ✓ |
| `pending` | ✓ | ✓ |
| `legal/privacy` | ✓ | ✓ |
| `legal/terms` | ✓ | ✓ |
| `legal/support` | ✓ | ✓ |

Runs on `desktop-chromium` at 1280×720. Snapshots are committed to git.

### What has zero test coverage

The following areas have **no tests of any kind**:

| Area | Notes |
|---|---|
| All authenticated screens | `HomeScreen`, `EarningsScreen`, `NavigateScreen`, `RideRequestScreen`, `RideCompleteScreen`, `SettingsScreen`, `SetupPaymentsScreen`, `InstantPayScreen`, `MemberApprovalScreen` — excluded from visual tests due to requiring a seeded Supabase session |
| All API server routes | No unit, integration, or contract tests for any Express route |
| All hooks | `useAuth`, `useActiveRide`, `useRideRequests`, `useRideCancellation`, `useTandemBroadcasts`, `useEarnings`, `useInstantPay`, `useDriverStatus`, `useNetworkStatus`, `useRideCancellation` |
| Dispatch logic | The core ride dispatch algorithm in `artifacts/api-server/src/routes/rides.ts` |
| Payout logic | `runWeeklyPayouts()` in `artifacts/api-server/src/services/weeklyPayoutService.ts`; instant/standard payout routes in `src/routes/instantPayout.ts` and `src/routes/standardPayout.ts` |
| Tandem matching logic | All Mode A / B / C state machine transitions |
| Admin app | All pages, services, and hooks |
| Marketing site | All pages |
| `lib/db` schema | No migration or constraint tests |
| `lib/api-zod` | No validation tests |
| Scripts | No smoke test automation (scripts exist but are not wired to any CI) |
| Stripe Connect flows | No mocked Stripe tests |
