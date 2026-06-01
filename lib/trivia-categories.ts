/**
 * Trivia category catalog + session diversity (one plan per 10-question run).
 */

export type TriviaCategoryDef = {
  id: string;
  /** Topic family — at most one question per family in a 10-question session when possible. */
  family: string;
  /** Passed to the model as the category focus line. */
  label: string;
};

export const TRIVIA_CATEGORY_DEFS: TriviaCategoryDef[] = [
  // 311
  {
    id: "311-borough-volume",
    family: "311",
    label: "311 complaint volume compared across NYC boroughs (year 2024 or 2025)",
  },
  {
    id: "311-complaint-type",
    family: "311",
    label: "most common 311 complaint types in one borough (noise, heat, rodent, etc.)",
  },
  {
    id: "311-noise",
    family: "311",
    label: "noise-related 311 complaints by borough or neighborhood theme",
  },
  {
    id: "311-status",
    family: "311",
    label: "311 open vs closed complaint rates or resolution patterns by borough",
  },
  {
    id: "311-resolution-speed",
    family: "311_resolution",
    label: "which borough closes 311 complaints fastest or slowest (closed_date vs created_date)",
  },
  // Collisions
  {
    id: "collision-borough",
    family: "collisions",
    label: "motor vehicle collision counts or injuries ranked by borough",
  },
  {
    id: "collision-factor",
    family: "collisions",
    label: "top contributing factors or driver actions in NYPD collision data",
  },
  {
    id: "collision-pedestrian",
    family: "collisions",
    label: "pedestrian injuries or fatalities compared across boroughs",
  },
  {
    id: "collision-vehicle",
    family: "collisions",
    label: "collisions by vehicle type (sedan, SUV, bike, etc.) — surprising rankings",
  },
  // Taxi — trips & zones
  {
    id: "taxi-zone-rank",
    family: "taxi_trips",
    label: "yellow taxi trip counts by pickup zone or zone name (year 2025)",
  },
  {
    id: "taxi-borough-pickups",
    family: "taxi_trips",
    label: "taxi pickups or dropoffs by taxi_zones.borough (Manhattan vs outer boroughs)",
  },
  {
    id: "taxi-airport",
    family: "taxi_trips",
    label: "airport-related taxi trips (JFK/LGA/EWR zones) vs city zones",
  },
  {
    id: "taxi-hourly",
    family: "taxi_trips",
    label: "busiest hour-of-day or day-of-week for yellow taxi pickups (2025)",
  },
  // Taxi — money
  {
    id: "taxi-fare-tip",
    family: "taxi_fares",
    label: "average fare, tip amount, or tip percentage patterns (year 2025)",
  },
  {
    id: "taxi-payment",
    family: "taxi_fares",
    label: "payment type or trip distance extremes (longest trips, highest fares)",
  },
  // Census / demographics
  {
    id: "census-income",
    family: "census",
    label: "median household income or poverty rate across census tracts (ACS 2023 vintage)",
  },
  {
    id: "census-population",
    family: "census",
    label: "population or age distribution surprises by borough via census tracts",
  },
  {
    id: "census-vs-311",
    family: "census",
    label: "311 complaints per capita by borough (census population denominator; say per capita clearly)",
  },
  // MTA / Transit — subway ridership
  {
    id: "transit-busiest-station",
    family: "transit",
    label: "busiest subway station complexes by total ridership in 2025 (SUM(ridership), not row counts)",
  },
  {
    id: "transit-omny-share",
    family: "transit",
    label: "OMNY vs MetroCard ridership share by borough in 2025 (payment_method)",
  },
  {
    id: "transit-fair-fare",
    family: "transit",
    label: "Fair Fare ridership share across boroughs in 2025 (fare_class_category LIKE '%Fair Fare%')",
  },
  // Cross-dataset angles
  {
    id: "compare-boroughs",
    family: "comparison",
    label: "one clear metric ranked by borough within a single dataset (not cross-dataset ratios)",
  },
  {
    id: "weekend-weekday",
    family: "time_patterns",
    label: "weekday vs weekend patterns in taxi tips or trip volume (2025, day_of_week)",
  },
  {
    id: "collision-monthly",
    family: "collision_timing",
    label: "collisions by month or season in 2024 — which month peaks",
  },
  {
    id: "taxi-distance",
    family: "taxi_distance",
    label: "longest average trip distance or duration by pickup zone (2025)",
  },
];

const BY_ID = new Map(TRIVIA_CATEGORY_DEFS.map((d) => [d.id, d]));

export function getTriviaCategoryById(id: string): TriviaCategoryDef | undefined {
  return BY_ID.get(id);
}

/** Extra model guidance for categories that often mismatch SQL vs options. */
export function getCategoryGenerationHint(categoryId: string): string | undefined {
  const hints: Record<string, string> = {
    "taxi-airport":
      "Filter to airport pickup zones only (JFK, LaGuardia, Newark/EWR) via taxi_zones.zone. " +
      "answer_label must be those zone names from tz.zone — not random neighborhoods. " +
      "Options = the four zone names returned by SQL. " +
      "Also filter trip_distance <= 50 miles — averages should be tens of miles, not 300+.",
    "taxi-zone-rank":
      "Use taxi_zones.zone as answer_label. Filter trips: trip_distance 0–50 miles, valid zone IDs, fare 0–500 before AVG/COUNT.",
    "taxi-borough-pickups":
      "If comparing boroughs, answer_label must be taxi_zones.borough (Title Case). Filter trip_distance <= 50 miles on gtp_tlc_data.",
    "taxi-distance":
      "Average trip distance by zone — MUST filter trip_distance > 0 AND <= 50 miles before AVG; typical NYC zone averages are under 15 mi.",
    "taxi-fare-tip":
      "Filter trip_distance and fare_amount sanity (distance <= 50 mi, fare 0–500) before tip or fare aggregates.",
    "taxi-hourly":
      "Hour-of-day trip counts — filter trip_distance <= 50 miles even if not selecting distance.",
    "weekend-weekday":
      "Weekday/weekend splits — include trip_distance <= 50 miles filter on gtp_tlc_data.",
    "census-income":
      "If ranking boroughs by median income, avoid ACS top-code 250001 ties — pick a metric or filter with a unique winner.",
    "census-vs-311":
      "Only per-capita / per-1,000-residents 311 rates with census population — never 311 per collision or per taxi trip.",
    "compare-boroughs":
      "Compare boroughs on ONE metric from ONE table (e.g. total 311 count, total collisions) — no cross-dataset ratios.",
    "transit-busiest-station":
      "mta_turnstile: rank by SUM(TRY_CAST(ridership AS DOUBLE)) — NEVER COUNT(*) (rows are fare-class buckets). " +
      "answer_label = station_complex (GROUP BY station_complex_id). Filter year = '2025'.",
    "transit-omny-share":
      "mta_turnstile: payment_method is lowercase 'omny'/'metrocard'; SUM(TRY_CAST(ridership AS DOUBLE)) per borough. " +
      "borough is Title Case ('Manhattan') — never UPPER(). Filter year = '2025'.",
    "transit-fair-fare":
      "mta_turnstile: Fair Fare share = SUM(ridership) WHERE fare_class_category LIKE '%Fair Fare%' over SUM(ridership) all classes, by borough. " +
      "TRY_CAST(ridership AS DOUBLE); borough Title Case; year = '2025'.",
  };
  return hints[categoryId];
}

export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build a 10-question category plan: prefer one category per family, then fill
 * without repeating the same category id.
 */
export function buildSessionCategoryPlan(
  length: number,
  defs: TriviaCategoryDef[] = TRIVIA_CATEGORY_DEFS
): string[] {
  if (length <= 0) return [];

  const byFamily = new Map<string, TriviaCategoryDef[]>();
  for (const d of defs) {
    const list = byFamily.get(d.family) ?? [];
    list.push(d);
    byFamily.set(d.family, list);
  }

  const plan: string[] = [];
  const usedIds = new Set<string>();

  const families = shuffle([...byFamily.keys()]);
  for (const family of families) {
    if (plan.length >= length) break;
    const pool = shuffle(byFamily.get(family) ?? []).filter((d) => !usedIds.has(d.id));
    if (pool.length === 0) continue;
    plan.push(pool[0].id);
    usedIds.add(pool[0].id);
  }

  while (plan.length < length) {
    const remaining = defs.filter((d) => !usedIds.has(d.id));
    if (remaining.length === 0) break;

    const lastId = plan[plan.length - 1];
    const lastFamily = lastId ? BY_ID.get(lastId)?.family : undefined;
    const prefer = remaining.filter((d) => d.family !== lastFamily);
    const pool = shuffle(prefer.length > 0 ? prefer : remaining);
    plan.push(pool[0].id);
    usedIds.add(pool[0].id);
  }

  return plan;
}

export type TriviaSessionConstraints = {
  /** Planned category for this slot (from buildSessionCategoryPlan). */
  categoryId?: string;
  /** Prior question texts in this session — model must not repeat. */
  excludeQuestions?: string[];
  /** Families already used this session (hint for model). */
  usedFamilies?: string[];
};

export function pickCategoryForRequest(
  constraints?: TriviaSessionConstraints
): TriviaCategoryDef {
  if (constraints?.categoryId) {
    const found = getTriviaCategoryById(constraints.categoryId);
    if (found) return found;
  }

  const usedFamilies = new Set(constraints?.usedFamilies ?? []);
  const unusedFamily = TRIVIA_CATEGORY_DEFS.filter((d) => !usedFamilies.has(d.family));
  const pool = unusedFamily.length > 0 ? unusedFamily : TRIVIA_CATEGORY_DEFS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Legacy string list for any code that still expects labels only. */
export const TRIVIA_CATEGORY_LABELS = TRIVIA_CATEGORY_DEFS.map((d) => d.label);
