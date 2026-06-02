import { evaluatedFieldsFromQueryRun } from "@/lib/dashboard-judge";
import type { DashboardMomentBase } from "@/lib/p8k8-moments";
import type { QuestionSource } from "@/lib/question-source-types";
import {
  listEvaluatedDashboardRuns,
  listLatestQueryRunsPerQuestion,
  listQueryRuns,
  parseJudgeOverall,
  parseTokensUsed,
  type EvaluatedDashboardRunOptions,
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
  judgeOverall: number | null;
};

export function queryRunRowToMomentBase(row: QueryRunRow): DashboardMomentBase {
  const backend = row.backend?.trim() || null;
  const version = row.app_version?.trim() || null;
  const agentLabel =
    backend && version
      ? `${backend} · ${version}`
      : backend ?? version ?? "app";

  const tokens = parseTokensUsed(row.tokens_used);
  const evaluated = evaluatedFieldsFromQueryRun(row);

  return {
    id: row.id,
    timestamp: row.created_at,
    question: row.question,
    sql: row.sql,
    model: row.model,
    tokenCount: tokens?.total ?? null,
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
    judgeOverall: evaluated?.judgeOverall ?? null,
    judgeVerdict: evaluated?.judgeVerdict ?? null,
    judgeCategory: evaluated?.judgeCategory ?? null,
    judgeDataset: evaluated?.judgeDataset ?? null,
    judgeDifficulty: evaluated?.judgeDifficulty ?? null,
    tokensUsed: evaluated?.tokensUsed ?? tokens,
    costUsd: evaluated?.costUsd ?? null,
    hallucinationType: evaluated?.hallucinationType ?? null,
    questionSource: evaluated?.questionSource ?? null,
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
    judgeOverall: parseJudgeOverall(row.judge_overall),
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

/** Judged runs for eval dashboard (latest judged per question). */
export async function loadEvaluatedQueryRunMoments(options?: {
  limit?: number;
  sinceDays?: 1 | 7 | 30;
  appVersion?: string;
  questionSource?: QuestionSource | "all";
}): Promise<DashboardMomentBase[]> {
  const runOptions: EvaluatedDashboardRunOptions = {
    limit: options?.limit ?? 500,
    sinceDays: options?.sinceDays,
    appVersion: options?.appVersion,
  };
  let rows = await listEvaluatedDashboardRuns(runOptions);
  const sourceFilter = options?.questionSource ?? "all";
  if (sourceFilter !== "all") {
    rows = rows.filter(
      (r) => evaluatedFieldsFromQueryRun(r)?.questionSource === sourceFilter
    );
  }
  return rows.map(queryRunRowToMomentBase);
}
