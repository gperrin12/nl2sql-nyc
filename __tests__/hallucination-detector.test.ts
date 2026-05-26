import { describe, expect, it } from "vitest";
import { detectSchemaHallucinations } from "@/lib/hallucination-detector";
import { getWarehouseSchemaMap } from "@/lib/hallucination-schema";

describe("hallucination detector", () => {
  const schema = getWarehouseSchemaMap();

  it("flags borough_name on nyc_311 as invalid column", () => {
    const sql = "SELECT borough_name FROM nyc_311 WHERE year = '2024' LIMIT 10";
    const r = detectSchemaHallucinations(sql, schema);
    expect(r.hasHallucination).toBe(true);
    expect(r.invalidColumns).toContain("borough_name");
  });

  it("accepts borough on nyc_311", () => {
    const sql = "SELECT borough FROM nyc_311 LIMIT 10";
    const r = detectSchemaHallucinations(sql, schema);
    expect(r.hasHallucination).toBe(false);
    expect(r.invalidColumns).toEqual([]);
  });

  it("does not flag SELECT alias columns", () => {
    const sql = "SELECT COUNT(*) AS complaint_count FROM nyc_311";
    const r = detectSchemaHallucinations(sql, schema);
    expect(r.hasHallucination).toBe(false);
    expect(r.invalidColumns).not.toContain("complaint_count");
  });

  it("flags invalid table names", () => {
    const sql = "SELECT borough FROM fake_table LIMIT 1";
    const r = detectSchemaHallucinations(sql, schema);
    expect(r.hasHallucination).toBe(true);
    expect(r.invalidTables).toContain("fake_table");
  });
});
