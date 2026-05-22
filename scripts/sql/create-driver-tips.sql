-- ============================================================
-- driver_tips table
-- ============================================================
-- Stores tips processed through Stripe on behalf of drivers.
-- One row per tip transaction; a ride can have at most one tip
-- (enforced by the unique index below).
-- ============================================================

CREATE TABLE IF NOT EXISTS driver_tips (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id             UUID         NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id           UUID         NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  amount              NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  stripe_transfer_id  TEXT,
  status              TEXT         NOT NULL DEFAULT 'completed'
                        CHECK (status IN ('completed', 'failed')),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One tip per ride
CREATE UNIQUE INDEX IF NOT EXISTS driver_tips_ride_id_key
  ON driver_tips (ride_id);

-- Fast lookup by driver
CREATE INDEX IF NOT EXISTS driver_tips_driver_id_idx
  ON driver_tips (driver_id);
