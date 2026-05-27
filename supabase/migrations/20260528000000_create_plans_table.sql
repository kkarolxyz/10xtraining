CREATE TABLE plans (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT         NOT NULL,
  goal        TEXT         NOT NULL CHECK (goal IN ('speed', 'distance')),
  ride_stats  TEXT         NOT NULL,
  plan        JSONB        NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plans_select_own"
  ON plans FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "plans_insert_own"
  ON plans FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "plans_delete_own"
  ON plans FOR DELETE
  USING (auth.uid() = user_id);
