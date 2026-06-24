/**
 * Judge-score regression gate for CI.
 *
 * Compares avg judge_overall in the first N days of judged history (baseline)
 * vs the last M days (current). Fails when current drops more than the threshold.
 *
 * Usage (loads .env / .env.local):
 *   npm run regression:check
 *
 * Env:
 *   NEON_DATABASE_URL              required to run (otherwise exits 0)
 *   REGRESSION_BASELINE_DAYS=30    baseline window length from first judged run
 *   REGRESSION_CURRENT_DAYS=7      rolling current window
 *   REGRESSION_DROP_THRESHOLD=0.10  fractional drop that fails (10%)
 *   REGRESSION_MIN_SAMPLES=5       min judged runs per window
 */

import { loadEnvFile } from "../lib/load-env-file";

loadEnvFile();

import { readFileSync } from "fs";
import path from "path";
import { getPgPool, isDatabaseConfigured } from "../lib/db";
import { evaluateJudgeScoreRegression } from "../lib/regression-check";

const BASELINE_DAYS =
  Number.parseInt(process.env.REGRESSION_BASELINE_DAYS ?? "30", 10) || 30;
const CURRENT_DAYS =
  Number.parseInt(process.env.REGRESSION_CURRENT_DAYS ?? "7", 10) || 7;
const DROP_THRESHOLD =
  Number.parseFloat(process.env.REGRESSION_DROP_THRESHOLD ?? "0.10") || 0.1;
const MIN_SAMPLES =
  Number.parseInt(process.env.REGRESSION_MIN_SAMPLES ?? "5", 10) || 5;

async function ensureMonitoringAlertsTable(): Promise<void> {
  const pool = getPgPool();
  if (!pool) return;

  const sqlPath = path.join(
    process.cwd(),
    "scripts/sql/create-monitoring-alerts.sql"
  );
  const sql = readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

async function fetchBaseline(): Promise<{ avgScore: number; sampleCount: number } | null> {
  const pool = getPgPool();
  if (!pool) return null;

  const result = await pool.query<{ avg_score: string | null; sample_count: string }>(
    `WITH start_bound AS (
       SELECT date_trunc('day', MIN(created_at)) AS start_day
       FROM nl2sql.query_runs
       WHERE judge_overall IS NOT NULL
     )
     SELECT
       AVG(q.judge_overall::float8) AS avg_score,
       COUNT(*)::int AS sample_count
     FROM nl2sql.query_runs q
     CROSS JOIN start_bound s
     WHERE q.judge_overall IS NOT NULL
       AND s.start_day IS NOT NULL
       AND q.created_at >= s.start_day
       AND q.created_at < s.start_day + ($1::int * INTERVAL '1 day')`,
    [BASELINE_DAYS]
  );

  const row = result.rows[0];
  if (!row || Number.parseInt(row.sample_count, 10) === 0) return null;

  return {
    avgScore: Number.parseFloat(row.avg_score ?? "0"),
    sampleCount: Number.parseInt(row.sample_count, 10),
  };
}

async function fetchCurrent(): Promise<{ avgScore: number; sampleCount: number } | null> {
  const pool = getPgPool();
  if (!pool) return null;

  const result = await pool.query<{ avg_score: string | null; sample_count: string }>(
    `SELECT
       AVG(judge_overall::float8) AS avg_score,
       COUNT(*)::int AS sample_count
     FROM nl2sql.query_runs
     WHERE judge_overall IS NOT NULL
       AND created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
    [CURRENT_DAYS]
  );

  const row = result.rows[0];
  if (!row || Number.parseInt(row.sample_count, 10) === 0) return null;

  return {
    avgScore: Number.parseFloat(row.avg_score ?? "0"),
    sampleCount: Number.parseInt(row.sample_count, 10),
  };
}

async function recordAlert(
  result: Extract<
    ReturnType<typeof evaluateJudgeScoreRegression>,
    { status: "pass" | "fail" }
  >
): Promise<void> {
  const pool = getPgPool();
  if (!pool) return;

  const passed = result.status === "pass";
  const message =
    result.status === "fail"
      ? result.message
      : `Judge score stable: baseline ${result.baseline.avgScore.toFixed(2)}/5, current ${result.current.avgScore.toFixed(2)}/5`;

  await pool.query(
    `INSERT INTO nl2sql.monitoring_alerts
       (alert_type, baseline_avg, current_avg, baseline_count, current_count, drop_pct, passed, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      "judge_score_regression",
      result.baseline.avgScore,
      result.current.avgScore,
      result.baseline.sampleCount,
      result.current.sampleCount,
      result.dropPct,
      passed,
      message,
    ]
  );
}

async function runRegressionCheck(): Promise<void> {
  if (!isDatabaseConfigured()) {
    console.log("[regression-check] NEON_DATABASE_URL not set — skipping");
    process.exit(0);
  }

  const pool = getPgPool();
  if (!pool) {
    console.log("[regression-check] Could not create pool — skipping");
    process.exit(0);
  }

  await ensureMonitoringAlertsTable();

  const baseline = await fetchBaseline();
  const current = await fetchCurrent();

  if (!baseline || !current) {
    console.log(
      "[regression-check] Not enough judged history in nl2sql.query_runs — skipping"
    );
    process.exit(0);
  }

  const result = evaluateJudgeScoreRegression(baseline, current, {
    dropThreshold: DROP_THRESHOLD,
    minSamples: MIN_SAMPLES,
  });

  if (result.status === "skip") {
    console.log(`[regression-check] ${result.reason} — skipping`);
    process.exit(0);
  }

  await recordAlert(result);

  console.log(
    `[regression-check] baseline=${result.baseline.avgScore.toFixed(2)}/5 ` +
      `(n=${result.baseline.sampleCount}, first ${BASELINE_DAYS}d) · ` +
      `current=${result.current.avgScore.toFixed(2)}/5 ` +
      `(n=${result.current.sampleCount}, last ${CURRENT_DAYS}d) · ` +
      `drop=${(result.dropPct * 100).toFixed(1)}%`
  );

  if (result.status === "fail") {
    console.error(`[regression-check] FAIL: ${result.message}`);
    process.exit(1);
  }

  console.log("[regression-check] PASS");
  process.exit(0);
}

runRegressionCheck().catch((e) => {
  console.error("[regression-check] Fatal error:", e);
  process.exit(1);
});
