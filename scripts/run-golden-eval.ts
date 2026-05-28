/**
 * Golden dataset eval: agent-only SQL generation, Athena execution, LLM judge,
 * log to nl2sql.query_runs with a golden app_version tag and judge_overall.
 *
 * Usage (reads .env / .env.local):
 *   npm run eval:golden
 *   npm run eval:golden -- --version v3.1
 *   GOLDEN_APP_VERSION=v3.1 npm run eval:golden
 *   npm run eval:golden:dry
 *
 * Flags:
 *   --version   — app_version tag (default: lib/golden-eval-version.ts, currently v3.1)
 *   --dry-run   — print plan only
 *   --no-judge  — run agent + Athena + DB only
 *   --force     — re-judge even when eval exists for same question+sql
 *   --replace   — evals file contains only this run's results (not merged)
 *
 * Env:
 *   GOLDEN_APP_VERSION  — same as --version (CLI wins if both set)
 *   DATABASE_URL, ANTHROPIC_API_KEY, ATHENA_OUTPUT_LOCATION
 *   SEED_IDS, SEED_CATEGORY, SEED_DIFFICULTY, RUN_LIMIT, RUN_DELAY_MS
 */

import { loadEnvFile } from "../lib/load-env-file";
loadEnvFile();

import { startQuery, getStatus, getResults } from "../lib/athena";
import type { SqlGenerationResult } from "../lib/claude";
import { ensureGuardedSql } from "../lib/ensure-guarded-sql";
import { isDatabaseConfigured } from "../lib/db";
import { evalMatchKey } from "../lib/eval-match";
import {
  evalsStorageDescription,
  loadEvals,
  saveEvals,
} from "../lib/evals-store";
import { detectWarehouseHallucinations } from "../lib/hallucination-schema";
import { inferUiViz } from "../lib/infer-ui-viz";
import {
  loadGoldenDataset,
  type GoldenDatasetEntry,
} from "../lib/golden-dataset";
import { judgeFullResult, type FullJudgeResult } from "../lib/judge";
import { applyQuestionFilters } from "../lib/questions-bank";
import {
  recordQueryRunFinalize,
  recordQueryRunJudge,
  recordQueryRunStart,
} from "../lib/record-query-run";
import type { ReplayResult } from "../lib/replay";
import { generateSqlWithAgent } from "../lib/sql-agent/run";
import { resolveGoldenAppVersion } from "../lib/golden-eval-version";
import {
  getQueryRunIdByExecutionId,
  upsertQueryRun,
} from "../lib/query-runs-store";

const GOLDEN_APP_VERSION = resolveGoldenAppVersion();

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE_JUDGE = process.argv.includes("--force");
const REPLACE_EVALS = process.argv.includes("--replace");
const NO_JUDGE = process.argv.includes("--no-judge");

const RUN_DELAY_MS =
  Number.parseInt(process.env.RUN_DELAY_MS ?? "4000", 10) || 4000;
const JUDGE_DELAY_MS =
  Number.parseInt(process.env.JUDGE_DELAY_MS ?? "600", 10) || 600;
const POLL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

const BACKEND = "agent";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    console.error(`Error: ${name} is required`);
    process.exit(1);
  }
  return value.trim();
}

type AthenaPoll = {
  state: string;
  reason?: string;
  scannedBytes?: number;
  runtimeMs?: number;
  columns?: string[];
  rows?: Record<string, string | null>[];
};

async function pollAthenaLocal(executionId: string): Promise<AthenaPoll> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const status = await getStatus(executionId);
    const state = status.state;

    if (state === "SUCCEEDED") {
      try {
        const results = await getResults(executionId);
        return {
          state,
          scannedBytes: results.scannedBytes,
          runtimeMs: results.executionTimeMs,
          columns: results.columns,
          rows: results.rows,
        };
      } catch (e) {
        return {
          state: "FAILED",
          reason: e instanceof Error ? e.message : String(e),
          scannedBytes: status.scannedBytes,
          runtimeMs: status.runtimeMs,
        };
      }
    }

    if (state === "FAILED" || state === "CANCELLED") {
      return {
        state,
        reason: status.reason ?? state,
        scannedBytes: status.scannedBytes,
        runtimeMs: status.runtimeMs,
      };
    }
  }

  return { state: "TIMEOUT", reason: `Exceeded ${POLL_TIMEOUT_MS / 1000}s` };
}

function toReplayResult(
  question: string,
  sql: string,
  poll: AthenaPoll
): ReplayResult {
  if (poll.state === "SUCCEEDED" && poll.columns && poll.rows) {
    const columns = poll.columns;
    const rows = poll.rows;
    const sampleRows = rows.slice(0, 5);
    const rowCount = rows.length;
    const ui = inferUiViz(columns, rows);
    return {
      question,
      sql,
      athenaStatus: "SUCCEEDED",
      rowCount,
      columns,
      sampleRows,
      scannedBytes: poll.scannedBytes ?? null,
      runtimeMs: poll.runtimeMs ?? null,
      vizType: ui?.primary ?? null,
      uiVizDescription: ui?.description ?? null,
      emptyResult: rowCount === 0,
    };
  }

  if (poll.state === "FAILED" || poll.state === "CANCELLED") {
    return {
      question,
      sql,
      athenaStatus: "FAILED",
      errorReason: poll.reason ?? poll.state,
      rowCount: null,
      columns: null,
      sampleRows: null,
      scannedBytes: poll.scannedBytes ?? null,
      runtimeMs: poll.runtimeMs ?? null,
      vizType: null,
      uiVizDescription: null,
      emptyResult: false,
    };
  }

  return {
    question,
    sql,
    athenaStatus: "TIMEOUT",
    errorReason: poll.reason ?? "TIMEOUT",
    rowCount: null,
    columns: null,
    sampleRows: null,
    scannedBytes: poll.scannedBytes ?? null,
    runtimeMs: poll.runtimeMs ?? null,
    vizType: null,
    uiVizDescription: null,
    emptyResult: false,
  };
}

function schemaHallucinationPatch(sql: string): {
  hallucinationType: "schema_hallucination" | null;
  hallucinations: ReturnType<typeof detectWarehouseHallucinations>;
} {
  const hallucinations = detectWarehouseHallucinations(sql);
  return {
    hallucinationType: hallucinations.hasHallucination
      ? "schema_hallucination"
      : null,
    hallucinations,
  };
}

type RunOutcome = {
  question: string;
  sql: string;
  model: string;
  replay: ReplayResult;
  queryRunId: string | null;
};

async function runGoldenQuestion(
  q: GoldenDatasetEntry
): Promise<RunOutcome | null> {
  const question = q.question.trim();
  console.log("  → generating (agent)…");

  let generation: SqlGenerationResult;
  try {
    generation = await generateSqlWithAgent(question);
  } catch (e) {
    console.log(`  ✗ generation failed — ${e instanceof Error ? e.message : e}`);
    return null;
  }

  console.log(`  → model: ${generation.model}, backend: ${BACKEND}`);

  const guarded = await ensureGuardedSql(question, generation);
  if (!guarded.ok) {
    const h = schemaHallucinationPatch(guarded.sql);
    console.log(`  ✗ guardrails — ${guarded.reason}`);
    const queryRunId = await upsertQueryRun({
      question,
      sql: guarded.sql,
      model: generation.model,
      backend: BACKEND,
      athenaState: "FAILED",
      errorReason: guarded.reason,
      appVersion: GOLDEN_APP_VERSION,
      ...h,
    });
    return {
      question,
      sql: guarded.sql,
      model: generation.model,
      queryRunId,
      replay: {
        question,
        sql: guarded.sql,
        athenaStatus: "FAILED",
        errorReason: guarded.reason,
        rowCount: null,
        columns: null,
        sampleRows: null,
        scannedBytes: null,
        runtimeMs: null,
        vizType: null,
        uiVizDescription: null,
        emptyResult: false,
      },
    };
  }

  generation = guarded.generation;
  const sql = guarded.sql;
  const h = schemaHallucinationPatch(sql);

  let executionId: string;
  try {
    executionId = await startQuery(sql);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ✗ athena start — ${msg}`);
    const queryRunId = await upsertQueryRun({
      question,
      sql,
      model: generation.model,
      backend: BACKEND,
      athenaState: "FAILED",
      errorReason: msg,
      appVersion: GOLDEN_APP_VERSION,
      ...h,
    });
    return {
      question,
      sql,
      model: generation.model,
      queryRunId,
      replay: {
        question,
        sql,
        athenaStatus: "ERROR",
        errorReason: msg,
        rowCount: null,
        columns: null,
        sampleRows: null,
        scannedBytes: null,
        runtimeMs: null,
        vizType: null,
        uiVizDescription: null,
        emptyResult: false,
      },
    };
  }

  await recordQueryRunStart({
    question,
    sql,
    model: generation.model,
    backend: BACKEND,
    executionId,
    appVersion: GOLDEN_APP_VERSION,
    ...h,
  });

  let queryRunId = await getQueryRunIdByExecutionId(executionId);

  console.log("  → polling athena…");
  const poll = await pollAthenaLocal(executionId);
  const rowCount =
    poll.state === "SUCCEEDED" && poll.rows ? poll.rows.length : null;

  await recordQueryRunFinalize(executionId, {
    athenaState: poll.state,
    question,
    sql,
    model: generation.model,
    backend: BACKEND,
    errorReason: poll.reason ?? null,
    scannedBytes: poll.scannedBytes ?? null,
    runtimeMs: poll.runtimeMs ?? null,
    rowCount,
  });

  queryRunId =
    queryRunId ?? (await getQueryRunIdByExecutionId(executionId));

  const replay = toReplayResult(question, sql, poll);
  console.log(
    `  → athena: ${replay.athenaStatus}, rows: ${replay.rowCount ?? "n/a"}${replay.emptyResult ? " (empty)" : ""}`
  );

  return {
    question,
    sql,
    model: generation.model,
    queryRunId,
    replay,
  };
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

function printPlan(questions: GoldenDatasetEntry[]): void {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Golden eval plan: ${questions.length} question(s)`);
  console.log(`  Source:   data/golden-dataset.json`);
  console.log(`  Backend:  agent (generateSqlWithAgent)`);
  console.log(`  Version:  ${GOLDEN_APP_VERSION} (nl2sql.query_runs.app_version)`);
  console.log(`  DB log:   ${isDatabaseConfigured() ? "yes" : "no (DATABASE_URL unset)"}`);
  console.log(`  Judge:    ${NO_JUDGE ? "skipped" : "full (SQL + Athena result)"}`);
  console.log(`  Delay:    ${RUN_DELAY_MS}ms between questions`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

function printSummary(newResults: FullJudgeResult[], all: FullJudgeResult[]): void {
  const n = newResults.length;
  const avg =
    n > 0 ? newResults.reduce((s, r) => s + r.overall, 0) / n : 0;
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Judged: ${n} pair(s), avg ${avg.toFixed(1)}/5`);
  if (!NO_JUDGE) {
    console.log(`Written to ${evalsStorageDescription()} (${all.length} total)`);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

async function main(): Promise<void> {
  requireEnv("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);

  if (!process.env.ATHENA_OUTPUT_LOCATION?.trim()) {
    console.error("Error: ATHENA_OUTPUT_LOCATION is required");
    process.exit(1);
  }

  if (!isDatabaseConfigured()) {
    console.warn(
      "Warning: DATABASE_URL unset — runs will not be logged to query_runs."
    );
  }

  let questions = applyQuestionFilters(loadGoldenDataset());
  const limit = Number.parseInt(process.env.RUN_LIMIT ?? "", 10);
  if (Number.isFinite(limit) && limit > 0) {
    questions = questions.slice(0, limit);
  }

  if (questions.length === 0) {
    console.error("No golden questions match filters.");
    process.exit(1);
  }

  printPlan(questions);

  if (DRY_RUN) {
    questions.forEach((q, i) => {
      console.log(
        `  ${i + 1}. ${q.id} [${q.category}/${q.difficulty}] ${q.question.slice(0, 70)}${q.question.length > 70 ? "…" : ""}`
      );
    });
    return;
  }

  const existing = NO_JUDGE ? [] : await loadEvals();
  const judgedKeys = new Set(
    existing.map((e) => evalMatchKey(e.question, e.sql))
  );
  const newResults: FullJudgeResult[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(
      `\n[${i + 1}/${questions.length}] ${q.id} — "${q.question.slice(0, 60)}${q.question.length > 60 ? "..." : ""}"`
    );

    const outcome = await runGoldenQuestion(q);

    if (!outcome?.sql?.trim()) {
      if (i < questions.length - 1) await sleep(RUN_DELAY_MS);
      continue;
    }

    if (NO_JUDGE) {
      if (i < questions.length - 1) await sleep(RUN_DELAY_MS);
      continue;
    }

    const key = evalMatchKey(outcome.question, outcome.sql);
    if (!FORCE_JUDGE && judgedKeys.has(key)) {
      console.log("  → eval exists for this question+sql, skipping judge");
      if (i < questions.length - 1) await sleep(JUDGE_DELAY_MS);
      continue;
    }

    console.log("  → judging (SQL + result)…");
    const result = await judgeFullResult(
      outcome.question,
      outcome.sql,
      outcome.replay
    );

    await recordQueryRunJudge(outcome.queryRunId, result.overall);
    console.log(`  → judge: ${result.overall}/5 (${result.verdict})`);

    newResults.push(result);
    judgedKeys.add(key);

    if (i < questions.length - 1) {
      await sleep(RUN_DELAY_MS);
    }
  }

  if (NO_JUDGE) {
    console.log("\nDone (no judge).");
    return;
  }

  const merged = REPLACE_EVALS
    ? newResults
    : mergeByPairKey(existing, newResults);
  merged.sort(
    (a, b) =>
      new Date(b.judgedAt).getTime() - new Date(a.judgedAt).getTime()
  );

  await saveEvals(merged);
  printSummary(newResults, merged);

  if (!process.env.EVALS_S3_URI?.trim()) {
    console.warn(
      "\nNote: EVALS_S3_URI is not set — evals saved locally only."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
