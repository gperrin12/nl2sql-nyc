import { describe, expect, it } from "vitest";
import {
  judgeDetailFromResult,
  parseJudgeDetail,
} from "@/lib/judge-detail";

describe("judgeDetailFromResult", () => {
  it("maps issues to reasoning", () => {
    const detail = judgeDetailFromResult({
      overall: 2,
      verdict: "incorrect",
      issues: ["Wrong year filter; used 2023 instead of last year."],
      judgedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(detail.reasoning).toContain("Wrong year filter");
    expect(detail.overall).toBe(2);
    expect(detail.verdict).toBe("incorrect");
    expect(detail.judgeModel).toBe("claude-haiku-4-5");
  });
});

describe("parseJudgeDetail", () => {
  it("parses JSON object", () => {
    const detail = parseJudgeDetail({
      overall: 4,
      verdict: "partial",
      reasoning: "Minor alias issue.",
      judgedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(detail?.reasoning).toBe("Minor alias issue.");
  });

  it("returns null for invalid payload", () => {
    expect(parseJudgeDetail({ overall: "nope" })).toBeNull();
  });
});
