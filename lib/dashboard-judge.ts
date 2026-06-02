/**
 * Server-side: map query_runs rows to dashboard fields (uses fs for question source).
 */

import {
  buildDashboardJudgeView,
  type DashboardJudgeView,
} from "@/lib/dashboard-judge-view";
export {
  buildDashboardJudgeView,
  momentToJudgeView,
  verdictFromJudgeOverall,
  type DashboardJudgeView,
} from "@/lib/dashboard-judge-view";

import type { CorrectnessVerdict } from "@/lib/judge";
import type { QueryCategory } from "@/lib/query-category";
import type { QueryDataset } from "@/lib/query-dataset";
import type { QueryDifficulty } from "@/lib/query-difficulty";
import type { HallucinationType, QueryRunRow } from "@/lib/query-runs-store";
import type { JudgeDetail } from "@/lib/judge-detail-types";
import { parseJudgeDetail } from "@/lib/judge-detail";
import {
  parseCostUsd,
  parseJudgeOverall,
  parseTokensUsed,
} from "@/lib/query-runs-store";
import { getQuestionSource } from "@/lib/question-source";
import type { QuestionSource } from "@/lib/question-source-types";
import type { TokenSummary } from "@/lib/query-run-tokens";

export function judgeViewFromQueryRun(row: QueryRunRow): DashboardJudgeView | null {
  const detail = parseJudgeDetail(row.judge_detail);
  const overall =
    detail?.overall ?? parseJudgeOverall(row.judge_overall);
  if (overall == null) return null;
  const view = buildDashboardJudgeView(row.question, row.sql, overall);
  if (detail) {
    return { ...view, verdict: detail.verdict };
  }
  return view;
}

export type EvaluatedRunFields = {
  judgeOverall: number;
  judgeVerdict: CorrectnessVerdict;
  judgeCategory: QueryCategory;
  judgeDataset: QueryDataset;
  judgeDifficulty: QueryDifficulty;
  tokensUsed: TokenSummary | null;
  costUsd: number | null;
  hallucinationType: HallucinationType | null;
  questionSource: QuestionSource;
  judgeDetail: JudgeDetail | null;
};

export function evaluatedFieldsFromQueryRun(row: QueryRunRow): EvaluatedRunFields | null {
  const detail = parseJudgeDetail(row.judge_detail);
  const overall =
    detail?.overall ?? parseJudgeOverall(row.judge_overall);
  if (overall == null) return null;

  const view = buildDashboardJudgeView(row.question, row.sql, overall);
  const verdict = detail?.verdict ?? view.verdict;

  const hallucinationRaw = row.hallucination_type?.trim() || null;
  const hallucinationType =
    hallucinationRaw === "off_topic" ||
    hallucinationRaw === "guardrail_blocked" ||
    hallucinationRaw === "no_sql_produced" ||
    hallucinationRaw === "schema_hallucination"
      ? hallucinationRaw
      : null;

  return {
    judgeOverall: overall,
    judgeVerdict: verdict,
    judgeCategory: view.category,
    judgeDataset: view.dataset,
    judgeDifficulty: view.difficulty,
    tokensUsed: parseTokensUsed(row.tokens_used),
    costUsd: parseCostUsd(row.cost_usd),
    hallucinationType,
    questionSource: getQuestionSource(row.question),
    judgeDetail: detail,
  };
}
