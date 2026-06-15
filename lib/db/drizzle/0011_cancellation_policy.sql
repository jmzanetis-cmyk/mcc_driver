ALTER TABLE "drivers" ADD COLUMN "timeout_until" timestamp with time zone;
ALTER TABLE "drivers" ADD COLUMN "cancel_strike_count" integer NOT NULL DEFAULT 0;
