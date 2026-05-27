-- ============================================================
-- driver_milestones — one-time earned achievement badges
-- ============================================================

CREATE TABLE IF NOT EXISTS driver_milestones (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id  UUID         NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  kind       TEXT         NOT NULL, -- e.g. 'earnings_100', 'rides_10'
  label      TEXT         NOT NULL,
  icon       TEXT         NOT NULL,
  earned_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(driver_id, kind)
);

CREATE INDEX IF NOT EXISTS driver_milestones_driver_id_idx ON driver_milestones (driver_id);

-- Add streak tracking column to driver_promotions
ALTER TABLE driver_promotions ADD COLUMN IF NOT EXISTS streak_last_date DATE;
