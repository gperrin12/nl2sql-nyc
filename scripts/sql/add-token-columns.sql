-- Token + cost columns for nl2sql.query_runs (see lib/add-token-logging.ts)
ALTER TABLE nl2sql.query_runs
  ADD COLUMN IF NOT EXISTS tokens_used JSONB,
  ADD COLUMN IF NOT EXISTS cost_usd FLOAT;
