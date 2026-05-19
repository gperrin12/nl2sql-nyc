/**
 * Pull p8k8 query pairs, classify + judge with Claude, write data/evals.json.
 *
 * Usage:
 * ANTHROPIC_API_KEY=... P8K8_URL=... P8K8_AUTH_TOKEN=... npx tsx scripts/eval-moments.ts
 *
 * Full eval (replay through running app + Athena result judge):
 * APP_URL=http://localhost:3000 APP_PASSWORD=... npm run eval:full
 *
 * Re-run every known question through the app and replace evals (dashboard refresh):
 * npm run eval:refresh
 * (requires npm run dev + EVALS_S3_URI in .env)
 *
 * Optional:
 * EVAL_LIMIT=50       (default 100, p8k8 session fetch cap)
 * EVAL_DELAY_MS=600   (default 600, SQL-only judge delay)
 * REPLAY_DELAY_MS=2000 (default 2000, delay between full replays)
 *
 * Production (Vercel): set EVALS_S3_URI=s3://bucket/path/evals.json (same on
 * Vercel env + local when running eval). Uses AWS_REGION / AWS_* credentials.
 */

import { evalMatchKey } from "../lib/eval-match";
import {
  judgeFullResult,
  judgeQueryPair,
  type FullJudgeResult,
} from "../lib/judge";
import { replayQuestion } from "../lib/replay";
import {
  evalsStorageDescription,
  loadEvals,
  saveEvals,
} from "../lib/evals-store";
import {
  pairSessionMessages,
  unwrapTimelinePayload,
} from "../lib/p8k8-moments";
import { resolveP8k8ChatId } from "../lib/p8k8";

const FULL_EVAL = process.argv.includes("--full");
const FORCE_REPLAY = process.argv.includes("--force");
const REPLACE_EVALS = process.argv.includes("--replace");
const P8K8_URL = process.env.P8K8_URL?.replace(/\/$/, "");
const P8K8_AUTH_TOKEN = process.env.P8K8_AUTH_TOKEN;
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
  const good = newResults.filter((r) => r.verdict === "good").length;
  const acceptable = newResults.filter((r) => r.verdict === "acceptable").length;
  const poor = newResults.filter((r) => r.verdict === "poor").length;
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
    console.log(`Good:       ${good}  (${Math.round((good / n) * 100)}%)`);
    console.log(
      `Acceptable: ${acceptable}  (${Math.round((acceptable / n) * 100)}%)`
    );
    console.log(`Poor:       ${poor}  (${Math.round((poor / n) * 100)}%)`);
    console.log(`Avg score:  ${avg.toFixed(1)} / 10`);
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
  console.log(`Avg result quality: ${(sumQuality / n).toFixed(1)} / 10`);
  console.log(`Avg viz fit:        ${(sumVizFit / n).toFixed(1)} / 10`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

async function main(): Promise<void> {
  requireEnv("P8K8_URL", P8K8_URL);
  requireEnv("P8K8_AUTH_TOKEN", P8K8_AUTH_TOKEN);
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

  const sessionId = resolveP8k8ChatId();
  const url = `${P8K8_URL}/moments/session/${encodeURIComponent(sessionId)}?limit=${EVAL_LIMIT}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${P8K8_AUTH_TOKEN}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`p8k8 fetch failed: HTTP ${res.status}\n${body}`);
    process.exit(1);
  }

  const data = (await res.json()) as unknown;
  const events = unwrapTimelinePayload(data);
  const pairs = pairSessionMessages(events).filter((p) =>
    hasSqlStatement(p.sql)
  );

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
      `Full eval: ${questions.length} unique question(s)${REPLACE_EVALS ? " (from evals + p8k8)" : " (from p8k8)"}`
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
