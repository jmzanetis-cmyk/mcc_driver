-- ============================================================
-- support_tickets table
-- ============================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID         NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  subject     TEXT         NOT NULL,
  description TEXT         NOT NULL,
  status      TEXT         NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS support_tickets_driver_id_idx ON support_tickets (driver_id, created_at DESC);
