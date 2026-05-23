-- ============================================================
-- driver_promotions table
-- ============================================================

CREATE TABLE IF NOT EXISTS driver_promotions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     UUID         NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  type          TEXT         NOT NULL, -- 'streak', 'weekly_challenge', 'bonus'
  title         TEXT         NOT NULL,
  description   TEXT         NOT NULL,
  target_count  INTEGER      NOT NULL,
  current_count INTEGER      NOT NULL DEFAULT 0,
  reward_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  starts_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ends_at       TIMESTAMPTZ,
  status        TEXT         NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS driver_promotions_driver_id_idx ON driver_promotions (driver_id, status);
