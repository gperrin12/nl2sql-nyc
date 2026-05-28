import { writeTokensToQueryRunByExecutionId } from "@/lib/query-run-tokens";
import type { SqlGenerationResult } from "@/lib/claude";
import {
  beginQueryRun,
  finalizeQueryRun,
  insertQueryRunStart,
  updateQueryRun,
  updateQueryRunJudge,
  upsertQueryRun,
  type QueryRunInsert,
  type QueryRunUpdate,
} from "@/lib/query-runs-store";

/** Persist LLM judge score on query_runs (server-side; does not throw). */
export async function recordQueryRunJudge(
  queryRunId: string | null,
  judgeOverall: number
): Promise<void> {
  if (!queryRunId) return;
  try {
    await updateQueryRunJudge(queryRunId, judgeOverall);
  } catch (e) {
    console.warn(
      "[query-runs] judge update failed:",
      e instanceof Error ? e.message : e
    );
  }
}

/** Begin universal logging for a chat question (server-side; does not throw). */
export async function startQueryRunLogging(input: {
  question: string;
  backend?: string | null;
  appVersion?: string | null;
}): Promise<string | null> {
  try {
    return await beginQueryRun(input);
  } catch (e) {
    console.warn(
      "[query-runs] begin failed:",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/** Patch query_runs on any pipeline exit path (server-side; does not throw). */
export async function safeUpdateQueryRun(
  queryRunId: string | null,
  patch: QueryRunUpdate
): Promise<void> {
  if (!queryRunId) return;
  try {
    await updateQueryRun(queryRunId, patch);
  } catch (e) {
    console.warn(
      "[query-runs] update failed:",
      e instanceof Error ? e.message : e
    );
  }
}

/** Persist agent/Claude token totals on the query_runs row (server-side; does not throw). */
export async function recordQueryRunTokens(
  executionId: string,
  generation: Pick<SqlGenerationResult, "tokensUsed" | "costUsd">
): Promise<void> {
  if (
    generation.tokensUsed == null ||
    generation.costUsd == null ||
    !Number.isFinite(generation.costUsd)
  ) {
    return;
  }
  try {
    await writeTokensToQueryRunByExecutionId(
      executionId,
      generation.tokensUsed,
      generation.costUsd
    );
  } catch (e) {
    console.warn(
      "[query-runs] token update failed:",
      e instanceof Error ? e.message : e
    );
  }
}

/**
 * Legacy: insert RUNNING row when pipeline did not call beginQueryRun.
 * Prefer startQueryRunLogging + safeUpdateQueryRun in new code paths.
 */
export async function recordQueryRunStart(
  input: Omit<QueryRunInsert, "athenaState"> & { executionId: string }
): Promise<void> {
  try {
    await insertQueryRunStart(input);
  } catch (e) {
    console.warn(
      "[query-runs] start insert failed:",
      e instanceof Error ? e.message : e
    );
  }
}

/** When Athena reaches a terminal state (server-side; does not throw). */
export async function recordQueryRunFinalize(
  executionId: string,
  input: {
    athenaState: string;
    question?: string;
    sql?: string;
    model?: string | null;
    backend?: string | null;
    errorReason?: string | null;
    scannedBytes?: number | null;
    runtimeMs?: number | null;
    rowCount?: number | null;
    trace?: QueryRunInsert["trace"];
  }
): Promise<void> {
  try {
    const updated = await finalizeQueryRun(executionId, {
      athenaState: input.athenaState,
      errorReason: input.errorReason,
      scannedBytes: input.scannedBytes,
      runtimeMs: input.runtimeMs,
      rowCount: input.rowCount,
      trace: input.trace,
    });
    if (!updated && input.question?.trim() && input.sql?.trim()) {
      await upsertQueryRun({
        question: input.question,
        sql: input.sql,
        executionId,
        model: input.model,
        backend: input.backend,
        athenaState: input.athenaState,
        errorReason: input.errorReason,
        scannedBytes: input.scannedBytes,
        runtimeMs: input.runtimeMs,
        rowCount: input.rowCount,
        trace: input.trace,
      });
    }
  } catch (e) {
    console.warn(
      "[query-runs] finalize failed:",
      e instanceof Error ? e.message : e
    );
  }
}
