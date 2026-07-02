import { describe, it, expect } from "vitest";
import { validateTriviaQuestionSense } from "@/lib/trivia-sense";

describe("validateTriviaQuestionSense — minimum-direction questions", () => {
  const minQuestions = [
    "In 2025, which NYC borough had the lowest percentage of subway ridership using fair fare discounts?",
    "Which borough had the fewest 311 noise complaints in 2024?",
    "Which taxi zone had the smallest average fare in 2025?",
    "Which borough recorded the least motor vehicle collisions in 2024?",
    "Which subway station had the fastest growth... which zone had the shortest average trip?",
  ];

  for (const q of minQuestions) {
    it(`rejects: "${q.slice(0, 40)}…"`, () => {
      const result = validateTriviaQuestionSense(q);
      expect(result.ok).toBe(false);
    });
  }

  it("gives an actionable reason mentioning highest/most", () => {
    const result = validateTriviaQuestionSense(
      "Which borough had the lowest number of collisions in 2024?"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/highest|most|top/i);
  });

  it("does NOT reject 'at least' phrasing (not the superlative 'least')", () => {
    const result = validateTriviaQuestionSense(
      "Which borough had at least 10,000 collisions and the most injuries in 2024?"
    );
    expect(result.ok).toBe(true);
  });

  it("allows highest/most-direction questions", () => {
    const good = [
      "Which NYC borough had the most 311 noise complaints in 2024?",
      "Which taxi zone had the highest average fare (with at least 100 trips) in 2025?",
      "Which subway station complex had the busiest total ridership in 2025?",
    ];
    for (const q of good) {
      expect(validateTriviaQuestionSense(q).ok).toBe(true);
    }
  });

  it("still rejects the slowest-resolution framing? no — slowest maps to MAX and is allowed", () => {
    const result = validateTriviaQuestionSense(
      "Which borough was slowest to close its 311 complaints in 2024?"
    );
    expect(result.ok).toBe(true);
  });
});
