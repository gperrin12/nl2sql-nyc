-- Run once: one row per Athena execution_id (avoids duplicates from server + client logging).
CREATE UNIQUE INDEX IF NOT EXISTS query_runs_execution_id_key
  ON nl2sql.query_runs (execution_id)
  WHERE execution_id IS NOT NULL;
