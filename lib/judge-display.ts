/**
 * Client-safe helpers for displaying judge scores on the dashboard.
 */

import type { FullJudgeResult } from "@/lib/judge";

export function getSqlOverall(evalResult: FullJudgeResult): number {
  return evalResult.overall;
}

export function formatJudgeFormulaLabel(): string {
  return `Judge score (1-5)`;
}

export function formatJudgeHeaderTooltip(): string {
  return "Single judge score (1-5) for how well SQL answers the question.";
}

export function formatJudgeCellTooltip(evalResult: FullJudgeResult): string {
  return `Judge score: ${evalResult.overall.toFixed(0)}/5`;
}

export function formatSqlJudgeHeaderTooltip(): string {
  return "Judge score (single overall 1-5).";
}
