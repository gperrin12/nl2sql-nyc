-- Hallucination analytics columns for nl2sql.query_runs (see lib/query-runs-store.ts)
ALTER TABLE nl2sql.query_runs
  ADD COLUMN IF NOT EXISTS hallucinations JSONB,
  ADD COLUMN IF NOT EXISTS hallucination_type TEXT;

-- Allow rows before SQL exists (universal logging at question submit)
ALTER TABLE nl2sql.query_runs
  ALTER COLUMN sql DROP NOT NULL;

CREATE INDEX IF NOT EXISTS query_runs_hallucination_type_idx
  ON nl2sql.query_runs (hallucination_type)
  WHERE hallucination_type IS NOT NULL;

COMMENT ON COLUMN nl2sql.query_runs.hallucinations IS
  'Structured detector output (schema hallucination, etc.); populated by future mechanical detector';
COMMENT ON COLUMN nl2sql.query_runs.hallucination_type IS
  'off_topic | guardrail_blocked | no_sql_produced | schema_hallucination | null on success';
