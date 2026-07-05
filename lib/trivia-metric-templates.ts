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
const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx"] as const;

type MetricParams = { borough?: string };

type MetricTemplate = {
  id: string;
  family: "transit";
  label: string;
  metricColumn: string;
  labelColumn: "answer_label";
  question: (borough?: string) => string;
  metricName: string;
  buildSql: (p: MetricParams) => string;
  perBorough: boolean;
};

function boroughClause(borough?: string): string {
  return borough ? `AND borough = '${borough.replace(/'/g, "''")}'` : "";
}

export const METRIC_TEMPLATES: MetricTemplate[] = [
  {
    id: "transit-late-night-share",
    family: "transit",
    label:
      "subway station with the highest share of late-night (midnight–5AM) ridership in 2025",
    metricColumn: "late_night_pct",
    labelColumn: "answer_label",
    metricName: "late-night ridership share",
    perBorough: true,
    question: (b) =>
      b
        ? `Among ${b} subway stations in 2025, which had the highest share of riders entering between midnight and 5 AM?`
        : `Which NYC subway station had the highest share of its riders entering between midnight and 5 AM in 2025?`,
    buildSql: ({ borough }) => `
      WITH s AS (
        SELECT station_complex_id,
               MIN(station_complex) AS station_complex,
               SUM(TRY_CAST(ridership AS DOUBLE)) AS total_rides,
               SUM(CASE WHEN HOUR(TRY_CAST(transit_timestamp AS TIMESTAMP)) < 5
                        THEN TRY_CAST(ridership AS DOUBLE) ELSE 0 END) AS late_rides
        FROM mta_turnstile
        WHERE year = '${YEAR}' ${boroughClause(borough)}
        GROUP BY station_complex_id
        HAVING SUM(TRY_CAST(ridership AS DOUBLE)) >= ${RIDE_FLOOR}
      )
      SELECT station_complex AS answer_label,
             ROUND(100.0 * late_rides / NULLIF(total_rides, 0), 2) AS late_night_pct
      FROM s
      ORDER BY late_rides / NULLIF(total_rides, 0) DESC, station_complex_id ASC
      LIMIT 4`,
  },
  {
    id: "transit-weekend-share",
    family: "transit",
    label: "subway station with the highest share of weekend ridership in 2025",
    metricColumn: "weekend_pct",
    labelColumn: "answer_label",
    metricName: "weekend ridership share",
    perBorough: true,
    question: (b) =>
      b
        ? `Among ${b} subway stations in 2025, which drew the largest share of its ridership on weekends?`
        : `Which NYC subway station drew the largest share of its ridership on weekends in 2025?`,
    buildSql: ({ borough }) => `
      WITH s AS (
        SELECT station_complex_id,
               MIN(station_complex) AS station_complex,
               SUM(TRY_CAST(ridership AS DOUBLE)) AS total_rides,
               SUM(CASE WHEN day_of_week(TRY_CAST(transit_timestamp AS TIMESTAMP)) IN (6,7)
                        THEN TRY_CAST(ridership AS DOUBLE) ELSE 0 END) AS weekend_rides
        FROM mta_turnstile
        WHERE year = '${YEAR}' ${boroughClause(borough)}
        GROUP BY station_complex_id
        HAVING SUM(TRY_CAST(ridership AS DOUBLE)) >= ${RIDE_FLOOR}
      )
      SELECT station_complex AS answer_label,
             ROUND(100.0 * weekend_rides / NULLIF(total_rides, 0), 2) AS weekend_pct
      FROM s
      ORDER BY weekend_rides / NULLIF(total_rides, 0) DESC, station_complex_id ASC
      LIMIT 4`,
  },
  {
    id: "transit-peak-day-spike",
    family: "transit",
    label:
      "subway station with the biggest single-day ridership spike vs its typical day in 2025",
    metricColumn: "peak_spike",
    labelColumn: "answer_label",
    metricName: "peak-day ridership spike (busiest day ÷ average day)",
    perBorough: true,
    question: (b) =>
      b
        ? `Among ${b} subway stations in 2025, which had the biggest single-day ridership spike relative to its typical day?`
        : `Which NYC subway station had the biggest single-day ridership spike relative to its typical day in 2025?`,
    buildSql: ({ borough }) => `
      WITH daily AS (
        SELECT station_complex_id,
               DATE(TRY_CAST(transit_timestamp AS TIMESTAMP)) AS d,
               SUM(TRY_CAST(ridership AS DOUBLE)) AS day_rides,
               MIN(station_complex) AS station_complex
        FROM mta_turnstile
        WHERE year = '${YEAR}' ${boroughClause(borough)}
        GROUP BY station_complex_id, DATE(TRY_CAST(transit_timestamp AS TIMESTAMP))
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
    labelColumn: "answer_label",
    metricName: "transfer share of station activity",
    perBorough: false,
    question: () =>
      `At which NYC subway station did transfers make up the largest share of total activity in 2025?`,
    buildSql: () => `
      WITH s AS (
        SELECT station_complex_id,
               MIN(station_complex) AS station_complex,
               SUM(TRY_CAST(ridership AS DOUBLE)) AS rides,
               SUM(TRY_CAST(transfers AS DOUBLE)) AS xfers
        FROM mta_turnstile
        WHERE year = '${YEAR}'
        GROUP BY station_complex_id
        HAVING SUM(TRY_CAST(ridership AS DOUBLE)) >= ${RIDE_FLOOR}
      )
      SELECT station_complex AS answer_label,
             ROUND(100.0 * xfers / NULLIF(rides, 0), 2) AS transfer_pct
      FROM s
      ORDER BY xfers / NULLIF(rides, 0) DESC, station_complex_id ASC
      LIMIT 4`,
  },
];

const BY_ID = new Map(METRIC_TEMPLATES.map((t) => [t.id, t]));

export function isTemplatedMetricId(id: string): boolean {
  return BY_ID.has(id);
}

function pickBorough(): string {
  return BOROUGHS[Math.floor(Math.random() * BOROUGHS.length)];
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
 * come straight from Athena. Re-rolls params (borough) when the winner is excluded, when
 * fewer than 4 distinct rows come back, or on a display-value tie for the top slot.
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
    const borough = tpl.perBorough ? pickBorough() : undefined;
    const sql = tpl.buildSql({ borough }).trim();
    const results = await runAthenaQuery(injectStationCrosswalk(sql));

    const rows = results.rows ?? [];
    const labels: string[] = [];
    for (const r of rows) {
      const l = (r.answer_label ?? "").trim();
      if (l && !labels.some((x) => x.toLowerCase() === l.toLowerCase())) labels.push(l);
      if (labels.length === 4) break;
    }
    if (labels.length < 4) {
      lastErr = `only ${labels.length} qualifying stations`;
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
    const explanation =
      `${winner} ranks first on ${tpl.metricName} (${winnerMetricValue}), ` +
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
      question: tpl.question(borough),
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
