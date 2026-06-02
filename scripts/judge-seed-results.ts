/**
 * Judge seed-results.json with Claude (SQL + Athena outcome) and persist judge_overall on query_runs.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npm run eval:seed
 *
 * Optional:
 *   JUDGE_DELAY_MS=600     delay between judge calls (default 600)
 *   SEED_IDS=agg-001,...   filter by question bank id
 *   SEED_CATEGORY=spatial  filter by seed category
 *   SEED_STATUS=succeeded  filter by seed status (succeeded|empty|failed|timeout|start_failed)
 *   JUDGE_FORCE=true       re-judge even if question+sql already has a prior score
 *   JUDGE_DRY_RUN=true     print plan only
 */

import { readFileSync, existsSync } from "fs";
import path from "path";
import { judgeFullResult, type FullJudgeResult } from "../lib/judge";
import { judgeDetailFromResult, runJudgeDetailMigration } from "../lib/judge-detail";
import {
  findQueryRunIdByQuestionSql,
  getQueryRunJudgeOverall,
  updateQueryRunJudge,
} from "../lib/query-runs-store";
import { isDatabaseConfigured } from "../lib/db";
import type { ReplayResult } from "../lib/replay";
import { inferUiViz } from "../lib/infer-ui-viz";

type SeedResultStatus =
  | "succeeded"
  | "failed"
  | "timeout"
  | "start_failed"
  | "empty";

type SeedResult = {
  id: string;
  question: string;
  category: string;
  difficulty: string;
  tables: string[];
  expectedViz: string;
  notes?: string;
  status: SeedResultStatus;
  sql?: string;
  errorReason?: string;
  rowCount?: number;
  columnCount?: number;
  columns?: string[];
  scannedBytes?: number;
  runtimeMs?: number;
  seededAt: string;
};

const SEED_RESULTS_PATH = path.join(process.cwd(), "data", "seed-results.json");
const JUDGE_DELAY_MS =
  Number.parseInt(process.env.JUDGE_DELAY_MS ?? "600", 10) || 600;
const JUDGE_FORCE = process.env.JUDGE_FORCE === "true";
const JUDGE_DRY_RUN = process.env.JUDGE_DRY_RUN === "true";

function requireEnv(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    console.error(`Error: ${name} env var is required`);
    process.exit(1);
  }
  return value.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasSqlStatement(sql: string): boolean {
  return /\b(SELECT|WITH)\b/i.test(sql);
}

async function hasJudgeOnRow(question: string, sql: string): Promise<boolean> {
  const id = await findQueryRunIdByQuestionSql(question, sql);
  if (!id) return false;
  return (await getQueryRunJudgeOverall(id)) != null;
}

function loadSeedResults(): SeedResult[] {
  if (!existsSync(SEED_RESULTS_PATH)) {
    console.error(
      `Error: ${SEED_RESULTS_PATH} not found — run npm run seed first`
    );
    process.exit(1);
  }
  const parsed = JSON.parse(readFileSync(SEED_RESULTS_PATH, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    console.error("Error: seed-results.json must be a JSON array");
    process.exit(1);
  }
  return parsed as SeedResult[];
}

function applyFilters(rows: SeedResult[]): SeedResult[] {
  let list = rows;

  const idsRaw = process.env.SEED_IDS?.trim();
  if (idsRaw) {
    const ids = new Set(
      idsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    );
    list = list.filter((r) => ids.has(r.id));
  }

  const category = process.env.SEED_CATEGORY?.trim();
  if (category) {
    list = list.filter((r) => r.category === category);
  }

  const status = process.env.SEED_STATUS?.trim();
  if (status) {
    list = list.filter((r) => r.status === status);
  }

  return list;
}

function seedToReplay(row: SeedResult): ReplayResult | null {
  const sql = row.sql?.trim() ?? "";
  if (!sql || !hasSqlStatement(sql)) return null;

  const athenaStatus =
    row.status === "succeeded" || row.status === "empty"
      ? "SUCCEEDED"
      : row.status === "timeout"
        ? "TIMEOUT"
        : row.status === "failed"
          ? "FAILED"
          : "ERROR";

  const columns = row.columns ?? null;
  const rowCount = row.rowCount ?? null;
  const ui = columns?.length ? inferUiViz(columns, []) : null;

  return {
    question: row.question,
    sql,
    athenaStatus,
    errorReason: row.errorReason,
    rowCount,
    columns,
    sampleRows: [],
    scannedBytes: row.scannedBytes ?? null,
    runtimeMs: row.runtimeMs ?? null,
    vizType: ui?.primary ?? null,
    uiVizDescription: ui?.description ?? null,
    emptyResult: row.status === "empty",
  };
}

function printPlan(
  total: number,
  toJudge: SeedResult[],
  skipped: number,
  noSql: number
): void {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Judge seed plan: ${toJudge.length} to judge (${total} after filters)`);
  console.log(`  Skipping (already judged): ${skipped}`);
  console.log(`  Skipping (no SQL):         ${noSql}`);
  console.log(`  Delay: ${JUDGE_DELAY_MS}ms between judges`);
  if (JUDGE_FORCE) console.log("  JUDGE_FORCE=true — re-judging all matching rows");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

function printSummary(newResults: FullJudgeResult[]): void {
  const correct = newResults.filter((r) => r.verdict === "correct").length;
  const partial = newResults.filter((r) => r.verdict === "partial").length;
  const incorrect = newResults.filter((r) => r.verdict === "incorrect").length;
  const n = newResults.length;
  const avg =
    n > 0 ? newResults.reduce((s, r) => s + r.overall, 0) / n : 0;

  const byCategory = new Map<string, { count: number; sum: number }>();
  for (const r of newResults) {
    const c = r.category;
    const entry = byCategory.get(c) ?? { count: 0, sum: 0 };
    entry.count += 1;
    entry.sum += r.overall;
    byCategory.set(c, entry);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Judged: ${n} new pairs from seed-results`);
  if (n > 0) {
    console.log(`Correct:    ${correct}  (${Math.round((correct / n) * 100)}%)`);
    console.log(`Partial:    ${partial}  (${Math.round((partial / n) * 100)}%)`);
    console.log(`Incorrect:  ${incorrect}  (${Math.round((incorrect / n) * 100)}%)`);
    console.log(`Avg score:  ${avg.toFixed(1)} / 5`);
    console.log("\nBy category:");
    for (const [cat, { count, sum }] of [...byCategory.entries()].sort(
      (a, b) => a[0].localeCompare(b[0])
    )) {
      console.log(
        `  ${cat.padEnd(14)} ${String(count).padStart(2)} queries  avg ${(sum / count).toFixed(1)}`
      );
    }
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Persisted judge_overall on nl2sql.query_runs (when row exists)");
}

async function main(): Promise<void> {
  requireEnv("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);

  if (!isDatabaseConfigured()) {
    console.error("Error: NEON_DATABASE_URL is required to persist judge scores");
    process.exit(1);
  }

  try {
    await runJudgeDetailMigration();
  } catch (e) {
    console.warn(
      "judge_detail migration skipped:",
      e instanceof Error ? e.message : e
    );
  }

  const allSeed = loadSeedResults();
  const filtered = applyFilters(allSeed);

  if (filtered.length === 0) {
    console.error("No seed results match the current filters.");
    process.exit(1);
  }

  const noSql: SeedResult[] = [];
  const skipped: SeedResult[] = [];
  const toJudge: { row: SeedResult; replay: ReplayResult }[] = [];

  for (const row of filtered) {
    const replay = seedToReplay(row);
    if (!replay) {
      noSql.push(row);
      continue;
    }
    if (!JUDGE_FORCE && (await hasJudgeOnRow(row.question, replay.sql))) {
      skipped.push(row);
      continue;
    }
    toJudge.push({ row, replay });
  }

  printPlan(filtered.length, toJudge.map((t) => t.row), skipped.length, noSql.length);

  if (JUDGE_DRY_RUN) {
    console.log("\nDry run — would judge:\n");
    toJudge.forEach(({ row }, i) => {
      console.log(
        `${String(i + 1).padStart(3)}. ${row.id} (${row.category}/${row.status})`
      );
      console.log(`     "${row.question.slice(0, 70)}${row.question.length > 70 ? "..." : ""}"`);
    });
    console.log(`\nTotal: ${toJudge.length}`);
    return;
  }

  if (toJudge.length === 0) {
    console.log("\nNothing to judge.");
    return;
  }

  const newResults: FullJudgeResult[] = [];

  for (let i = 0; i < toJudge.length; i++) {
    const { row, replay } = toJudge[i];
    console.log(
      `\n[${i + 1}/${toJudge.length}] ${row.id} (${row.category}/${row.status}) — "${row.question.slice(0, 55)}${row.question.length > 55 ? "..." : ""}"`
    );
    console.log(
      `  → athena: ${replay.athenaStatus}, rows: ${replay.rowCount ?? "n/a"}${replay.emptyResult ? " (empty)" : ""}`
    );
    console.log("  → judging (SQL + result)...");

    const result = await judgeFullResult(row.question, replay.sql, replay);
    newResults.push(result);

    const runId = await findQueryRunIdByQuestionSql(row.question, replay.sql);
    if (runId) {
      await updateQueryRunJudge(
        runId,
        result.overall,
        judgeDetailFromResult(result)
      );
    } else {
      console.warn("  → no matching query_runs row — score not persisted");
    }

    console.log(
      `  → ${result.verdict} (score ${result.overall}/5)`
    );

    if (i < toJudge.length - 1) await sleep(JUDGE_DELAY_MS);
  }

  printSummary(newResults);
  console.log("Seed judging completed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
