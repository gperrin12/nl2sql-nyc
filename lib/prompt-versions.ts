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
