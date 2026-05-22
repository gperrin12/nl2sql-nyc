import type { AgentStreamPayload } from "@/lib/sql-agent/types";
import { getAppVersion } from "@/lib/app-version";
import { getPgPool, isDatabaseConfigured } from "@/lib/db";

export type QueryRunInsert = {
  question: string;
  sql: string;
  model?: string | null;
  backend?: string | null;
  executionId?: string | null;
  athenaState: string;
  errorReason?: string | null;
  scannedBytes?: number | null;
  runtimeMs?: number | null;
  rowCount?: number | null;
  trace?: AgentStreamPayload[] | null;
  /** Defaults to getAppVersion() when omitted. */
  appVersion?: string | null;
};

export type QueryRunRow = {
  id: string;
  created_at: string;
  question: string;
  sql: string;
  model: string | null;
  backend: string | null;
  execution_id: string | null;
  athena_state: string | null;
  error_reason: string | null;
  scanned_bytes: string | null;
  runtime_ms: number | null;
  row_count: number | null;
  judge_overall: string | null;
  app_version: string | null;
};

/** Persist one completed (or failed) query run. No-op if DATABASE_URL is unset. */
export async function insertQueryRun(input: QueryRunInsert): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;

  const pool = getPgPool();
  if (!pool) return null;

  const traceJson =
    input.trace && input.trace.length > 0 ? JSON.stringify(input.trace) : null;
  const appVersion = (input.appVersion ?? getAppVersion()).slice(0, 128);

  const result = await pool.query<{ id: string }>(
    `INSERT INTO nl2sql.query_runs (
      question, sql, model, backend, execution_id, athena_state,
      error_reason, scanned_bytes, runtime_ms, row_count, trace_json, app_version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
    RETURNING id`,
    [
      input.question.trim(),
      input.sql.trim(),
      input.model ?? null,
      input.backend ?? null,
      input.executionId ?? null,
      input.athenaState,
      input.errorReason ?? null,
      input.scannedBytes ?? null,
      input.runtimeMs ?? null,
      input.rowCount ?? null,
      traceJson,
      appVersion,
    ]
  );

  return result.rows[0]?.id ?? null;
}

/** Recent runs for dashboard / debugging. */
export async function listQueryRuns(
  limit = 50,
  options?: { appVersion?: string }
): Promise<QueryRunRow[]> {
  if (!isDatabaseConfigured()) return [];

  const pool = getPgPool();
  if (!pool) return [];

  const safeLimit = Math.min(Math.max(1, limit), 200);
  const versionFilter = options?.appVersion?.trim();

  const result = versionFilter
    ? await pool.query<QueryRunRow>(
        `SELECT
          id::text,
          created_at::text,
          question,
          sql,
          model,
          backend,
          execution_id,
          athena_state,
          error_reason,
          scanned_bytes::text,
          runtime_ms,
          row_count,
          judge_overall::text,
          app_version
        FROM nl2sql.query_runs
        WHERE app_version = $1
        ORDER BY created_at DESC
        LIMIT $2`,
        [versionFilter, safeLimit]
      )
    : await pool.query<QueryRunRow>(
        `SELECT
          id::text,
          created_at::text,
          question,
          sql,
          model,
          backend,
          execution_id,
          athena_state,
          error_reason,
          scanned_bytes::text,
          runtime_ms,
          row_count,
          judge_overall::text,
          app_version
        FROM nl2sql.query_runs
        ORDER BY created_at DESC
        LIMIT $1`,
        [safeLimit]
      );

  return result.rows;
}
