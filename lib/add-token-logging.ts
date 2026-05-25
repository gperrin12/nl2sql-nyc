/**
 * Token accumulation, Anthropic cost estimates, and nl2sql.query_runs persistence.
 * Wire into lib/sql-agent/run.ts and lib/claude.ts via createAccumulator / addUsage.
 *
 * CLI: npm run token:report  (or npx tsx scripts/token-report.ts)
 */

import { getPgPool, isDatabaseConfigured } from "@/lib/db";
import { getQueryRunIdByExecutionId } from "@/lib/query-runs-store";

export type TokenAccumulator = {
  input_tokens: number;
  output_tokens: number;
  model_call_count: number;
};

export type TokenSummary = {
  input: number;
  output: number;
  total: number;
};

export type CostProjection = {
  avg_cost_per_query_usd: number;
  queries_per_day: number;
  daily_cost_usd: number;
  monthly_cost_usd: number;
  annual_cost_usd: number;
};

/** USD per 1M tokens — verify at https://anthropic.com/pricing */
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
};

export function createAccumulator(): TokenAccumulator {
  return { input_tokens: 0, output_tokens: 0, model_call_count: 0 };
}

/** Sum usage from every messages.create() in an agent loop, not only the final turn. */
export function addUsage(
  acc: TokenAccumulator,
  usage: { input_tokens: number; output_tokens: number }
): void {
  acc.input_tokens += usage.input_tokens;
  acc.output_tokens += usage.output_tokens;
  acc.model_call_count++;
}

export function computeCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: string = "claude-sonnet-4-6"
): number {
  const prices = PRICING[model] ?? PRICING["claude-sonnet-4-6"];
  return (
    (inputTokens / 1_000_000) * prices.input +
    (outputTokens / 1_000_000) * prices.output
  );
}

export function buildTokenSummary(acc: TokenAccumulator): TokenSummary {
  return {
    input: acc.input_tokens,
    output: acc.output_tokens,
    total: acc.input_tokens + acc.output_tokens,
  };
}

export async function runTokenColumnsMigration(): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error("DATABASE_URL is required for token column migration");
  }
  await pool.query(`
    ALTER TABLE nl2sql.query_runs
      ADD COLUMN IF NOT EXISTS tokens_used JSONB,
      ADD COLUMN IF NOT EXISTS cost_usd FLOAT
  `);
}

export async function writeTokensToQueryRun(
  queryRunId: string | number,
  tokenSummary: TokenSummary,
  costUsd: number
): Promise<void> {
  if (!isDatabaseConfigured()) return;

  const pool = getPgPool();
  if (!pool) return;

  await pool.query(
    `UPDATE nl2sql.query_runs
     SET tokens_used = $1::jsonb, cost_usd = $2
     WHERE id = $3`,
    [JSON.stringify(tokenSummary), costUsd, queryRunId]
  );
}

export async function writeTokensToQueryRunByExecutionId(
  executionId: string,
  tokenSummary: TokenSummary,
  costUsd: number
): Promise<void> {
  const id = await getQueryRunIdByExecutionId(executionId);
  if (!id) return;
  await writeTokensToQueryRun(id, tokenSummary, costUsd);
}

export function projectCost(
  avgCostPerQuery: number,
  queriesPerDay: number
): CostProjection {
  const dailyCostUsd = avgCostPerQuery * queriesPerDay;
  return {
    avg_cost_per_query_usd: avgCostPerQuery,
    queries_per_day: queriesPerDay,
    daily_cost_usd: dailyCostUsd,
    monthly_cost_usd: dailyCostUsd * 30,
    annual_cost_usd: dailyCostUsd * 365,
  };
}

export async function printLatestQueryRunTokens(): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    console.log("DATABASE_URL not set — cannot load query runs.");
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
  console.log(`question:   ${row.question.slice(0, 120)}${row.question.length > 120 ? "…" : ""}`);

  if (row.tokens_used != null && row.cost_usd != null) {
    const t =
      typeof row.tokens_used === "string"
        ? (JSON.parse(row.tokens_used) as TokenSummary)
        : row.tokens_used;
    console.log(`tokens:     input=${t.input} output=${t.output} total=${t.total}`);
    console.log(`cost_usd:   $${Number(row.cost_usd).toFixed(6)}`);
  } else {
    console.log(
      "tokens:     (not logged — run a new agent query after token integration, or backend was p8k8)"
    );
    console.log("cost_usd:   (null)");
  }
}

export async function printCostReport(): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    console.log("DATABASE_URL not set — skipping cost report.");
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
  console.log(`Avg input tokens:  ${Math.round(parseFloat(row.avg_input_tokens))}`);
  console.log(`Avg output tokens: ${Math.round(parseFloat(row.avg_output_tokens))}`);
  console.log(`Avg total tokens:  ${Math.round(parseFloat(row.avg_total_tokens))}`);
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

export async function runTokenReportCli(argv: string[] = process.argv): Promise<void> {
  const migrate = argv.includes("--migrate");
  if (migrate) {
    await runTokenColumnsMigration();
    console.log("Migration complete: tokens_used, cost_usd on nl2sql.query_runs.");
  }
  await printLatestQueryRunTokens();
  await printCostReport();
}
