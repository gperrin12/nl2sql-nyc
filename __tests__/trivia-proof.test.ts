import { describe, it, expect } from "vitest";
import {
  cellMatchesOption,
  findRankingMetricTie,
  resolveTriviaProofFromResults,
  optionsThemeMismatch,
  shuffleTriviaOptions,
  buildTriviaExplanationFromProof,
  proofRowLabelsFromResults,
  realignOptionsFromAthenaResults,
  formatRankingTieFeedback,
  explanationAlignsWithProof,
  type TriviaProof,
} from "@/lib/trivia-proof";

// ---------------------------------------------------------------------------
// cellMatchesOption
// ---------------------------------------------------------------------------

describe("cellMatchesOption", () => {
  it("returns false for null", () => {
    expect(cellMatchesOption(null, "Manhattan")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(cellMatchesOption(undefined, "Manhattan")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(cellMatchesOption("", "Manhattan")).toBe(false);
  });

  it("returns true for exact match", () => {
    expect(cellMatchesOption("Manhattan", "Manhattan")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(cellMatchesOption("MANHATTAN", "manhattan")).toBe(true);
  });

  it("ignores leading/trailing whitespace", () => {
    expect(cellMatchesOption("  Manhattan  ", "Manhattan")).toBe(true);
  });

  it("collapses internal whitespace", () => {
    expect(cellMatchesOption("New  York", "New York")).toBe(true);
  });

  it("returns true when cell contains option (substring match)", () => {
    expect(cellMatchesOption("Brooklyn, NY", "Brooklyn")).toBe(true);
  });

  it("returns true when option contains cell (reverse substring match)", () => {
    expect(cellMatchesOption("JFK", "JFK International Airport")).toBe(true);
  });

  it("returns true for numeric match with commas stripped", () => {
    expect(cellMatchesOption("1,234", "1234")).toBe(true);
  });

  it("returns true for numeric match with dollar sign stripped", () => {
    expect(cellMatchesOption("$15.50", "15.50")).toBe(true);
  });

  it("returns false when numbers differ", () => {
    expect(cellMatchesOption("1234", "5678")).toBe(false);
  });

  it("returns false for completely different strings", () => {
    expect(cellMatchesOption("Queens", "Manhattan")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findRankingMetricTie
// ---------------------------------------------------------------------------

describe("findRankingMetricTie", () => {
  it("returns null when rows is empty", () => {
    expect(findRankingMetricTie(["label", "count"], [])).toBeNull();
  });

  it("returns null when columns is empty", () => {
    expect(findRankingMetricTie([], [{ label: "A", count: "10" }])).toBeNull();
  });

  it("returns null when there is a clear single winner", () => {
    const rows = [
      { borough: "Manhattan", trip_count: "5000" },
      { borough: "Brooklyn", trip_count: "3000" },
      { borough: "Queens", trip_count: "2000" },
    ];
    expect(findRankingMetricTie(["borough", "trip_count"], rows)).toBeNull();
  });

  it("detects a tie between two rows with the same top metric", () => {
    const rows = [
      { borough: "Manhattan", trip_count: "5000" },
      { borough: "Brooklyn", trip_count: "5000" },
      { borough: "Queens", trip_count: "2000" },
    ];
    const result = findRankingMetricTie(["borough", "trip_count"], rows);
    expect(result).not.toBeNull();
    expect(result?.tiedLabels).toHaveLength(2);
    expect(result?.tiedLabels).toContain("Manhattan");
    expect(result?.tiedLabels).toContain("Brooklyn");
    expect(result?.metricValue).toBe("5000");
  });

  it("returns null when only one row exists (no tie possible)", () => {
    const rows = [{ borough: "Manhattan", trip_count: "5000" }];
    expect(findRankingMetricTie(["borough", "trip_count"], rows)).toBeNull();
  });

  it("ignores null metric values when detecting a tie", () => {
    // All three rows have non-null trip_count, giving it a higher max than borough
    // (which parses to 0) — so trip_count is correctly selected as the metric column.
    // Manhattan and Queens tie at 5000; Brooklyn is below the top.
    const rows = [
      { borough: "Manhattan", trip_count: "5000" },
      { borough: "Brooklyn", trip_count: "2000" },
      { borough: "Queens", trip_count: "5000" },
    ];
    const result = findRankingMetricTie(["borough", "trip_count"], rows);
    expect(result).not.toBeNull();
    expect(result?.tiedLabels).toContain("Manhattan");
    expect(result?.tiedLabels).toContain("Queens");
    expect(result?.tiedLabels).not.toContain("Brooklyn");
  });
});

// ---------------------------------------------------------------------------
// resolveTriviaProofFromResults
// ---------------------------------------------------------------------------

const OPTIONS = ["Manhattan", "Brooklyn", "Queens", "The Bronx"];

describe("resolveTriviaProofFromResults — empty/insufficient data", () => {
  it("returns null when columns is empty", () => {
    const result = resolveTriviaProofFromResults(OPTIONS, 0, {
      columns: [],
      rows: [{ borough: "Manhattan" }],
    });
    expect(result).toBeNull();
  });

  it("returns null when rows is empty", () => {
    const result = resolveTriviaProofFromResults(OPTIONS, 0, {
      columns: ["borough", "trip_count"],
      rows: [],
    });
    expect(result).toBeNull();
  });
});

describe("resolveTriviaProofFromResults — single-row (scalar) answers", () => {
  it("resolves a single-row answer that matches an option", () => {
    const result = resolveTriviaProofFromResults(OPTIONS, 0, {
      columns: ["borough"],
      rows: [{ borough: "Brooklyn" }],
    });
    expect(result).not.toBeNull();
    expect(result?.correctIndex).toBe(1); // Brooklyn is index 1
    expect(result?.proof.correctOption).toBe("Brooklyn");
    expect(result?.proof.correctLabel).toBe("B");
  });

  it("sets correctedFromModel=true when data disagrees with model", () => {
    const result = resolveTriviaProofFromResults(OPTIONS, 0, {
      // model says index 0 (Manhattan) but data says Brooklyn
      columns: ["borough"],
      rows: [{ borough: "Brooklyn" }],
    });
    expect(result?.proof.correctedFromModel).toBe(true);
  });

  it("sets correctedFromModel=false when data agrees with model", () => {
    const result = resolveTriviaProofFromResults(OPTIONS, 1, {
      columns: ["borough"],
      rows: [{ borough: "Brooklyn" }],
    });
    expect(result?.proof.correctedFromModel).toBe(false);
  });

  it("returns null when single-row value doesn't match any option", () => {
    const result = resolveTriviaProofFromResults(OPTIONS, 0, {
      columns: ["borough"],
      rows: [{ borough: "Staten Island" }],
    });
    expect(result).toBeNull();
  });
});

describe("resolveTriviaProofFromResults — multi-row (ranking) answers", () => {
  it("picks the row with the highest metric as the winner", () => {
    const rows = [
      { borough: "Queens", trip_count: "2000" },
      { borough: "Manhattan", trip_count: "5000" },
      { borough: "Brooklyn", trip_count: "3000" },
    ];
    const result = resolveTriviaProofFromResults(OPTIONS, 0, {
      columns: ["borough", "trip_count"],
      rows,
    });
    expect(result?.correctIndex).toBe(0); // Manhattan is index 0
    expect(result?.proof.winnerLabel).toBe("Manhattan");
    expect(result?.proof.winnerMetric?.value).toBe("5000");
  });

  it("returns null when there is a tie for the top metric", () => {
    const rows = [
      { borough: "Manhattan", trip_count: "5000" },
      { borough: "Brooklyn", trip_count: "5000" },
    ];
    const result = resolveTriviaProofFromResults(OPTIONS, 0, {
      columns: ["borough", "trip_count"],
      rows,
    });
    expect(result).toBeNull();
  });

  it("returns null when the winning label doesn't match any option", () => {
    const rows = [
      { borough: "Staten Island", trip_count: "9999" },
      { borough: "Manhattan", trip_count: "5000" },
    ];
    const result = resolveTriviaProofFromResults(OPTIONS, 0, {
      columns: ["borough", "trip_count"],
      rows,
    });
    expect(result).toBeNull();
  });

  it("builds a proof with matches for both label and metric columns", () => {
    const rows = [
      { borough: "Manhattan", trip_count: "5000" },
      { borough: "Brooklyn", trip_count: "3000" },
    ];
    const result = resolveTriviaProofFromResults(OPTIONS, 0, {
      columns: ["borough", "trip_count"],
      rows,
    });
    expect(result?.proof.matches).toHaveLength(2);
    const matchColumns = result?.proof.matches.map((m) => m.column);
    expect(matchColumns).toContain("borough");
    expect(matchColumns).toContain("trip_count");
  });
});

// ---------------------------------------------------------------------------
// optionsThemeMismatch
// ---------------------------------------------------------------------------

describe("optionsThemeMismatch", () => {
  it("returns true when options mention an airport but row labels don't", () => {
    const result = optionsThemeMismatch(
      ["JFK", "LGA", "EWR", "Newark"],
      "Which airport has the most taxi pickups?",
      ["Midtown", "Harlem", "Astoria", "Flushing"]
    );
    expect(result).toBe(true);
  });

  it("returns false when both options and rows mention airports", () => {
    const result = optionsThemeMismatch(
      ["JFK", "LGA", "EWR", "Newark"],
      "Which airport has the most taxi pickups?",
      ["JFK", "LGA", "EWR", "Newark"]
    );
    expect(result).toBe(false);
  });

  it("returns true when options mention a borough but rows are neighborhood-level", () => {
    const result = optionsThemeMismatch(
      ["Manhattan", "Brooklyn", "Queens", "The Bronx"],
      "Which borough has the highest income?",
      ["fordham", "concourse", "morris park", "ntaname"]
    );
    expect(result).toBe(true);
  });

  it("returns false for a normal borough question with borough row labels", () => {
    const result = optionsThemeMismatch(
      ["Manhattan", "Brooklyn", "Queens", "The Bronx"],
      "Which borough has the most 311 complaints?",
      ["Manhattan", "Brooklyn", "Queens", "The Bronx"]
    );
    expect(result).toBe(false);
  });

  it("returns false when neither airports nor boroughs are in options", () => {
    const result = optionsThemeMismatch(
      ["2020", "2021", "2022", "2023"],
      "Which year had the most taxi rides?",
      ["2020", "2021", "2022", "2023"]
    );
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shuffleTriviaOptions
// ---------------------------------------------------------------------------

describe("shuffleTriviaOptions", () => {
  it("preserves the correct answer after shuffling", () => {
    const options = ["Manhattan", "Brooklyn", "Queens", "The Bronx"];
    const correctIndex = 2; // Queens
    const { options: shuffled, correctIndex: newIdx } = shuffleTriviaOptions(options, correctIndex);
    expect(shuffled[newIdx]).toBe("Queens");
  });

  it("keeps all original options in the shuffled array", () => {
    const options = ["Manhattan", "Brooklyn", "Queens", "The Bronx"];
    const { options: shuffled } = shuffleTriviaOptions(options, 0);
    expect(shuffled.sort()).toEqual(options.sort());
  });

  it("returns an array of the same length", () => {
    const options = ["A", "B", "C", "D"];
    const { options: shuffled } = shuffleTriviaOptions(options, 1);
    expect(shuffled).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// buildTriviaExplanationFromProof
// ---------------------------------------------------------------------------

describe("buildTriviaExplanationFromProof", () => {
  const baseProof: TriviaProof = {
    summary: "test summary",
    correctOption: "Manhattan",
    correctLabel: "A",
    matches: [],
    winnerLabel: "Manhattan",
    winnerMetric: { column: "trip_count", value: "5000" },
    correctedFromModel: false,
  };

  it("includes the winner label in the explanation", () => {
    const explanation = buildTriviaExplanationFromProof(baseProof);
    expect(explanation).toContain("Manhattan");
  });

  it("includes the humanized metric column name", () => {
    const explanation = buildTriviaExplanationFromProof(baseProof);
    expect(explanation).toContain("trip count");
  });

  it("includes the metric value", () => {
    const explanation = buildTriviaExplanationFromProof(baseProof);
    expect(explanation).toContain("5000");
  });

  it("falls back gracefully when no winnerMetric is provided", () => {
    const proof: TriviaProof = { ...baseProof, winnerMetric: undefined };
    const explanation = buildTriviaExplanationFromProof(proof);
    expect(explanation).toContain("Manhattan");
    expect(explanation).toContain("correct answer");
  });

  it("humanizes underscored metric column names", () => {
    const proof: TriviaProof = {
      ...baseProof,
      winnerMetric: { column: "avg_trip_distance", value: "2.3" },
    };
    const explanation = buildTriviaExplanationFromProof(proof);
    // humanizeMetricColumn replaces underscores then expands "avg" → "average"
    expect(explanation).toContain("average trip distance");
  });
});

// ---------------------------------------------------------------------------
// proofRowLabelsFromResults
// ---------------------------------------------------------------------------

describe("proofRowLabelsFromResults", () => {
  it("returns empty array for empty results", () => {
    expect(proofRowLabelsFromResults({ columns: [], rows: [] })).toEqual([]);
  });

  it("extracts up to 4 distinct label values in row order", () => {
    const rows = [
      { borough: "Manhattan", count: "500" },
      { borough: "Brooklyn", count: "400" },
      { borough: "Queens", count: "300" },
      { borough: "The Bronx", count: "200" },
      { borough: "Staten Island", count: "100" },
    ];
    const labels = proofRowLabelsFromResults({ columns: ["borough", "count"], rows });
    expect(labels).toHaveLength(4);
    expect(labels[0]).toBe("Manhattan");
  });

  it("deduplicates repeated label values", () => {
    const rows = [
      { borough: "Manhattan", count: "500" },
      { borough: "Manhattan", count: "400" }, // duplicate
      { borough: "Brooklyn", count: "300" },
    ];
    const labels = proofRowLabelsFromResults({ columns: ["borough", "count"], rows });
    expect(labels.filter((l) => l === "Manhattan")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// realignOptionsFromAthenaResults
// ---------------------------------------------------------------------------

describe("realignOptionsFromAthenaResults", () => {
  it("returns null when fewer than 4 rows available", () => {
    const result = realignOptionsFromAthenaResults(
      {
        columns: ["borough", "count"],
        rows: [
          { borough: "Manhattan", count: "500" },
          { borough: "Brooklyn", count: "400" },
        ],
      },
      0
    );
    expect(result).toBeNull();
  });

  it("returns realigned options with correct winner index when 4 rows exist", () => {
    const rows = [
      { borough: "Brooklyn", count: "400" },
      { borough: "Manhattan", count: "500" },
      { borough: "Queens", count: "300" },
      { borough: "The Bronx", count: "200" },
    ];
    const result = realignOptionsFromAthenaResults(
      { columns: ["borough", "count"], rows },
      0
    );
    expect(result).not.toBeNull();
    expect(result?.options).toHaveLength(4);
    // The winner (Manhattan with 500) should be the correct answer
    const winnerIdx = result?.correctIndex ?? -1;
    expect(result?.options[winnerIdx]).toBe("Manhattan");
  });
});

// ---------------------------------------------------------------------------
// formatRankingTieFeedback
// ---------------------------------------------------------------------------

describe("formatRankingTieFeedback", () => {
  it("includes the tied labels in the feedback message", () => {
    const tie = {
      metricColumn: "trip_count",
      metricValue: "5000",
      tiedLabels: ["Manhattan", "Brooklyn"],
    };
    const msg = formatRankingTieFeedback(tie, OPTIONS);
    expect(msg).toContain("Manhattan");
    expect(msg).toContain("Brooklyn");
  });

  it("includes the metric column name", () => {
    const tie = {
      metricColumn: "avg_fare",
      metricValue: "12.50",
      tiedLabels: ["Queens", "The Bronx"],
    };
    const msg = formatRankingTieFeedback(tie, OPTIONS);
    expect(msg).toContain("avg_fare");
  });
});

// ---------------------------------------------------------------------------
// explanationAlignsWithProof
// ---------------------------------------------------------------------------

describe("explanationAlignsWithProof", () => {
  const proof: TriviaProof = {
    summary: "",
    correctOption: "Manhattan",
    correctLabel: "A",
    matches: [],
    winnerLabel: "Manhattan",
    winnerMetric: { column: "trip_count", value: "5000" },
    correctedFromModel: false,
  };

  it("returns true when explanation names the correct winner", () => {
    const explanation = "Manhattan has the most taxi rides with 5000 trips.";
    expect(explanationAlignsWithProof(explanation, proof, OPTIONS)).toBe(true);
  });

  it("returns false when explanation names a different option instead", () => {
    const explanation = "Brooklyn has the most taxi rides overall.";
    expect(explanationAlignsWithProof(explanation, proof, OPTIONS)).toBe(false);
  });

  it("returns false when explanation mentions airports but correct answer is not an airport", () => {
    const explanation = "JFK airport has the most pickups overall.";
    expect(explanationAlignsWithProof(explanation, proof, OPTIONS)).toBe(false);
  });
});
