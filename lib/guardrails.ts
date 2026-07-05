/**
 * Light-touch SQL guardrails. The Athena workgroup should ALSO have a
 * BytesScannedCutoffPerQuery set as a hard backstop — these checks are
 * the first line of defense, not the only one.
 */

import {
  hasTlcTripDistanceFilter,
  tlcTripFilterGuardrailReason,
} from "@/lib/tlc-trip-filters";
import { trimTrailingProseFromSql } from "@/lib/sanitize-agent-sql";
import { fixWarehouseDateCasts } from "@/lib/warehouse-date-casts";

export { fixNyc311IsoDateCasts, fixWarehouseDateCasts } from "@/lib/warehouse-date-casts";

const FORBIDDEN_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
  "TRUNCATE", "GRANT", "REVOKE", "MERGE", "REPLACE",
];

export type GuardrailResult =
  | { ok: true; sql: string }
  | { ok: false; reason: string };

export function checkSql(rawSql: string): GuardrailResult {
  const sql = trimTrailingProseFromSql(rawSql.trim());
  if (!sql) return { ok: false, reason: "Empty SQL" };

  // Single statement only — trailing semicolon is fine, but no second statement.
  const stripped = sql.replace(/;\s*$/, "");
  if (stripped.includes(";")) {
    return { ok: false, reason: "Multiple SQL statements not allowed" };
  }

  const upper = stripped.toUpperCase();

  // Must start with SELECT or WITH.
  if (!/^\s*(SELECT|WITH)\b/.test(upper)) {
    return { ok: false, reason: "Only SELECT / WITH queries are allowed" };
  }

  // Token-boundary checks for dangerous keywords. We use \b to avoid matching
  // substrings inside column names like 'created_date' (matching CREATE).
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(stripped)) {
      return { ok: false, reason: `Forbidden keyword: ${kw}` };
    }
  }

  if (
    /\bTRIM\s*\(\s*(?:(?:\w+)\.)?(pulocationid|dolocationid|locationid)\s*\)/i.test(
      stripped
    )
  ) {
    return {
      ok: false,
      reason:
        "TRIM() on pulocationid/dolocationid/locationid is invalid (zone IDs are numeric). Use pulocationid IS NOT NULL and CAST/TRY_CAST for taxi_zones joins",
    };
  }

  const trimNumeric = checkTrimOnNumeric(stripped);
  if (trimNumeric) return trimNumeric;

  if (
    /\bSUBSTRING\s*\(\s*(?:(?:\w+)\.)?(tpep_pickup_datetime|tpep_dropoff_datetime|created_date|closed_date|crash_date|pickup_datetime|dropoff_datetime)\b/i.test(
      stripped
    )
  ) {
    return {
      ok: false,
      reason:
        "SUBSTRING() on datetime columns is invalid — use day_of_week(FROM_ISO8601_TIMESTAMP(col)) or day_of_week(col) for weekday/weekend",
    };
  }

  if (!hasTlcTripDistanceFilter(stripped)) {
    return { ok: false, reason: tlcTripFilterGuardrailReason() };
  }

  return { ok: true, sql: fixWarehouseDateCasts(stripped) };
}

/** TRIM() in Athena/Trino accepts only char/varchar — not DOUBLE/BIGINT aggregates. */
function checkTrimOnNumeric(sql: string): GuardrailResult | null {
  if (
    /\bTRIM\s*\(\s*TRY_CAST\s*\([^)]+\s+AS\s+(?:DOUBLE|BIGINT|INTEGER|INT|REAL|FLOAT|DECIMAL)\b/i.test(
      sql
    ) ||
    /\bTRIM\s*\(\s*CAST\s*\([^)]+\s+AS\s+(?:DOUBLE|BIGINT|INTEGER|INT|REAL|FLOAT|DECIMAL)\b/i.test(
      sql
    )
  ) {
    return {
      ok: false,
      reason:
        "TRIM() on a numeric CAST/TRY_CAST is invalid in Athena (FUNCTION_NOT_FOUND). " +
        "Trim VARCHAR first, then parse: TRY_CAST(TRIM(REGEXP_REPLACE(col, ',', '')) AS DOUBLE). " +
        "For geoid joins use TRIM(CAST(geoid AS VARCHAR)).",
    };
  }

  if (/\bTRIM\s*\(\s*(?:SUM|AVG|MIN|MAX|COUNT)\s*\(/i.test(sql)) {
    return {
      ok: false,
      reason:
        "TRIM() on an aggregate (SUM/AVG/MIN/MAX/COUNT) is invalid — aggregates are numeric. " +
        "Use the numeric expression directly in ORDER BY / WHERE, or CAST to VARCHAR only if you need text.",
    };
  }

  if (
    /\bTRIM\s*\(\s*(?:\w+\.)?(?:latitude|longitude|\blat\b|\blon\b)\s*\)/i.test(
      sql
    )
  ) {
    return {
      ok: false,
      reason:
        "TRIM() on latitude/longitude is invalid (they are DOUBLE). Use them directly in ST_Point(longitude, latitude).",
    };
  }

  return null;
}
