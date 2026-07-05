import { describe, expect, it } from "vitest";
import { extractJsonText } from "@/lib/extract-json-text";

describe("extractJsonText", () => {
  it("parses raw JSON", () => {
    expect(extractJsonText('{"a":1}')).toBe('{"a":1}');
  });

  it("strips closed markdown fences", () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("strips unclosed opening fence (Haiku slip)", () => {
    expect(extractJsonText('```json\n{"question":"x"}')).toBe('{"question":"x"}');
  });

  it("extracts first object from preamble + fence", () => {
    const raw =
      'Here is the trivia question:\n```json\n{"question":"Which borough?","options":["A","B","C","D"],"correctIndex":0,"sql":"SELECT 1","explanation":"Because A."}\n```';
    const json = extractJsonText(raw);
    expect(JSON.parse(json)).toMatchObject({ question: "Which borough?" });
  });

  it("respects braces inside SQL strings", () => {
    const raw = JSON.stringify({
      question: "test",
      sql: "SELECT x FROM t WHERE y = '{not json}'",
    });
    expect(extractJsonText(raw)).toBe(raw);
  });
});
