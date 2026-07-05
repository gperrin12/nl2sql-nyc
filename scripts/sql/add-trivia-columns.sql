-- Trivia generation metadata on nl2sql.query_runs, so trivia spend/behavior can
-- be measured in the same audit table as nl2sql/RAG runs (see lib/query-run-tokens.ts,
-- lib/trivia-generate-verified.ts). Distinguish trivia rows via backend IN
-- ('trivia-solo', 'trivia-room'). Safe to re-run.
ALTER TABLE nl2sql.query_runs
  ADD COLUMN IF NOT EXISTS trivia_category TEXT,
  ADD COLUMN IF NOT EXISTS trivia_deck TEXT,
  ADD COLUMN IF NOT EXISTS generation_attempts INTEGER;

CREATE INDEX IF NOT EXISTS query_runs_backend_created_at_idx
  ON nl2sql.query_runs (backend, created_at DESC);
