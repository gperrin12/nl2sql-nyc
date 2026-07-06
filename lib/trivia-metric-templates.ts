import { startQuery } from "@/lib/athena";
import { waitForAthenaResults } from "@/lib/athena-wait";
import { injectStationCrosswalk } from "@/lib/station-crosswalk";
import {
  proofWithShuffledIndex,
  shuffleTriviaOptions,
  type TriviaProof,
} from "@/lib/trivia-proof";

const YEAR = "2025";
const RIDE_FLOOR = 250000;
const TS = "TRY_CAST(transit_timestamp AS TIMESTAMP)";

type Scope =
  | { kind: "borough"; value: "Manhattan" | "Brooklyn" | "Queens" | "Bronx" }
  | { kind: "timeBand"; label: string; startHour: number; endHour: number }
  | { kind: "dayType"; label: string; pred: "weekday" | "weekend" | "saturday" | "sunday" }
  | { kind: "system" }
  | { kind: "notableDate"; date: string; label: string; month: string }
  | { kind: "censusFilter"; phrase: string; sqlPredicate: string };

const BOROUGH_SCOPES: Scope[] = (
  ["Manhattan", "Brooklyn", "Queens", "Bronx"] as const
).map((value) => ({ kind: "borough", value }));

const TIME_BAND_SCOPES: Scope[] = [
  { kind: "timeBand", label: "the morning rush (6–10 AM)", startHour: 6, endHour: 10 },
  { kind: "timeBand", label: "midday (10 AM–4 PM)", startHour: 10, endHour: 16 },
  { kind: "timeBand", label: "the evening rush (4–8 PM)", startHour: 16, endHour: 20 },
  { kind: "timeBand", label: "the evening (8 PM–midnight)", startHour: 20, endHour: 24 },
  { kind: "timeBand", label: "the late-night hours (midnight–5 AM)", startHour: 0, endHour: 5 },
];

const DAY_TYPE_SCOPES: Scope[] = [
  { kind: "dayType", label: "on weekdays", pred: "weekday" },
  { kind: "dayType", label: "on weekends", pred: "weekend" },
  { kind: "dayType", label: "on Saturdays", pred: "saturday" },
  { kind: "dayType", label: "on Sundays", pred: "sunday" },
];

const SYSTEM_SCOPE: Scope = { kind: "system" };

const NOTABLE_2025_DATES: Scope[] = [
  { kind: "notableDate", date: "2025-01-01", label: "New Year's Day", month: "01" },
  { kind: "notableDate", date: "2025-01-20", label: "Martin Luther King Jr. Day", month: "01" },
  { kind: "notableDate", date: "2025-02-14", label: "Valentine's Day", month: "02" },
  { kind: "notableDate", date: "2025-03-17", label: "St. Patrick's Day", month: "03" },
  { kind: "notableDate", date: "2025-05-26", label: "Memorial Day", month: "05" },
  { kind: "notableDate", date: "2025-07-04", label: "July 4", month: "07" },
  { kind: "notableDate", date: "2025-09-01", label: "Labor Day", month: "09" },
  { kind: "notableDate", date: "2025-10-31", label: "Halloween", month: "10" },
  { kind: "notableDate", date: "2025-11-02", label: "NYC Marathon Sunday", month: "11" },
  { kind: "notableDate", date: "2025-11-27", label: "Thanksgiving", month: "11" },
  { kind: "notableDate", date: "2025-12-25", label: "Christmas Day", month: "12" },
  { kind: "notableDate", date: "2025-12-31", label: "New Year's Eve", month: "12" },
  { kind: "notableDate", date: "2025-06-15", label: "NYC Pride Sunday", month: "06" },
  { kind: "notableDate", date: "2025-04-15", label: "Tax Day", month: "04" },
  { kind: "notableDate", date: "2025-01-06", label: "the January 2025 snowstorm day", month: "01" },
];

function acsNum(col: string): string {
  return `TRY_CAST(TRIM(REGEXP_REPLACE(demo.${col}, ',', '')) AS DOUBLE)`;
}

const CENSUS_FILTER_SCOPES: Scope[] = [
  {
    kind: "censusFilter",
    phrase: "where median household income tops $100,000",
    sqlPredicate: `${acsNum("median_household_income_2023")} > 100000`,
  },
  {
    kind: "censusFilter",
    phrase: "where limited-English Spanish-speaking households are at least 30% of households",
    sqlPredicate: `${acsNum("lang_lim_eng_spanish_2023")} / NULLIF(${acsNum("lang_universe_2023")}, 0) > 0.3`,
  },
  {
    kind: "censusFilter",
    phrase: "where the bachelor's-or-higher share among adults tops 50%",
    sqlPredicate:
      `(${acsNum("edu_bachelors_2023")} + ${acsNum("edu_masters_2023")} + ` +
      `${acsNum("edu_professional_2023")} + ${acsNum("edu_doctorate_2023")}) / ` +
      `NULLIF(${acsNum("edu_universe_25plus_2023")}, 0) > 0.5`,
  },
];

/** Scope unused — keeps pool shape uniform for templates that ignore it. */
const UNIFORM_SCOPE: Scope[] = [{ kind: "dayType", label: "", pred: "weekday" }];

const DOW_LABEL = `CASE day_of_week(${TS})
  WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday'
  WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' WHEN 6 THEN 'Saturday' WHEN 7 THEN 'Sunday'
END`;

const MONTH_LABEL = `CASE month
  WHEN '01' THEN 'January' WHEN '02' THEN 'February' WHEN '03' THEN 'March'
  WHEN '04' THEN 'April' WHEN '05' THEN 'May' WHEN '06' THEN 'June'
  WHEN '07' THEN 'July' WHEN '08' THEN 'August' WHEN '09' THEN 'September'
  WHEN '10' THEN 'October' WHEN '11' THEN 'November' WHEN '12' THEN 'December'
END`;

/** SQL WHERE fragment (leading AND) that narrows to the scope. */
function scopeWhere(scope: Scope): string {
  switch (scope.kind) {
    case "borough":
      return `AND borough = '${scope.value}'`;
    case "timeBand":
      return `AND HOUR(${TS}) >= ${scope.startHour} AND HOUR(${TS}) < ${scope.endHour}`;
    case "dayType":
      if (scope.pred === "weekday") return `AND day_of_week(${TS}) <= 5`;
      if (scope.pred === "weekend") return `AND day_of_week(${TS}) IN (6, 7)`;
      if (scope.pred === "saturday") return `AND day_of_week(${TS}) = 6`;
      return `AND day_of_week(${TS}) = 7`;
    case "system":
      return "";
    case "notableDate":
      return `AND DATE(${TS}) = DATE '${scope.date}' AND month = '${scope.month}'`;
    case "censusFilter":
      return "";
  }
}

/** Human phrase for the question stem. */
function scopePhrase(scope: Scope): string {
  if (scope.kind === "borough") return `among ${scope.value} stations`;
  if (scope.kind === "timeBand") return `during ${scope.label}`;
  if (scope.kind === "dayType") return scope.label;
  if (scope.kind === "notableDate") return `on ${scope.label}`;
  if (scope.kind === "censusFilter") return scope.phrase;
  return "citywide";
}

function sample<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sampleScope(pools: Scope[][]): Scope {
  return sample(sample(pools));
}

type ScopedTemplate = {
  id: string;
  family: "transit";
  label: string;
  metricColumn: string;
  metricName: string;
  scopePools: Scope[][];
  question: (scope: Scope) => string;
  buildSql: (scope: Scope) => string;
  formatExplanation?: (winner: string, metricValue: string) => string;
};

export const METRIC_TEMPLATES: ScopedTemplate[] = [
  {
    id: "transit-late-night-share",
    family: "transit",
    label:
      "subway station with the highest share of late-night (midnight–5AM) ridership in 2025",
    metricColumn: "late_night_pct",
    metricName: "late-night ridership share",
    scopePools: [BOROUGH_SCOPES],
    question: (s) =>
      `Which subway station had the highest share of riders entering between midnight and 5 AM ${scopePhrase(s)} in 2025?`,
    buildSql: (s) => `
      WITH st AS (
        SELECT station_complex_id,
               MIN(station_complex) AS station_complex,
               SUM(TRY_CAST(ridership AS DOUBLE)) AS total_rides,
               SUM(CASE WHEN HOUR(${TS}) < 5
                        THEN TRY_CAST(ridership AS DOUBLE) ELSE 0 END) AS late_rides
        FROM mta_turnstile
        WHERE year = '${YEAR}' ${scopeWhere(s)}
        GROUP BY station_complex_id
        HAVING SUM(TRY_CAST(ridership AS DOUBLE)) >= ${RIDE_FLOOR}
      )
      SELECT station_complex AS answer_label,
             ROUND(100.0 * late_rides / NULLIF(total_rides, 0), 2) AS late_night_pct
      FROM st
      ORDER BY late_rides / NULLIF(total_rides, 0) DESC, station_complex_id ASC
      LIMIT 4`,
  },
  {
    id: "transit-weekend-share",
    family: "transit",
    label: "subway station with the highest share of weekend ridership in 2025",
    metricColumn: "weekend_pct",
    metricName: "weekend ridership share",
    scopePools: [BOROUGH_SCOPES],
    question: (s) =>
      `Which subway station drew the largest share of its ridership on weekends ${scopePhrase(s)} in 2025?`,
    buildSql: (s) => `
      WITH st AS (
        SELECT station_complex_id,
               MIN(station_complex) AS station_complex,
               SUM(TRY_CAST(ridership AS DOUBLE)) AS total_rides,
               SUM(CASE WHEN day_of_week(${TS}) IN (6, 7)
                        THEN TRY_CAST(ridership AS DOUBLE) ELSE 0 END) AS weekend_rides
        FROM mta_turnstile
        WHERE year = '${YEAR}' ${scopeWhere(s)}
        GROUP BY station_complex_id
        HAVING SUM(TRY_CAST(ridership AS DOUBLE)) >= ${RIDE_FLOOR}
      )
      SELECT station_complex AS answer_label,
             ROUND(100.0 * weekend_rides / NULLIF(total_rides, 0), 2) AS weekend_pct
      FROM st
      ORDER BY weekend_rides / NULLIF(total_rides, 0) DESC, station_complex_id ASC
      LIMIT 4`,
  },
  {
    id: "transit-morning-share",
    family: "transit",
    label: "subway station with the highest share of morning-rush (6–10 AM) ridership in 2025",
    metricColumn: "morning_pct",
    metricName: "morning-rush ridership share",
    scopePools: [BOROUGH_SCOPES],
    question: (s) =>
      `Which subway station had the highest share of riders entering during the morning rush (6–10 AM) ${scopePhrase(s)} in 2025?`,
    buildSql: (s) => `
      WITH st AS (
        SELECT station_complex_id,
               MIN(station_complex) AS station_complex,
               SUM(TRY_CAST(ridership AS DOUBLE)) AS total_rides,
               SUM(CASE WHEN HOUR(${TS}) >= 6 AND HOUR(${TS}) < 10
                        THEN TRY_CAST(ridership AS DOUBLE) ELSE 0 END) AS morning_rides
        FROM mta_turnstile
        WHERE year = '${YEAR}' ${scopeWhere(s)}
        GROUP BY station_complex_id
        HAVING SUM(TRY_CAST(ridership AS DOUBLE)) >= ${RIDE_FLOOR}
      )
      SELECT station_complex AS answer_label,
             ROUND(100.0 * morning_rides / NULLIF(total_rides, 0), 2) AS morning_pct
      FROM st
      ORDER BY morning_rides / NULLIF(total_rides, 0) DESC, station_complex_id ASC
      LIMIT 4`,
  },
  {
    id: "transit-evening-share",
    family: "transit",
    label: "subway station with the highest share of evening-rush (4–8 PM) ridership in 2025",
    metricColumn: "evening_pct",
    metricName: "evening-rush ridership share",
    scopePools: [BOROUGH_SCOPES],
    question: (s) =>
      `Which subway station had the highest share of riders entering during the evening rush (4–8 PM) ${scopePhrase(s)} in 2025?`,
    buildSql: (s) => `
      WITH st AS (
        SELECT station_complex_id,
               MIN(station_complex) AS station_complex,
               SUM(TRY_CAST(ridership AS DOUBLE)) AS total_rides,
               SUM(CASE WHEN HOUR(${TS}) >= 16 AND HOUR(${TS}) < 20
                        THEN TRY_CAST(ridership AS DOUBLE) ELSE 0 END) AS evening_rides
        FROM mta_turnstile
        WHERE year = '${YEAR}' ${scopeWhere(s)}
        GROUP BY station_complex_id
        HAVING SUM(TRY_CAST(ridership AS DOUBLE)) >= ${RIDE_FLOOR}
      )
      SELECT station_complex AS answer_label,
             ROUND(100.0 * evening_rides / NULLIF(total_rides, 0), 2) AS evening_pct
      FROM st
      ORDER BY evening_rides / NULLIF(total_rides, 0) DESC, station_complex_id ASC
      LIMIT 4`,
  },
  {
    id: "transit-peak-day-spike",
    family: "transit",
    label:
      "subway station with the biggest single-day ridership spike vs its typical day in 2025",
    metricColumn: "peak_spike",
    metricName: "peak-day ridership spike (busiest day ÷ average day)",
    scopePools: [BOROUGH_SCOPES],
    question: (s) =>
      `Which subway station had the biggest single-day ridership spike relative to its typical day ${scopePhrase(s)} in 2025?`,
    buildSql: (s) => `
      WITH daily AS (
        SELECT station_complex_id,
               DATE(${TS}) AS d,
               SUM(TRY_CAST(ridership AS DOUBLE)) AS day_rides,
               MIN(station_complex) AS station_complex
        FROM mta_turnstile
        WHERE year = '${YEAR}' ${scopeWhere(s)}
        GROUP BY station_complex_id, DATE(${TS})
      ),
      agg AS (
        SELECT station_complex_id,
               MIN(station_complex) AS station_complex,
               MAX(day_rides) AS peak_day,
               AVG(day_rides) AS avg_day,
               SUM(day_rides) AS total_rides
        FROM daily
        GROUP BY station_complex_id
      )
      SELECT station_complex AS answer_label,
             ROUND(peak_day / NULLIF(avg_day, 0), 2) AS peak_spike
      FROM agg
      WHERE total_rides >= ${RIDE_FLOOR}
      ORDER BY peak_day / NULLIF(avg_day, 0) DESC, station_complex_id ASC
      LIMIT 4`,
  },
  {
    id: "transit-transfer-ratio",
    family: "transit",
    label:
      "subway station where transfers make up the largest share of activity in 2025",
    metricColumn: "transfer_pct",
    metricName: "transfer share of station activity",
    scopePools: [BOROUGH_SCOPES],
    question: (s) =>
      `At which subway station did transfers make up the largest share of total activity ${scopePhrase(s)} in 2025?`,
    buildSql: (s) => `
      WITH st AS (
        SELECT station_complex_id,
               MIN(station_complex) AS station_complex,
               SUM(TRY_CAST(ridership AS DOUBLE)) AS rides,
               SUM(TRY_CAST(transfers AS DOUBLE)) AS xfers
        FROM mta_turnstile
        WHERE year = '${YEAR}' ${scopeWhere(s)}
        GROUP BY station_complex_id
        HAVING SUM(TRY_CAST(ridership AS DOUBLE)) >= ${RIDE_FLOOR}
      )
      SELECT station_complex AS answer_label,
             ROUND(100.0 * xfers / NULLIF(rides, 0), 2) AS transfer_pct
      FROM st
      ORDER BY xfers / NULLIF(rides, 0) DESC, station_complex_id ASC
      LIMIT 4`,
  },
  {
    id: "transit-busiest-station-scoped",
    family: "transit",
    label: "busiest subway station within a given borough, time-of-day, or day-type in 2025",
    metricColumn: "rides",
    metricName: "total ridership",
    scopePools: [BOROUGH_SCOPES, TIME_BAND_SCOPES, DAY_TYPE_SCOPES],
    question: (s) =>
      `Which subway station had the highest ridership ${scopePhrase(s)} in 2025?`,
    buildSql: (s) => `
      SELECT station_complex AS answer_label,
             SUM(TRY_CAST(ridership AS DOUBLE)) AS rides
      FROM mta_turnstile
      WHERE year = '${YEAR}' ${scopeWhere(s)}
      GROUP BY station_complex_id, station_complex
      HAVING SUM(TRY_CAST(ridership AS DOUBLE)) >= ${Math.round(RIDE_FLOOR / 4)}
      ORDER BY rides DESC, station_complex_id ASC
      LIMIT 4`,
  },
  {
    id: "transit-busiest-hour",
    family: "transit",
    label: "busiest hour of the day on the subway (system-wide or within a borough) in 2025",
    metricColumn: "rides",
    metricName: "total ridership in that hour",
    scopePools: [[SYSTEM_SCOPE], BOROUGH_SCOPES],
    question: (s) =>
      s.kind === "borough"
        ? `${s.value}: which hour of the day sees the most subway ridership in 2025?`
        : `Which hour of the day sees the most NYC subway ridership in 2025?`,
    buildSql: (s) => `
      SELECT LPAD(CAST(HOUR(${TS}) AS VARCHAR), 2, '0') || ':00' AS answer_label,
             SUM(TRY_CAST(ridership AS DOUBLE)) AS rides
      FROM mta_turnstile
      WHERE year = '${YEAR}' ${s.kind === "borough" ? scopeWhere(s) : ""}
      GROUP BY HOUR(${TS})
      ORDER BY rides DESC, answer_label ASC
      LIMIT 4`,
  },
  {
    id: "transit-neighborhood-latenight",
    family: "transit",
    label:
      "NYC neighborhood with the highest late-night (midnight–5 AM) subway ridership share in 2025",
    metricColumn: "late_pct",
    metricName: "late-night ridership share",
    scopePools: [UNIFORM_SCOPE],
    question: () =>
      `Which NYC neighborhood had the highest share of its subway riders entering between midnight and 5 AM in 2025?`,
    buildSql: () => `
      WITH n AS (
        SELECT x.ntaname AS nta,
               SUM(TRY_CAST(m.ridership AS DOUBLE)) AS total_rides,
               SUM(CASE WHEN HOUR(TRY_CAST(m.transit_timestamp AS TIMESTAMP)) < 5
                        THEN TRY_CAST(m.ridership AS DOUBLE) ELSE 0 END) AS late_rides
        FROM mta_turnstile m
        JOIN station_xwalk x USING (station_complex_id)
        WHERE m.year = '${YEAR}' AND x.ntaname <> ''
        GROUP BY x.ntaname
        HAVING SUM(TRY_CAST(m.ridership AS DOUBLE)) >= ${RIDE_FLOOR}
      )
      SELECT nta AS answer_label,
             ROUND(100.0 * late_rides / NULLIF(total_rides, 0), 2) AS late_pct
      FROM n
      ORDER BY late_rides / NULLIF(total_rides, 0) DESC, nta ASC
      LIMIT 4`,
  },
  {
    id: "transit-fastest-growing-station",
    family: "transit",
    label: "subway station with the fastest ridership growth from H1 to H2 2025, by borough",
    metricColumn: "growth",
    metricName: "H2-vs-H1 ridership growth",
    scopePools: [BOROUGH_SCOPES],
    question: (s) =>
      `${scopePhrase(s)}: which subway station grew the most from the first half of 2025 to the second?`,
    buildSql: (s) => `
      WITH st AS (
        SELECT station_complex_id, MIN(station_complex) AS station_complex,
               SUM(CASE WHEN month IN ('01','02','03','04','05','06')
                        THEN TRY_CAST(ridership AS DOUBLE) ELSE 0 END) AS h1,
               SUM(CASE WHEN month IN ('07','08','09','10','11','12')
                        THEN TRY_CAST(ridership AS DOUBLE) ELSE 0 END) AS h2
        FROM mta_turnstile
        WHERE year = '${YEAR}' ${scopeWhere(s)}
        GROUP BY station_complex_id
        HAVING SUM(CASE WHEN month IN ('01','02','03','04','05','06')
                        THEN TRY_CAST(ridership AS DOUBLE) ELSE 0 END) >= ${RIDE_FLOOR}
      )
      SELECT station_complex AS answer_label,
             ROUND(h2 / NULLIF(h1, 0), 3) AS growth
      FROM st
      ORDER BY h2 / NULLIF(h1, 0) DESC, station_complex_id ASC
      LIMIT 4`,
  },
  {
    id: "transit-busiest-neighborhood",
    family: "transit",
    label: "busiest NYC neighborhood by total subway ridership in 2025",
    metricColumn: "rides",
    metricName: "total ridership",
    scopePools: [BOROUGH_SCOPES, [SYSTEM_SCOPE]],
    question: (s) =>
      s.kind === "borough"
        ? `Which ${s.value} neighborhood had the highest total subway ridership in 2025?`
        : `Which NYC neighborhood had the highest total subway ridership in 2025?`,
    buildSql: (s) => `
      SELECT x.ntaname AS answer_label,
             SUM(TRY_CAST(m.ridership AS DOUBLE)) AS rides
      FROM mta_turnstile m
      JOIN station_xwalk x USING (station_complex_id)
      WHERE m.year = '${YEAR}' AND x.ntaname <> ''
        ${s.kind === "borough" ? `AND x.boroname = '${s.value}'` : ""}
      GROUP BY x.ntaname
      HAVING SUM(TRY_CAST(m.ridership AS DOUBLE)) >= ${RIDE_FLOOR}
      ORDER BY rides DESC, answer_label ASC
      LIMIT 4`,
  },
  {
    id: "transit-neighborhood-weekend",
    family: "transit",
    label: "NYC neighborhood with the highest share of weekend subway ridership in 2025",
    metricColumn: "weekend_pct",
    metricName: "weekend ridership share",
    scopePools: [UNIFORM_SCOPE],
    question: () =>
      `Which NYC neighborhood drew the largest share of its subway ridership on weekends in 2025?`,
    buildSql: () => `
      WITH n AS (
        SELECT x.ntaname AS nta,
               SUM(TRY_CAST(m.ridership AS DOUBLE)) AS total_rides,
               SUM(CASE WHEN day_of_week(TRY_CAST(m.transit_timestamp AS TIMESTAMP)) IN (6, 7)
                        THEN TRY_CAST(m.ridership AS DOUBLE) ELSE 0 END) AS weekend_rides
        FROM mta_turnstile m
        JOIN station_xwalk x USING (station_complex_id)
        WHERE m.year = '${YEAR}' AND x.ntaname <> ''
        GROUP BY x.ntaname
        HAVING SUM(TRY_CAST(m.ridership AS DOUBLE)) >= ${RIDE_FLOOR}
      )
      SELECT nta AS answer_label,
             ROUND(100.0 * weekend_rides / NULLIF(total_rides, 0), 2) AS weekend_pct
      FROM n
      ORDER BY weekend_rides / NULLIF(total_rides, 0) DESC, nta ASC
      LIMIT 4`,
  },
  {
    id: "transit-census-neighborhood",
    family: "transit",
    label:
      "highest subway ridership among neighborhoods meeting a census demographic filter in 2025",
    metricColumn: "rides",
    metricName: "total ridership",
    scopePools: [CENSUS_FILTER_SCOPES],
    question: (s) =>
      s.kind === "censusFilter"
        ? `Among NYC neighborhoods ${s.phrase}, which had the highest total subway ridership in 2025?`
        : `Among NYC neighborhoods meeting a census filter, which had the highest total subway ridership in 2025?`,
    buildSql: (s) => {
      const pred = s.kind === "censusFilter" ? s.sqlPredicate : "1=1";
      return `
      WITH n AS (
        SELECT x.ntaname AS nta,
               SUM(TRY_CAST(m.ridership AS DOUBLE)) AS total_rides
        FROM mta_turnstile m
        JOIN station_xwalk x USING (station_complex_id)
        JOIN census_tract_demographics demo
          ON TRIM(CAST(x.geoid AS VARCHAR)) = TRIM(CAST(demo.geoid AS VARCHAR))
        WHERE m.year = '${YEAR}' AND x.ntaname <> '' AND (${pred})
        GROUP BY x.ntaname
        HAVING SUM(TRY_CAST(m.ridership AS DOUBLE)) >= ${RIDE_FLOOR}
      )
      SELECT nta AS answer_label,
             total_rides AS rides
      FROM n
      ORDER BY total_rides DESC, nta ASC
      LIMIT 4`;
    },
  },
  {
    id: "transit-busiest-line",
    family: "transit",
    label:
      "busiest subway line by total ridership at stations served in 2025 (multi-line stations counted toward each line)",
    metricColumn: "rides",
    metricName: "total ridership at stations served by the line",
    scopePools: [UNIFORM_SCOPE],
    question: () =>
      `Which subway line had the highest total ridership at the stations it serves in 2025? (Multi-line stations count toward each line they serve.)`,
    buildSql: () => `
      WITH routes AS (
        SELECT TRIM(r.route) AS route,
               SUM(TRY_CAST(m.ridership AS DOUBLE)) AS rides
        FROM mta_turnstile m
        JOIN station_xwalk x USING (station_complex_id)
        CROSS JOIN UNNEST(SPLIT(x.daytime_routes, ',')) AS t(r)
        WHERE m.year = '${YEAR}' AND x.daytime_routes <> ''
        GROUP BY TRIM(r.route)
      )
      SELECT route AS answer_label, rides
      FROM routes
      ORDER BY rides DESC, answer_label ASC
      LIMIT 4`,
    formatExplanation: (winner, metricValue) =>
      `${winner} ranks first on total ridership at stations served by the line (${metricValue}) — ` +
      `this counts all riders at stations the line serves, not exact per-line boardings, so ${winner} is the correct answer.`,
  },
  {
    id: "transit-line-weekend",
    family: "transit",
    label:
      "subway line with the highest weekend ridership share at stations served in 2025",
    metricColumn: "weekend_pct",
    metricName: "weekend ridership share at stations served by the line",
    scopePools: [UNIFORM_SCOPE],
    question: () =>
      `Which subway line drew the largest share of weekend ridership at the stations it serves in 2025?`,
    buildSql: () => `
      WITH routes AS (
        SELECT TRIM(r.route) AS route,
               SUM(TRY_CAST(m.ridership AS DOUBLE)) AS total_rides,
               SUM(CASE WHEN day_of_week(TRY_CAST(m.transit_timestamp AS TIMESTAMP)) IN (6, 7)
                        THEN TRY_CAST(m.ridership AS DOUBLE) ELSE 0 END) AS weekend_rides
        FROM mta_turnstile m
        JOIN station_xwalk x USING (station_complex_id)
        CROSS JOIN UNNEST(SPLIT(x.daytime_routes, ',')) AS t(r)
        WHERE m.year = '${YEAR}' AND x.daytime_routes <> ''
        GROUP BY TRIM(r.route)
        HAVING SUM(TRY_CAST(m.ridership AS DOUBLE)) >= ${RIDE_FLOOR}
      )
      SELECT route AS answer_label,
             ROUND(100.0 * weekend_rides / NULLIF(total_rides, 0), 2) AS weekend_pct
      FROM routes
      ORDER BY weekend_rides / NULLIF(total_rides, 0) DESC, route ASC
      LIMIT 4`,
    formatExplanation: (winner, metricValue) =>
      `${winner} ranks first on weekend ridership share at stations served by the line (${metricValue}) — ` +
      `multi-line stations are counted toward each line they serve, so ${winner} is the correct answer.`,
  },
  {
    id: "transit-busiest-dow",
    family: "transit",
    label: "busiest day of the week for subway ridership in 2025",
    metricColumn: "rides",
    metricName: "total ridership",
    scopePools: [[{ kind: "borough", value: "Manhattan" }], BOROUGH_SCOPES],
    question: (s) =>
      s.kind === "borough"
        ? `${s.value}: which day of the week sees the most subway ridership in 2025?`
        : `Which day of the week sees the most NYC subway ridership in 2025?`,
    buildSql: (s) => `
      SELECT ${DOW_LABEL} AS answer_label,
             SUM(TRY_CAST(ridership AS DOUBLE)) AS rides
      FROM mta_turnstile
      WHERE year = '${YEAR}' ${s.kind === "borough" ? scopeWhere(s) : ""}
      GROUP BY day_of_week(${TS})
      ORDER BY rides DESC, answer_label ASC
      LIMIT 4`,
  },
  {
    id: "transit-busiest-month",
    family: "transit",
    label: "busiest month for subway ridership in 2025",
    metricColumn: "rides",
    metricName: "total ridership",
    scopePools: [[{ kind: "borough", value: "Manhattan" }], BOROUGH_SCOPES],
    question: (s) =>
      s.kind === "borough"
        ? `${s.value}: which month saw the most subway ridership in 2025?`
        : `Which month saw the most NYC subway ridership in 2025?`,
    buildSql: (s) => `
      SELECT ${MONTH_LABEL} AS answer_label,
             SUM(TRY_CAST(ridership AS DOUBLE)) AS rides
      FROM mta_turnstile
      WHERE year = '${YEAR}' ${s.kind === "borough" ? scopeWhere(s) : ""}
      GROUP BY month
      ORDER BY rides DESC, answer_label ASC
      LIMIT 4`,
  },
  {
    id: "transit-date-ridership",
    family: "transit",
    label:
      "busiest subway station on a notable 2025 date (holiday, parade, storm, or event day)",
    metricColumn: "rides",
    metricName: "total ridership on that date",
    scopePools: [NOTABLE_2025_DATES],
    question: (s) =>
      s.kind === "notableDate"
        ? `On ${s.label} in 2025, which subway station had the highest ridership?`
        : `On a notable 2025 date, which subway station had the highest ridership?`,
    buildSql: (s) => `
      SELECT station_complex AS answer_label,
             SUM(TRY_CAST(ridership AS DOUBLE)) AS rides
      FROM mta_turnstile
      WHERE year = '${YEAR}' ${scopeWhere(s)}
      GROUP BY station_complex_id, station_complex
      HAVING SUM(TRY_CAST(ridership AS DOUBLE)) >= ${Math.round(RIDE_FLOOR / 20)}
      ORDER BY rides DESC, station_complex_id ASC
      LIMIT 4`,
  },
];

const BY_ID = new Map(METRIC_TEMPLATES.map((t) => [t.id, t]));

export function isTemplatedMetricId(id: string): boolean {
  return BY_ID.has(id);
}

async function runAthenaQuery(sql: string) {
  const executionId = await startQuery(sql);
  return waitForAthenaResults(executionId, { pollMs: 400 });
}

export type TemplatedMetricQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  sql: string;
  explanation: string;
  model: string;
  categoryId: string;
  categoryLabel: string;
  proof: TriviaProof;
  results: {
    columns: string[];
    rows: Record<string, string | null>[];
  };
  scannedBytes: number;
  runtimeMs: number;
};

export type TemplatedMetricSession = {
  excludeAnswers?: string[];
};

/**
 * Generate a templated metric question. No model call — options and the correct answer
 * come straight from Athena. Re-rolls scope when the winner is excluded, when fewer than
 * 4 distinct rows come back, or on a display-value tie for the top slot.
 */
export async function generateTemplatedMetricQuestion(
  categoryId: string,
  opts?: { session?: TemplatedMetricSession }
): Promise<TemplatedMetricQuestion> {
  const tpl = BY_ID.get(categoryId);
  if (!tpl) throw new Error(`Not a templated metric category: ${categoryId}`);

  const exclude = new Set(
    (opts?.session?.excludeAnswers ?? []).map((a) => a.trim().toLowerCase())
  );

  const MAX_ROLLS = 6;
  let lastErr = "no attempts";
  for (let roll = 0; roll < MAX_ROLLS; roll++) {
    const scope = sampleScope(tpl.scopePools);
    const sql = tpl.buildSql(scope).trim();
    const results = await runAthenaQuery(injectStationCrosswalk(sql));

    const rows = results.rows ?? [];
    const labels: string[] = [];
    for (const r of rows) {
      const l = (r.answer_label ?? "").trim();
      if (l && !labels.some((x) => x.toLowerCase() === l.toLowerCase())) labels.push(l);
      if (labels.length === 4) break;
    }
    if (labels.length < 4) {
      lastErr = `only ${labels.length} qualifying rows`;
      continue;
    }

    const winner = labels[0];
    if (exclude.has(winner.toLowerCase())) {
      lastErr = `winner ${winner} is excluded this session`;
      continue;
    }

    const m0 = (rows[0][tpl.metricColumn] ?? "").trim();
    const m1 = (rows[1]?.[tpl.metricColumn] ?? "").trim();
    if (m0 !== "" && m0 === m1) {
      lastErr = `display tie at top on ${tpl.metricColumn}`;
      continue;
    }

    const dataCorrectIndex = 0;
    const { options, correctIndex } = shuffleTriviaOptions(labels, dataCorrectIndex);

    const winnerMetricValue = m0;
    const explanation = tpl.formatExplanation
      ? tpl.formatExplanation(winner, winnerMetricValue)
      : `${winner} ranks first on ${tpl.metricName} (${winnerMetricValue}), ` +
        `so ${winner} is the correct answer.`;

    const baseProof: TriviaProof = {
      summary: `Athena ranks ${winner} #1 (${tpl.metricColumn} = ${winnerMetricValue}) — answer ${winner}.`,
      correctOption: winner,
      correctLabel: winner,
      winnerLabel: winner,
      winnerMetric: { column: tpl.metricColumn, value: winnerMetricValue },
      correctedFromModel: false,
      matches: [{ rowIndex: 0, column: "answer_label", value: winner }],
    };
    const proof = proofWithShuffledIndex(baseProof, correctIndex, options);

    return {
      question: tpl.question(scope),
      options,
      correctIndex,
      sql,
      explanation,
      categoryId: tpl.id,
      categoryLabel: tpl.label,
      proof,
      results: { columns: results.columns, rows: rows.slice(0, 10) },
      scannedBytes: results.scannedBytes,
      runtimeMs: results.executionTimeMs,
      model: "templated",
    };
  }
  throw new Error(
    `Templated metric ${categoryId} failed after ${MAX_ROLLS} rolls: ${lastErr}`
  );
}
