import { describe, it, expect } from "vitest";
import { checkSql } from "@/lib/guardrails";
import { fixWarehouseDateCasts } from "@/lib/warehouse-date-casts";

// A minimal valid SELECT that satisfies all guardrails (no gtp_tlc_data, so TLC filter passes).
const VALID_SQL = "SELECT borough, COUNT(*) FROM nyc_311 GROUP BY borough";

// A valid TLC query with a proper trip_distance upper bound.
const VALID_TLC_SQL =
  "SELECT AVG(TRY_CAST(trip_distance AS DOUBLE)) FROM gtp_tlc_data t " +
  "WHERE TRY_CAST(t.trip_distance AS DOUBLE) > 0 AND TRY_CAST(t.trip_distance AS DOUBLE) <= 50";

describe("checkSql — empty / blank input", () => {
  it("rejects empty string", () => {
    expect(checkSql("")).toEqual({ ok: false, reason: "Empty SQL" });
  });

  it("rejects whitespace-only string", () => {
    expect(checkSql("   \n\t  ")).toEqual({ ok: false, reason: "Empty SQL" });
  });
});

describe("checkSql — multiple statements", () => {
  it("rejects two statements separated by semicolon", () => {
    const result = checkSql("SELECT 1; SELECT 2");
    expect(result).toMatchObject({ ok: false, reason: "Multiple SQL statements not allowed" });
  });

  it("allows a single trailing semicolon", () => {
    const result = checkSql(`${VALID_SQL};`);
    expect(result.ok).toBe(true);
  });

  it("rejects trailing semicolon followed by a second statement", () => {
    const result = checkSql(`${VALID_SQL}; DROP TABLE foo`);
    expect(result).toMatchObject({ ok: false });
  });
});

describe("checkSql — must start with SELECT or WITH", () => {
  it("accepts SELECT", () => {
    expect(checkSql(VALID_SQL).ok).toBe(true);
  });

  it("accepts WITH (CTE)", () => {
    const cte =
      "WITH counts AS (SELECT borough, COUNT(*) AS n FROM nyc_311 GROUP BY borough) SELECT * FROM counts";
    expect(checkSql(cte).ok).toBe(true);
  });

  it("rejects statements that start with something else", () => {
    expect(checkSql("EXPLAIN SELECT 1")).toMatchObject({ ok: false, reason: "Only SELECT / WITH queries are allowed" });
  });

  it("rejects statements starting with whitespace then forbidden verb", () => {
    expect(checkSql("  INSERT INTO foo VALUES (1)")).toMatchObject({ ok: false });
  });
});

describe("checkSql — forbidden DML/DDL keywords", () => {
  // All queries start with SELECT so the SELECT/WITH check passes first,
  // ensuring we specifically exercise the forbidden-keyword scanner.
  const cases: [string, string][] = [
    ["SELECT INSERT FROM foo", "INSERT"],
    ["SELECT UPDATE FROM foo", "UPDATE"],
    ["SELECT DELETE FROM foo", "DELETE"],
    ["SELECT DROP FROM foo", "DROP"],
    ["SELECT ALTER FROM foo", "ALTER"],
    ["SELECT CREATE FROM foo", "CREATE"],
    ["SELECT TRUNCATE FROM foo", "TRUNCATE"],
    ["SELECT GRANT FROM foo", "GRANT"],
    ["SELECT REVOKE FROM foo", "REVOKE"],
    ["SELECT MERGE FROM foo", "MERGE"],
    ["SELECT REPLACE FROM foo", "REPLACE"],
  ];

  for (const [sql, keyword] of cases) {
    it(`rejects SQL containing ${keyword}`, () => {
      const result = checkSql(sql);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain(keyword);
      }
    });
  }
});

describe("checkSql — word boundary prevents false positives on column names", () => {
  it("does not flag 'created_date' as CREATE", () => {
    const sql = "SELECT created_date, COUNT(*) FROM nyc_311 GROUP BY created_date";
    expect(checkSql(sql).ok).toBe(true);
  });

  it("does not flag 'updated_at' as UPDATE", () => {
    const sql = "SELECT updated_at FROM nyc_311";
    expect(checkSql(sql).ok).toBe(true);
  });

  it("does not flag 'deleted_flag' as DELETE", () => {
    const sql = "SELECT deleted_flag FROM nyc_311";
    expect(checkSql(sql).ok).toBe(true);
  });

  it("does not flag 'replacement_cost' as REPLACE", () => {
    const sql = "SELECT replacement_cost FROM nyc_311";
    expect(checkSql(sql).ok).toBe(true);
  });
});

describe("checkSql — TRIM() on zone ID columns", () => {
  it("rejects TRIM(pulocationid)", () => {
    const result = checkSql("SELECT TRIM(pulocationid) FROM gtp_tlc_data t WHERE TRY_CAST(t.trip_distance AS DOUBLE) <= 50");
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("TRIM()") });
  });

  it("rejects TRIM(dolocationid)", () => {
    const result = checkSql("SELECT TRIM(dolocationid) FROM gtp_tlc_data t WHERE TRY_CAST(t.trip_distance AS DOUBLE) <= 50");
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("TRIM()") });
  });

  it("rejects TRIM(t.pulocationid) with alias qualifier", () => {
    const result = checkSql("SELECT TRIM(t.pulocationid) FROM gtp_tlc_data t WHERE TRY_CAST(t.trip_distance AS DOUBLE) <= 50");
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("TRIM()") });
  });

  it("rejects TRIM(locationid)", () => {
    const result = checkSql("SELECT TRIM(locationid) FROM gtp_tlc_data t WHERE TRY_CAST(t.trip_distance AS DOUBLE) <= 50");
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("TRIM()") });
  });

  it("allows TRIM() on unrelated columns", () => {
    const sql = "SELECT TRIM(complaint_type) FROM nyc_311";
    expect(checkSql(sql).ok).toBe(true);
  });
});

describe("checkSql — TRIM() on numeric expressions", () => {
  it("rejects TRIM(TRY_CAST(... AS DOUBLE))", () => {
    const result = checkSql(
      "SELECT TRIM(TRY_CAST(ridership AS DOUBLE)) FROM mta_turnstile WHERE year = '2025'"
    );
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("TRIM()") });
  });

  it("rejects TRIM(SUM(...))", () => {
    const result = checkSql(
      "SELECT borough AS answer_label, TRIM(SUM(TRY_CAST(ridership AS DOUBLE))) AS rides " +
        "FROM mta_turnstile WHERE year = '2025' GROUP BY borough"
    );
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("aggregate") });
  });

  it("rejects TRIM(latitude)", () => {
    const result = checkSql(
      "SELECT TRIM(latitude) FROM mta_turnstile WHERE year = '2025'"
    );
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("latitude") });
  });

  it("allows TRY_CAST(TRIM(REGEXP_REPLACE(...)) AS DOUBLE)", () => {
    const sql =
      "SELECT ct.ntaname AS answer_label, SUM(rides) AS total " +
      "FROM census_tracts ct " +
      "JOIN census_tract_demographics demo ON TRIM(CAST(ct.geoid AS VARCHAR)) = TRIM(CAST(demo.geoid AS VARCHAR)) " +
      "WHERE TRY_CAST(TRIM(REGEXP_REPLACE(demo.median_household_income_2023, ',', '')) AS DOUBLE) > 100000";
    expect(checkSql(sql).ok).toBe(true);
  });
});

describe("checkSql — SUBSTRING() on datetime columns", () => {
  const datetimeCols = [
    "tpep_pickup_datetime",
    "tpep_dropoff_datetime",
    "created_date",
    "closed_date",
    "crash_date",
    "pickup_datetime",
    "dropoff_datetime",
  ];

  for (const col of datetimeCols) {
    it(`rejects SUBSTRING(${col}, ...)`, () => {
      const result = checkSql(`SELECT SUBSTRING(${col}, 1, 4) FROM nyc_311`);
      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("SUBSTRING()") });
    });
  }

  it("allows SUBSTRING() on unrelated columns", () => {
    const sql = "SELECT SUBSTRING(complaint_type, 1, 5) FROM nyc_311";
    expect(checkSql(sql).ok).toBe(true);
  });
});

describe("checkSql — TLC trip distance filter", () => {
  it("passes a valid TLC query with TRY_CAST distance <= 50", () => {
    expect(checkSql(VALID_TLC_SQL).ok).toBe(true);
  });

  it("rejects a TLC query with trip_distance but no upper bound", () => {
    const sql =
      "SELECT AVG(trip_distance) FROM gtp_tlc_data WHERE trip_distance > 0";
    const result = checkSql(sql);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("gtp_tlc_data") });
  });

  it("passes a TLC query that does not reference trip_distance", () => {
    const sql =
      "SELECT COUNT(*) FROM gtp_tlc_data WHERE pulocationid IS NOT NULL";
    expect(checkSql(sql).ok).toBe(true);
  });

  it("passes a non-TLC query with no trip_distance", () => {
    expect(checkSql(VALID_SQL).ok).toBe(true);
  });

  it("strips the trailing semicolon before returning ok sql", () => {
    const result = checkSql(`${VALID_SQL};`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sql.endsWith(";")).toBe(false);
    }
  });
});

describe("fixWarehouseDateCasts — nyc_311", () => {
  it("rewrites TRY_CAST on created_date when nyc_311 is queried", () => {
    const sql =
      "SELECT MIN(TRY_CAST(created_date AS TIMESTAMP)) AS earliest_date FROM nyc_311";
    expect(fixWarehouseDateCasts(sql)).toBe(
      "SELECT MIN(FROM_ISO8601_TIMESTAMP(created_date)) AS earliest_date FROM nyc_311"
    );
  });

  it("rewrites MIN/MAX TRY_CAST pairs (date-range queries)", () => {
    const sql =
      "SELECT MIN(TRY_CAST(created_date AS TIMESTAMP)) AS earliest_date, " +
      "MAX(TRY_CAST(created_date AS TIMESTAMP)) AS latest_date FROM nyc_311 WHERE year >= '2020'";
    const fixed = fixWarehouseDateCasts(sql);
    expect(fixed).not.toContain("TRY_CAST(created_date AS TIMESTAMP)");
    expect(fixed).toContain(
      "MIN(FROM_ISO8601_TIMESTAMP(created_date)) AS earliest_date"
    );
    expect(fixed).toContain(
      "MAX(FROM_ISO8601_TIMESTAMP(created_date)) AS latest_date"
    );
  });

  it("rewrites table-qualified and alias-qualified date columns", () => {
    const sql =
      "SELECT TRY_CAST(nyc_311.created_date AS TIMESTAMP), TRY_CAST(n.closed_date AS TIMESTAMP) " +
      "FROM nyc_311 n";
    const fixed = fixWarehouseDateCasts(sql);
    expect(fixed).toContain("FROM_ISO8601_TIMESTAMP(nyc_311.created_date)");
    expect(fixed).toContain("FROM_ISO8601_TIMESTAMP(n.closed_date)");
  });

  it("rewrites CAST (non-TRY) on ISO date columns", () => {
    const sql =
      "SELECT CAST(created_date AS TIMESTAMP) FROM nyc_311";
    expect(fixWarehouseDateCasts(sql)).toBe(
      "SELECT FROM_ISO8601_TIMESTAMP(created_date) FROM nyc_311"
    );
  });

  it("leaves non-date TRY_CAST columns unchanged", () => {
    const sql =
      "SELECT TRY_CAST(latitude AS DOUBLE) FROM nyc_311 WHERE TRY_CAST(longitude AS DOUBLE) > 0";
    expect(fixWarehouseDateCasts(sql)).toBe(sql);
  });

  it("no-ops when nyc_311 is not referenced", () => {
    const sql = "SELECT TRY_CAST(created_date AS TIMESTAMP) FROM other_table";
    expect(fixWarehouseDateCasts(sql)).toBe(sql);
  });

  it("does not double-wrap existing FROM_ISO8601_TIMESTAMP", () => {
    const sql =
      "SELECT MIN(FROM_ISO8601_TIMESTAMP(created_date)) FROM nyc_311";
    expect(fixWarehouseDateCasts(sql)).toBe(sql);
  });
});

describe("fixWarehouseDateCasts — gtp_tlc_data", () => {
  it("rewrites tpep pickup/dropoff datetime casts", () => {
    const sql =
      "SELECT day_of_week(TRY_CAST(tpep_pickup_datetime AS TIMESTAMP)) FROM gtp_tlc_data t " +
      "WHERE TRY_CAST(t.trip_distance AS DOUBLE) <= 50";
    const fixed = fixWarehouseDateCasts(sql);
    expect(fixed).toContain(
      "day_of_week(FROM_ISO8601_TIMESTAMP(tpep_pickup_datetime))"
    );
    expect(fixed).toContain("TRY_CAST(t.trip_distance AS DOUBLE)");
  });
});

describe("fixWarehouseDateCasts — par", () => {
  it("rewrites lpep pickup/dropoff datetime casts", () => {
    const sql =
      "SELECT TRY_CAST(lpep_pickup_datetime AS TIMESTAMP) FROM par WHERE year = '2015'";
    expect(fixWarehouseDateCasts(sql)).toBe(
      "SELECT FROM_ISO8601_TIMESTAMP(lpep_pickup_datetime) FROM par WHERE year = '2015'"
    );
  });
});

describe("fixWarehouseDateCasts — nypd_collisions", () => {
  it("rewrites crash_date to DATE_PARSE", () => {
    const sql =
      "SELECT MIN(TRY_CAST(crash_date AS TIMESTAMP)) FROM nypd_collisions WHERE year = '2024'";
    expect(fixWarehouseDateCasts(sql)).toBe(
      "SELECT MIN(TRY(DATE_PARSE(crash_date, '%m/%d/%Y'))) FROM nypd_collisions WHERE year = '2024'"
    );
  });
});

describe("fixWarehouseDateCasts — mta_turnstile", () => {
  it("leaves transit_timestamp TRY_CAST unchanged (space-separated format)", () => {
    const sql =
      "SELECT HOUR(TRY_CAST(transit_timestamp AS TIMESTAMP)) FROM mta_turnstile WHERE year = '2025'";
    expect(fixWarehouseDateCasts(sql)).toBe(sql);
  });
});

describe("checkSql — warehouse date cast rewrite", () => {
  it("returns rewritten SQL from checkSql", () => {
    const sql =
      "SELECT MIN(TRY_CAST(created_date AS TIMESTAMP)) AS earliest_date FROM nyc_311";
    const result = checkSql(sql);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sql).toContain("FROM_ISO8601_TIMESTAMP(created_date)");
      expect(result.sql).not.toContain("TRY_CAST(created_date");
    }
  });
});
