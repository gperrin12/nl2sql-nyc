/**
 * Client-safe helpers for displaying judge scores on the dashboard.
 */

import type { FullJudgeResult } from "@/lib/judge";

export const JUDGE_WEIGHTS = {
  sql: 0.6,
  result: 0.25,
  viz: 0.15,
} as const;

function clampScore(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

/** SQL-only overall (stored on full eval, or inferred / equals overall for SQL-only). */
export function getSqlOverall(evalResult: FullJudgeResult): number {
  if (evalResult.sqlOverall != null && Number.isFinite(evalResult.sqlOverall)) {
    return evalResult.sqlOverall;
  }
  if (!evalResult.resultEval) return evalResult.overall;
  const re = evalResult.resultEval;
  const inferred =
    (evalResult.overall -
      re.resultQuality * JUDGE_WEIGHTS.result -
      re.vizFit * JUDGE_WEIGHTS.viz) /
    JUDGE_WEIGHTS.sql;
  return clampScore(inferred);
}

/** Blended overall from components (may differ slightly from stored after rounding). */
export function computeBlendedOverall(
  sql: number,
  resultQuality: number,
  vizFit: number
): number {
  return clampScore(
    sql * JUDGE_WEIGHTS.sql +
      resultQuality * JUDGE_WEIGHTS.result +
      vizFit * JUDGE_WEIGHTS.viz
  );
}

export function formatJudgeHeaderTooltip(): string {
  return [
    "Combined score (full eval):",
    `0.6 × SQL + 0.25 × Result + 0.15 × Viz`,
    "SQL-only evals: overall equals SQL score.",
  ].join("\n");
}

export function formatJudgeCellTooltip(evalResult: FullJudgeResult): string {
  const sql = getSqlOverall(evalResult);
  if (!evalResult.resultEval) {
    return `SQL judge: ${sql.toFixed(1)}/10\n(No full eval — Judge column equals SQL score.)`;
  }
  const rq = evalResult.resultEval.resultQuality;
  const vf = evalResult.resultEval.vizFit;
  const raw =
    sql * JUDGE_WEIGHTS.sql +
    rq * JUDGE_WEIGHTS.result +
    vf * JUDGE_WEIGHTS.viz;
  return [
    `0.6 × SQL (${sql.toFixed(1)})`,
    `+ 0.25 × Result (${rq.toFixed(1)})`,
    `+ 0.15 × Viz (${vf.toFixed(1)})`,
    `= ${raw.toFixed(2)} → ${evalResult.overall.toFixed(1)}/10`,
  ].join("\n");
}

export function formatSqlJudgeHeaderTooltip(): string {
  return "SQL-only judge score (validity, intent, compliance, efficiency). Not blended with Athena result or viz.";
}
