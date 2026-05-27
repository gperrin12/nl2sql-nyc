/**
 * Client-safe helpers for displaying judge scores on the dashboard.
 */

import type { FullJudgeResult } from "@/lib/judge";
import {
  blendJudgeOverall,
  JUDGE_BLEND_COEFF,
  JUDGE_BLEND_DIVISOR,
} from "@/lib/judge-blend";

export { JUDGE_BLEND_COEFF, JUDGE_BLEND_DIVISOR };

function clampScore(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}

export function computeBlendedOverall(
  sql: number,
  resultQuality: number,
  vizFit: number
): number {
  return blendJudgeOverall(sql, resultQuality, vizFit);
}

/** SQL-only overall (stored on full eval, or inferred / equals overall for SQL-only). */
export function getSqlOverall(evalResult: FullJudgeResult): number {
  if (evalResult.sqlOverall != null && Number.isFinite(evalResult.sqlOverall)) {
    return evalResult.sqlOverall;
  }
  if (!evalResult.resultEval) return evalResult.overall;
  const re = evalResult.resultEval;
  const inferred =
    JUDGE_BLEND_DIVISOR * evalResult.overall -
    JUDGE_BLEND_COEFF.result * re.resultQuality -
    JUDGE_BLEND_COEFF.viz * re.vizFit;
  return clampScore(inferred / JUDGE_BLEND_COEFF.sql);
}

export function formatJudgeFormulaLabel(): string {
  return `(SQL + 2×Result + Viz) / 4`;
}

export function formatJudgeHeaderTooltip(): string {
  return [
    "Combined score (full eval):",
    "(1×SQL + 2×Result + 1×Viz) / 4",
    "Result counts twice as much as SQL or Viz.",
    "SQL-only evals: Judge equals SQL score.",
  ].join("\n");
}

export function formatJudgeCellTooltip(evalResult: FullJudgeResult): string {
  const sql = getSqlOverall(evalResult);
  if (!evalResult.resultEval) {
    return `SQL judge: ${sql.toFixed(0)}/5\n(No full eval — Judge equals SQL score.)`;
  }
  const rq = evalResult.resultEval.resultQuality;
  const vf = evalResult.resultEval.vizFit;
  const raw =
    sql * JUDGE_BLEND_COEFF.sql +
    rq * JUDGE_BLEND_COEFF.result +
    vf * JUDGE_BLEND_COEFF.viz;
  return [
    `(SQL + 2×Result + Viz) / 4`,
    `= (${sql.toFixed(0)} + 2×${rq.toFixed(0)} + ${vf.toFixed(0)}) / 4`,
    `= ${raw.toFixed(0)} / 4 = ${(raw / JUDGE_BLEND_DIVISOR).toFixed(2)} → ${evalResult.overall.toFixed(0)}/5`,
  ].join("\n");
}

export function formatSqlJudgeHeaderTooltip(): string {
  return "SQL-only judge score (single overall 1-5). Not blended with Athena result or viz.";
}
