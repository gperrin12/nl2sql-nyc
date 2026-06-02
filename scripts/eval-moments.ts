/**
 * Judge query pairs from nl2sql.query_runs and persist judge_overall on each row.
 *
 * Usage (reads .env / .env.local for DATABASE_URL):
 *   npm run eval
 *   npm run eval:full
 *
 * Full eval replays through the app (APP_URL) and judges SQL + Athena + UI viz.
 * SQL-only mode judges question+sql already stored in the database.
 *
 * Optional:
 *   EVAL_LIMIT=200      max rows to load from DB
 *   EVAL_APP_VERSION=   filter by app_version (default: current deploy; use "all" for every deploy)
 *   EVAL_DELAY_MS=600
 *   REPLAY_DELAY_MS=2000
 *   --force            re-judge even when judge_overall is already set
 */

import { loadEnvFile } from "../lib/load-env-file";
loadEnvFile();

import { judgeDetailFromResult, runJudgeDetailMigration } from "../lib/judge-detail";
import {
  findLatestQueryRunIdByQuestion,
  findQueryRunIdByQuestionSql,
  updateQueryRunJudge,
} from "../lib/query-runs-store";
import {
  judgeFullResult,
  judgeQueryPair,
  type FullJudgeResult,
} from "../lib/judge";
import { replayQuestion } from "../lib/replay";
import { loadQueryRunPairs, type QueryRunPair } from "../lib/query-runs-dashboard";
import { isDatabaseConfigured } from "../lib/db";
import { resolveQueryRunsAppVersion } from "../lib/app-version";

const FULL_EVAL = process.argv.includes("--full");
const FORCE_REPLAY = process.argv.includes("--force");
const REPLACE_EVALS = process.argv.includes("--replace");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const APP_URL = process.env.APP_URL?.replace(/\/$/, "");
const EVAL_LIMIT = Number.parseInt(process.env.EVAL_LIMIT ?? "100", 10) || 100;
const EVAL_DELAY_MS =
  Number.parseInt(process.env.EVAL_DELAY_MS ?? "600", 10) || 600;
const REPLAY_DELAY_MS =
  Number.parseInt(process.env.REPLAY_DELAY_MS ?? "2000", 10) || 2000;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`Error: ${name} env var is required`);
    process.exit(1);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasSqlStatement(sql: string): boolean {
  return /\b(SELECT|WITH)\b/i.test(sql);
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

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Evaluated: ${n} pair(s) → judge_overall on nl2sql.query_runs`);
  if (n > 0) {
    console.log(`Correct:    ${correct}  (${Math.round((correct / n) * 100)}%)`);
    console.log(`Partial:    ${partial}  (${Math.round((partial / n) * 100)}%)`);
    console.log(`Incorrect:  ${incorrect}  (${Math.round((incorrect / n) * 100)}%)`);
    console.log(`Avg score:  ${avg.toFixed(1)} / 5`);
    console.log("");
    console.log("By category:");
    for (const [cat, { count, sum }] of [...byCategory.entries()].sort(
      (a, b) => a[0].localeCompare(b[0])
    )) {
      const catAvg = (sum / count).toFixed(1);
      console.log(
        `  ${cat.padEnd(14)} ${String(count).padStart(2)} queries  avg ${catAvg}`
      );
    }
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

async function persistJudge(
  result: FullJudgeResult,
  rowId?: string
): Promise<void> {
  const id =
    rowId ??
    (await findQueryRunIdByQuestionSql(result.question, result.sql)) ??
    (await findLatestQueryRunIdByQuestion(result.question));
  if (!id) {
    console.warn("  → no query_runs row to persist judge");
    return;
  }
  const ok = await updateQueryRunJudge(
    id,
    result.overall,
    judgeDetailFromResult(result)
  );
  if (!ok) console.warn(`  → failed to update judge on row ${id}`);
  if (result.issues[0]) {
    console.log(`  → reasoning: ${result.issues[0]}`);
  }
}

async function loadEvalPairs(): Promise<QueryRunPair[]> {
  if (!isDatabaseConfigured()) {
    console.error("Error: DATABASE_URL is required");
    process.exit(1);
  }
  const appVersion = resolveQueryRunsAppVersion(process.env.EVAL_APP_VERSION);
  const rows = await loadQueryRunPairs({ limit: EVAL_LIMIT, appVersion });
  console.log(
    `Loaded ${rows.length} query run(s) from nl2sql.query_runs${
      appVersion ? ` (app_version=${appVersion})` : " (all deploys)"
    }`
  );
  return rows.filter((r) => hasSqlStatement(r.sql));
}

async function main(): Promise<void> {
  requireEnv("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY);

  if (FULL_EVAL) {
    if (!APP_URL && !process.env.APP_URL) {
      console.warn(
        "Note: APP_URL not set — defaulting to http://localhost:3000"
      );
    }
    if (!process.env.APP_PASSWORD?.trim()) {
      console.warn(
        "Note: APP_PASSWORD not set — login skipped (only works if app has no auth)"
      );
    }
    console.warn(
      "Full eval hits the running app (npm run dev). Athena/AWS env must be valid on that server."
    );
  }

  try {
    await runJudgeDetailMigration();
  } catch (e) {
    console.warn(
      "judge_detail migration skipped:",
      e instanceof Error ? e.message : e
    );
  }

  const pairs = await loadEvalPairs();

  if (pairs.length === 0) {
    console.error("No question/SQL pairs to judge. Run some queries in the app first.");
    process.exit(1);
  }

  const newResults: FullJudgeResult[] = [];

  if (FULL_EVAL) {
    const seen = new Set<string>();
    const questions = pairs
      .map((p) => p.question.trim())
      .filter((q) => {
        if (seen.has(q)) return false;
        seen.add(q);
        return true;
      });

    console.log(`Full eval: ${questions.length} unique question(s)`);

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      const pair = pairs.find((p) => p.question.trim() === question);
      console.log(
        `Full eval [${i + 1}/${questions.length}]: "${question.slice(0, 60)}${question.length > 60 ? "..." : ""}"`
      );

      if (
        !FORCE_REPLAY &&
        !REPLACE_EVALS &&
        pair?.judgeOverall != null
      ) {
        console.log("  → judge_overall already set, skipping");
        if (i < questions.length - 1) await sleep(REPLAY_DELAY_MS);
        continue;
      }

      console.log("  → replaying through app...");
      const replay = await replayQuestion(question);
      const errHint = replay.errorReason ? ` — ${replay.errorReason}` : "";
      console.log(
        `  → athena: ${replay.athenaStatus}, rows: ${replay.rowCount ?? "n/a"}${errHint}`
      );

      console.log("  → judging (SQL + result)...");
      const result = await judgeFullResult(question, replay.sql, replay);
      newResults.push(result);
      await persistJudge(result, pair?.id);

      if (i < questions.length - 1) await sleep(REPLAY_DELAY_MS);
    }
  } else {
    const toJudge = FORCE_REPLAY
      ? pairs
      : pairs.filter((p) => p.judgeOverall == null);

    for (let i = 0; i < toJudge.length; i++) {
      const { id, question, sql } = toJudge[i];
      console.log(
        `Judging [${i + 1}/${toJudge.length}]: "${question.slice(0, 60)}${question.length > 60 ? "..." : ""}"`
      );
      const result = await judgeQueryPair(question, sql);
      newResults.push(result);
      await persistJudge(result, id);
      if (i < toJudge.length - 1) await sleep(EVAL_DELAY_MS);
    }
  }

  printSummary(newResults);
  if (FULL_EVAL) console.log("Full eval mode: single-score judging completed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
