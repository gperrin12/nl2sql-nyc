import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  computeTimeRemaining,
  pickNextBuildCategory,
  shouldAutoReveal,
} from "@/lib/trivia-room";

describe("computeTimeRemaining", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the full window right after the question starts", () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(computeTimeRemaining(new Date(now).toISOString(), 60)).toBe(60);
  });

  it("counts down as time elapses", () => {
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start + 15_000);
    expect(computeTimeRemaining(new Date(start).toISOString(), 60)).toBe(45);
  });

  it("never goes below zero once the window has passed", () => {
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start + 90_000);
    expect(computeTimeRemaining(new Date(start).toISOString(), 60)).toBe(0);
  });

  it("returns zero for an unparseable timestamp", () => {
    expect(computeTimeRemaining("not-a-date", 60)).toBe(0);
  });
});

describe("shouldAutoReveal", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const freshStart = () => new Date().toISOString();

  it("does not reveal while the timer is running and not everyone has answered", () => {
    expect(
      shouldAutoReveal({
        startedAt: freshStart(),
        durationSeconds: 60,
        answeredCount: 1,
        expectedAnswerers: 3,
      })
    ).toBe(false);
  });

  it("reveals once the countdown has expired", () => {
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const startedAt = new Date(start).toISOString();
    vi.setSystemTime(start + 61_000);
    expect(
      shouldAutoReveal({
        startedAt,
        durationSeconds: 60,
        answeredCount: 0,
        expectedAnswerers: 3,
      })
    ).toBe(true);
  });

  it("reveals early once every expected player has answered", () => {
    expect(
      shouldAutoReveal({
        startedAt: freshStart(),
        durationSeconds: 60,
        answeredCount: 3,
        expectedAnswerers: 3,
      })
    ).toBe(true);
  });

  it("does not reveal early in a host-only room (no expected answerers)", () => {
    expect(
      shouldAutoReveal({
        startedAt: freshStart(),
        durationSeconds: 60,
        answeredCount: 0,
        expectedAnswerers: 0,
      })
    ).toBe(false);
  });

  it("does not reveal when the question has not started yet", () => {
    expect(
      shouldAutoReveal({
        startedAt: null,
        durationSeconds: 60,
        answeredCount: 0,
        expectedAnswerers: 3,
      })
    ).toBe(false);
  });
});

describe("pickNextBuildCategory", () => {
  it("rotates through the plan when all categories have equal failures", () => {
    const plan = ["a", "b", "c"];
    const fails = new Map<string, number>();
    expect(pickNextBuildCategory(plan, fails, 0)).toBe("a");
    expect(pickNextBuildCategory(plan, fails, 1)).toBe("b");
    expect(pickNextBuildCategory(plan, fails, 2)).toBe("c");
  });

  it("prefers less-failed categories over a sticky-failing one", () => {
    const plan = ["bad", "good", "also-good"];
    const fails = new Map([["bad", 3]]);
    expect(pickNextBuildCategory(plan, fails, 0)).toBe("good");
    expect(pickNextBuildCategory(plan, fails, 3)).toBe("good");
  });
});

describe("buildLockedQuestionSet", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function mockVerifiedQuestion(categoryId: string, n: number) {
    return {
      ok: true as const,
      question: {
        question: `Question ${n} from ${categoryId}?`,
        options: ["A", "B", "C", "D"],
        correctIndex: 0,
        sql: "SELECT 1",
        explanation: "Because Athena said so.",
        model: "test-model",
        categoryId,
        categoryLabel: categoryId,
        proof: {
          answerLabel: "A",
          metricLabel: "count",
          metricValue: "1",
          ranking: [],
        },
        results: { columns: ["x"], rows: [{ x: "1" }] },
        scannedBytes: 0,
        runtimeMs: 1,
      },
    };
  }

  it("skips a sticky-failing category and still fills the exact length", async () => {
    const generateVerifiedTriviaQuestion = vi.fn(
      async (session: { categoryId?: string }) => {
        if (session.categoryId === "bad") {
          return {
            ok: false as const,
            error: "Could not produce a verified trivia question",
            detail: "ranking tie",
          };
        }
        const n = generateVerifiedTriviaQuestion.mock.calls.length;
        return mockVerifiedQuestion(session.categoryId ?? "good", n);
      }
    );

    vi.doMock("@/lib/trivia-generate-verified", () => ({
      generateVerifiedTriviaQuestion,
    }));
    vi.doMock("@/lib/trivia-categories", async () => {
      const actual = await vi.importActual<
        typeof import("@/lib/trivia-categories")
      >("@/lib/trivia-categories");
      return {
        ...actual,
        buildSessionCategoryPlan: () => ["bad", "good", "also-good"],
        categoriesForDeck: () => [
          { id: "bad", family: "x", label: "bad" },
          { id: "good", family: "y", label: "good" },
          { id: "also-good", family: "z", label: "also" },
        ],
      };
    });

    const { buildLockedQuestionSet } = await import("@/lib/trivia-room");
    const questions = await buildLockedQuestionSet(3);

    expect(questions).toHaveLength(3);
    expect(questions.every((q) => !q.question.includes(" from bad"))).toBe(
      true
    );
    expect(
      generateVerifiedTriviaQuestion.mock.calls.some(
        (c) => c[0].categoryId === "bad"
      )
    ).toBe(true);
  });

  it("throws when the attempt budget cannot fill the requested length", async () => {
    const generateVerifiedTriviaQuestion = vi.fn(async () => ({
      ok: false as const,
      error: "Could not produce a verified trivia question",
      detail: "Athena returned zero rows",
    }));

    vi.doMock("@/lib/trivia-generate-verified", () => ({
      generateVerifiedTriviaQuestion,
    }));
    vi.doMock("@/lib/trivia-categories", async () => {
      const actual = await vi.importActual<
        typeof import("@/lib/trivia-categories")
      >("@/lib/trivia-categories");
      return {
        ...actual,
        buildSessionCategoryPlan: (length: number) =>
          Array.from({ length }, (_, i) => `cat-${i}`),
        categoriesForDeck: () =>
          Array.from({ length: 3 }, (_, i) => ({
            id: `cat-${i}`,
            family: `f${i}`,
            label: `cat ${i}`,
          })),
      };
    });

    const { buildLockedQuestionSet } = await import("@/lib/trivia-room");
    await expect(buildLockedQuestionSet(3)).rejects.toThrow(
      /Failed to build full trivia question set \(0\/3\): Athena returned zero rows/
    );
    // Budget = length * 4 = 12 attempts, not an early abort after 4.
    expect(generateVerifiedTriviaQuestion).toHaveBeenCalledTimes(12);
  });

  it("returns exactly the requested length on a clean run", async () => {
    let n = 0;
    const generateVerifiedTriviaQuestion = vi.fn(
      async (session: { categoryId?: string }) => {
        n += 1;
        return mockVerifiedQuestion(session.categoryId ?? "c", n);
      }
    );

    vi.doMock("@/lib/trivia-generate-verified", () => ({
      generateVerifiedTriviaQuestion,
    }));
    vi.doMock("@/lib/trivia-categories", async () => {
      const actual = await vi.importActual<
        typeof import("@/lib/trivia-categories")
      >("@/lib/trivia-categories");
      return {
        ...actual,
        buildSessionCategoryPlan: (length: number) =>
          Array.from({ length }, (_, i) => `cat-${i}`),
        categoriesForDeck: () =>
          Array.from({ length: 5 }, (_, i) => ({
            id: `cat-${i}`,
            family: `f${i}`,
            label: `cat ${i}`,
          })),
      };
    });

    const { buildLockedQuestionSet } = await import("@/lib/trivia-room");
    const questions = await buildLockedQuestionSet(5);
    expect(questions).toHaveLength(5);
    expect(generateVerifiedTriviaQuestion).toHaveBeenCalledTimes(5);
  });
});
