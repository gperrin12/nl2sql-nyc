/**
 * Circuit-breaker guardrails for the query pipeline (replaces ensureGuardedSql there).
 *
 * - Error type classification
 * - Repair attempt logging to nl2sql.repair_attempts
 * - Same-error detection: 3+ identical error_type in window → structured abstention
 *
 * App entry: guardGenerationWithV2() in lib/run-guarded-sql.ts
 */

import { Pool } from "pg";
import { generateSqlWithRepair, type SqlGenerationResult } from "@/lib/claude";
import {
  mergeGenerations,
  type GuardRepairHook,
} from "@/lib/ensure-guarded-sql";
import { checkSql, type GuardrailResult } from "@/lib/guardrails";

export type EnsureGuardedSqlV2Options = {
  maxRepairs?: number;
  queryRunId?: string;
  onRepair?: GuardRepairHook;
  /** When set, repair calls merge token usage into this object. */
  initialGeneration?: SqlGenerationResult;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GuardedSqlResult {
  ok: boolean;
  sql: string;
  attempts: number;
  reason?: string;
  error_type?: string;
  suggestion?: string;
}

export interface RepairAttemptRecord {
  question: string;
  attempt_number: number;
  error_type: string;
  error_message: string;
  sql_attempted: string;
  repair_succeeded: boolean;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_MAX_REPAIRS = 2;
const CIRCUIT_BREAKER_THRESHOLD = 3; // same error_type this many times → open circuit
const CIRCUIT_BREAKER_WINDOW_MINUTES = 60;

// ─── Error Classification ─────────────────────────────────────────────────────

export function classifyError(errorMessage: string): string {
    const msg = errorMessage.toLowerCase();

    if (msg.includes("column") && msg.includes("cannot be resolved")) {
      return "column_not_found";
    }
    if (msg.includes("function_not_found")) {
      return "function_error";
    }
    if (msg.includes("type_mismatch") || msg.includes("cannot apply operator")) {
      return "type_mismatch";
    }
    if (msg.includes("agent ended") || msg.includes("select/with")) {
      return "no_sql_produced";
    }
    if (msg.includes("outside") && msg.includes("scope")) {
      return "off_topic";
    }
    if (msg.includes("athena_output_location") || msg.includes("env var")) {
      return "configuration_error";
    }

    return "unknown";
  }

// ─── Suggestion Builder ───────────────────────────────────────────────────────

/**
 * Returns a human-readable suggestion for the user based on what failed.
 * These appear in the abstention response — keep them brief and actionable.
 */
export function buildSuggestion(errorType: string): string {
  const suggestions: Record<string, string> = {
    column_not_found:
      "Try rephrasing with different column names, or ask which fields are available for this data source.",
    table_not_found:
      "This data source may not be available. Ask what data sources are available for your question.",
    syntax_error:
      "The generated SQL had a syntax issue that couldn't be repaired automatically. Try simplifying your question.",
    type_mismatch:
      "There was a data type conflict in the query. Try being more specific about the data format you expect.",
    timeout:
      "The query timed out. Try narrowing the time range or adding more specific filters.",
    unknown:
      "The query couldn't be completed after multiple attempts. Try rephrasing your question.",
  };

  return suggestions[errorType] ?? suggestions.unknown;
}

// ─── Repair Attempt Logging ───────────────────────────────────────────────────

export async function logRepairAttempt(
    pool: Pool,
    record: RepairAttemptRecord,
    queryRunId?: string
  ): Promise<number> {
    const result = await pool.query(
      `INSERT INTO nl2sql.repair_attempts 
        (question, attempt_number, error_type, error_message, sql_attempted, repair_succeeded, query_run_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        record.question,
        record.attempt_number,
        record.error_type,
        record.error_message,
        record.sql_attempted,
        false, // initial state — will update to true on success
        queryRunId ?? null,
      ]
    );

    return result.rows[0]?.id ?? -1;
  }

  export async function updateRepairSucceeded(
    pool: Pool,
    rowId: number
  ): Promise<void> {
    if (rowId <= 0) return; // skip if we don't have a valid row id

    await pool.query(
      `UPDATE nl2sql.repair_attempts 
       SET repair_succeeded = true 
       WHERE id = $1`,
      [rowId]
    );
  }

// ─── Circuit Breaker Check ────────────────────────────────────────────────────

export async function hasSameErrorRepeated(
    pool: Pool,
    errorType: string,
    windowMinutes: number = CIRCUIT_BREAKER_WINDOW_MINUTES,
    threshold: number = CIRCUIT_BREAKER_THRESHOLD
  ): Promise<boolean> {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM nl2sql.repair_attempts
       WHERE error_type = $1
         AND created_at > NOW() - ($2::int * INTERVAL '1 minute')`,
      [errorType, windowMinutes]
    );

    const count = Number(result.rows[0]?.count ?? 0);
    return count >= threshold;
  }

// ─── Main Function ────────────────────────────────────────────────────────────

/**
 * ensureGuardedSqlV2
 *
 * Drop-in replacement for ensureGuardedSql with:
 * - Error type classification on each failure
 * - Repair attempt logging to Postgres
 * - Circuit breaker: same error type 3+ times → structured abstention
 *
 * @param pool     - Postgres pool (for repair_attempts logging)
 * @param question - Original natural language question
 * @param sql      - Initial generated SQL to validate
 * @param options - maxRepairs, queryRunId, onRepair, initialGeneration (token merge)
 */
export async function ensureGuardedSqlV2(
  pool: Pool,
  question: string,
  sql: string,
  options?: EnsureGuardedSqlV2Options
): Promise<GuardedSqlResult> {
  const maxRepairs = options?.maxRepairs ?? DEFAULT_MAX_REPAIRS;
  let currentSql = sql;
  let generation = options?.initialGeneration;
  let attemptNumber = 0;
  let pendingRepairRowId: number | null = null;

  while (attemptNumber <= maxRepairs) {
    const check: GuardrailResult = checkSql(currentSql);

    if (check.ok) {
      if (pendingRepairRowId != null && pendingRepairRowId > 0) {
        await updateRepairSucceeded(pool, pendingRepairRowId);
      }
      return {
        ok: true,
        sql: check.sql,
        attempts: attemptNumber,
      };
    }

    const errorType = classifyError(check.reason ?? "unknown error");

    const rowId = await logRepairAttempt(
      pool,
      {
        question,
        attempt_number: attemptNumber,
        error_type: errorType,
        error_message: check.reason ?? "unknown error",
        sql_attempted: currentSql,
        repair_succeeded: false,
      },
      options?.queryRunId
    );

    const shouldTrip = await hasSameErrorRepeated(pool, errorType);
    if (shouldTrip) {
      return {
        ok: false,
        sql: currentSql,
        attempts: attemptNumber,
        reason: "schema_mismatch_repeated",
        error_type: errorType,
        suggestion: buildSuggestion(errorType),
      };
    }

    if (attemptNumber >= maxRepairs) {
      return {
        ok: false,
        sql: currentSql,
        attempts: attemptNumber,
        reason: "max_repairs_exceeded",
        error_type: errorType,
        suggestion: buildSuggestion(errorType),
      };
    }

    attemptNumber++;
    const repaired = await generateSqlWithRepair(
      question,
      currentSql,
      check.reason ?? ""
    );
    if (generation) {
      generation = mergeGenerations(generation, repaired);
      currentSql = generation.sql;
    } else {
      currentSql = repaired.sql;
    }
    await options?.onRepair?.({
      attempt: attemptNumber,
      reason: check.reason ?? "unknown error",
      sql: currentSql,
    });
    pendingRepairRowId = rowId;
  }

  return {
    ok: false,
    sql: currentSql,
    attempts: attemptNumber,
    reason: "max_repairs_exceeded",
    error_type: "unknown",
    suggestion: buildSuggestion("unknown"),
  };
}
