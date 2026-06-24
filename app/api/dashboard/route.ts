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
      client.query(`...`),
      // Query 3: Error rate breakdown (last 7 days)
      client.query(`...`),
      // Query 4: Eval score trend (30 days, by day)
      client.query(`...`),
      // Query 5: Routing distribution (last 7 days)
      client.query(`...`),
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