/**
 * Sanity filters for gtp_tlc_data — drops bogus long-haul rows (bad distances, fares).
 * trip_distance is in miles in this warehouse.
 */

/** Max single-trip distance (miles) for NYC yellow/green zone-level analysis. */
export const TLC_MAX_TRIP_DISTANCE_MILES = 50;

/** Reject trivia proof rows when distance-like metrics exceed this (miles). */
export const TLC_MAX_PLAUSIBLE_AVG_DISTANCE_MILES = 50;

/**
 * Minimum trips a taxi ZONE must have to be a valid trivia answer. Zone-level
 * aggregates over a handful of trips are noise (e.g. "highest average fare" won
 * by a zone with 3 rides), so zone rankings must exclude tiny samples.
 */
export const TLC_ZONE_MIN_PICKUPS = 100;

const DISTANCE_METRIC_RE =
  /distance|mile|km|length|avg_dist|trip_len/i;

/** Column names that represent a trip/ride count (sample size). */
const TRIP_COUNT_METRIC_RE =
  /\b(count|cnt|trips|rides|pickups|dropoffs|volume)\b/i;

/**
 * WHERE fragment for alias `t` (or custom) on gtp_tlc_data.
 * Include in every query that reads trip_distance / fare_amount.
 */
export function tlcTripSanityWhere(alias = "t"): string {
  const d = alias;
  return [
    `${d}.pulocationid IS NOT NULL`,
    `${d}.dolocationid IS NOT NULL`,
    `TRY_CAST(${d}.trip_distance AS DOUBLE) > 0`,
    `TRY_CAST(${d}.trip_distance AS DOUBLE) <= ${TLC_MAX_TRIP_DISTANCE_MILES}`,
    `TRY_CAST(${d}.fare_amount AS DOUBLE) > 0`,
    `TRY_CAST(${d}.fare_amount AS DOUBLE) < 500`,
  ].join("\n    AND ");
}

/** One-line rule text for LLM system prompts. */
export const TLC_TRIP_FILTER_PROMPT_RULE = `gtp_tlc_data: ALWAYS filter spurious trips — TRY_CAST(trip_distance AS DOUBLE) > 0 AND <= ${TLC_MAX_TRIP_DISTANCE_MILES} (miles), pulocationid/dolocationid IS NOT NULL, TRY_CAST(fare_amount AS DOUBLE) BETWEEN 0 AND 500. Without this, averages can exceed 300 miles from bad rows.`;

/** Rule text: taxi-zone rankings must exclude low-volume zones. */
export const TLC_ZONE_MIN_PICKUPS_PROMPT_RULE = `gtp_tlc_data taxi-ZONE rankings (grouped by pickup/dropoff zone, e.g. taxi_zones.zone / pulocationid): only rank zones with a meaningful sample. SELECT COUNT(*) AS trip_count and add HAVING COUNT(*) >= ${TLC_ZONE_MIN_PICKUPS} so a zone with only a handful of trips cannot be the answer. (Borough-level rankings do not need this.)`;

export function sqlUsesGtpTlcData(sql: string): boolean {
  return /\bgtp_tlc_data\b/i.test(sql);
}

/** Guardrail: TLC queries that use trip_distance must bound it. */
export function hasTlcTripDistanceFilter(sql: string): boolean {
  if (!sqlUsesGtpTlcData(sql)) return true;
  if (!/\btrip_distance\b/i.test(sql)) return true;
  return hasDistanceUpperBound(sql);
}

function hasDistanceUpperBound(sql: string): boolean {
  const s = sql;
  if (
    /trip_distance\s+AS\s+DOUBLE\s*\)\s*(?:<=|<)\s*(?:50|100)\b/i.test(s) ||
    /trip_distance\s+AS\s+DOUBLE\s*\)\s+BETWEEN\s+0\s+AND\s+(?:50|100)\b/i.test(s)
  ) {
    return true;
  }
  if (
    /\btrip_distance\b[^;]{0,80}(?:<=|<)\s*50\b/i.test(s) ||
    /\btrip_distance\b[^;]{0,80}(?:<=|<)\s*100\b/i.test(s)
  ) {
    return true;
  }
  if (/\bBETWEEN\s+0(?:\.0+)?\s+AND\s+(?:50|100)\b/i.test(s) && /\btrip_distance\b/i.test(s)) {
    return true;
  }
  return false;
}

export function tlcTripFilterGuardrailReason(): string {
  return (
    `Queries on gtp_tlc_data must filter bogus trips. Add to WHERE:\n${tlcTripSanityWhere("t")}`
  );
}

export type TlcProofCheck =
  | { ok: true }
  | { ok: false; reason: string };

/** After Athena: distance aggregates should not all look like cross-country junk. */
export function validateTlcProofDistances(
  columns: string[],
  rows: Record<string, string | null>[]
): TlcProofCheck {
  const metricCol = columns.find((c) => DISTANCE_METRIC_RE.test(c));
  if (!metricCol) return { ok: true };

  const values: number[] = [];
  for (const row of rows) {
    const raw = row[metricCol];
    if (raw == null) continue;
    const n = Number(String(raw).replace(/,/g, ""));
    if (Number.isFinite(n)) values.push(n);
  }
  if (values.length === 0) return { ok: true };

  const max = Math.max(...values);
  const min = Math.min(...values);

  if (min > TLC_MAX_PLAUSIBLE_AVG_DISTANCE_MILES) {
    return {
      ok: false,
      reason:
        `Proof distances are implausible for NYC taxis (min ${min} mi — expected well under ${TLC_MAX_PLAUSIBLE_AVG_DISTANCE_MILES} mi). ` +
        `Add trip_distance filter: > 0 AND <= ${TLC_MAX_TRIP_DISTANCE_MILES} miles before aggregating.`,
    };
  }

  if (max > 150) {
    return {
      ok: false,
      reason:
        `Proof shows distance up to ${max} mi — likely unfiltered bad rows. ` +
        `Filter trip_distance to <= ${TLC_MAX_TRIP_DISTANCE_MILES} miles on gtp_tlc_data.`,
    };
  }

  return { ok: true };
}

/** Extract the GROUP BY clause body (lowercased), or "" if none. */
function groupByClause(sql: string): string {
  const m = sql
    .toLowerCase()
    .match(/group\s+by\s+([\s\S]*?)(?:\border\s+by\b|\bhaving\b|\blimit\b|$)/);
  return m?.[1] ?? "";
}

/**
 * True when a gtp_tlc_data query ranks at ZONE granularity (grouped by
 * zone/location), as opposed to borough level. Borough rankings always have
 * plenty of trips and are exempt from the min-pickups rule.
 */
export function sqlIsTaxiZoneRanking(sql: string): boolean {
  if (!sqlUsesGtpTlcData(sql)) return false;
  const clause = groupByClause(sql);
  if (!clause) return false;
  const zoneLevel =
    /\bpulocationid\b|\bdolocationid\b|\blocationid\b|\bzone\b/.test(clause);
  const boroughLevel = /\bborough\b/.test(clause);
  return zoneLevel && !boroughLevel;
}

/** First results column that looks like a trip/ride count, or null. */
export function findTripCountColumn(columns: string[]): string | null {
  for (const c of columns) {
    if (TRIP_COUNT_METRIC_RE.test(c.replace(/_/g, " "))) return c;
  }
  return null;
}

/**
 * After Athena: for zone-level taxi rankings, require the sample size to be
 * visible and every ranked zone to clear TLC_ZONE_MIN_PICKUPS. This keeps a
 * zone with only a handful of rides from winning "highest average fare" etc.
 */
export function validateTlcZoneMinPickups(
  sql: string,
  columns: string[],
  rows: Record<string, string | null>[]
): TlcProofCheck {
  if (!sqlIsTaxiZoneRanking(sql)) return { ok: true };

  const countCol = findTripCountColumn(columns);
  if (!countCol) {
    return {
      ok: false,
      reason:
        `Taxi zone rankings must expose the sample size. SELECT COUNT(*) AS trip_count ` +
        `and add HAVING COUNT(*) >= ${TLC_ZONE_MIN_PICKUPS} so low-volume zones can't be the answer.`,
    };
  }

  const counts: number[] = [];
  for (const row of rows) {
    const raw = row[countCol];
    if (raw == null) continue;
    const n = Number(String(raw).replace(/,/g, ""));
    if (Number.isFinite(n)) counts.push(n);
  }
  if (counts.length === 0) return { ok: true };

  const min = Math.min(...counts);
  if (min < TLC_ZONE_MIN_PICKUPS) {
    return {
      ok: false,
      reason:
        `A taxi zone in the proof has only ${min} trips (< ${TLC_ZONE_MIN_PICKUPS}). ` +
        `Add HAVING COUNT(*) >= ${TLC_ZONE_MIN_PICKUPS} so tiny-sample zones are excluded from the ranking.`,
    };
  }

  return { ok: true };
}
