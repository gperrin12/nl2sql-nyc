import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getPgPool, isDatabaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const pool = getPgPool();
  if (!pool) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const client = await pool.connect();
  try {
    const [summary, costTrend, byCategory, byMode, recentRuns] = await Promise.all([
      // Summary: all-time totals + last-30-day success rate / avg attempts.
      client.query(`
        SELECT
          COUNT(*)::int AS total_generations,
          COUNT(*) FILTER (WHERE athena_state = 'SUCCEEDED')::int AS succeeded,
          COUNT(*) FILTER (WHERE athena_state = 'FAILED')::int AS failed,
          COALESCE(SUM(cost_usd), 0)::float8 AS total_cost_usd,
          COALESCE(SUM((tokens_used->>'total')::int), 0)::bigint AS total_tokens,
          AVG(generation_attempts)::float8 AS avg_attempts,
          AVG(cost_usd)::float8 AS avg_cost_per_question
        FROM nl2sql.query_runs
        WHERE backend LIKE 'trivia%'
      `),
      // Cost trend (30 days, by day) — trivia only.
      client.query(`
        SELECT
          d.day::date AS day,
          COALESCE(c.query_count, 0)::int AS query_count,
          COALESCE(c.total_cost_usd, 0)::float8 AS total_cost_usd,
          c.avg_attempts::float8 AS avg_attempts
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
            AVG(generation_attempts)::float8 AS avg_attempts
          FROM nl2sql.query_runs
          WHERE created_at >= NOW() - INTERVAL '30 days'
            AND backend LIKE 'trivia%'
          GROUP BY 1
        ) c USING (day)
        ORDER BY d.day
      `),
      // Breakdown by category + deck + mode (backend), all-time.
      client.query(`
        SELECT
          COALESCE(trivia_category, 'unknown') AS category,
          COALESCE(trivia_deck, 'unknown') AS deck,
          COUNT(*)::int AS query_count,
          COUNT(*) FILTER (WHERE athena_state = 'SUCCEEDED')::int AS succeeded,
          COALESCE(SUM(cost_usd), 0)::float8 AS total_cost_usd,
          AVG(generation_attempts)::float8 AS avg_attempts
        FROM nl2sql.query_runs
        WHERE backend LIKE 'trivia%'
        GROUP BY 1, 2
        ORDER BY total_cost_usd DESC
      `),
      // Breakdown by mode (solo vs room).
      client.query(`
        SELECT
          backend AS mode,
          COUNT(*)::int AS query_count,
          COUNT(*) FILTER (WHERE athena_state = 'SUCCEEDED')::int AS succeeded,
          COALESCE(SUM(cost_usd), 0)::float8 AS total_cost_usd,
          AVG(generation_attempts)::float8 AS avg_attempts
        FROM nl2sql.query_runs
        WHERE backend LIKE 'trivia%'
        GROUP BY 1
        ORDER BY total_cost_usd DESC
      `),
      // Recent generations — the "what is being queried" view.
      client.query(`
        SELECT
          id::text,
          created_at::text,
          question,
          sql,
          backend,
          trivia_category,
          trivia_deck,
          generation_attempts,
          athena_state,
          error_reason,
          model,
          tokens_used,
          cost_usd::text,
          scanned_bytes::text,
          runtime_ms
        FROM nl2sql.query_runs
        WHERE backend LIKE 'trivia%'
        ORDER BY created_at DESC
        LIMIT 100
      `),
    ]);

    // node-postgres already parses JSONB (tokens_used) into a plain object; just
    // coerce the ::text-cast numeric columns so the client never touches raw SQL types.
    const normalizedRuns = recentRuns.rows.map((row) => ({
      ...row,
      cost_usd: row.cost_usd == null ? null : Number(row.cost_usd),
    }));

    return NextResponse.json({
      summary: summary.rows[0],
      costTrend: costTrend.rows,
      byCategory: byCategory.rows,
      byMode: byMode.rows,
      recentRuns: normalizedRuns,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[dashboard/trivia]", detail);
    return NextResponse.json(
      { error: "Failed to load trivia dashboard metrics", detail },
      { status: 502 }
    );
  } finally {
    client.release();
  }
}
