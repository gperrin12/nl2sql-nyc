/**
 * Pull p8k8 query pairs, classify + judge with Claude, write data/evals.json.
 *
 * Usage:
 * ANTHROPIC_API_KEY=... P8K8_URL=... P8K8_AUTH_TOKEN=... npx tsx scripts/eval-moments.ts
 *
 * Optional:
 * EVAL_LIMIT=50     (default 100)
 * EVAL_DELAY_MS=600 (default 600)
 *
 * Production (Vercel): set EVALS_S3_URI=s3://bucket/path/evals.json (same on
 * Vercel env + local when running eval). Uses AWS_REGION / AWS_* credentials.
 */

import { evalMatchKey } from "../lib/eval-match";
import { judgeQueryPair, type JudgeResult } from "../lib/judge";
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

const P8K8_URL = process.env.P8K8_URL?.replace(/\/$/, "");
const P8K8_AUTH_TOKEN = process.env.P8K8_AUTH_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const EVAL_LIMIT = Number.parseInt(process.env.EVAL_LIMIT ?? "100", 10) || 100;
const EVAL_DELAY_MS =
  Number.parseInt(process.env.EVAL_DELAY_MS ?? "600", 10) || 600;

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

async function loadExisting(): Promise<JudgeResult[]> {
  return loadEvals();
}

function mergeByPairKey(
  existing: JudgeResult[],
  added: JudgeResult[]
): JudgeResult[] {
  const map = new Map<string, JudgeResult>();
  for (const e of existing) map.set(evalMatchKey(e.question, e.sql), e);
  for (const e of added) map.set(evalMatchKey(e.question, e.sql), e);
  return Array.from(map.values());
}

function printSummary(newResults: JudgeResult[], all: JudgeResult[]): void {
  const good = newResults.filter((r) => r.verdict === "good").length;
  const acceptable = newResults.filter((r) => r.verdict === "acceptable").length;
  const poor = newResults.filter((r) => r.verdict === "poor").length;
  const n = newResults.length;
  const avg =
    n > 0
      ? newResults.reduce((s, r) => s + r.overall, 0) / n
      : 0;

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

async function main(): Promise<void> {
  requireEnv("P8K8_URL", P8K8_URL);
  requireEnv("P8K8_AUTH_TOKEN", P8K8_AUTH_TOKEN);
  requireEnv("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY);

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

  const existing = await loadExisting();
  const judgedKeys = new Set(
    existing.map((e) => evalMatchKey(e.question, e.sql))
  );

  const toJudge = pairs.filter(
    (p) => !judgedKeys.has(evalMatchKey(p.question, p.sql))
  );
  const newResults: JudgeResult[] = [];

  for (let i = 0; i < toJudge.length; i++) {
    const { question, sql } = toJudge[i];
    console.log(
      `Judging [${i + 1}/${toJudge.length}]: "${question.slice(0, 60)}${question.length > 60 ? "..." : ""}"`
    );
    const result = await judgeQueryPair(question, sql);
    newResults.push(result);
    if (i < toJudge.length - 1) await sleep(EVAL_DELAY_MS);
  }

  const merged = mergeByPairKey(existing, newResults);
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
