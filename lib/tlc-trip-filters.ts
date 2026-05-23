/**
 * Sanity filters for gtp_tlc_data — drops bogus long-haul rows (bad distances, fares).
 * trip_distance is in miles in this warehouse.
 */

/** Max single-trip distance (miles) for NYC yellow/green zone-level analysis. */
export const TLC_MAX_TRIP_DISTANCE_MILES = 50;

/** Reject trivia proof rows when distance-like metrics exceed this (miles). */
export const TLC_MAX_PLAUSIBLE_AVG_DISTANCE_MILES = 50;

const DISTANCE_METRIC_RE =
  /distance|mile|km|length|avg_dist|trip_len/i;

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
