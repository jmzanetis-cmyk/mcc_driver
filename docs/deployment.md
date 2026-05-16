# Production Deployment Runbook

This runbook covers deploying the **MCC API server** and the **MCC Driver app** (web + iOS Capacitor build) to a real production environment. The dev workflow runs everything against ephemeral Replit infra; production needs a managed Postgres and a stable HTTPS URL.

---

## Architecture overview (prod)

```
            +--------------------+         +--------------------------+
 iOS app    |  Capacitor webview |  HTTPS  |  api.mycarconcierge.com  |
 (App Store)|  bundles driver SPA|-------->|  Express + Drizzle ORM   |
            +--------------------+         +-----------+--------------+
                                                       |
                                  Drizzle (TCP / SSL)  |
                                                       v
                                            +----------------------+
                                            |  Managed Postgres    |
                                            |  (transactional DB)  |
                                            +----------------------+

                            Supabase HTTPS (service-role key) — realtime bus only
                            (driver_assignments INSERT, rides UPDATE for cancels)
```

The **split-write strategy** documented in `replit.md` is intentional and stays the same in prod: transactional writes go to managed Postgres via Drizzle; realtime notification mirroring goes to Supabase via HTTPS. Do not "simplify" by pointing Drizzle at Supabase — direct Postgres connections from Replit's network to Supabase are blocked.

---

## 1. Managed production Postgres

We support any managed Postgres (Replit Deployments Postgres, Neon, Supabase Postgres, RDS, etc.). The DB must:

1. Be reachable over TLS from the API server deployment.
2. Have a `DATABASE_URL` connection string available as a secret.
3. Have a recurring backup configured (daily snapshot retention ≥ 7 days).

### Provision

1. Stand up the managed instance.
2. Capture the connection string and store it as the `DATABASE_URL` secret in the **production deployment** (NOT in the dev workspace — keep dev and prod URLs separate).

### Apply schema

From a machine with `DATABASE_URL` pointing at prod:

```bash
DATABASE_URL='postgres://…prod…' pnpm --filter @workspace/db run push
```

This applies `lib/db/src/schema/index.ts` via `drizzle-kit push`. Verify the four tables exist:

```sql
SELECT tablename FROM pg_tables
WHERE schemaname='public'
  AND tablename IN ('drivers','rides','driver_assignments','driver_payouts')
ORDER BY tablename;
```

### One-time post-push setup

These items are not part of the Drizzle schema and must be run by hand once:

* The `driver_assignments` unique partial index for one pending row per (ride, role) — auto-applied by `db push`, verify it exists.
* Realtime publications on the **Supabase project** (not prod Postgres):
  ```sql
  ALTER PUBLICATION supabase_realtime ADD TABLE driver_assignments;
  ALTER PUBLICATION supabase_realtime ADD TABLE rides;
  ```
  Script: `scripts/sql/enable-rides-realtime.sql`.

---

## 2. Deploy the API server

### Build

```bash
pnpm --filter @workspace/api-server run build
```

Outputs `dist/index.mjs` (esbuild ESM bundle). The container start command is:

```bash
node --enable-source-maps ./dist/index.mjs
```

### Required production secrets

Set all of these in the deployment's secret store **before first start**:

| Secret | Why |
|---|---|
| `DATABASE_URL` | Managed Postgres (Drizzle ORM target) |
| `VITE_SUPABASE_URL` *(or* `SUPABASE_URL`*)* | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` *(or* `SUPABASE_ANON_KEY`*)* | Supabase anon key for JWT verification |
| `SUPABASE_SERVICE_ROLE_KEY` | Required to mirror writes to Supabase + delete auth users |
| `RESEND_API_KEY` | Transactional email |
| `SESSION_SECRET` | Session/cookie signing |
| `DISPATCH_API_KEY` | **MUST be set in prod** — locks down `/api/dev/push-test` and `/api/_debug/throw` |
| `APP_BASE_URL` | Used in SMS deep links |

### Optional / feature-gated

| Secret | Enables |
|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Tandem SMS notifications |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push |
| `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_AUTH_KEY` / `APNS_BUNDLE_ID` / `APNS_PRODUCTION=true` | iOS native push (production APNs) |
| `SENTRY_DSN` / `SENTRY_ENV=production` / `SENTRY_RELEASE` | Server error monitoring |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe Connect payouts |

### Verify

After first deploy:

```bash
curl -sf https://api.mycarconcierge.com/api/healthz
# → {"ok":true}
```

`/api/_debug/throw` should return 401 without `x-api-key: $DISPATCH_API_KEY`.

---

## 3. Wire the driver app (web + iOS) to prod

The driver app picks its API target from a build-time env var (`VITE_API_BASE_URL`) resolved by `services/api/baseUrl.ts`. There is **one** code path; the URL is the only thing that changes per environment.

### Web build (served from same origin as API — typical Replit deploy)

Leave `VITE_API_BASE_URL` **unset**. The app will use relative `/api/*` URLs that the shared reverse proxy routes to the API service.

### iOS production build (TestFlight / App Store)

On the Mac build machine, set the env vars **before** running `pnpm --filter @workspace/driver run build:ios`:

```bash
export VITE_API_BASE_URL=https://api.mycarconcierge.com
export VITE_APP_ENV=production
export VITE_SUPABASE_URL=…
export VITE_SUPABASE_ANON_KEY=…
export VITE_SENTRY_DSN=…           # optional
pnpm --filter @workspace/driver run build:ios
```

### iOS staging / TestFlight against staging API

```bash
export VITE_API_BASE_URL=https://api-staging.mycarconcierge.com
export VITE_APP_ENV=staging
…
```

The driver app surfaces a corner badge in any build where `VITE_APP_ENV !== 'production'`, so QA can never accidentally ship a staging build to the App Store.

Refer to `artifacts/driver/.env.example` for the canonical list of env vars.

---

## 4. Smoke test

After every prod deploy, run the end-to-end loop:

1. `curl https://api.mycarconcierge.com/api/healthz` → `200 {"ok":true}`.
2. Sign a test driver into the iOS production build, complete the application, admin-approve.
3. From the admin app (also pointed at prod), dispatch a ride to that driver.
4. Driver accepts, transitions through en-route → arrived → in-progress → complete.
5. Verify the `driver_payouts` row materializes in prod Postgres.

If any step fails, **roll back** before investigating (see below) — leaving a half-broken prod deploy live is worse than running the previous build.

---

## 5. Rollback

Replit Deployments keeps the previous build. To roll back:

1. Open the deployment dashboard for `@workspace/api-server`.
2. Select the previous successful build → "Promote to production".
3. The container restarts on the previous `dist/index.mjs` within ~30 s.
4. Verify `/api/healthz` returns 200 and run the smoke loop.

DB rollbacks are out of scope — schema migrations should be **additive** (new nullable columns, new tables). If a destructive change is required, plan a deprecation cycle: ship the additive change first, migrate the data, then ship the removal in a later release.

---

## 6. Logs and observability

| What | Where |
|---|---|
| API server stdout (`pino` JSON) | Deployment dashboard → Logs |
| Driver app errors | Sentry project — see `replit.md` "Error monitoring" |
| API server errors | Sentry project (Node SDK) |
| Supabase Realtime / auth | Supabase dashboard |
| Stripe transfers | Stripe dashboard |

Set `SENTRY_ENV=production` and `VITE_SENTRY_ENV=production` so the two environments stay separated in Sentry.

---

## 7. Secret rotation

| Secret | Rotation procedure |
|---|---|
| `DATABASE_URL` | Rotate password in managed Postgres dashboard → update secret → restart deployment |
| `SUPABASE_SERVICE_ROLE_KEY` | Roll in Supabase dashboard → update secret → restart |
| `VITE_SUPABASE_ANON_KEY` | Roll in Supabase dashboard → update secret on **both** API + Driver → rebuild iOS |
| `DISPATCH_API_KEY` | Generate new value → update secret → restart |
| `APNS_AUTH_KEY` | Generate new .p8 in Apple Developer → update secret → restart |
| `VAPID_*` | Regenerate with `npx web-push generate-vapid-keys` → update secret → existing web subscriptions invalidated (drivers re-register on next sign-in) |
| `STRIPE_SECRET_KEY` | Roll in Stripe dashboard → update secret → restart |
| `SENTRY_DSN` | Generate new DSN in Sentry → update secret on both API + Driver → rebuild iOS |

---

## Out of scope

* Multi-region failover / HA.
* Blue-green deployment automation.
* Schema rework — keep the schema as-is for this rollout.
