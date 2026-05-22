-- ============================================================
-- ride_messages table
-- ============================================================
-- Stores in-ride chat messages between driver and member.
-- Supabase Realtime broadcasts INSERTs to both parties
-- so messages appear instantly without polling.
-- ============================================================

CREATE TABLE IF NOT EXISTS ride_messages (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID         NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  sender_id   TEXT         NOT NULL,  -- auth user_id or 'system'
  sender_role TEXT         NOT NULL CHECK (sender_role IN ('driver', 'member', 'system')),
  body        TEXT         NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ride_messages_ride_id_idx
  ON ride_messages (ride_id, created_at);

-- Enable Realtime so the driver app receives new messages instantly
ALTER PUBLICATION supabase_realtime ADD TABLE ride_messages;
