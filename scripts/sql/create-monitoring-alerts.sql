-- Regression monitoring alerts (scripts/regression-check.ts). Safe to re-run.
CREATE SCHEMA IF NOT EXISTS nl2sql;

CREATE TABLE IF NOT EXISTS nl2sql.monitoring_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alert_type TEXT NOT NULL,
  baseline_avg NUMERIC,
  current_avg NUMERIC,
  baseline_count INTEGER,
  current_count INTEGER,
  drop_pct NUMERIC,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  message TEXT
);

CREATE INDEX IF NOT EXISTS monitoring_alerts_created_at_idx
  ON nl2sql.monitoring_alerts (created_at DESC);

COMMENT ON TABLE nl2sql.monitoring_alerts IS
  'Judge-score regression alerts from scripts/regression-check.ts';
