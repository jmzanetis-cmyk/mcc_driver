-- ============================================================
-- ride_ratings table + drivers rolling-average columns
-- ============================================================

CREATE TABLE IF NOT EXISTS ride_ratings (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID         NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  rater_id    TEXT         NOT NULL,   -- auth user_id of the person rating
  rater_role  TEXT         NOT NULL CHECK (rater_role IN ('driver', 'member', 'admin')),
  rated_id    TEXT         NOT NULL,   -- auth user_id of the person being rated
  rated_role  TEXT         NOT NULL CHECK (rated_role IN ('driver', 'member')),
  stars       SMALLINT     NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One rating per rater per ride (a driver can't rate the same member twice)
CREATE UNIQUE INDEX IF NOT EXISTS ride_ratings_rater_ride_key
  ON ride_ratings (ride_id, rater_id);

CREATE INDEX IF NOT EXISTS ride_ratings_rated_id_idx
  ON ride_ratings (rated_id);

-- Add total_ratings to drivers if it doesn't exist (average_rating already exists)
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS total_ratings INTEGER NOT NULL DEFAULT 0;
