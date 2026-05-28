import type { AgentStreamPayload } from "@/lib/sql-agent/types";
import { getAppVersion } from "@/lib/app-version";
import { getPgPool, isDatabaseConfigured } from "@/lib/db";

function pgErrorCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "code" in e) {
    return String((e as { code: string }).code);
  }
  return undefined;
}

function isUniqueViolation(e: unknown): boolean {
  return pgErrorCode(e) === "23505";
}

export type HallucinationType =
  | "off_topic"
  | "guardrail_blocked"
  | "no_sql_produced"
  | "schema_hallucination";

export type QueryRunInsert = {
  question: string;
  sql?: string | null;
  model?: string | null;
  backend?: string | null;
  executionId?: string | null;
  athenaState: string;
  errorReason?: string | null;
  hallucinationType?: HallucinationType | null;
  hallucinations?: unknown | null;
  scannedBytes?: number | null;
  runtimeMs?: number | null;
  rowCount?: number | null;
  trace?: AgentStreamPayload[] | null;
  /** Defaults to getAppVersion() when omitted. */
  appVersion?: string | null;
};

export type QueryRunUpdate = {
  sql?: string | null;
  model?: string | null;
  backend?: string | null;
  executionId?: string | null;
  athenaState?: string;
  errorReason?: string | null;
  hallucinationType?: HallucinationType | null;
  hallucinations?: unknown | null;
  scannedBytes?: number | null;
  runtimeMs?: number | null;
  rowCount?: number | null;
  trace?: AgentStreamPayload[] | null;
  judgeOverall?: number | null;
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

function normalizeSql(sql: string | null | undefined): string | null {
  if (sql == null) return null;
  const trimmed = sql.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hallucinationsJson(value: unknown | null | undefined): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

/** Log every chat question at request start. No-op if DATABASE_URL is unset. */
export async function beginQueryRun(input: {
  question: string;
  backend?: string | null;
  appVersion?: string | null;
}): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;

  const pool = getPgPool();
  if (!pool) return null;

  const appVersion = (input.appVersion ?? getAppVersion()).slice(0, 128);

  const result = await pool.query<{ id: string }>(
    `INSERT INTO nl2sql.query_runs (
      question, sql, backend, athena_state, app_version
    ) VALUES ($1, NULL, $2, 'PENDING', $3)
    RETURNING id`,
    [input.question.trim(), input.backend ?? null, appVersion]
  );

  return result.rows[0]?.id ?? null;
}

/** Patch an existing query_runs row (all pipeline exit paths). */
export async function updateQueryRun(
  id: string,
  patch: QueryRunUpdate
): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;

  const pool = getPgPool();
  if (!pool) return false;

  const sets: string[] = [];
  const values: unknown[] = [id];
  let n = 2;

  const add = (column: string, value: unknown) => {
    sets.push(`${column} = $${n}`);
    values.push(value);
    n += 1;
  };

  if (patch.sql !== undefined) add("sql", normalizeSql(patch.sql));
  if (patch.model !== undefined) add("model", patch.model);
  if (patch.backend !== undefined) add("backend", patch.backend);
  if (patch.executionId !== undefined) add("execution_id", patch.executionId);
  if (patch.athenaState !== undefined) add("athena_state", patch.athenaState);
  if (patch.errorReason !== undefined) add("error_reason", patch.errorReason);
  if (patch.hallucinationType !== undefined) {
    add("hallucination_type", patch.hallucinationType);
  }
  if (patch.hallucinations !== undefined) {
    sets.push(`hallucinations = $${n}::jsonb`);
    values.push(hallucinationsJson(patch.hallucinations));
    n += 1;
  }
  if (patch.scannedBytes !== undefined) add("scanned_bytes", patch.scannedBytes);
  if (patch.runtimeMs !== undefined) add("runtime_ms", patch.runtimeMs);
  if (patch.rowCount !== undefined) add("row_count", patch.rowCount);
  if (patch.trace !== undefined) {
    const traceJson =
      patch.trace && patch.trace.length > 0 ? JSON.stringify(patch.trace) : null;
    sets.push(`trace_json = $${n}::jsonb`);
    values.push(traceJson);
    n += 1;
  }
  if (patch.judgeOverall !== undefined) {
    add(
      "judge_overall",
      patch.judgeOverall == null ? null : String(patch.judgeOverall)
    );
  }

  if (sets.length === 0) return false;

  const result = await pool.query(
    `UPDATE nl2sql.query_runs SET ${sets.join(", ")} WHERE id = $1`,
    values
  );

  return (result.rowCount ?? 0) > 0;
}

/** Persist LLM judge score (1–5) on a query_runs row. */
export async function updateQueryRunJudge(
  id: string,
  judgeOverall: number
): Promise<boolean> {
  return updateQueryRun(id, { judgeOverall });
}

/** Persist one completed (or failed) query run. No-op if DATABASE_URL is unset. */
export async function insertQueryRun(input: QueryRunInsert): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;

  const pool = getPgPool();
  if (!pool) return null;

  const traceJson =
    input.trace && input.trace.length > 0 ? JSON.stringify(input.trace) : null;
  const appVersion = (input.appVersion ?? getAppVersion()).slice(0, 128);
  const hallucinations = hallucinationsJson(input.hallucinations);

  const result = await pool.query<{ id: string }>(
    `INSERT INTO nl2sql.query_runs (
      question, sql, model, backend, execution_id, athena_state,
      error_reason, hallucination_type, hallucinations,
      scanned_bytes, runtime_ms, row_count, trace_json, app_version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13::jsonb, $14)
    RETURNING id`,
    [
      input.question.trim(),
      normalizeSql(input.sql),
      input.model ?? null,
      input.backend ?? null,
      input.executionId ?? null,
      input.athenaState,
      input.errorReason ?? null,
      input.hallucinationType ?? null,
      hallucinations,
      input.scannedBytes ?? null,
      input.runtimeMs ?? null,
      input.rowCount ?? null,
      traceJson,
      appVersion,
    ]
  );

  return result.rows[0]?.id ?? null;
}

/** Insert when Athena starts; safe to call again with same execution_id (no-op). */
export async function insertQueryRunStart(
  input: Omit<QueryRunInsert, "athenaState"> & { executionId: string }
): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;

  try {
    return await insertQueryRun({ ...input, athenaState: "RUNNING" });
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw e;
  }
}

/** Set final Athena status (and optional trace) when polling completes. */
export async function finalizeQueryRun(
  executionId: string,
  input: {
    athenaState: string;
    errorReason?: string | null;
    scannedBytes?: number | null;
    runtimeMs?: number | null;
    rowCount?: number | null;
    trace?: AgentStreamPayload[] | null;
  }
): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;

  const pool = getPgPool();
  if (!pool) return false;

  const traceJson =
    input.trace && input.trace.length > 0 ? JSON.stringify(input.trace) : null;

  const result = await pool.query(
    `UPDATE nl2sql.query_runs SET
      athena_state = $2,
      error_reason = $3,
      scanned_bytes = $4,
      runtime_ms = $5,
      row_count = COALESCE($6, row_count),
      trace_json = COALESCE($7::jsonb, trace_json),
      hallucination_type = CASE
        WHEN $2 = 'SUCCEEDED'
          AND hallucination_type IS DISTINCT FROM 'schema_hallucination'
        THEN NULL
        ELSE hallucination_type
      END
    WHERE execution_id = $1`,
    [
      executionId,
      input.athenaState,
      input.errorReason ?? null,
      input.scannedBytes ?? null,
      input.runtimeMs ?? null,
      input.rowCount ?? null,
      traceJson,
    ]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function getQueryRunJudgeOverall(
  id: string
): Promise<number | null> {
  if (!isDatabaseConfigured()) return null;
  const pool = getPgPool();
  if (!pool) return null;

  const result = await pool.query<{ judge_overall: string | null }>(
    `SELECT judge_overall::text FROM nl2sql.query_runs WHERE id = $1 LIMIT 1`,
    [id]
  );
  const raw = result.rows[0]?.judge_overall;
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function getQueryRunIdByExecutionId(
  executionId: string
): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  const pool = getPgPool();
  if (!pool) return null;

  const result = await pool.query<{ id: string }>(
    `SELECT id::text FROM nl2sql.query_runs WHERE execution_id = $1 LIMIT 1`,
    [executionId]
  );
  return result.rows[0]?.id ?? null;
}

/** Update existing row by execution_id, or insert if missing. No ON CONFLICT required. */
export async function upsertQueryRun(input: QueryRunInsert): Promise<string | null> {
  const execId = input.executionId?.trim();
  if (execId) {
    const updated = await finalizeQueryRun(execId, {
      athenaState: input.athenaState,
      errorReason: input.errorReason,
      scannedBytes: input.scannedBytes,
      runtimeMs: input.runtimeMs,
      rowCount: input.rowCount,
      trace: input.trace,
    });
    if (updated) {
      return (await getQueryRunIdByExecutionId(execId)) ?? null;
    }
  }

  try {
    return await insertQueryRun(input);
  } catch (e) {
    if (execId && isUniqueViolation(e)) {
      await finalizeQueryRun(execId, {
        athenaState: input.athenaState,
        errorReason: input.errorReason,
        scannedBytes: input.scannedBytes,
        runtimeMs: input.runtimeMs,
        rowCount: input.rowCount,
        trace: input.trace,
      });
      return getQueryRunIdByExecutionId(execId);
    }
    throw e;
  }
}

const QUERY_RUN_SELECT = `
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
  app_version`;

/**
 * One row per question: the run with the latest created_at (optionally within one deploy).
 */
export async function listLatestQueryRunsPerQuestion(
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
        `WITH latest AS (
          SELECT DISTINCT ON (trim(question)) ${QUERY_RUN_SELECT}
          FROM nl2sql.query_runs
          WHERE app_version = $1
          ORDER BY trim(question), created_at DESC
        )
        SELECT * FROM latest
        ORDER BY created_at DESC
        LIMIT $2`,
        [versionFilter, safeLimit]
      )
    : await pool.query<QueryRunRow>(
        `WITH latest AS (
          SELECT DISTINCT ON (trim(question)) ${QUERY_RUN_SELECT}
          FROM nl2sql.query_runs
          ORDER BY trim(question), created_at DESC
        )
        SELECT * FROM latest
        ORDER BY created_at DESC
        LIMIT $1`,
        [safeLimit]
      );

  return result.rows;
}

/** Recent runs for dashboard / debugging (no per-question dedupe). */
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
        `SELECT ${QUERY_RUN_SELECT}
        FROM nl2sql.query_runs
        WHERE app_version = $1
        ORDER BY created_at DESC
        LIMIT $2`,
        [versionFilter, safeLimit]
      )
    : await pool.query<QueryRunRow>(
        `SELECT ${QUERY_RUN_SELECT}
        FROM nl2sql.query_runs
        ORDER BY created_at DESC
        LIMIT $1`,
        [safeLimit]
      );

  return result.rows;
}
