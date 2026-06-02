import { describe, expect, it } from "vitest";
import {
  getQuestionSource,
  resetQuestionSourceCache,
} from "@/lib/question-source";

describe("getQuestionSource", () => {
  it("classifies golden dataset questions", () => {
    resetQuestionSourceCache();
    expect(
      getQuestionSource(
        "How many yellow cab trips were taken in 2025?"
      )
    ).toBe("golden");
  });

  it("classifies question bank entries not only in golden", () => {
    resetQuestionSourceCache();
    expect(
      getQuestionSource(
        "How many 311 complaints were filed in each borough in 2024?"
      )
    ).toBe("bank");
  });

  it("classifies unknown questions as adhoc", () => {
    resetQuestionSourceCache();
    expect(
      getQuestionSource("What is the weather in NYC tomorrow?")
    ).toBe("adhoc");
  });
});
