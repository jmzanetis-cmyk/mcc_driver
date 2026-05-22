-- ============================================================
-- driver_notifications table
-- ============================================================
-- Stores in-app notifications for driver-facing events.
-- Enable Realtime so the bell badge updates live.
-- ============================================================

CREATE TABLE IF NOT EXISTS driver_notifications (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID         NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  type        TEXT         NOT NULL,   -- e.g. 'payout_success', 'tip_received', 'rating_received', 'ride_request', 'system'
  title       TEXT         NOT NULL,
  body        TEXT         NOT NULL,
  data        JSONB,
  read        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS driver_notifications_driver_id_idx
  ON driver_notifications (driver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS driver_notifications_unread_idx
  ON driver_notifications (driver_id, read)
  WHERE read = FALSE;

ALTER PUBLICATION supabase_realtime ADD TABLE driver_notifications;
