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
- Optional env: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_AUTH_KEY`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION` — Apple Push Notification service credentials for the Capacitor iOS build. `APNS_AUTH_KEY` is the full PEM contents of the .p8 file from the Apple Developer console; `APNS_BUNDLE_ID` defaults to `com.mycarconcierge.driver`; set `APNS_PRODUCTION=true` for the App Store / TestFlight build (sandbox otherwise — must match `App.entitlements` `aps-environment`). When unset, `apnsPush.ts` logs a skip and Web Push / Realtime continue to work.

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
- `artifacts/driver/src/services/push/registerNativePush.ts` — Capacitor PushNotifications registration; posts the APNs token to `/api/device-tokens` and listens for taps to deep-link via `data.url`
- `scripts/src/send-test-push.ts` — smoke test (`pnpm --filter @workspace/scripts run send-test-push -- --driver <id>`) that hits `POST /api/dev/push-test`; use to verify delivery in foreground / background / killed states on a real device.
- `artifacts/driver/ios/README.md` — Mac-side build, signing, and Xcode workflow

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
