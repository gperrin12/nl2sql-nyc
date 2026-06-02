/**
 * Token usage report for nl2sql.query_runs.
 *
 * Usage (loads .env / .env.local):
 *   npm run token:report
 *   npm run token:report -- --migrate
 */

import { loadEnvFile } from "../lib/load-env-file";

loadEnvFile();

import { getPgPool } from "../lib/db";
import {
  projectCost,
  runTokenColumnsMigration,
  type TokenSummary,
} from "../lib/query-run-tokens";

async function printLatestQueryRunTokens(): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    console.log("NEON_DATABASE_URL not set — cannot load query runs.");
    return;
  }

  const latest = await pool.query<{
    id: string;
    created_at: string;
    question: string;
    model: string | null;
    backend: string | null;
    tokens_used: TokenSummary | null;
    cost_usd: number | null;
    execution_id: string | null;
  }>(`
    SELECT
      id::text,
      created_at,
      question,
      model,
      backend,
      tokens_used,
      cost_usd,
      execution_id
    FROM nl2sql.query_runs
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const row = latest.rows[0];
  if (!row) {
    console.log("No rows in nl2sql.query_runs.");
    return;
  }

  console.log("\n=== Most recent query run ===");
  console.log(`id:         ${row.id}`);
  console.log(`created_at: ${row.created_at}`);
  console.log(`model:      ${row.model ?? "(null)"}`);
  console.log(`backend:    ${row.backend ?? "(null)"}`);
  console.log(`execution:  ${row.execution_id ?? "(null)"}`);
  console.log(
    `question:   ${row.question.slice(0, 120)}${row.question.length > 120 ? "…" : ""}`
  );

  if (row.tokens_used != null && row.cost_usd != null) {
    const t =
      typeof row.tokens_used === "string"
        ? (JSON.parse(row.tokens_used) as TokenSummary)
        : row.tokens_used;
    console.log(
      `tokens:     input=${t.input} output=${t.output} total=${t.total}`
    );
    console.log(`cost_usd:   $${Number(row.cost_usd).toFixed(6)}`);
  } else {
    console.log("tokens:     (not logged on this row)");
    console.log("cost_usd:   (null)");
  }
}

async function printCostReport(): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    console.log("NEON_DATABASE_URL not set — skipping cost report.");
    return;
  }

  const result = await pool.query<{
    query_count: string;
    avg_cost: string;
    total_cost: string;
    avg_total_tokens: string;
    avg_input_tokens: string;
    avg_output_tokens: string;
  }>(`
    SELECT
      COUNT(*) AS query_count,
      AVG(cost_usd) AS avg_cost,
      SUM(cost_usd) AS total_cost,
      AVG((tokens_used->>'total')::int) AS avg_total_tokens,
      AVG((tokens_used->>'input')::int) AS avg_input_tokens,
      AVG((tokens_used->>'output')::int) AS avg_output_tokens
    FROM nl2sql.query_runs
    WHERE cost_usd IS NOT NULL
  `);

  const row = result.rows[0];
  if (parseInt(row.query_count, 10) === 0) {
    console.log("No query runs with token data yet.");
    return;
  }

  const avgCostPerQuery = parseFloat(row.avg_cost);

  console.log("\n=== nl2sql-nyc Cost Report ===");
  console.log(`Queries measured: ${row.query_count}`);
  console.log(
    `Avg input tokens:  ${Math.round(parseFloat(row.avg_input_tokens))}`
  );
  console.log(
    `Avg output tokens: ${Math.round(parseFloat(row.avg_output_tokens))}`
  );
  console.log(
    `Avg total tokens:  ${Math.round(parseFloat(row.avg_total_tokens))}`
  );
  console.log(`Avg cost per query: $${avgCostPerQuery.toFixed(6)}`);
  console.log(`Total cost logged: $${parseFloat(row.total_cost).toFixed(4)}`);

  console.log("\n=== Cost Projections ===");
  for (const { label, qpd } of [
    { label: "100 queries/day", qpd: 100 },
    { label: "1,000 queries/day", qpd: 1_000 },
    { label: "10,000 queries/day", qpd: 10_000 },
  ]) {
    const p = projectCost(avgCostPerQuery, qpd);
    console.log(
      `  ${label} → $${p.daily_cost_usd.toFixed(2)}/day, ` +
        `$${p.monthly_cost_usd.toFixed(2)}/month, ` +
        `$${p.annual_cost_usd.toFixed(2)}/year`
    );
  }
  console.log("");
}

async function main(): Promise<void> {
  if (process.argv.includes("--migrate")) {
    await runTokenColumnsMigration();
    console.log("Migration complete: tokens_used, cost_usd on nl2sql.query_runs.");
  }
  await printLatestQueryRunTokens();
  await printCostReport();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
