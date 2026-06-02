-- LLM judge explanation persisted with judge_overall (see lib/judge-detail.ts)
ALTER TABLE nl2sql.query_runs
  ADD COLUMN IF NOT EXISTS judge_detail JSONB;

COMMENT ON COLUMN nl2sql.query_runs.judge_detail IS
  'Judge output: verdict, reasoning, judgedAt, judgeModel (score also on judge_overall)';
