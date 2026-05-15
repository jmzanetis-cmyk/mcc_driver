# MCC Driver

A real-time driver portal for My Car Concierge — a premium vehicle concierge service. Drivers receive ride requests in real time, accept or decline them, and navigate through the full ride lifecycle from pickup to completion.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/driver run dev` — run the driver web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — Supabase project credentials (driver app)
- Optional env: `DISPATCH_API_KEY` — allows unauthenticated dispatch calls via `x-api-key` header

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Driver app: React + Vite, Zustand, TanStack Query, Supabase JS client
- API: Express 5, Drizzle ORM
- DB: PostgreSQL (Supabase) + Drizzle ORM
- Realtime: Supabase Realtime (postgres_changes on driver_assignments)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/index.ts` — Drizzle ORM schema: drivers, rides, driver_assignments, driver_payouts
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth for API shape)
- `artifacts/api-server/src/routes/rides.ts` — Ride dispatch, accept, decline, stage update, complete
- `artifacts/api-server/src/lib/scenarioConfig.ts` — Server-side ride scenario definitions
- `artifacts/driver/src/hooks/useRideRequests.ts` — Supabase Realtime subscription for live ride requests
- `artifacts/driver/src/services/api/edgeFunctions.ts` — API server calls (accept, decline, stage, complete)
- `artifacts/driver/src/store/dispatchStore.ts` — Zustand store for ride lifecycle state
- `artifacts/driver/src/screens/RideRequestScreen.tsx` — Ride request modal (RideRequestModal component)
- `artifacts/driver/src/screens/NavigateScreen.tsx` — Active ride navigation screen

## Architecture decisions

- **Supabase Realtime for push delivery**: The driver app subscribes to `postgres_changes` on the `driver_assignments` table filtered by `driver_id`. When the API server inserts a new assignment row, Supabase fires the event to all subscribed drivers within seconds — no polling.
- **API server for state transitions**: All ride mutations (accept, decline, stage update, complete) go through the API server rather than direct client updates. This enables atomic accept with deadline checking and prevents race conditions where two drivers accept simultaneously.
- **Zustand dispatch store as single source of truth**: The entire ride lifecycle state (idle → offered → accepted → navigating → arrived → in_progress → completing → completed) lives in a single Zustand store, shared between HomeScreen, NavigateScreen, and RideCompleteScreen without prop drilling.
- **Dual DB access**: The driver app reads/writes Supabase Postgres directly for auth-adjacent data (driver profile, earnings). The API server uses Drizzle ORM via `DATABASE_URL` pointing to the same Postgres for transactional ride operations.
- **SCENARIO_CONFIG mirrored on client and server**: The ride scenario definitions (which role drives the member vehicle, how many drivers required, etc.) exist in both `artifacts/driver/src/services/rides/index.ts` and `artifacts/api-server/src/lib/scenarioConfig.ts` to avoid a cross-artifact dependency.

## Product

Drivers sign in with Supabase phone auth, submit a background check application, and once approved can go online to receive ride requests. When a ride is dispatched, online drivers receive a modal popup with a countdown timer. Accepting navigates the driver through: en route → arrived at pickup → ride in progress → complete. Drivers see earnings dashboards, can request instant payouts, and have an AI assistant for support.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Database schema status

All four tables are confirmed present in Supabase Postgres (verified 2026-05-14):
- `drivers` — driver profiles, status, location, payout info
- `rides` — ride records with scenario, fare, pickup/dropoff
- `driver_assignments` — links drivers to rides with status/deadline
- `driver_payouts` — payout requests and transfer records

`pnpm --filter @workspace/db run push` returned "No changes detected" (schema in sync).

**Supabase Realtime** must be manually enabled for `driver_assignments` in the
Supabase dashboard (Table Editor → Realtime toggle). Without it, drivers will not
receive live ride offers even though the API correctly inserts the assignment row.

**DATABASE_URL vs Supabase Postgres**: In Replit dev, `DATABASE_URL` points to
Replit's built-in Postgres (`heliumdb`), which is a separate database from the
Supabase Postgres that Supabase Realtime watches. For production or to test
Realtime end-to-end, `DATABASE_URL` must be set to the Supabase direct connection
string (Project → Settings → Database → Connection string → URI). Until then,
the API server and driver app use different databases — rides created by the API
won't fire Realtime events to the driver app.

**Dispatch eligibility requirements** (discovered during smoke testing):
- Driver `status` must be `'active'` (not `'approved'` or `'pending_approval'`)
- `is_online` must be `true`
- `current_lat` and `current_lng` must both be non-null

Run `pnpm --filter @workspace/scripts run smoke-dispatch` (with API server running)
to verify the full dispatch path — it inserts a test driver, fires dispatch,
confirms DB rows, then cleans up automatically. Realtime delivery is checked
as a WARN (not a failure) when DATABASE_URL doesn't point to Supabase Postgres.

## Gotchas

- After changing `lib/db/src/schema/index.ts`, run `pnpm --filter @workspace/db run push` to apply schema changes to the database.
- After changing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` to regenerate types and hooks.
- Supabase Realtime only fires for tables that have Realtime enabled in the Supabase dashboard. The `driver_assignments` table must have Realtime enabled for live ride delivery to work.
- The API server uses `DATABASE_URL` to connect directly to the Supabase Postgres database — this is the same DB the Supabase JS client reads from, so writes from the API server trigger Realtime events.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
