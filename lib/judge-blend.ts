/** Full-eval overall: (1×SQL + 2×Result + 1×Viz) / 4 */

export const JUDGE_BLEND_COEFF = { sql: 1, result: 2, viz: 1 } as const;
export const JUDGE_BLEND_DIVISOR = 4;

function clampScore(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

export function blendJudgeOverall(
  sql: number,
  resultQuality: number,
  vizFit: number
): number {
  const raw =
    sql * JUDGE_BLEND_COEFF.sql +
    resultQuality * JUDGE_BLEND_COEFF.result +
    vizFit * JUDGE_BLEND_COEFF.viz;
  return clampScore(raw / JUDGE_BLEND_DIVISOR);
}
