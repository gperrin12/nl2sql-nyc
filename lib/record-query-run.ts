import {
  finalizeQueryRun,
  insertQueryRunStart,
  upsertQueryRun,
  type QueryRunInsert,
} from "@/lib/query-runs-store";

/** After Athena execution starts (server-side; does not throw). */
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
