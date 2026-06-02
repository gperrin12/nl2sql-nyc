-- Base table for prompt A/B testing (lib/prompt-versions.ts). Safe to re-run.
CREATE SCHEMA IF NOT EXISTS nl2sql;

CREATE TABLE IF NOT EXISTS nl2sql.prompt_versions (
  version_name TEXT PRIMARY KEY,
  system_prompt TEXT NOT NULL,
  is_production BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS prompt_versions_is_production_created_at_idx
  ON nl2sql.prompt_versions (is_production, created_at DESC);
