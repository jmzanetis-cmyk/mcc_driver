ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "timeout_until" timestamp with time zone;
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "cancel_strike_count" integer NOT NULL DEFAULT 0;
