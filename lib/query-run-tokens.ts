/**
 * LLM token accumulation, cost estimates, and persistence on nl2sql.query_runs.
 * Used by sql-agent, claude repair paths, and record-query-run.
 *
 * Ops CLI: npm run token:report  (scripts/token-report.ts)
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

export async function runTokenColumnsMigration(): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error("NEON_DATABASE_URL is required for token column migration");
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
