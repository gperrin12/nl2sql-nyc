-- Guardrail/repair attempt log (lib/sql-agent/ensure-guarded-sql.ts). Safe to re-run.
CREATE SCHEMA IF NOT EXISTS nl2sql;

CREATE TABLE IF NOT EXISTS nl2sql.repair_attempts (
  id BIGSERIAL PRIMARY KEY,
  query_run_id UUID,
  question TEXT NOT NULL,
  attempt_number INT NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  sql_attempted TEXT NOT NULL,
  repair_succeeded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS repair_attempts_error_type_created_at
  ON nl2sql.repair_attempts (error_type, created_at DESC);

CREATE INDEX IF NOT EXISTS repair_attempts_question_created_at
  ON nl2sql.repair_attempts (question, created_at DESC);

COMMENT ON TABLE nl2sql.repair_attempts IS
  'Guardrail/repair attempts from ensureGuardedSqlV2; powers circuit breaker + adversarial eval stats';
