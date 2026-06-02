/**
 * Build and parse nl2sql.query_runs.judge_detail (JSONB).
 */

import type { JudgeResult } from "@/lib/judge";
import type { JudgeDetail } from "@/lib/judge-detail-types";

export type { JudgeDetail, JudgeDetailVerdict } from "@/lib/judge-detail-types";

const JUDGE_MODEL = "claude-haiku-4-5";

export function judgeDetailFromResult(
  result: Pick<JudgeResult, "overall" | "verdict" | "issues" | "judgedAt">
): JudgeDetail {
  const reasoning =
    result.issues
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ") || "";
  return {
    overall: result.overall,
    verdict: result.verdict,
    reasoning,
    judgedAt: result.judgedAt,
    judgeModel: JUDGE_MODEL,
  };
}

export function parseJudgeDetail(raw: unknown): JudgeDetail | null {
  if (raw == null) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const overall = Number(o.overall);
  const verdict = o.verdict;
  const reasoning = typeof o.reasoning === "string" ? o.reasoning.trim() : "";
  const judgedAt = typeof o.judgedAt === "string" ? o.judgedAt : "";
  if (
    !Number.isFinite(overall) ||
    (verdict !== "correct" && verdict !== "partial" && verdict !== "incorrect")
  ) {
    return null;
  }
  return {
    overall,
    verdict,
    reasoning,
    judgedAt,
    judgeModel:
      typeof o.judgeModel === "string" ? o.judgeModel : undefined,
  };
}

export async function runJudgeDetailMigration(): Promise<void> {
  const { getPgPool, isDatabaseConfigured } = await import("@/lib/db");
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is required for judge_detail migration");
  }
  const pool = getPgPool();
  if (!pool) throw new Error("DATABASE_URL is required for judge_detail migration");
  await pool.query(`
    ALTER TABLE nl2sql.query_runs
      ADD COLUMN IF NOT EXISTS judge_detail JSONB
  `);
}
