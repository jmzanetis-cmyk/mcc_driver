-- ============================================================
-- Driver Training Schema
-- Execute in Supabase SQL editor (service_role access required).
-- RLS is enabled on all tables but no policies are created —
-- all access goes through the API server's service_role key.
-- ============================================================

-- ── training_modules ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_modules (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT         NOT NULL UNIQUE,
  title             TEXT         NOT NULL,
  description       TEXT         NOT NULL,
  tier_required     INTEGER      NOT NULL DEFAULT 0,  -- 0 = always unlocked
  sort_order        INTEGER      NOT NULL DEFAULT 0,
  estimated_minutes INTEGER      NOT NULL DEFAULT 30,
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE training_modules ENABLE ROW LEVEL SECURITY;

-- Seed modules
INSERT INTO training_modules (slug, title, description, tier_required, sort_order, estimated_minutes)
VALUES
  ('platform-basics',      'Platform Basics',         'Learn how MCC works, how to get paid, and how to set up your profile.',                          0, 1, 25),
  ('passenger-rides',      'Passenger Rides',         'Master pickup etiquette, safe driving, and handling difficult passenger situations.',             1, 2, 35),
  ('solo-vehicle-shuttle', 'Solo Vehicle Shuttle',    'Learn to safely transport member vehicles, document condition, and handle emergencies.',          2, 3, 40),
  ('tandem-concierge',     'Tandem & Concierge',      'Coordinate tandem rides with a co-driver and manage full concierge logistics.',                   3, 4, 45),
  ('safety-emergency',     'Safety & Emergency',      'Personal safety protocols, accident procedures, medical emergencies, and de-escalation.',         0, 5, 30),
  ('earnings-business',    'Earnings & Business',     'Maximize your earnings, understand your pay, and manage taxes as an independent contractor.',     0, 6, 25)
ON CONFLICT (slug) DO NOTHING;

-- ── training_lessons ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_lessons (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id    UUID         NOT NULL REFERENCES training_modules(id) ON DELETE CASCADE,
  slug         TEXT         NOT NULL,
  title        TEXT         NOT NULL,
  content_type TEXT         NOT NULL CHECK (content_type IN ('text', 'interactive', 'scenario')),
  content      JSONB        NOT NULL DEFAULT '[]',
  sort_order   INTEGER      NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (module_id, slug)
);

CREATE INDEX IF NOT EXISTS training_lessons_module_id_idx ON training_lessons (module_id, sort_order);
ALTER TABLE training_lessons ENABLE ROW LEVEL SECURITY;

-- ── training_questions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_questions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id       UUID         NOT NULL REFERENCES training_lessons(id) ON DELETE CASCADE,
  question_text   TEXT         NOT NULL,
  question_type   TEXT         NOT NULL CHECK (question_type IN ('multiple_choice', 'true_false', 'scenario')),
  options         JSONB        NOT NULL DEFAULT '[]',  -- [{"key":"A","text":"..."}]
  correct_answer  TEXT         NOT NULL,               -- "A", "B", "true", "false", etc.
  explanation     TEXT         NOT NULL,
  sort_order      INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS training_questions_lesson_id_idx ON training_questions (lesson_id, sort_order);
ALTER TABLE training_questions ENABLE ROW LEVEL SECURITY;

-- ── driver_training_progress ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_training_progress (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    UUID         NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  module_id    UUID         NOT NULL REFERENCES training_modules(id) ON DELETE CASCADE,
  lesson_id    UUID         NOT NULL REFERENCES training_lessons(id) ON DELETE CASCADE,
  status       TEXT         NOT NULL DEFAULT 'not_started'
                              CHECK (status IN ('not_started', 'in_progress', 'completed')),
  score        INTEGER,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (driver_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS driver_training_progress_driver_idx
  ON driver_training_progress (driver_id, module_id);
ALTER TABLE driver_training_progress ENABLE ROW LEVEL SECURITY;

-- ── driver_certifications ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_certifications (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    UUID         NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  module_slug  TEXT         NOT NULL,
  certified_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,
  UNIQUE (driver_id, module_slug)
);

CREATE INDEX IF NOT EXISTS driver_certifications_driver_idx
  ON driver_certifications (driver_id);
ALTER TABLE driver_certifications ENABLE ROW LEVEL SECURITY;
