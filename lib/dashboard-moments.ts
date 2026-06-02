/**
 * Dashboard query-pair types and pagination helpers.
 */

import type { CorrectnessVerdict } from "@/lib/judge";
import type { QueryCategory } from "@/lib/query-category";
import type { QueryDataset } from "@/lib/query-dataset";
import type { QueryDifficulty } from "@/lib/query-difficulty";
import type { HallucinationType } from "@/lib/query-runs-store";
import type { JudgeDetail } from "@/lib/judge-detail-types";
import type { QuestionSource } from "@/lib/question-source-types";
import type { TokenSummary } from "@/lib/query-run-tokens";
import type { QuestionMetrics, SqlComplexity } from "@/lib/sql-metrics";

export type DashboardMoment = {
  id: string;
  timestamp: string;
  question: string;
  sql: string;
  model: string | null;
  tokenCount: number | null;
  agentName: string | null;
  latencyMs: number | null;
  questionMetrics: QuestionMetrics;
  sqlComplexity: SqlComplexity;
  source?: "postgres";
  athenaState?: string | null;
  executionId?: string | null;
  appVersion?: string | null;
  backend?: string | null;
  rowCount?: number | null;
  scannedBytes?: number | null;
  /** Raw runtime_ms from DB when source is postgres */
  runtimeMsFromDb?: number | null;
  /** From query_runs when judged (eval dashboard). */
  judgeOverall?: number | null;
  judgeVerdict?: CorrectnessVerdict | null;
  judgeCategory?: QueryCategory | null;
  judgeDataset?: QueryDataset | null;
  judgeDifficulty?: QueryDifficulty | null;
  tokensUsed?: TokenSummary | null;
  costUsd?: number | null;
  hallucinationType?: HallucinationType | null;
  questionSource?: QuestionSource | null;
  judgeDetail?: JudgeDetail | null;
};

/** Base pair shape before server-side enrichment. */
export type DashboardMomentBase = Omit<
  DashboardMoment,
  "latencyMs" | "questionMetrics" | "sqlComplexity"
>;

export function paginateMoments<T extends { id: string }>(
  moments: T[],
  offset: number,
  limit: number
): { moments: T[]; total: number } {
  const total = moments.length;
  const safeOffset = Math.max(0, offset);
  const safeLimit = Math.max(1, limit);
  return {
    moments: moments.slice(safeOffset, safeOffset + safeLimit),
    total,
  };
}
