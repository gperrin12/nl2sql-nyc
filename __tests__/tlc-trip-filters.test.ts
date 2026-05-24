import { describe, it, expect } from "vitest";
import {
  sqlUsesGtpTlcData,
  hasTlcTripDistanceFilter,
  validateTlcProofDistances,
  TLC_MAX_TRIP_DISTANCE_MILES,
} from "@/lib/tlc-trip-filters";

describe("sqlUsesGtpTlcData", () => {
  it("returns true when gtp_tlc_data appears in FROM clause", () => {
    expect(sqlUsesGtpTlcData("SELECT * FROM gtp_tlc_data")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(sqlUsesGtpTlcData("SELECT * FROM GTP_TLC_DATA")).toBe(true);
  });

  it("returns false for a different table", () => {
    expect(sqlUsesGtpTlcData("SELECT * FROM nyc_311")).toBe(false);
  });

  it("returns false for a table that contains gtp_tlc_data as a substring of a longer name", () => {
    // word boundary: prefix_gtp_tlc_data should not match
    expect(sqlUsesGtpTlcData("SELECT * FROM prefix_gtp_tlc_data")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(sqlUsesGtpTlcData("")).toBe(false);
  });
});

describe("hasTlcTripDistanceFilter", () => {
  it("returns true when SQL does not reference gtp_tlc_data", () => {
    expect(hasTlcTripDistanceFilter("SELECT COUNT(*) FROM nyc_311")).toBe(true);
  });

  it("returns true when SQL references gtp_tlc_data but not trip_distance", () => {
    expect(hasTlcTripDistanceFilter("SELECT COUNT(*) FROM gtp_tlc_data WHERE pulocationid IS NOT NULL")).toBe(true);
  });

  it("returns true for TRY_CAST(trip_distance AS DOUBLE) <= 50", () => {
    const sql =
      "SELECT * FROM gtp_tlc_data WHERE TRY_CAST(trip_distance AS DOUBLE) > 0 AND TRY_CAST(trip_distance AS DOUBLE) <= 50";
    expect(hasTlcTripDistanceFilter(sql)).toBe(true);
  });

  it("returns true for TRY_CAST(trip_distance AS DOUBLE) <= 100", () => {
    const sql =
      "SELECT * FROM gtp_tlc_data WHERE TRY_CAST(trip_distance AS DOUBLE) <= 100";
    expect(hasTlcTripDistanceFilter(sql)).toBe(true);
  });

  it("returns true for TRY_CAST(trip_distance AS DOUBLE) < 50", () => {
    const sql =
      "SELECT * FROM gtp_tlc_data WHERE TRY_CAST(trip_distance AS DOUBLE) < 50";
    expect(hasTlcTripDistanceFilter(sql)).toBe(true);
  });

  it("returns true for BETWEEN 0 AND 50 on trip_distance", () => {
    const sql =
      "SELECT * FROM gtp_tlc_data WHERE trip_distance BETWEEN 0 AND 50";
    expect(hasTlcTripDistanceFilter(sql)).toBe(true);
  });

  it("returns true for trip_distance <= 50 without TRY_CAST", () => {
    const sql =
      "SELECT * FROM gtp_tlc_data WHERE trip_distance > 0 AND trip_distance <= 50";
    expect(hasTlcTripDistanceFilter(sql)).toBe(true);
  });

  it("returns false when trip_distance has no upper bound", () => {
    const sql =
      "SELECT AVG(trip_distance) FROM gtp_tlc_data WHERE trip_distance > 0";
    expect(hasTlcTripDistanceFilter(sql)).toBe(false);
  });

  it("returns false when trip_distance only has a lower bound", () => {
    const sql =
      "SELECT * FROM gtp_tlc_data WHERE TRY_CAST(trip_distance AS DOUBLE) > 0";
    expect(hasTlcTripDistanceFilter(sql)).toBe(false);
  });
});

describe("validateTlcProofDistances", () => {
  const distanceCols = ["avg_distance", "distance", "trip_distance"];

  it("returns ok when there are no distance-like columns", () => {
    const result = validateTlcProofDistances(
      ["borough", "trip_count"],
      [{ borough: "Manhattan", trip_count: "10000" }]
    );
    expect(result.ok).toBe(true);
  });

  it("returns ok for normal NYC taxi distances", () => {
    const result = validateTlcProofDistances(
      ["borough", "avg_distance"],
      [
        { borough: "Manhattan", avg_distance: "2.5" },
        { borough: "Brooklyn", avg_distance: "3.1" },
      ]
    );
    expect(result.ok).toBe(true);
  });

  it("returns ok when rows are empty", () => {
    const result = validateTlcProofDistances(["avg_distance"], []);
    expect(result.ok).toBe(true);
  });

  it("returns ok when distance column has all null values", () => {
    const result = validateTlcProofDistances(
      ["avg_distance"],
      [{ avg_distance: null }]
    );
    expect(result.ok).toBe(true);
  });

  it(`returns error when all distances exceed TLC_MAX_PLAUSIBLE_AVG_DISTANCE_MILES (${TLC_MAX_TRIP_DISTANCE_MILES})`, () => {
    const result = validateTlcProofDistances(
      ["avg_distance"],
      [
        { avg_distance: "75" },
        { avg_distance: "82" },
      ]
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/implausible/i);
    }
  });

  it("returns error when any distance exceeds 150 miles", () => {
    const result = validateTlcProofDistances(
      ["distance"],
      [
        { distance: "3.2" },
        { distance: "200" },
      ]
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/200/);
    }
  });

  it("handles comma-formatted numbers like '1,234'", () => {
    const result = validateTlcProofDistances(
      ["distance"],
      [{ distance: "200,000" }]
    );
    expect(result.ok).toBe(false);
  });

  it("returns ok for distance exactly at the max threshold", () => {
    const result = validateTlcProofDistances(
      ["avg_distance"],
      [{ avg_distance: String(TLC_MAX_TRIP_DISTANCE_MILES) }]
    );
    // At exactly the max, min === max === 50, which is not > 50, so should be ok.
    expect(result.ok).toBe(true);
  });
});
