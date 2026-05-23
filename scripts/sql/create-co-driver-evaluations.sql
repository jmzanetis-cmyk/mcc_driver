-- ============================================================
-- MCC — Co-driver evaluation table + co_driver_rating column
-- ============================================================

CREATE TABLE IF NOT EXISTS co_driver_evaluations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id           UUID        NOT NULL,
  evaluator_id      UUID        NOT NULL REFERENCES drivers(id),
  evaluatee_id      UUID        REFERENCES drivers(id),
  communication     SMALLINT    NOT NULL CHECK (communication BETWEEN 1 AND 5),
  punctuality       SMALLINT    NOT NULL CHECK (punctuality BETWEEN 1 AND 5),
  safety            SMALLINT    NOT NULL CHECK (safety BETWEEN 1 AND 5),
  professionalism   SMALLINT    NOT NULL CHECK (professionalism BETWEEN 1 AND 5),
  comment           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ride_id, evaluator_id)
);

CREATE INDEX IF NOT EXISTS idx_codriver_eval_evaluatee ON co_driver_evaluations(evaluatee_id);
CREATE INDEX IF NOT EXISTS idx_codriver_eval_ride      ON co_driver_evaluations(ride_id);

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS co_driver_rating NUMERIC(3,2);

-- RLS
ALTER TABLE co_driver_evaluations ENABLE ROW LEVEL SECURITY;
-- Drivers can insert their own evaluations
CREATE POLICY "driver insert own codriver eval"
  ON co_driver_evaluations FOR INSERT
  TO authenticated
  WITH CHECK (evaluator_id = (SELECT id FROM drivers WHERE user_id = auth.uid() LIMIT 1));
-- Drivers can read evaluations where they are the evaluatee
CREATE POLICY "driver read own codriver evals"
  ON co_driver_evaluations FOR SELECT
  TO authenticated
  USING (evaluatee_id = (SELECT id FROM drivers WHERE user_id = auth.uid() LIMIT 1));
