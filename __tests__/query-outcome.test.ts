import { describe, it, expect } from "vitest";
import {
  classifyNonSqlGeneration,
  isOffTopicRefusal,
  isValidSelectSql,
  outcomeForGuardrailBlocked,
  outcomeForOffTopic,
} from "@/lib/query-outcome";

describe("isValidSelectSql", () => {
  it("accepts SELECT and WITH", () => {
    expect(isValidSelectSql("SELECT 1")).toBe(true);
    expect(isValidSelectSql("  WITH c AS (SELECT 1) SELECT * FROM c")).toBe(true);
  });

  it("rejects prose and DML", () => {
    expect(isValidSelectSql("I cannot help with that.")).toBe(false);
    expect(isValidSelectSql("INSERT INTO foo VALUES (1)")).toBe(false);
  });
});

describe("isOffTopicRefusal", () => {
  it("detects scope refusals without SQL", () => {
    expect(
      isOffTopicRefusal(
        "I can only answer questions about the NYC civic data warehouse."
      )
    ).toBe(true);
    expect(isOffTopicRefusal("That question is off-topic for this dataset.")).toBe(
      true
    );
  });

  it("does not flag valid SQL as refusal", () => {
    expect(isOffTopicRefusal("SELECT borough FROM nyc_311 LIMIT 10")).toBe(false);
  });
});

describe("classifyNonSqlGeneration", () => {
  it("returns null for valid SQL", () => {
    expect(classifyNonSqlGeneration("SELECT 1")).toBeNull();
  });

  it("maps refusals to off_topic", () => {
    const outcome = classifyNonSqlGeneration(
      "I'm unable to help — outside the scope of this dataset."
    );
    expect(outcome).toMatchObject({
      athenaState: "BLOCKED",
      hallucinationType: "off_topic",
    });
  });

  it("maps missing SQL to no_sql_produced", () => {
    const outcome = classifyNonSqlGeneration("Here is a summary with no query.");
    expect(outcome).toMatchObject({
      athenaState: "FAILED",
      hallucinationType: "no_sql_produced",
    });
  });
});

describe("outcome helpers", () => {
  it("guardrail_blocked uses BLOCKED state", () => {
    expect(outcomeForGuardrailBlocked("INSERT not allowed")).toEqual({
      athenaState: "BLOCKED",
      hallucinationType: "guardrail_blocked",
      errorReason: "INSERT not allowed",
    });
  });

  it("off_topic uses BLOCKED state", () => {
    expect(outcomeForOffTopic()).toMatchObject({
      athenaState: "BLOCKED",
      hallucinationType: "off_topic",
    });
  });
});
