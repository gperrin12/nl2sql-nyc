/**
 * lib/prompt-versions.ts
 *
 * Read-only loader for prompt variants stored in nl2sql.prompt_versions.
 * Used by the eval harness to A/B test system prompts: each variant's
 * system_prompt is injected into the tool-using agent and the variant name
 * is tagged onto the resulting nl2sql.query_runs rows (prompt_version column).
 *
 * Returns null when DATABASE_URL is unset or no matching row exists.
 */

import { getPgPool } from "@/lib/db";

export type PromptVersion = {
  versionName: string;
  systemPrompt: string;
};

export async function loadPromptVersion(
  versionName: string
): Promise<PromptVersion | null> {
  const name = versionName.trim();
  if (!name) return null;

  const pool = getPgPool();
  if (!pool) return null;

  const result = await pool.query<{
    version_name: string;
    system_prompt: string;
  }>(
    `SELECT version_name, system_prompt
     FROM nl2sql.prompt_versions
     WHERE version_name = $1
     LIMIT 1`,
    [name]
  );

  const row = result.rows[0];
  if (!row || !row.system_prompt?.trim()) return null;

  return {
    versionName: row.version_name,
    systemPrompt: row.system_prompt,
  };
}

/** Load the single prompt marked is_production = TRUE. Null when DB unset / no row. */
export async function loadProductionPromptVersion(): Promise<PromptVersion | null> {
  const pool = getPgPool();
  if (!pool) return null;

  const result = await pool.query<{
    version_name: string;
    system_prompt: string;
  }>(
    `SELECT version_name, system_prompt
     FROM nl2sql.prompt_versions
     WHERE is_production = TRUE
     ORDER BY created_at DESC
     LIMIT 1`
  );

  const row = result.rows[0];
  if (!row || !row.system_prompt?.trim()) return null;

  return {
    versionName: row.version_name,
    systemPrompt: row.system_prompt,
  };
}

const DEFAULT_PRODUCTION_TTL_MS = 60_000;

function productionTtlMs(): number {
  const raw = process.env.PROMPT_PRODUCTION_TTL_MS?.trim();
  if (!raw) return DEFAULT_PRODUCTION_TTL_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_PRODUCTION_TTL_MS;
}

type ProductionCache = { value: PromptVersion | null; expiresAt: number };

let productionCache: ProductionCache | null = null;
let productionInFlight: Promise<PromptVersion | null> | null = null;

/**
 * Cached accessor for the is_production prompt. Caches the value (including null)
 * for PROMPT_PRODUCTION_TTL_MS to avoid a DB hit on every generation request.
 * Concurrent misses share one query; on DB error, returns the last cached value
 * if present, else null (so a transient blip can't break generation).
 */
export async function getProductionPromptVersion(): Promise<PromptVersion | null> {
  const ttl = productionTtlMs();
  const now = Date.now();

  if (ttl > 0 && productionCache && productionCache.expiresAt > now) {
    return productionCache.value;
  }

  if (productionInFlight) return productionInFlight;

  productionInFlight = (async () => {
    try {
      const value = await loadProductionPromptVersion();
      if (ttl > 0) {
        productionCache = { value, expiresAt: Date.now() + ttl };
      }
      return value;
    } catch (e) {
      console.warn(
        "[prompt-versions] production prompt load failed:",
        e instanceof Error ? e.message : e
      );
      return productionCache?.value ?? null;
    } finally {
      productionInFlight = null;
    }
  })();

  return productionInFlight;
}

/** Clear the cached is_production prompt (tests / manual refresh). */
export function clearProductionPromptCache(): void {
  productionCache = null;
  productionInFlight = null;
}
