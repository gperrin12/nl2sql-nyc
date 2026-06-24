import { NextResponse } from 'next/server';
import { getPgPool } from '@/lib/db';

export async function GET() {
  const pool = getPgPool();
  if (!pool) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await pool.connect();
  try {
    const [costTrend, latency, errorRates, scoreTrend, routing] = await Promise.all([
      // Query 1: Cost trend (30 days, by day)
      client.query(`
        SELECT
          d.day::date AS day,
          COALESCE(c.query_count, 0)::int AS query_count,
          COALESCE(c.total_cost_usd, 0)::float8 AS total_cost_usd,
          c.avg_cost_usd::float8 AS avg_cost_usd
        FROM generate_series(
          date_trunc('day', NOW() - INTERVAL '29 days')::date,
          date_trunc('day', NOW())::date,
          '1 day'::interval
        ) AS d(day)
        LEFT JOIN (
          SELECT
            date_trunc('day', created_at)::date AS day,
            COUNT(*)::int AS query_count,
            SUM(cost_usd)::float8 AS total_cost_usd,
            AVG(cost_usd)::float8 AS avg_cost_usd
          FROM nl2sql.query_runs
          WHERE created_at >= NOW() - INTERVAL '30 days'
            AND cost_usd IS NOT NULL
          GROUP BY 1
        ) c USING (day)
        ORDER BY d.day
      `),
      // Query 2: Latency p50/p95 (30 days, by day)
      client.query(`
        SELECT
          d.day::date AS day,
          COALESCE(l.sample_count, 0)::int AS sample_count,
          l.p50_ms::float8 AS p50_ms,
          l.p95_ms::float8 AS p95_ms
        FROM generate_series(
          date_trunc('day', NOW() - INTERVAL '29 days')::date,
          date_trunc('day', NOW())::date,
          '1 day'::interval
        ) AS d(day)
        LEFT JOIN (
          SELECT
            date_trunc('day', created_at)::date AS day,
            COUNT(*)::int AS sample_count,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY runtime_ms)::float8 AS p50_ms,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY runtime_ms)::float8 AS p95_ms
          FROM nl2sql.query_runs
          WHERE created_at >= NOW() - INTERVAL '30 days'
            AND runtime_ms IS NOT NULL
          GROUP BY 1
        ) l USING (day)
        ORDER BY d.day
      `),
      // Query 3: Error rate breakdown (last 7 days)
      client.query(`
        SELECT
          CASE
            WHEN hallucination_type IS NOT NULL THEN hallucination_type
            WHEN athena_state = 'SUCCEEDED' THEN 'success'
            WHEN athena_state IN ('FAILED', 'CANCELLED') THEN 'athena_failed'
            WHEN athena_state = 'BLOCKED' THEN 'blocked'
            WHEN athena_state = 'RUNNING' THEN 'running'
            ELSE COALESCE(athena_state, 'unknown')
          END AS category,
          COUNT(*)::int AS count,
          ROUND(
            100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0),
            2
          )::float8 AS pct
        FROM nl2sql.query_runs
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY 1
        ORDER BY count DESC
      `),
      // Query 4: Eval score trend (30 days, by day)
      client.query(`
        SELECT
          d.day::date AS day,
          COALESCE(s.judged_count, 0)::int AS judged_count,
          s.avg_score::float8 AS avg_score,
          s.min_score::float8 AS min_score,
          s.max_score::float8 AS max_score
        FROM generate_series(
          date_trunc('day', NOW() - INTERVAL '29 days')::date,
          date_trunc('day', NOW())::date,
          '1 day'::interval
        ) AS d(day)
        LEFT JOIN (
          SELECT
            date_trunc('day', created_at)::date AS day,
            COUNT(*)::int AS judged_count,
            AVG(judge_overall)::float8 AS avg_score,
            MIN(judge_overall)::float8 AS min_score,
            MAX(judge_overall)::float8 AS max_score
          FROM nl2sql.query_runs
          WHERE created_at >= NOW() - INTERVAL '30 days'
            AND judge_overall IS NOT NULL
          GROUP BY 1
        ) s USING (day)
        ORDER BY d.day
      `),
      // Query 5: Routing distribution (last 7 days)
      client.query(`
        SELECT
          route,
          COUNT(*)::int AS count,
          ROUND(
            100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0),
            2
          )::float8 AS pct
        FROM nl2sql.routing_log
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY route
        ORDER BY count DESC
      `),
    ]);

    return NextResponse.json({
      costTrend: costTrend.rows,
      latency: latency.rows,
      errorRates: errorRates.rows,
      scoreTrend: scoreTrend.rows,
      routing: routing.rows,
    });
  } finally {
    client.release();
  }
}