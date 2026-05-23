-- ============================================================
-- safety_alerts table
-- ============================================================

CREATE TABLE IF NOT EXISTS safety_alerts (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID         NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  ride_id     UUID         REFERENCES rides(id) ON DELETE SET NULL,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  alert_type  TEXT         NOT NULL CHECK (alert_type IN ('panic', 'share_trip')),
  status      TEXT         NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  share_token TEXT         UNIQUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS safety_alerts_driver_id_idx ON safety_alerts (driver_id, created_at DESC);

-- Add emergency_contact_phone to drivers (optional — stored by driver in settings)
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
