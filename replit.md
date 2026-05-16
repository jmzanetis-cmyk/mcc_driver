# MCC Driver

A real-time driver portal for My Car Concierge — a premium vehicle concierge service. Drivers receive ride requests in real time, accept or decline them, and navigate through the full ride lifecycle from pickup to completion.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/driver run dev` — run the driver web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes to local Postgres (dev only)
- Required env: `DATABASE_URL` — local Postgres connection string (Replit built-in)
- Required env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — Supabase project credentials
- Required env: `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (API server writes to Supabase)
- Optional env: `DISPATCH_API_KEY` — restricts dispatch endpoint to service callers via `x-api-key` header
- Optional env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — Phase 3c tandem SMS notifications. If unset, `notifications.ts` logs `sms_skipped` and skips delivery; push (Realtime) still fires. A Replit Twilio integration is available and preferred.
- Optional env: `APP_BASE_URL` — base URL used in SMS deep links; falls back to first entry of `REPLIT_DOMAINS`.
- Optional env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — Web Push (native browser push) credentials. When unset, `webPush.ts` logs `skipped` and the API server falls back to Supabase Realtime broadcasts only. Generate a pair with `npx web-push generate-vapid-keys`. `VAPID_SUBJECT` defaults to `mailto:support@mycarconcierge.com`.
- Optional env: `SENTRY_DSN`, `SENTRY_ENV`, `SENTRY_RELEASE` — API-server Sentry credentials. When `SENTRY_DSN` is unset, `lib/sentry.ts` no-ops cleanly and the server runs without telemetry (dev default). `SENTRY_ENV` defaults to `NODE_ENV`.
- Optional env: `VITE_SENTRY_DSN`, `VITE_SENTRY_ENV`, `VITE_SENTRY_RELEASE` — Driver-app Sentry credentials, embedded at build time. When `VITE_SENTRY_DSN` is unset, `services/telemetry/sentry.ts` no-ops cleanly. The native iOS layer uses `@sentry/capacitor`; native crash symbolication still requires uploading dSYMs from the Mac build (see `artifacts/driver/ios/README.md`).
- Optional env (driver, build-time): `VITE_API_BASE_URL` — absolute API origin (e.g. `https://api.mycarconcierge.com`). Leave unset for web/dev preview so the app uses relative `/api/*` URLs through the shared proxy. **MUST be set** for native iOS Capacitor builds — the webview has no implicit origin. Resolved by `artifacts/driver/src/services/api/baseUrl.ts::apiUrl()`. Paired with `VITE_APP_ENV` (`production` | `staging` | `development`) which drives a corner badge in non-prod builds so QA can never ship the wrong target. See `artifacts/driver/.env.example` and `docs/deployment.md`.
- Optional env: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_AUTH_KEY`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION` — Apple Push Notification service credentials for the Capacitor iOS build. `APNS_AUTH_KEY` is the full PEM contents of the .p8 file from the Apple Developer console; `APNS_BUNDLE_ID` defaults to `com.mycarconcierge.driver` and **must match** the signed build's bundle id + `App.entitlements` `aps-environment` (a mismatch returns APNs `DeviceTokenNotForTopic`, which `apnsPush.ts` treats as a revoke signal — misconfigured creds will silently purge valid tokens). Set `APNS_PRODUCTION=true` for the App Store / TestFlight build (sandbox otherwise). When unset, `apnsPush.ts` logs a skip and Web Push / Realtime continue to work. **Ops:** set `DISPATCH_API_KEY` in any non-local environment so `/api/dev/push-test` is locked down (open only when no key is configured outside production).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Driver app: React + Vite, Zustand, TanStack Query, Supabase JS client
- API: Express 5, Drizzle ORM, @supabase/supabase-js
- DB: Local Postgres (Drizzle ORM via DATABASE_URL) + Supabase Postgres (HTTPS via service role key)
- Realtime: Supabase Realtime (postgres_changes on driver_assignments)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/index.ts` — Drizzle ORM schema: drivers, rides, driver_assignments, driver_payouts
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth for API shape)
- `artifacts/api-server/src/routes/rides.ts` — Ride dispatch, accept, decline, stage update, complete
- `artifacts/api-server/src/lib/supabaseAdmin.ts` — Supabase admin client + insertAssignmentViaSupabase + updateAssignmentViaSupabase
- `artifacts/driver/src/hooks/useRideCancellation.ts` — Realtime UPDATE subscription on rides (primary) + driver_assignments (fallback) for cancellation detection
- `artifacts/driver/src/components/ActiveRideWatcher.tsx` — app-level component that mounts useRideCancellation and auto-navigates home on cancellation
- `artifacts/api-server/src/lib/scenarioConfig.ts` — Server-side ride scenario definitions
- `artifacts/api-server/src/lib/notifications.ts` — Phase 3c tandem notification helpers (Twilio SMS + Realtime push)
- `artifacts/driver/src/hooks/useRideRequests.ts` — Supabase Realtime subscription for live ride requests
- `artifacts/driver/src/services/api/edgeFunctions.ts` — API server calls (accept, decline, stage, complete)
- `artifacts/driver/src/store/dispatchStore.ts` — Zustand store for ride lifecycle state
- `artifacts/driver/src/screens/RideRequestScreen.tsx` — Ride request modal (RideRequestModal component)
- `artifacts/driver/src/screens/NavigateScreen.tsx` — Active ride navigation screen

## Architecture decisions

- **Split DB write strategy for Realtime**: The API server uses Drizzle ORM (via local `DATABASE_URL`) for all transactional ride operations (reads, status updates, ride insert). However, `driver_assignments` inserts AND ride cancellation status changes go through the Supabase JS admin client (HTTPS + service role key) so they land in Supabase Postgres and trigger Realtime events to drivers — direct Postgres connections from Replit's network to Supabase are blocked.
- **Supabase Realtime for push delivery**: The driver app subscribes to `postgres_changes` on two tables: `driver_assignments` (INSERT events, filtered by `driver_id`, for new ride offers) and `rides` (UPDATE events, filtered by `id=eq.{rideId}`, for ride cancellation). Both tables must be in the `supabase_realtime` publication.
- **Cancellation flow**: `POST /api/rides/:rideId/cancel` updates both local Postgres (ride + assignment rows via Drizzle) AND Supabase (ride row via `updateRideViaSupabase()`, assignment rows via `updateAssignmentViaSupabase()`). The Supabase ride write fires a Realtime UPDATE to the driver's `useRideCancellation` hook, which calls `setCancelled()` + `setServerCancelled(true)`, and `ActiveRideWatcher` auto-navigates home.
- **API server for state transitions**: All ride mutations (accept, decline, stage update, complete) go through the API server rather than direct client updates. This enables atomic accept with deadline checking and prevents race conditions where two drivers accept simultaneously.
- **Zustand dispatch store as single source of truth**: The entire ride lifecycle state (idle → offered → accepted → navigating → arrived → in_progress → completing → completed) lives in a single Zustand store, shared between HomeScreen, NavigateScreen, and RideCompleteScreen without prop drilling.
- **SCENARIO_CONFIG mirrored on client and server**: The ride scenario definitions (which role drives the member vehicle, how many drivers required, etc.) exist in both `artifacts/driver/src/services/rides/index.ts` and `artifacts/api-server/src/lib/scenarioConfig.ts` to avoid a cross-artifact dependency.
- **cascadeDispatch + startExpiryWorker**: When an assignment is declined or expires, `cascadeDispatch` re-offers the ride to the next eligible driver. `startExpiryWorker` sweeps overdue pending assignments every 15 s and triggers cascade automatically for ignored requests.

## Product

Drivers sign in with Supabase phone auth, submit a background check application, and once approved can go online to receive ride requests. When a ride is dispatched, online drivers receive a modal popup with a countdown timer. Accepting navigates the driver through: en route → arrived at pickup → ride in progress → complete. Drivers see earnings dashboards, can request instant payouts, and have an AI assistant for support.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Database schema status

### Local Postgres (Drizzle — DATABASE_URL)
All four tables live here and are used by the API server for business logic:
- `drivers` — driver profiles, status, location, payout info
- `rides` — ride records with scenario, fare, pickup/dropoff
- `driver_assignments` — links drivers to rides with status/deadline
- `driver_payouts` — payout requests and transfer records

### Supabase Postgres (HTTPS via service role key)
`driver_assignments` is also written here (via `insertAssignmentViaSupabase`) to trigger Realtime events.
FK constraints on `driver_assignments` in Supabase have been dropped (ride_id_fkey and driver_id_fkey)
since Supabase is used solely as a Realtime notification bus — integrity is enforced in local Drizzle schema.

Missing enum values were added to Supabase via SQL editor (2026-05-15):
- `ride_status`: added pending, pending_dispatch, dispatched, accepted, cancelled, dispatch_failed
- `driver_assignment_status`: added declined, expired
- `driver_status`: added approved
- `driver_assignments` columns added: member_vehicle_description, member_vehicle_plate
- Realtime enabled on driver_assignments: `ALTER PUBLICATION supabase_realtime ADD TABLE driver_assignments`
- **Required one-time setup** (not yet confirmed): `ALTER PUBLICATION supabase_realtime ADD TABLE rides;` — run in the Supabase SQL editor. Script: `scripts/sql/enable-rides-realtime.sql`. The `driver_assignments` fallback path in `useRideCancellation` delivers cancellation notifications without this step.

**Dispatch eligibility requirements**:
- Driver `status` must be `'active'`
- `is_online` must be `true`
- `current_lat` and `current_lng` must both be non-null

Run `pnpm --filter @workspace/scripts run smoke-dispatch` (with API server running)
to verify the full dispatch path end-to-end — confirmed passing as of 2026-05-15:
✓ Dispatch HTTP 201, ✓ ride row in local DB, ✓ assignment row in Supabase, ✓ Realtime event received.

## Gotchas

- After changing `lib/db/src/schema/index.ts`, run `pnpm --filter @workspace/db run push` to apply schema changes to local Postgres.
- After changing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` to regenerate types and hooks.
- `driver_assignments` inserts MUST go through `insertAssignmentViaSupabase` (not Drizzle) so Realtime INSERT events fire for new ride offers.
- Ride cancellations MUST call `updateRideViaSupabase()` to mirror the status to Supabase so Realtime UPDATE fires on the `rides` table. The `updateAssignmentViaSupabase()` call is a belt-and-suspenders secondary path.
- Direct Postgres connections from Replit to Supabase are blocked (network). All Supabase writes go via HTTPS using the service role key.
- Supabase Realtime is enabled on `driver_assignments` via the supabase_realtime publication. Do not remove it.
- **`rides` table must also be added to the publication** for cancellation detection to work. Run `scripts/sql/enable-rides-realtime.sql` once in the Supabase SQL editor.

## iOS (Capacitor) build

The driver web app is wrapped as a native iOS binary via Capacitor 8 (Swift Package Manager, no CocoaPods). All native work happens on a Mac — Replit can scaffold and sync but cannot run a simulator or produce an `.ipa`.

Scripts (run from repo root):

- `pnpm --filter @workspace/driver run build:ios` — build the web bundle and `cap sync` it into `artifacts/driver/ios/App/App/public`
- `pnpm --filter @workspace/driver run ios:open` — open the Xcode workspace
- `pnpm --filter @workspace/driver run ios:assets` — regenerate icon + splash from `artifacts/driver/assets/` (Mac only — `sharp` does not run on the Replit Linux container)

Key files:

- `artifacts/driver/capacitor.config.ts` — app id (`com.mycarconcierge.driver`), display name, splash/status bar/keyboard config
- `artifacts/driver/ios/App/App/Info.plist` — bundle metadata + draft `NSLocation*UsageDescription`, `NSCamera*`, `NSPhotoLibrary*` strings
- `artifacts/driver/ios/App/App/App.entitlements` — `aps-environment = development` for push (flip to `production` for App Store)
- `artifacts/api-server/src/lib/apnsPush.ts` — APNs sender (HTTP/2 + JWT via the `apn` package), dispatched from `webPush.ts` for tokens with `platform = "apns"`
- `artifacts/driver/src/services/location/index.ts` — single location wrapper around `@capacitor/geolocation` (native iOS) with `navigator.geolocation` fallback (web). All location reads/watches in the driver app must go through this service.
- `artifacts/driver/src/services/location/permissionFlow.ts` — pre-permission rationale dialogs: `ensureWhileInUsePermission` (called on go-online) and `announceAlwaysUpgrade` (called once when entering an active-ride stage, primes the driver for iOS' automatic "Always Allow" upgrade prompt).
- `artifacts/api-server/src/routes/driverLocation.ts` — `POST /api/drivers/me/location` (Supabase Bearer auth). Updates local Postgres `drivers.current_lat/current_lng` (read by dispatch eligibility in `routes/rides.ts`) and mirrors to Supabase. Throttled server-side to 1 write per driver per 8 s.
- `artifacts/driver/ios/App/App/Info.plist` — `UIBackgroundModes` includes `location` (in addition to `remote-notification`). Required so iOS keeps the watch alive with the screen locked and surfaces the "Always Allow" upgrade prompt after sustained background use.
- `artifacts/driver/src/services/push/registerNativePush.ts` — Capacitor PushNotifications registration; posts the APNs token to `/api/device-tokens` (canonical device-token endpoint — owner is resolved server-side from the Supabase Bearer token, so there is no separate `/api/drivers/me/device-tokens`) and listens for taps to deep-link via `data.url`
- `scripts/src/send-test-push.ts` — smoke test (`pnpm --filter @workspace/scripts run send-test-push -- --driver <id>`) that hits `POST /api/dev/push-test`; use to verify delivery in foreground / background / killed states on a real device.
- `artifacts/driver/ios/README.md` — Mac-side build, signing, and Xcode workflow

## Account deletion (App Store 5.1.1(v))

Drivers can permanently delete their account from Settings → Delete Account
(two-step confirmation; the second step requires typing `DELETE`).

- Endpoint: `DELETE /api/drivers/me` — Supabase Bearer auth. Implemented in
  `artifacts/api-server/src/routes/driverAccount.ts`.
- **Preflight** (runs inside the anonymize transaction under a `SELECT … FOR UPDATE`
  row lock on the driver, so concurrent dispatch/payout writers cannot race the
  block policy; returns HTTP 409 with `reason: 'active_ride' | 'pending_payout' | 'unpaid_balance'`):
  - Active ride: any `driver_assignments` row with status in
    `accepted | en_route | arrived | in_progress` blocks deletion.
  - Pending payout: any `driver_payouts.status = 'pending'` row blocks
    deletion. **Policy choice:** we BLOCK rather than auto-forfeit or
    auto-pay so the Stripe webhook can still reconcile the in-flight
    transfer to the driver row. Driver must wait for the payout to settle
    (or cancel it) before retrying.
  - Unpaid balance: any `driver_assignments` row with `status = 'completed'`
    and `payout_status IS NULL OR = 'unpaid'` whose `driver_payout_amount`
    sums above $0 blocks deletion. Driver must request a payout for the
    balance first — auto-forfeit would erase earned money, and auto-pay
    would create a transfer to a soon-to-be-anonymized account.
- **Anonymize (don't hard-delete) strategy** — the `drivers` row is preserved
  so FKs from `rides`, `driver_assignments`, `driver_payouts`, and
  `driver_audit_log` keep resolving for historical / accounting integrity.
  - Scrubbed to `[deleted]` (notNull text columns): `first_name`,
    `last_name`, `email`, `phone`.
  - `user_id` (notNull) is replaced with a sentinel `deleted:<driverId>`
    so it cannot collide with any future Supabase auth uid.
  - Set to NULL: `profile_photo_url`, `license_document_path`,
    `insurance_document_path`, `document_rejection_reason`,
    `stripe_account_id`, `current_lat/lng`, `location_updated_at`,
    `preferred_partner_id`.
  - Flipped: `status = 'deleted'`, `is_online = false`,
    `can_drive_member_vehicle/can_do_rideshare/can_do_delivery = false`
    (so dispatch + admin active lists exclude the row).
- **Retained for accounting** — `id`, `created_at`, `total_rides_completed`,
  `average_rating`, `completion_rate`, `background_check_passed`, plus all
  child rows in `rides`, `driver_assignments`, `driver_payouts`,
  `driver_audit_log`.
- **Audit trail** — a `driver_audit_log` row is inserted in the same
  transaction with `action = 'self_delete'`,
  `admin_email = 'self-delete@system'` (non-PII sentinel — the column is
  notNull but we must not retain the driver's real email in the audit row),
  `resulting_status = 'deleted'`. The `driver_id` column preserves the
  link for support correlation.
- **Supabase auth user** is hard-deleted via
  `supabaseAdmin.auth.admin.deleteUser(userId)` after the local anonymize
  transaction commits. This also revokes outstanding sessions, and frees
  the phone number so the same number can re-register cleanly and create a
  brand-new driver row.
- **Client cleanup** on success: TanStack Query cache cleared, `mcc_*`
  localStorage keys removed, `sessionStorage` cleared, the entire
  `mcc-driver` IndexedDB hard-deleted via `purgeAllOfflineData()` in
  `artifacts/driver/src/services/offline/storage.ts` (removes offline
  active-ride snapshot, pending-actions queue, cached driver-state so a
  deleted account leaves zero on-device residue), `supabase.auth.signOut()`
  invoked, and navigation forced to `/` (welcome). If the server returns
  HTTP 207 (local row anonymized but Supabase auth-user deletion failed),
  the client surfaces the warning to the driver before bouncing.

Out of scope (separate tasks if needed): admin-initiated soft-delete tooling
and a GDPR / CCPA data-export endpoint.

## Marketing site (public legal & support pages)

The `artifacts/marketing` artifact is a small React + Vite site mounted at
`/` of the project's published domain. It exists primarily to satisfy App
Store Connect's requirement for public HTTPS Privacy / Terms / Support URLs,
and renders the canonical markdown in `docs/app-store/` at build time via
Vite `?raw` imports (so the docs/ source files remain the single source of
truth).

Routes:

- `/` — landing page with links to the three policy pages
- `/privacy` — renders `docs/app-store/privacy-policy.md`
- `/terms` — renders `docs/app-store/terms-of-service.md`
- `/support` — renders `docs/app-store/support.md`

The driver app's in-app `/legal/{privacy,terms,support}` routes remain as
a fallback (and for offline / in-app linking from SignIn / Settings).

## App Store listing assets

Drafted material for App Store Connect submission (Task #77) lives in `docs/app-store/`:

- `privacy-policy.md` — full driver privacy policy (publishable + in-app)
- `terms-of-service.md` — full driver terms of service (publishable + in-app)
- `app-privacy.md` — App Privacy "nutrition label" worksheet ready to paste into App Store Connect
- `listing-copy.md` — name, subtitle, promotional text, description, keywords, support/marketing/privacy/EULA URLs, age-rating answers, App Review notes
- `support.md` — driver support content (in-app + marketing site)
- `screenshots/README.md` — required device sizes and capture procedure (must run on a Mac simulator for the App Store upload); web-preview reference captures live alongside
- `submission-runbook.md` — end-to-end checklist for TestFlight upload + App Review submission (Task #83). Covers Apple Developer prep, backend pre-flight, reviewer account seeding, the Mac-only build/archive/upload steps, export compliance, App Store Connect record, internal TestFlight pass, submit-for-review, post-approval rollout, and rollback.
- `reviewer-notes.md` — the exact text + sign-in credentials to paste into App Store Connect's "App Review Information" section. Pairs with the Supabase Auth "Test Phone Number" feature (no production backdoor — App Store compliant) and the `seed-reviewer-driver` script.

### Reviewer demo account

Apple's reviewers can't receive real Supabase phone OTPs on their internal
review devices. The supported workaround:

1. In the Supabase production project: **Authentication → Providers → Phone
   → Test OTP**, add the reviewer phone (e.g. `+15555550199`) with a fixed
   6-digit code (e.g. `424242`). No real SMS is ever sent for that number.
2. Seed the matching driver row + Supabase auth user:
   ```bash
   REVIEWER_PHONE='+15555550199' \
     pnpm --filter @workspace/scripts run seed-reviewer-driver
   ```
   The script (`scripts/src/seed-reviewer-driver.ts`) is idempotent: it
   creates the Supabase auth user if missing and inserts/refreshes a fully
   approved driver row (`status='active'`, `background_check_passed=true`,
   all service-type capabilities on) so the reviewer skips the application
   flow.
3. Paste the phone + OTP into App Store Connect's Sign-in Information
   fields and the body of `reviewer-notes.md` into the Notes field.

This is the only safe path — a hard-coded "review mode" backdoor in the
client would itself be grounds for rejection.

In-app legal routes (publicly reachable over HTTPS via the deployed driver
app domain, so they satisfy App Store Connect's Privacy / EULA / Support
URL fields even before mycarconcierge.com hosts them):

- `/legal/privacy` — `artifacts/driver/src/screens/legal/PrivacyScreen.tsx`
- `/legal/terms` — `artifacts/driver/src/screens/legal/TermsScreen.tsx`
- `/legal/support` — `artifacts/driver/src/screens/legal/SupportScreen.tsx`

Links are wired from `SignInScreen` (footer), `ApplicationScreen`
(submission consent text), and `SettingsScreen` (Legal & About card).

## Error monitoring (Sentry)

- **Driver app** uses `@sentry/capacitor` (which wraps `@sentry/react`) via
  `artifacts/driver/src/services/telemetry/sentry.ts`. `initSentry()` is
  invoked from `main.tsx` before `App` mounts. User context is set to the
  driver id only (never PII) from `AuthProvider`, cleared on sign-out.
- **API server** uses `@sentry/node` via
  `artifacts/api-server/src/lib/sentry.ts`. `initSentry()` runs as the first
  side-effect in `src/index.ts`. The Express error handler is wired through
  `Sentry.setupExpressErrorHandler(app)` after the route layer, with a
  fallback JSON 500 handler so callers still get a clean response.
  `unhandledRejection` and `uncaughtException` are also captured.
- **PII scrubbing** — both SDKs share a `beforeSend` / `beforeBreadcrumb`
  hook that strips `phone`, `email`, `name`, `Authorization`, `Cookie`,
  `access_token`, `refresh_token`, `password` and similar keys from event
  request/data/extra/contexts before delivery.
- **Smoke tests** — driver: `Settings → Debug → Trigger client error`
  (visible only in `import.meta.env.DEV` builds). API: `GET /api/_debug/throw`
  (open in non-production; in production requires `x-api-key` matching
  `DISPATCH_API_KEY`, same lock-down pattern as `/api/dev/push-test`).
  Both paths produce a real exception when a DSN is configured.
- **Build externals** — the API server bundle no longer externalizes
  `@opentelemetry/*` (esbuild bundles them now), so `@sentry/node`'s
  Otel-based auto-instrumentation works without extra runtime installs.
  `lib/db` now declares `@opentelemetry/api` so drizzle-orm's optional
  Otel peer resolves to a single copy across the workspace (avoids the
  duplicate-drizzle TS2345 we hit when Sentry was first added).
- **Release tagging** — both apps auto-generate a release tag of
  `<pkgName>@<pkgVersion>+<gitShortSha>` at build time
  (driver: `vite.config.ts` `resolveRelease()`; API: `lib/sentry.ts`
  `resolveRelease()`). Env overrides (`SENTRY_RELEASE` / `VITE_SENTRY_RELEASE`)
  still win, and the computation falls back gracefully when git is unavailable.
- **Source maps** — `artifacts/driver/vite.config.ts` wires
  `@sentry/vite-plugin` with `sourcemap: true` in the build output.
  Source-map upload runs only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and
  `SENTRY_PROJECT` are all set (CI / Mac build); otherwise the plugin
  disables itself but the release id is still injected into the bundle so
  later out-of-band uploads attach cleanly.
- **Driver init ordering** — `main.tsx` imports only `./bootstrap`, which
  runs `initSentry()` before the dynamic `await import('./renderApp')`.
  This guarantees the SDK is live before the `App` module graph evaluates,
  so import-time errors inside `App` are still captured.
- **API request identity** — `lib/sentry.ts` exports
  `setSentryRequestIdentity({ userId, driverId })`, which sets the user id
  and a `driver_id` tag on the per-request isolation scope.
  `routes/rides.ts` calls it inside `requireUserAuth` (Supabase user) and
  `resolveCallerDriver` (driver row) so any error captured later in the
  request lifecycle is grouped against the right account — ids only, no PII.

## Visual-regression tests (driver app)

Lightweight Playwright snapshot suite guards the driver app's
editorial look-and-feel. Lives in `artifacts/driver/tests/`.

- `pnpm --filter @workspace/driver run test:visual` — compare to baselines
- `pnpm --filter @workspace/driver run test:visual:update` — refresh baselines after an intentional visual change
- Requires the `artifacts/driver: web` workflow running (hits `localhost:80/driver/*`)
- Covers Sign In, Application, Pending, Privacy, Terms, Support — both light + dark themes via `?theme=` deep-link
- Baselines committed under `tests/visual.spec.ts-snapshots/`; transient `test-results/` + `playwright-report/` are gitignored
- Auth-gated screens (Home / Earnings / Navigate / RideComplete) are NOT covered — see `artifacts/driver/tests/README.md` for the two options to add them later (an `E2E_AUTH_BYPASS` build flag, or programmatic Supabase test-OTP login)
- System deps required for Chromium headless on Replit (already installed): `glib`, `nss`, `nspr`, `dbus`, `atk`, `at-spi2-atk`, `at-spi2-core`, `cups`, `libdrm`, `expat`, `mesa`, `libGL`, `libgbm`, `pango`, `cairo`, `alsa-lib`, plus various xorg libs.

## Network resilience (offline / flaky signal)

- **Network status hook** — `artifacts/driver/src/hooks/useNetworkStatus.ts` exposes a singleton subscription that prefers the Capacitor Network plugin on native iOS and falls back to `navigator.onLine` + browser `online`/`offline` events on web. Also exports `getNetworkStatus()` for one-shot reads and `onNetworkRestored()` for offline → online edge callbacks.
- **OfflineBanner** — `artifacts/driver/src/components/OfflineBanner.tsx` (mounted in `App.tsx`) shows a red "You're offline" bar while disconnected and a 2.5 s green "Back online" flash on reconnect. Respects `env(safe-area-inset-top)`.
- **NetworkResyncBridge** — `artifacts/driver/src/components/NetworkResyncBridge.tsx` (mounted in `App.tsx`) listens for `onNetworkRestored`, invalidates every TanStack Query, and calls `supabase.realtime.connect()` to close any websocket back-off gap so missed ride offers / cancellations arrive within ~10 s of reconnect.
- **TanStack Query defaults** — `QueryProvider.tsx`: `retry: 2` with exp-backoff (cap 8 s), `retryOnMount: true`, `refetchOnReconnect: true`, `staleTime: 30s`, `networkMode: 'offlineFirst'` (renders cached data while offline rather than holding spinners). Mutations: `retry: 1` with same backoff.
- **Location broadcast pause** — `LocationTracker.tsx` checks `getNetworkStatus().online` inside its broadcast interval and skips the POST while offline. The watch keeps recording fixes locally; the next tick after reconnect pushes the latest position.
- **Realtime auto-reconnect** — `supabase-js` keeps its own heartbeat / back-off, and `NetworkResyncBridge` nudges it on the offline → online edge. Existing `useRideRequests` / `useRideCancellation` subscriptions bind to the live socket via `realtimeManager`, so they pick up where they left off without remount.
- **Out of scope** (deferred): full offline-first queued mutations, map tile caching.

## Remote kill switch & forced update

Single-row `app_config` table (id = `'global'`) drives a server-side kill switch
that can block outdated builds and surface an outage banner without a redeploy.

- **Schema** — `app_config` in `lib/db/src/schema/index.ts`
  (`minSupportedVersion`, `latestVersion`, `outageMessage`, `appStoreUrl`,
  `updatedAt`, `updatedBy`). Push with `pnpm --filter @workspace/db run push`.
- **Public endpoint** — `GET /api/app/status` (no auth) returns the four
  fields with `Cache-Control: public, max-age=60`. Fail-soft: if the row is
  missing or the DB errors, the server returns permissive defaults
  (`minSupportedVersion: "0.0.0"`, no outage) so a DB blip can never lock
  every driver out of the app.
- **Admin endpoints** — `GET/PUT /api/admin/app-config` (admin Supabase
  Bearer). PUT body validated with Zod (semver regex on the version fields,
  optional outage text + App Store URL).
- **Admin UI** — `artifacts/admin/src/pages/AppConfig.tsx`, mounted at
  `/app-config` and linked from the existing top-tab nav.
- **Driver client** — `services/appStatus/` (fetch + zustand store + semver
  compare + version resolver via Capacitor `App.getInfo()` on native,
  `__APP_VERSION__` Vite define on web), `components/AppStatusBridge.tsx`
  wraps `<Routes>` in `App.tsx`. On launch and on app resume
  (`appStateChange` on native, `visibilitychange` on web) it re-fetches
  `/api/app/status`. When `currentVersion < minSupportedVersion` AND both
  are known (never on the cold first frame), it renders the full-screen
  `ForcedUpdateScreen` over the entire router; the single CTA opens the
  App Store via `window.open(_blank)` (works for `apps.apple.com` URLs
  on both web and Capacitor iOS).
- **Outage banner** — `components/OutageBanner.tsx` is mounted alongside
  `OfflineBanner`; self-hides when `outageMessage` is null, uses
  `colors.warning` (amber) so it's visually distinct from the red offline
  banner.
- **Propagation latency** — up to ~60 s (server cache) + client refetch
  interval. "Resume to re-fetch" makes the worst case for an already-open
  app the next foreground.
- **Out of scope** — full feature-flag system, per-driver targeting, soft
  "update available" nudge UI.

## Production deployment

End-to-end runbook lives in `docs/deployment.md` (managed Postgres provisioning + schema push, API server deploy + required secrets, iOS prod/staging build env vars, smoke-test loop, rollback, secret rotation). Quick pointers:

- **API base URL** is resolved at build time via `VITE_API_BASE_URL` in `artifacts/driver/src/services/api/baseUrl.ts`. All driver-app `fetch('/api/...')` calls go through `apiUrl()` so a single code path serves web (relative URLs) and native iOS (absolute prod/staging origin).
- **Env separation**: `VITE_APP_ENV` (`production` | `staging` | `development`) drives `EnvBadge.tsx`, a fixed corner badge rendered in any non-production build. Prevents QA from confusing a staging device for a prod one.
- **Split-write strategy stays intact in prod** — Drizzle ORM against managed Postgres for transactional writes, Supabase HTTPS admin client for realtime mirroring. Do NOT collapse to a single DB — direct Postgres from Replit to Supabase is blocked.
- **One-time Supabase prod setup**: `ALTER PUBLICATION supabase_realtime ADD TABLE driver_assignments;` and `ADD TABLE rides;` (script: `scripts/sql/enable-rides-realtime.sql`).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
