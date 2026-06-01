import type { SqlGenerationResult } from "@/lib/claude";
import { getPgPool } from "@/lib/db";
import {
  ensureGuardedSql,
  type GuardRepairHook,
} from "@/lib/ensure-guarded-sql";
import { ensureRepairAttemptsTable } from "@/lib/repair-attempts";
import {
  ensureGuardedSqlV2,
  type EnsureGuardedSqlV2Options,
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
      /** Machine reason: max_repairs_exceeded | schema_mismatch_repeated | guardrail text */
      reason: string;
      error_type?: string;
      suggestion?: string;
    };

export type EnsureGuardedPipelineOptions = {
  onRepair?: GuardRepairHook;
  queryRunId?: string;
  maxRepairs?: number;
};

/** Guardrails + repair: V2 when Postgres is configured, else legacy ensureGuardedSql. */
export async function ensureGuardedForPipeline(
  question: string,
  generation: SqlGenerationResult,
  options?: EnsureGuardedPipelineOptions
): Promise<GuardedPipelineResult> {
  const pool = getPgPool();
  if (!pool) {
    const legacy = await ensureGuardedSql(question, generation, {
      maxRepairs: options?.maxRepairs,
      onRepair: options?.onRepair,
    });
    if (legacy.ok) {
      return {
        ok: true,
        sql: legacy.sql,
        generation: legacy.generation,
        repairCount: legacy.repairCount,
      };
    }
    return {
      ok: false,
      sql: legacy.sql,
      generation: legacy.generation,
      reason: legacy.reason,
    };
  }

  await ensureRepairAttemptsTable(pool);

  const v2Opts: EnsureGuardedSqlV2Options = {
    maxRepairs: options?.maxRepairs,
    queryRunId: options?.queryRunId,
    onRepair: options?.onRepair,
    initialGeneration: generation,
  };

  const guarded = await ensureGuardedSqlV2(
    pool,
    question,
    generation.sql,
    v2Opts
  );

  const gen =
    v2Opts.initialGeneration ?? { ...generation, sql: guarded.sql };

  if (guarded.ok) {
    return {
      ok: true,
      sql: guarded.sql,
      generation: { ...gen, sql: guarded.sql },
      repairCount: guarded.attempts,
    };
  }

  return {
    ok: false,
    sql: guarded.sql,
    generation: { ...gen, sql: guarded.sql },
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
