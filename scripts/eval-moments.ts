/**
 * Judge query pairs from nl2sql.query_runs (Postgres) or p8k8 session timeline; write data/evals.json.
 *
 * Usage (reads .env / .env.local for DATABASE_URL):
 *   npm run eval
 *   npm run eval:full
 *
 * Source (default auto = Postgres when DATABASE_URL is set, else p8k8):
 *   EVAL_SOURCE=postgres|p8k8|auto
 *   npm run eval -- --source=p8k8
 *
 * Full eval replays through the app (APP_URL) and judges SQL + Athena + UI viz.
 * SQL-only mode judges question+sql already stored in the database.
 *
 * Optional:
 *   EVAL_LIMIT=200      max rows to load from DB / p8k8
 *   EVAL_APP_VERSION=   filter by app_version (default: current deploy; use "all" for every deploy)
 *   EVAL_DELAY_MS=600
 *   REPLAY_DELAY_MS=2000
 */

import { loadEnvFile } from "../lib/load-env-file";
loadEnvFile();

import { evalMatchKey } from "../lib/eval-match";
import {
  resolveDashboardDataSource,
  p8k8Configured,
  type DashboardDataSource,
} from "../lib/dashboard-source";
import { fetchP8k8MomentBases } from "../lib/load-p8k8-moments";
import {
  judgeFullResult,
  judgeQueryPair,
  type FullJudgeResult,
} from "../lib/judge";
import { replayQuestion } from "../lib/replay";
import { evalsStorageDescription, loadEvals, saveEvals } from "../lib/evals-store";
import { loadQueryRunPairs, type QueryRunPair } from "../lib/query-runs-dashboard";
import { isDatabaseConfigured } from "../lib/db";
import { resolveQueryRunsAppVersion } from "../lib/app-version";

const FULL_EVAL = process.argv.includes("--full");
const FORCE_REPLAY = process.argv.includes("--force");
const REPLACE_EVALS = process.argv.includes("--replace");
const SOURCE_ARG = process.argv.find((a) => a.startsWith("--source="));
const CLI_SOURCE = SOURCE_ARG?.split("=")[1]?.trim().toLowerCase();
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

type EvalPair = { question: string; sql: string };

function resolveEvalSource(): DashboardDataSource {
  if (CLI_SOURCE === "postgres" || CLI_SOURCE === "db") return "postgres";
  if (CLI_SOURCE === "p8k8") return "p8k8";
  if (process.env.EVAL_SOURCE?.trim().toLowerCase() === "postgres") return "postgres";
  if (process.env.EVAL_SOURCE?.trim().toLowerCase() === "p8k8") return "p8k8";
  return resolveDashboardDataSource();
}

async function loadEvalPairs(source: DashboardDataSource): Promise<EvalPair[]> {
  const limit = EVAL_LIMIT;

  if (source === "postgres") {
    if (!isDatabaseConfigured()) {
      console.error("Error: DATABASE_URL is required for postgres eval source");
      process.exit(1);
    }
    const appVersion = resolveQueryRunsAppVersion(process.env.EVAL_APP_VERSION);
    const rows: QueryRunPair[] = await loadQueryRunPairs({ limit, appVersion });
    console.log(
      `Loaded ${rows.length} query run(s) from nl2sql.query_runs${
        appVersion ? ` (app_version=${appVersion})` : " (all deploys)"
      }`
    );
    return rows.map((r) => ({ question: r.question, sql: r.sql }));
  }

  if (!p8k8Configured()) {
    console.error("Error: P8K8_URL and P8K8_AUTH_TOKEN required for p8k8 eval source");
    process.exit(1);
  }

  const bases = await fetchP8k8MomentBases(limit);
  const pairs = bases
    .filter((p) => hasSqlStatement(p.sql))
    .map((p) => ({ question: p.question, sql: p.sql }));
  console.log(`Loaded ${pairs.length} pair(s) from p8k8 session timeline`);
  return pairs;
}

function mergeByPairKey(
  existing: FullJudgeResult[],
  added: FullJudgeResult[]
): FullJudgeResult[] {
  const map = new Map<string, FullJudgeResult>();
  for (const e of existing) map.set(evalMatchKey(e.question, e.sql), e);
  for (const e of added) map.set(evalMatchKey(e.question, e.sql), e);
  return Array.from(map.values());
}

function hasFullEval(
  existing: FullJudgeResult[],
  question: string,
  sql: string
): boolean {
  const key = evalMatchKey(question, sql);
  const entry = existing.find((e) => evalMatchKey(e.question, e.sql) === key);
  return Boolean(entry?.resultEval);
}

/** Union of questions from prior evals and p8k8 pairs (stable order: evals first, then p8k8). */
function collectQuestionCatalog(
  existing: FullJudgeResult[],
  pairs: { question: string }[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (q: string) => {
    const t = q.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const e of existing) add(e.question);
  for (const p of pairs) add(p.question);
  return out;
}

function printSummary(newResults: FullJudgeResult[], all: FullJudgeResult[]): void {
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
  console.log(`Evaluated: ${n} new pairs`);
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
  console.log(`Written to ${evalsStorageDescription()} (${all.length} total)`);
}

function printFullSummary(newResults: FullJudgeResult[]): void {
  const withResult = newResults.filter((r) => r.resultEval);
  if (withResult.length === 0) return;

  const counts = {
    SUCCEEDED: 0,
    FAILED: 0,
    TIMEOUT: 0,
    ERROR: 0,
  };
  let empty = 0;
  let sumQuality = 0;
  let sumVizFit = 0;

  for (const r of withResult) {
    const re = r.resultEval!;
    const status = re.athenaStatus as keyof typeof counts;
    if (status in counts) counts[status] += 1;
    if (re.emptyResult) empty += 1;
    sumQuality += re.resultQuality;
    sumVizFit += re.vizFit;
  }

  const n = withResult.length;
  console.log("");
  console.log("FULL EVAL RESULTS");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Athena outcomes:");
  console.log(`  SUCCEEDED:  ${counts.SUCCEEDED}`);
  console.log(`  FAILED:     ${counts.FAILED}  ← investigate these`);
  console.log(`  TIMEOUT:    ${counts.TIMEOUT}`);
  console.log(`  ERROR:      ${counts.ERROR}`);
  console.log(`  Empty (0 rows): ${empty}  ← silent failures`);
  console.log("");
  console.log(`Avg result quality: ${(sumQuality / n).toFixed(1)} / 5`);
  console.log(`Avg viz fit:        ${(sumVizFit / n).toFixed(1)} / 5`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

async function main(): Promise<void> {
  requireEnv("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY);

  const source = resolveEvalSource();
  console.log(`Eval source: ${source}`);

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
      "Full eval hits the running app (npm run dev). Athena/AWS env must be valid on that server — not only in this shell."
    );
    if (REPLACE_EVALS) {
      console.warn(
        "Replace mode: evals file will contain only this run's full evals (one row per question)."
      );
    }
    if (FORCE_REPLAY) {
      console.warn("Force mode: re-judging even when a matching full eval exists.");
    }
  }

  const pairs = (await loadEvalPairs(source)).filter((p) =>
    hasSqlStatement(p.sql)
  );

  if (pairs.length === 0) {
    console.error("No question/SQL pairs to judge. Run some queries in the app first.");
    process.exit(1);
  }

  const existing = await loadEvals();
  const newResults: FullJudgeResult[] = [];

  if (FULL_EVAL) {
    const questions = REPLACE_EVALS
      ? collectQuestionCatalog(existing, pairs)
      : (() => {
          const seen = new Set<string>();
          return pairs.filter((p) => {
            const q = p.question.trim();
            if (seen.has(q)) return false;
            seen.add(q);
            return true;
          }).map((p) => p.question.trim());
        })();

    console.log(
      `Full eval: ${questions.length} unique question(s)${REPLACE_EVALS ? ` (from evals + ${source})` : ` (from ${source})`}`
    );

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      console.log(
        `Full eval [${i + 1}/${questions.length}]: "${question.slice(0, 60)}${question.length > 60 ? "..." : ""}"`
      );

      console.log("  → replaying through app...");
      const replay = await replayQuestion(question);
      const errHint = replay.errorReason ? ` — ${replay.errorReason}` : "";
      console.log(
        `  → athena: ${replay.athenaStatus}, rows: ${replay.rowCount ?? "n/a"}${errHint}`
      );
      if (
        replay.athenaStatus === "ERROR" &&
        replay.errorReason?.includes("output bucket")
      ) {
        console.log(
          "  → hint: fix ATHENA_OUTPUT_LOCATION in .env (used by npm run dev), then restart dev"
        );
      }

      if (
        !FORCE_REPLAY &&
        !REPLACE_EVALS &&
        hasFullEval(existing, question, replay.sql)
      ) {
        console.log("  → already judged with resultEval, skipping");
        if (i < questions.length - 1) await sleep(REPLAY_DELAY_MS);
        continue;
      }

      console.log("  → judging (SQL + result)...");
      const result = await judgeFullResult(question, replay.sql, replay);
      newResults.push(result);

      if (i < questions.length - 1) await sleep(REPLAY_DELAY_MS);
    }
  } else {
    const judgedKeys = new Set(
      existing.map((e) => evalMatchKey(e.question, e.sql))
    );
    const toJudge = pairs.filter(
      (p) => !judgedKeys.has(evalMatchKey(p.question, p.sql))
    );

    for (let i = 0; i < toJudge.length; i++) {
      const { question, sql } = toJudge[i];
      console.log(
        `Judging [${i + 1}/${toJudge.length}]: "${question.slice(0, 60)}${question.length > 60 ? "..." : ""}"`
      );
      const result = await judgeQueryPair(question, sql);
      newResults.push(result);
      if (i < toJudge.length - 1) await sleep(EVAL_DELAY_MS);
    }
  }

  const merged = REPLACE_EVALS
    ? newResults
    : mergeByPairKey(existing, newResults);
  merged.sort(
    (a, b) =>
      new Date(b.judgedAt).getTime() - new Date(a.judgedAt).getTime()
  );

  await saveEvals(merged);

  if (!process.env.EVALS_S3_URI?.trim()) {
    console.warn(
      "\nNote: EVALS_S3_URI is not set — results saved to data/evals.json only.",
      "Set EVALS_S3_URI in .env and re-run, or use: npm run eval:upload"
    );
  }

  printSummary(newResults, merged);
  if (FULL_EVAL) printFullSummary(newResults);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
