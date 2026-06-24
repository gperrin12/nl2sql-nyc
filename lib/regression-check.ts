export type RegressionSnapshot = {
  avgScore: number;
  sampleCount: number;
};

export type RegressionResult =
  | {
      status: "pass";
      baseline: RegressionSnapshot;
      current: RegressionSnapshot;
      dropPct: number;
    }
  | {
      status: "fail";
      baseline: RegressionSnapshot;
      current: RegressionSnapshot;
      dropPct: number;
      message: string;
    }
  | { status: "skip"; reason: string };

export function evaluateJudgeScoreRegression(
  baseline: RegressionSnapshot,
  current: RegressionSnapshot,
  options?: { dropThreshold?: number; minSamples?: number }
): RegressionResult {
  const dropThreshold = options?.dropThreshold ?? 0.1;
  const minSamples = options?.minSamples ?? 5;

  if (baseline.sampleCount < minSamples) {
    return {
      status: "skip",
      reason: `Baseline has ${baseline.sampleCount} judged runs (need ${minSamples})`,
    };
  }
  if (current.sampleCount < minSamples) {
    return {
      status: "skip",
      reason: `Current window has ${current.sampleCount} judged runs (need ${minSamples})`,
    };
  }

  const dropPct =
    baseline.avgScore > 0
      ? (baseline.avgScore - current.avgScore) / baseline.avgScore
      : 0;

  if (dropPct > dropThreshold) {
    return {
      status: "fail",
      baseline,
      current,
      dropPct,
      message:
        `Judge score dropped ${(dropPct * 100).toFixed(1)}% ` +
        `(baseline ${baseline.avgScore.toFixed(2)}/5 → current ${current.avgScore.toFixed(2)}/5, ` +
        `threshold ${(dropThreshold * 100).toFixed(0)}%)`,
    };
  }

  return { status: "pass", baseline, current, dropPct };
}
