import { describe, expect, it } from "vitest";
import { evaluateJudgeScoreRegression } from "@/lib/regression-check";

describe("evaluateJudgeScoreRegression", () => {
  const baseline = { avgScore: 4.0, sampleCount: 20 };
  const current = { avgScore: 3.8, sampleCount: 12 };

  it("passes when drop is within threshold", () => {
    const result = evaluateJudgeScoreRegression(baseline, current, {
      dropThreshold: 0.1,
      minSamples: 5,
    });
    expect(result.status).toBe("pass");
    if (result.status === "pass") {
      expect(result.dropPct).toBeCloseTo(0.05);
    }
  });

  it("fails when drop exceeds threshold", () => {
    const result = evaluateJudgeScoreRegression(
      baseline,
      { avgScore: 3.0, sampleCount: 10 },
      { dropThreshold: 0.1, minSamples: 5 }
    );
    expect(result.status).toBe("fail");
    if (result.status === "fail") {
      expect(result.dropPct).toBeCloseTo(0.25);
      expect(result.message).toContain("25.0%");
    }
  });

  it("skips when sample count is too low", () => {
    const result = evaluateJudgeScoreRegression(
      { avgScore: 4, sampleCount: 2 },
      current,
      { minSamples: 5 }
    );
    expect(result.status).toBe("skip");
  });
});
