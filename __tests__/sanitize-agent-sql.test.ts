import { describe, expect, it } from "vitest";
import { trimTrailingProseFromSql } from "@/lib/sanitize-agent-sql";

describe("trimTrailingProseFromSql", () => {
  it("removes prose after LIMIT", () => {
    const raw = `SELECT COUNT(*) AS total_complaints
FROM nyc_311
WHERE borough = 'MANHATTAN'
  AND year = '2026'
  AND month IN ('01', '02', '03')
LIMIT 1000

Regarding the Mayor's Management Report, complaint trends vary by agency.`;

    expect(trimTrailingProseFromSql(raw)).toBe(`SELECT COUNT(*) AS total_complaints
FROM nyc_311
WHERE borough = 'MANHATTAN'
  AND year = '2026'
  AND month IN ('01', '02', '03')
LIMIT 1000`);
  });

  it("keeps SQL with blank lines inside CTEs", () => {
    const raw = `WITH cte AS (
  SELECT 1 AS n
)

SELECT n FROM cte LIMIT 10`;

    expect(trimTrailingProseFromSql(raw)).toBe(raw);
  });

  it("strips trailing semicolon", () => {
    expect(trimTrailingProseFromSql("SELECT 1 LIMIT 1;")).toBe("SELECT 1 LIMIT 1");
  });
});
