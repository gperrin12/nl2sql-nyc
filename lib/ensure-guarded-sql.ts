import { generateSqlWithRepair, type SqlGenerationResult } from "@/lib/claude";
import { checkSql } from "@/lib/guardrails";

const DEFAULT_MAX_GUARD_REPAIRS = 2;

export type GuardedSqlResult =
  | {
      ok: true;
      sql: string;
      generation: SqlGenerationResult;
      repairCount: number;
    }
  | {
      ok: false;
      reason: string;
      sql: string;
      generation: SqlGenerationResult;
    };

export type GuardRepairHook = (info: {
  attempt: number;
  reason: string;
  sql: string;
}) => void | Promise<void>;

/**
 * Legacy guardrails + repair (no Postgres / circuit breaker).
 * Used by eval scripts (run-and-eval, run-golden-eval). App pipeline uses ensureGuardedSqlV2.
 */
export async function ensureGuardedSql(
  question: string,
  initial: SqlGenerationResult,
  options?: { maxRepairs?: number; onRepair?: GuardRepairHook }
): Promise<GuardedSqlResult> {
  const maxRepairs = options?.maxRepairs ?? DEFAULT_MAX_GUARD_REPAIRS;
  let generation = initial;
  let check = checkSql(generation.sql);
  let repairCount = 0;

  while (!check.ok && repairCount < maxRepairs) {
    repairCount += 1;
    const repaired = await generateSqlWithRepair(
      question,
      generation.sql,
      check.reason
    );
    generation = mergeGenerations(generation, repaired);
    await options?.onRepair?.({
      attempt: repairCount,
      reason: check.reason,
      sql: generation.sql,
    });
    check = checkSql(generation.sql);
  }

  if (!check.ok) {
    return {
      ok: false,
      reason: check.reason,
      sql: generation.sql,
      generation,
    };
  }

  return {
    ok: true,
    sql: check.sql,
    generation: { ...generation, sql: check.sql },
    repairCount,
  };
}

export function mergeGenerations(
  prior: SqlGenerationResult,
  next: SqlGenerationResult
): SqlGenerationResult {
  const mergedTokens =
    prior.tokensUsed && next.tokensUsed
      ? {
          input: prior.tokensUsed.input + next.tokensUsed.input,
          output: prior.tokensUsed.output + next.tokensUsed.output,
          total: prior.tokensUsed.total + next.tokensUsed.total,
        }
      : (next.tokensUsed ?? prior.tokensUsed);

  return {
    ...next,
    summary: next.summary ?? prior.summary,
    latencyMs: (prior.latencyMs ?? 0) + (next.latencyMs ?? 0) || undefined,
    inputTokens: prior.inputTokens + next.inputTokens,
    outputTokens: prior.outputTokens + next.outputTokens,
    tokensUsed: mergedTokens,
    costUsd:
      prior.costUsd != null || next.costUsd != null
        ? (prior.costUsd ?? 0) + (next.costUsd ?? 0)
        : undefined,
  };
}
