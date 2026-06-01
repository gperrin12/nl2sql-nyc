import type { SqlGenerationResult } from "@/lib/claude";
import type { GuardRepairHook } from "@/lib/ensure-guarded-sql";
import {
  ensureGuardedForPipeline,
  guardrailAbstentionMessage,
} from "@/lib/run-guarded-sql";
import { ensureSchemaValidSql } from "@/lib/ensure-schema-sql";
import { startQuery } from "@/lib/athena";
import {
  detectWarehouseHallucinations,
  persistSchemaHallucination,
} from "@/lib/hallucination-schema";
import { recordGenerationMetrics } from "@/lib/record-generation-metrics";
import {
  recordQueryRunTokens,
  safeUpdateQueryRun,
  startQueryRunLogging,
} from "@/lib/record-query-run";
import { isOffTopicHeuristic } from "@/lib/question-scope";
import {
  classifyNonSqlGeneration,
  outcomeForAthenaFailure,
  outcomeForGenerationError,
  outcomeForGuardrailBlocked,
  outcomeForOffTopic,
  outcomeForRunning,
} from "@/lib/query-outcome";
import type { QueryRunUpdate } from "@/lib/query-runs-store";

export type QueryPipelineSuccess = {
  ok: true;
  executionId: string;
  sql: string;
  model: string;
  backend: string;
  generation: SqlGenerationResult;
  summary?: string;
  queryRunId: string | null;
  usage: { inputTokens: number; outputTokens: number };
};

export type QueryPipelineFailure = {
  ok: false;
  queryRunId: string | null;
  httpStatus: number;
  body: Record<string, unknown>;
};

export type QueryPipelineResult = QueryPipelineSuccess | QueryPipelineFailure;

export type RunQueryPipelineOptions = {
  question: string;
  backend: string;
  generate: () => Promise<SqlGenerationResult>;
  skipScopeCheck?: boolean;
  guardOptions?: { onRepair?: GuardRepairHook };
  onSqlGenerated?: (sql: string) => void | Promise<void>;
  onGuardSuccess?: (repairCount: number) => void | Promise<void>;
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function applyOutcome(
  queryRunId: string | null,
  patch: QueryRunUpdate
): Promise<void> {
  await safeUpdateQueryRun(queryRunId, patch);
}

export async function runQueryPipeline(
  options: RunQueryPipelineOptions
): Promise<QueryPipelineResult> {
  const {
    question,
    backend,
    generate,
    skipScopeCheck,
    guardOptions,
    onSqlGenerated,
    onGuardSuccess,
  } = options;

  const queryRunId = await startQueryRunLogging({ question, backend });

  if (!skipScopeCheck && isOffTopicHeuristic(question)) {
    const outcome = outcomeForOffTopic();
    await applyOutcome(queryRunId, outcome);
    return {
      ok: false,
      queryRunId,
      httpStatus: 400,
      body: { error: "Question is off-topic for NYC civic data" },
    };
  }

  let generation: SqlGenerationResult;
  try {
    generation = await generate();
  } catch (e) {
    const outcome = outcomeForGenerationError(errorMessage(e));
    await applyOutcome(queryRunId, outcome);
    return {
      ok: false,
      queryRunId,
      httpStatus: 502,
      body: { error: "SQL generation failed", detail: outcome.errorReason },
    };
  }

  const nonSql = classifyNonSqlGeneration(generation.sql);
  if (nonSql) {
    await applyOutcome(queryRunId, nonSql);
    const isOffTopic = nonSql.hallucinationType === "off_topic";
    return {
      ok: false,
      queryRunId,
      httpStatus: isOffTopic ? 400 : 502,
      body: {
        error: isOffTopic
          ? "Question is off-topic for NYC civic data"
          : "No SQL produced",
        detail: nonSql.errorReason,
        sql: generation.sql,
      },
    };
  }

  await onSqlGenerated?.(generation.sql);

  const guarded = await ensureGuardedForPipeline(question, generation, {
    ...guardOptions,
    queryRunId: queryRunId ?? undefined,
  });
  if (!guarded.ok) {
    const displayReason = guardrailAbstentionMessage(guarded);
    const outcome = outcomeForGuardrailBlocked(displayReason);
    await applyOutcome(queryRunId, {
      ...outcome,
      sql: guarded.sql,
      model: guarded.generation.model,
    });
    return {
      ok: false,
      queryRunId,
      httpStatus: 400,
      body: {
        error: "SQL rejected by guardrails",
        reason: guarded.reason,
        sql: guarded.sql,
        error_type: guarded.error_type,
        suggestion: guarded.suggestion,
        abstention_reason: guarded.reason,
        message: displayReason,
      },
    };
  }
  generation = guarded.generation;
  if (guarded.repairCount > 0) {
    await onGuardSuccess?.(guarded.repairCount);
  }

  const initialHallucination = detectWarehouseHallucinations(generation.sql);
  await persistSchemaHallucination(queryRunId, initialHallucination);

  const schemaChecked = await ensureSchemaValidSql(question, generation, {
    guardOptions,
  });
  if (schemaChecked.guardFailure) {
    const gf = schemaChecked.guardFailure;
    const displayReason = guardrailAbstentionMessage(gf);
    const outcome = outcomeForGuardrailBlocked(displayReason);
    await applyOutcome(queryRunId, {
      ...outcome,
      sql: gf.sql,
      model: gf.generation.model,
    });
    return {
      ok: false,
      queryRunId,
      httpStatus: 400,
      body: {
        error: "SQL rejected by guardrails",
        reason: gf.reason,
        sql: gf.sql,
        error_type: gf.error_type,
        suggestion: gf.suggestion,
        abstention_reason: gf.reason,
        message: displayReason,
      },
    };
  }
  generation = schemaChecked.generation;
  await persistSchemaHallucination(queryRunId, schemaChecked.hallucination);

  await recordGenerationMetrics(question, generation, backend);

  let executionId: string;
  try {
    executionId = await startQuery(generation.sql);
  } catch (e) {
    const outcome = outcomeForAthenaFailure(errorMessage(e));
    await applyOutcome(queryRunId, {
      ...outcome,
      sql: generation.sql,
      model: generation.model,
    });
    return {
      ok: false,
      queryRunId,
      httpStatus: 502,
      body: {
        error: "Athena rejected the query",
        detail: outcome.errorReason,
        sql: generation.sql,
      },
    };
  }

  const running = outcomeForRunning();
  await applyOutcome(queryRunId, {
    ...running,
    sql: generation.sql,
    model: generation.model,
    executionId,
  });

  void recordQueryRunTokens(executionId, generation);

  return {
    ok: true,
    executionId,
    sql: generation.sql,
    model: generation.model,
    backend,
    generation,
    summary: generation.summary,
    queryRunId,
    usage: {
      inputTokens: generation.inputTokens,
      outputTokens: generation.outputTokens,
    },
  };
}
