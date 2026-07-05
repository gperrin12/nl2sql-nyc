/**
 * Trivia category catalog + session diversity (one plan per 10-question run).
 */

export type TriviaDeck = "mta" | "311" | "grab-bag";

export const DEFAULT_TRIVIA_DECK: TriviaDeck = "mta";

export const TRIVIA_DECK_LABELS: Record<TriviaDeck, string> = {
  mta: "MTA",
  "311": "311",
  "grab-bag": "Grab bag",
};

export const TRIVIA_DECK_OPTIONS: TriviaDeck[] = ["mta", "311", "grab-bag"];

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
    id: "transit-outer-borough-station",
    family: "transit",
    label: "busiest subway station complex OUTSIDE Manhattan by total ridership in 2025",
  },
  {
    id: "transit-date-ridership",
    family: "transit",
    label: "highest subway ridership by station or borough on a specific notable 2025 date (holiday, storm, parade, event day)",
  },
  {
    id: "transit-neighborhood",
    family: "transit",
    label: "highest subway ridership by NYC neighborhood (NTA) in 2025, via station lat/lon → census tract spatial join",
  },
  {
    id: "transit-census-neighborhood",
    family: "transit",
    label: "highest subway ridership among neighborhoods meeting a census filter (e.g. high-income tracts, majority-Spanish-speaking) in 2025",
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

/** Category pool for a trivia deck (MTA-only, 311-only, or mixed grab bag). */
export function categoriesForDeck(deck: TriviaDeck = DEFAULT_TRIVIA_DECK): TriviaCategoryDef[] {
  switch (deck) {
    case "mta":
      return TRIVIA_CATEGORY_DEFS.filter((d) => d.family === "transit");
    case "311":
      return TRIVIA_CATEGORY_DEFS.filter(
        (d) => d.family === "311" || d.family === "311_resolution"
      );
    case "grab-bag":
      return TRIVIA_CATEGORY_DEFS;
  }
}

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
      "Use taxi_zones.zone as answer_label. Filter trips: trip_distance 0–50 miles, valid zone IDs, fare 0–500 before AVG/COUNT. " +
      "SELECT COUNT(*) AS trip_count and HAVING COUNT(*) >= 100 so low-volume zones can't win.",
    "taxi-borough-pickups":
      "If comparing boroughs, answer_label must be taxi_zones.borough (Title Case). Filter trip_distance <= 50 miles on gtp_tlc_data.",
    "taxi-distance":
      "Average trip distance by zone — MUST filter trip_distance > 0 AND <= 50 miles before AVG; typical NYC zone averages are under 15 mi. " +
      "SELECT COUNT(*) AS trip_count and HAVING COUNT(*) >= 100 so a zone with a few trips can't top the ranking.",
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
    "transit-outer-borough-station":
      "mta_turnstile: SUM(TRY_CAST(ridership AS DOUBLE)) by station_complex WHERE year = '2025' " +
      "AND borough <> 'Manhattan' (borough is Title Case — never UPPER()). GROUP BY station_complex_id; " +
      "answer_label = MIN(station_complex). NEVER COUNT(*). Do NOT reference payment_method or fare_class_category.",
    "transit-date-ridership":
      "mta_turnstile: pick ONE real notable 2025 date and NAME it in the question (e.g. NYC Marathon Sunday, " +
      "July 4, a major snowstorm day, New Year's Day). Filter DATE(TRY_CAST(transit_timestamp AS TIMESTAMP)) = DATE '2025-MM-DD' " +
      "AND year = '2025' AND month = 'MM' (include the month partition literal for pruning). Rank station_complex " +
      "(or borough) by SUM(TRY_CAST(ridership AS DOUBLE)) DESC. answer_label = station_complex or borough. " +
      "For a more surprising winner, rank stations/boroughs and consider excluding Manhattan. No payment_method / fare_class_category.",
    "transit-neighborhood":
      "mta_turnstile → NYC neighborhood (NTA). Aggregate to STATION level FIRST — never spatial-join raw hourly rows " +
      "(millions of rows × 2,300 polygons is far too slow):\n" +
      "WITH stn AS (SELECT station_complex_id, MIN(station_complex) AS station_complex, " +
      "AVG(latitude) AS lat, AVG(longitude) AS lon, SUM(TRY_CAST(ridership AS DOUBLE)) AS rides " +
      "FROM mta_turnstile WHERE year = '2025' AND latitude IS NOT NULL AND longitude IS NOT NULL " +
      "GROUP BY station_complex_id)\n" +
      "Then point-in-polygon each station into census_tracts ct: " +
      "ST_CONTAINS(ST_GEOMETRY_FROM_TEXT(ct.geometry_wkt), ST_Point(stn.lon, stn.lat)) — longitude FIRST " +
      "(ST_Point(lat, lon) matches ZERO tracts, silently). Roll up SUM(rides) by ct.ntaname; ORDER BY 2 DESC LIMIT 4. " +
      "answer_label = ct.ntaname. Qualify ct.ntaname / ct.geoid (AMBIGUOUS_NAME).",
    "transit-census-neighborhood":
      "Same station-first aggregation + spatial join into census_tracts ct as transit-neighborhood, then " +
      "LEFT JOIN census_tract_demographics demo ON TRIM(CAST(ct.geoid AS VARCHAR)) = TRIM(CAST(demo.geoid AS VARCHAR)). " +
      "Filter neighborhoods by ONE real demographic column — open lib/schemas.ts, read the census_tract_demographics " +
      "column list, and use an ACTUAL column name; do NOT invent one. Parse ACS strings with " +
      "TRY_CAST(TRIM(REGEXP_REPLACE(demo.median_household_income_2023, ',', '')) AS DOUBLE) — trim the VARCHAR " +
      "before casting, never TRIM(TRY_CAST(... AS DOUBLE)). Never gate on TRY_CAST(... AS BIGINT) IS NOT NULL. " +
      "State the census filter in the question text (e.g. 'Among neighborhoods where median household income tops $100k, " +
      "which had the highest 2025 subway ridership?'). Use median_household_income_2023 or lang_lim_eng_spanish_2023 " +
      "as example filters — both are real columns. answer_label = ct.ntaname; metric = SUM(rides) DESC LIMIT 4.",
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
 * Build a category plan for a session: prefer one category per family, then fill
 * without repeating ids until the catalog is exhausted (then repeat for short decks).
 */
export function buildSessionCategoryPlan(
  length: number,
  defs: TriviaCategoryDef[] = TRIVIA_CATEGORY_DEFS
): string[] {
  const catalog = defs;
  if (length <= 0 || catalog.length === 0) return [];

  const byFamily = new Map<string, TriviaCategoryDef[]>();
  for (const d of catalog) {
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
    let remaining = catalog.filter((d) => !usedIds.has(d.id));
    if (remaining.length === 0) {
      usedIds.clear();
      remaining = [...catalog];
    }

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
  /** Question deck: MTA-only, 311-only, or mixed grab bag. */
  deck?: TriviaDeck;
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
  const catalog = categoriesForDeck(constraints?.deck ?? DEFAULT_TRIVIA_DECK);

  if (constraints?.categoryId) {
    const found = getTriviaCategoryById(constraints.categoryId);
    if (found && catalog.some((d) => d.id === found.id)) return found;
  }

  const usedFamilies = new Set(constraints?.usedFamilies ?? []);
  const unusedFamily = catalog.filter((d) => !usedFamilies.has(d.family));
  const pool = unusedFamily.length > 0 ? unusedFamily : catalog;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Legacy string list for any code that still expects labels only. */
export const TRIVIA_CATEGORY_LABELS = TRIVIA_CATEGORY_DEFS.map((d) => d.label);
