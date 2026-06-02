/**
 * Client-safe dashboard judge helpers (no Node fs / DB / child_process).
 */

import type { CorrectnessVerdict } from "@/lib/judge";
import { classifyQuestion, type QueryCategory } from "@/lib/query-category";
import { detectDatasets, type QueryDataset } from "@/lib/query-dataset";
import type { QueryDifficulty } from "@/lib/query-difficulty";
import { difficultyFromSql } from "@/lib/query-difficulty";

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
