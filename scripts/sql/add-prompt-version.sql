-- Run once in psql (tunnel or on server). Safe to re-run.
ALTER TABLE nl2sql.query_runs
  ADD COLUMN IF NOT EXISTS prompt_version TEXT;

COMMENT ON COLUMN nl2sql.query_runs.prompt_version IS
  'Prompt variant label (nl2sql.prompt_versions.version_name) used to generate this run';

CREATE INDEX IF NOT EXISTS query_runs_prompt_version_created_at_idx
  ON nl2sql.query_runs (prompt_version, created_at DESC);
