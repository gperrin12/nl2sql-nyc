import { describe, expect, it } from "vitest";
import {
  buildSessionCategoryPlan,
  categoriesForDeck,
  DEFAULT_TRIVIA_DECK,
  pickCategoryForRequest,
} from "@/lib/trivia-categories";

describe("trivia decks", () => {
  it("defaults to MTA deck", () => {
    expect(DEFAULT_TRIVIA_DECK).toBe("mta");
  });

  it("MTA deck is all templated transit archetypes", () => {
    const mta = categoriesForDeck("mta");
    expect(mta.length).toBe(18);
    for (const def of mta) {
      expect(def.family).toBe("transit");
    }
  });

  it("filters 311 categories to 311 families only", () => {
    const threeEleven = categoriesForDeck("311");
    expect(threeEleven.length).toBeGreaterThan(0);
    expect(
      threeEleven.every(
        (d) => d.family === "311" || d.family === "311_resolution"
      )
    ).toBe(true);
  });

  it("builds MTA session plans from transit categories only", () => {
    const plan = buildSessionCategoryPlan(10, categoriesForDeck("mta"));
    expect(plan).toHaveLength(10);
    for (const id of plan) {
      const def = categoriesForDeck("mta").find((d) => d.id === id);
      expect(def).toBeDefined();
    }
  });

  it("pickCategoryForRequest respects deck when categoryId is missing", () => {
    const picked = pickCategoryForRequest({ deck: "311" });
    expect(["311", "311_resolution"]).toContain(picked.family);
  });
});
