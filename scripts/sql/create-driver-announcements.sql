-- ============================================================
-- driver_announcements — platform-wide broadcasts to all drivers
-- driver_announcement_reads — per-driver read tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS driver_announcements (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT         NOT NULL,
  body         TEXT         NOT NULL,
  type         TEXT         NOT NULL DEFAULT 'news',
  -- ^ 'news' | 'tip' | 'event' | 'recognition'
  published_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  active       BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_announcement_reads (
  announcement_id UUID        NOT NULL REFERENCES driver_announcements(id) ON DELETE CASCADE,
  driver_id       UUID        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, driver_id)
);

CREATE INDEX IF NOT EXISTS driver_ann_reads_driver_idx ON driver_announcement_reads (driver_id);

-- Seed one welcome announcement so the inbox isn't empty on first launch
INSERT INTO driver_announcements (title, body, type)
VALUES (
  'Welcome to MCC Driver',
  'Thanks for being part of the My Car Concierge driver community. This inbox is where you''ll receive platform updates, earnings tips, event invites, and recognition from the team.',
  'news'
) ON CONFLICT DO NOTHING;
