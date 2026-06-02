/**
 * Derive dashboard judge fields from nl2sql.query_runs (no evals.json).
 */

import type { CorrectnessVerdict } from "@/lib/judge";
import { classifyQuestion, type QueryCategory } from "@/lib/query-category";
import { detectDatasets, type QueryDataset } from "@/lib/query-dataset";
import type { QueryDifficulty } from "@/lib/query-difficulty";
import { difficultyFromSql } from "@/lib/query-difficulty";
import type { HallucinationType, QueryRunRow } from "@/lib/query-runs-store";
import {
  parseCostUsd,
  parseJudgeOverall,
  parseTokensUsed,
} from "@/lib/query-runs-store";
import { getQuestionSource, type QuestionSource } from "@/lib/question-source";
import type { TokenSummary } from "@/lib/query-run-tokens";

export type DashboardJudgeView = {
  overall: number;
  verdict: CorrectnessVerdict;
  category: QueryCategory;
  dataset: QueryDataset;
  difficulty: QueryDifficulty;
  question: string;
  sql: string;
};

/** Map 1–5 judge_overall to verdict (aligned with lib/judge.ts rubric). */
export function verdictFromJudgeOverall(score: number): CorrectnessVerdict {
  if (score >= 5) return "correct";
  if (score >= 4) return "partial";
  return "incorrect";
}

export function buildDashboardJudgeView(
  question: string,
  sql: string,
  judgeOverall: number
): DashboardJudgeView {
  return {
    question,
    sql,
    overall: judgeOverall,
    verdict: verdictFromJudgeOverall(judgeOverall),
    category: classifyQuestion(question),
    dataset: detectDatasets(sql),
    difficulty: difficultyFromSql(sql) ?? "medium",
  };
}

export function judgeViewFromQueryRun(row: QueryRunRow): DashboardJudgeView | null {
  const overall = parseJudgeOverall(row.judge_overall);
  if (overall == null) return null;
  return buildDashboardJudgeView(row.question, row.sql, overall);
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
};

export function momentToJudgeView(m: {
  question: string;
  sql: string;
  judgeOverall?: number | null;
  judgeVerdict?: CorrectnessVerdict | null;
  judgeCategory?: QueryCategory | null;
  judgeDataset?: QueryDataset | null;
  judgeDifficulty?: QueryDifficulty | null;
}): DashboardJudgeView | null {
  if (m.judgeOverall == null) return null;
  return {
    question: m.question,
    sql: m.sql,
    overall: m.judgeOverall,
    verdict: m.judgeVerdict ?? verdictFromJudgeOverall(m.judgeOverall),
    category: m.judgeCategory ?? classifyQuestion(m.question),
    dataset: m.judgeDataset ?? detectDatasets(m.sql),
    difficulty: m.judgeDifficulty ?? difficultyFromSql(m.sql) ?? "medium",
  };
}

export function evaluatedFieldsFromQueryRun(row: QueryRunRow): EvaluatedRunFields | null {
  const view = judgeViewFromQueryRun(row);
  if (!view) return null;

  const hallucinationRaw = row.hallucination_type?.trim() || null;
  const hallucinationType =
    hallucinationRaw === "off_topic" ||
    hallucinationRaw === "guardrail_blocked" ||
    hallucinationRaw === "no_sql_produced" ||
    hallucinationRaw === "schema_hallucination"
      ? hallucinationRaw
      : null;

  return {
    judgeOverall: view.overall,
    judgeVerdict: view.verdict,
    judgeCategory: view.category,
    judgeDataset: view.dataset,
    judgeDifficulty: view.difficulty,
    tokensUsed: parseTokensUsed(row.tokens_used),
    costUsd: parseCostUsd(row.cost_usd),
    hallucinationType,
    questionSource: getQuestionSource(row.question),
  };
}
