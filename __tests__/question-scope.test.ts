import { describe, it, expect } from "vitest";
import { isOffTopicHeuristic } from "@/lib/question-scope";

describe("isOffTopicHeuristic", () => {
  it("flags general-knowledge questions without NYC context", () => {
    expect(isOffTopicHeuristic("what's the capital of egypt")).toBe(true);
    expect(isOffTopicHeuristic("Who was the president in 1999?")).toBe(true);
    expect(isOffTopicHeuristic("write me a joke about cats")).toBe(true);
  });

  it("allows NYC civic-data questions", () => {
    expect(
      isOffTopicHeuristic("how many 311 noise complaints in brooklyn in 2024")
    ).toBe(false);
    expect(isOffTopicHeuristic("yellow taxi pickups by zone in manhattan")).toBe(
      false
    );
    expect(
      isOffTopicHeuristic("nypd collisions with latitude longitude in 2024")
    ).toBe(false);
  });

  it("allows ambiguous questions through to generation", () => {
    expect(isOffTopicHeuristic("how many complaints last year")).toBe(false);
    expect(isOffTopicHeuristic("top zones by trip count")).toBe(false);
  });
});
