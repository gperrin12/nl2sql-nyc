import { describe, expect, it } from "vitest";
import {
  buildDashboardJudgeView,
  verdictFromJudgeOverall,
} from "@/lib/dashboard-judge-view";

describe("verdictFromJudgeOverall", () => {
  it("maps rubric scores to verdicts", () => {
    expect(verdictFromJudgeOverall(5)).toBe("correct");
    expect(verdictFromJudgeOverall(4)).toBe("partial");
    expect(verdictFromJudgeOverall(3)).toBe("incorrect");
    expect(verdictFromJudgeOverall(1)).toBe("incorrect");
  });
});

describe("buildDashboardJudgeView", () => {
  it("derives category and dataset from question and sql", () => {
    const view = buildDashboardJudgeView(
      "How many 311 complaints in Brooklyn in 2024?",
      "SELECT COUNT(*) FROM nyc_311 WHERE borough = 'BROOKLYN' AND year = '2024'",
      4
    );
    expect(view.overall).toBe(4);
    expect(view.verdict).toBe("partial");
    expect(view.category).toBeTruthy();
    expect(view.dataset).toBe("311");
  });
});
