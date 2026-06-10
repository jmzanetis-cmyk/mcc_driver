# HISTORICAL — DO NOT APPLY TO PRODUCTION

These Drizzle migration files (`0000_*.sql` … `0010_*.sql`) were **never applied to
the live Supabase database** and must not be applied now.

## Why

The live `public.drivers` table (and related tables) was created independently via
the Supabase dashboard, not through Drizzle. Its schema diverges significantly from
these migration files:

| What Drizzle 0000 assumes | What the live DB has |
|---|---|
| `user_id text NOT NULL` | `profile_id uuid NOT NULL` |
| `first_name text`, `last_name text` | `full_name text` |
| No `vehicle_class`, `hourly_rate_cents`, etc. | Those columns exist in production |

Running migration `0000` would fail immediately because the target tables already
exist — and if forced, it would collide destructively with the production schema.

## What to use instead

Schema additions the driver app needs are applied via targeted `ALTER TABLE ADD COLUMN`
scripts in `scripts/sql/`. The current one is:

```
scripts/sql/migrate-forward-drivers-schema.sql
```

That script is idempotent, non-destructive, and safe to run against the live database.

## Status of individual migrations

| File | Status |
|---|---|
| 0000 — initial schema | Never applied — conflicts with live table definitions |
| 0001 – 0010 — incremental changes | Never applied — built on top of 0000 |

If the schema ever needs a proper migration workflow going forward, set up Drizzle
against the **actual** live schema (via `drizzle-kit introspect`) rather than using
these historical files as a baseline.
