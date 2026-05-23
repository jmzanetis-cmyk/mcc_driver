-- ============================================================
-- scheduled_rides table
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduled_rides (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id         UUID         NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id       UUID         REFERENCES drivers(id) ON DELETE SET NULL,
  scheduled_at    TIMESTAMPTZ  NOT NULL,
  reminder_sent   BOOLEAN      NOT NULL DEFAULT FALSE,
  status          TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'completed')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scheduled_rides_driver_id_idx ON scheduled_rides (driver_id, scheduled_at);
CREATE INDEX IF NOT EXISTS scheduled_rides_status_idx ON scheduled_rides (status, scheduled_at);
