-- Base audit table for NL→SQL runs (lib/query-runs-store.ts). Safe to re-run.
CREATE SCHEMA IF NOT EXISTS nl2sql;

CREATE TABLE IF NOT EXISTS nl2sql.query_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  question TEXT NOT NULL,
  sql TEXT,
  model TEXT,
  backend TEXT,
  execution_id TEXT,
  athena_state TEXT,
  error_reason TEXT,
  scanned_bytes BIGINT,
  runtime_ms INTEGER,
  row_count INTEGER,
  judge_overall NUMERIC,
  judge_detail JSONB,
  trace_json JSONB,
  app_version VARCHAR,
  tokens_used JSONB,
  cost_usd DOUBLE PRECISION,
  hallucinations JSONB,
  hallucination_type TEXT,
  prompt_version VARCHAR
);

CREATE INDEX IF NOT EXISTS query_runs_created_at_idx
  ON nl2sql.query_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS query_runs_question_idx
  ON nl2sql.query_runs (question);

CREATE INDEX IF NOT EXISTS query_runs_athena_state_idx
  ON nl2sql.query_runs (athena_state);

CREATE INDEX IF NOT EXISTS query_runs_hallucination_type_idx
  ON nl2sql.query_runs (hallucination_type);

CREATE INDEX IF NOT EXISTS query_runs_prompt_version_created_at_idx
  ON nl2sql.query_runs (prompt_version, created_at DESC);
