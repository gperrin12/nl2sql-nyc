import type { DashboardMomentBase } from "@/lib/p8k8-moments";
import {
  listLatestQueryRunsPerQuestion,
  listQueryRuns,
  type QueryRunRow,
} from "@/lib/query-runs-store";

export type QueryRunPair = {
  id: string;
  question: string;
  sql: string;
  model: string | null;
  backend: string | null;
  athenaState: string | null;
  executionId: string | null;
  appVersion: string | null;
  createdAt: string;
  runtimeMs: number | null;
  rowCount: number | null;
};

export function queryRunRowToMomentBase(row: QueryRunRow): DashboardMomentBase {
  const backend = row.backend?.trim() || null;
  const version = row.app_version?.trim() || null;
  const agentLabel =
    backend && version
      ? `${backend} · ${version}`
      : backend ?? version ?? "app";

  return {
    id: row.id,
    timestamp: row.created_at,
    question: row.question,
    sql: row.sql,
    model: row.model,
    tokenCount: null,
    agentName: agentLabel,
    athenaState: row.athena_state,
    executionId: row.execution_id,
    appVersion: version,
    backend,
    runtimeMsFromDb: row.runtime_ms,
    rowCount: row.row_count,
    scannedBytes: row.scanned_bytes
      ? Number.parseInt(row.scanned_bytes, 10)
      : null,
    source: "postgres",
  };
}

export function queryRunRowToPair(row: QueryRunRow): QueryRunPair {
  return {
    id: row.id,
    question: row.question,
    sql: row.sql,
    model: row.model,
    backend: row.backend,
    athenaState: row.athena_state,
    executionId: row.execution_id,
    appVersion: row.app_version,
    createdAt: row.created_at,
    runtimeMs: row.runtime_ms,
    rowCount: row.row_count,
  };
}

/** Rows with SQL suitable for judge / dashboard (excludes empty or RUNNING-only if desired). */
export async function loadQueryRunMoments(options?: {
  limit?: number;
  appVersion?: string;
  includeRunning?: boolean;
  /** Default true for dashboard: newest run per question across deploys. */
  latestPerQuestion?: boolean;
}): Promise<DashboardMomentBase[]> {
  const limit = options?.limit ?? 200;
  const latestPerQuestion = options?.latestPerQuestion !== false;
  const rows = latestPerQuestion
    ? await listLatestQueryRunsPerQuestion(limit, {
        appVersion: options?.appVersion,
      })
    : await listQueryRuns(limit, {
        appVersion: options?.appVersion,
      });

  return rows
    .filter((r) => {
      if (!/\b(SELECT|WITH)\b/i.test(r.sql)) return false;
      if (!options?.includeRunning && r.athena_state === "RUNNING") {
        return false;
      }
      return true;
    })
    .map(queryRunRowToMomentBase);
}

export async function loadQueryRunPairs(options?: {
  limit?: number;
  appVersion?: string;
}): Promise<QueryRunPair[]> {
  const rows = await listQueryRuns(options?.limit ?? 200, {
    appVersion: options?.appVersion,
  });
  return rows
    .filter((r) => /\b(SELECT|WITH)\b/i.test(r.sql))
    .map(queryRunRowToPair);
}
