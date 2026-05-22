-- Run once in psql (tunnel or on server). Safe to re-run.
ALTER TABLE nl2sql.query_runs
  ADD COLUMN IF NOT EXISTS app_version TEXT;

COMMENT ON COLUMN nl2sql.query_runs.app_version IS
  'Deploy / iteration label (APP_VERSION env, e.g. git sha or release name)';

CREATE INDEX IF NOT EXISTS query_runs_app_version_created_at_idx
  ON nl2sql.query_runs (app_version, created_at DESC);

-- Optional: backfill existing rows
-- UPDATE nl2sql.query_runs SET app_version = 'legacy' WHERE app_version IS NULL;
