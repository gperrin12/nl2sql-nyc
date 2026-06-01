import type { SqlGenerationResult } from "@/lib/claude";
import { getPgPool } from "@/lib/db";
import type { GuardRepairHook } from "@/lib/ensure-guarded-sql";
import { ensureRepairAttemptsTable } from "@/lib/repair-attempts";
import {
  ensureGuardedSqlV2,
  type GuardedSqlResult,
} from "@/lib/sql-agent/ensure-guarded-sql";

export type GuardedPipelineResult =
  | {
      ok: true;
      sql: string;
      generation: SqlGenerationResult;
      repairCount: number;
    }
  | {
      ok: false;
      sql: string;
      generation: SqlGenerationResult;
      reason: string;
      error_type?: string;
      suggestion?: string;
    };

export type GuardGenerationV2Options = {
  onRepair?: GuardRepairHook;
  queryRunId?: string | null;
  maxRepairs?: number;
};

/**
 * Circuit-breaker guardrails (ensureGuardedSqlV2). Requires DATABASE_URL / getPgPool().
 */
export async function guardGenerationWithV2(
  question: string,
  generation: SqlGenerationResult,
  options?: GuardGenerationV2Options
): Promise<GuardedPipelineResult | { ok: false; poolMissing: true }> {
  const pool = getPgPool();
  if (!pool) {
    return { ok: false, poolMissing: true };
  }

  await ensureRepairAttemptsTable(pool);

  const v2Opts = {
    maxRepairs: options?.maxRepairs,
    queryRunId: options?.queryRunId ?? undefined,
    onRepair: options?.onRepair,
    initialGeneration: generation,
  };

  const guarded = await ensureGuardedSqlV2(
    pool,
    question,
    generation.sql,
    v2Opts
  );

  const gen = v2Opts.initialGeneration ?? generation;

  if (guarded.ok) {
    return {
      ok: true,
      sql: guarded.sql,
      generation: { ...gen, sql: guarded.sql },
      repairCount: guarded.attempts,
    };
  }

  return mapV2Failure(gen, guarded);
}

export function mapV2Failure(
  generation: SqlGenerationResult,
  guarded: GuardedSqlResult
): Extract<GuardedPipelineResult, { ok: false }> {
  return {
    ok: false,
    sql: guarded.sql,
    generation: { ...generation, sql: guarded.sql },
    reason: guarded.reason ?? "max_repairs_exceeded",
    error_type: guarded.error_type,
    suggestion: guarded.suggestion,
  };
}

/** User-facing message for abstention UI / SSE. */
export function guardrailAbstentionMessage(failure: {
  reason: string;
  suggestion?: string;
}): string {
  if (failure.suggestion?.trim()) return failure.suggestion.trim();
  if (failure.reason === "schema_mismatch_repeated") {
    return "The same type of error kept occurring. Try rephrasing or ask which columns are available.";
  }
  if (failure.reason === "max_repairs_exceeded") {
    return "The query could not be fixed after multiple repair attempts. Try simplifying your question.";
  }
  return failure.reason;
}

const POOL_REQUIRED_MSG =
  "DATABASE_URL is not configured — circuit-breaker guardrails require Postgres (nl2sql.repair_attempts)";

/** 503 when the app pipeline runs without DATABASE_URL. */
export function guardrailPoolMissingFailure(
  sql: string
): Record<string, unknown> {
  return {
    error: "SQL rejected by guardrails",
    reason: "configuration_error",
    sql,
    error_type: "configuration_error",
    message: POOL_REQUIRED_MSG,
  };
}

export function buildGuardrailFailureBody(
  failure: Extract<GuardedPipelineResult, { ok: false }>
): Record<string, unknown> {
  const displayReason = guardrailAbstentionMessage(failure);
  return {
    error: "SQL rejected by guardrails",
    reason: failure.reason,
    sql: failure.sql,
    error_type: failure.error_type,
    suggestion: failure.suggestion,
    abstention_reason: failure.reason,
    message: displayReason,
  };
}
