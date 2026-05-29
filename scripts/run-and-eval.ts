/**
 * Run questions from data/questions.json: generate SQL (local backends), log to Postgres,
 * judge, and write data/evals.json (+ S3 when EVALS_S3_URI is set).
 *
 * Usage (reads .env / .env.local):
 *   npm run run:eval
 *   npm run run:eval:full
 *   npm run run:eval:dry
 *
 * Modes:
 *   default     — direct: pickBackend() + Athena in this process (uses your .env)
 *   --remote    — HTTP via APP_URL (uses that deployment's USE_P8K8 / CLAUDE_SQL_AGENT)
 *
 * Flags:
 *   --full      — judge SQL + Athena result + viz (like eval:full)
 *   --dry-run   — print plan only
 *   --force     — re-judge even when eval exists for same question+sql
 *   --replace   — evals file contains only this run's results (not merged)
 *   --no-judge  — run queries + log only
 *
 * Env (same filters as seed):
 *   SEED_IDS, SEED_CATEGORY, SEED_DIFFICULTY, RUN_LIMIT
 *   RUN_DELAY_MS=4000
 *   RUN_QUESTIONS_FILE=data/questions.json
 *   APP_URL, APP_PASSWORD  (required for --remote)
 */

import { loadEnvFile } from "../lib/load-env-file";
loadEnvFile();

import path from "path";
import { getAppVersion } from "../lib/app-version";
import { generateSql, type SqlGenerationResult } from "../lib/claude";
import { ensureGuardedSql } from "../lib/ensure-guarded-sql";
import { detectWarehouseHallucinations } from "../lib/hallucination-schema";
import { evalMatchKey } from "../lib/eval-match";
import {
  evalsStorageDescription,
  loadEvals,
  saveEvals,
} from "../lib/evals-store";
import { startQuery, getStatus, getResults } from "../lib/athena";
import { inferUiViz } from "../lib/infer-ui-viz";
import {
  judgeFullResult,
  judgeQueryPair,
  type FullJudgeResult,
} from "../lib/judge";
import { isDatabaseConfigured } from "../lib/db";
import {
  applyQuestionFilters,
  loadQuestionsFromFile,
  type QuestionBankEntry,
} from "../lib/questions-bank";
import { generateSqlViaP8k8 } from "../lib/p8k8";
import { loadPromptVersion } from "../lib/prompt-versions";
import { recordQueryRunFinalize, recordQueryRunStart } from "../lib/record-query-run";
import type { ReplayResult } from "../lib/replay";
import { replayQuestion } from "../lib/replay";
import { pickBackend } from "../lib/route";
import { generateSqlWithAgent } from "../lib/sql-agent/run";
import { upsertQueryRun } from "../lib/query-runs-store";

const FULL_EVAL = process.argv.includes("--full");
const DRY_RUN = process.argv.includes("--dry-run");
const REMOTE = process.argv.includes("--remote");
const FORCE_JUDGE = process.argv.includes("--force");
const REPLACE_EVALS = process.argv.includes("--replace");
const NO_JUDGE = process.argv.includes("--no-judge");

/** Read --flag=value or --flag value from argv. */
function parseFlagValue(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1).trim() || undefined;
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1].trim() || undefined;
  }
  return undefined;
}

/** Prompt variant (nl2sql.prompt_versions.version_name) to A/B test; forces the agent backend. */
const PROMPT_VERSION = parseFlagValue("--prompt-version") ?? "v1-baseline";

/** Whether --prompt-version was passed explicitly (vs. the default). */
const PROMPT_VERSION_EXPLICIT = process.argv.some(
  (a) => a === "--prompt-version" || a.startsWith("--prompt-version=")
);

/** System prompt text loaded from nl2sql.prompt_versions in main(); injected into the agent. */
let promptSystem: string | null = null;

const RUN_DELAY_MS =
  Number.parseInt(process.env.RUN_DELAY_MS ?? "4000", 10) || 4000;
const JUDGE_DELAY_MS =
  Number.parseInt(process.env.JUDGE_DELAY_MS ?? "600", 10) || 600;
const POLL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

const QUESTIONS_FILE = process.env.RUN_QUESTIONS_FILE?.trim()
  ? path.resolve(process.cwd(), process.env.RUN_QUESTIONS_FILE.trim())
  : path.join(process.cwd(), "data", "questions.json");

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

function backendLabel(): string {
  return `agent (forced; prompt "${PROMPT_VERSION}")`;
}

async function generateForQuestion(
  question: string
): Promise<{ backend: string; generation: SqlGenerationResult }> {
  const generation = await generateSqlWithAgent(question, {
    systemPrompt: promptSystem ?? undefined,
  });
  return { backend: "agent", generation };
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

type RunOutcome = {
  question: string;
  sql: string;
  model: string;
  backend: string;
  replay: ReplayResult;
};

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

async function runQuestionDirect(q: QuestionBankEntry): Promise<RunOutcome | null> {
  const question = q.question.trim();
  console.log(`  → generating (agent, prompt "${PROMPT_VERSION}")…`);

  let backend: string;
  let generation: SqlGenerationResult;
  try {
    ({ backend, generation } = await generateForQuestion(question));
  } catch (e) {
    console.log(`  ✗ generation failed — ${e instanceof Error ? e.message : e}`);
    return null;
  }

  console.log(`  → model: ${generation.model}, backend: ${backend}`);

  const guarded = await ensureGuardedSql(question, generation);
  if (!guarded.ok) {
    const h = schemaHallucinationPatch(guarded.sql);
    console.log(`  ✗ guardrails — ${guarded.reason}`);
    await upsertQueryRun({
      question,
      sql: guarded.sql,
      model: generation.model,
      backend,
      athenaState: "FAILED",
      errorReason: guarded.reason,
      promptVersion: PROMPT_VERSION,
      ...h,
    });
    return {
      question,
      sql: guarded.sql,
      model: generation.model,
      backend,
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
    await upsertQueryRun({
      question,
      sql,
      model: generation.model,
      backend,
      athenaState: "FAILED",
      errorReason: msg,
      promptVersion: PROMPT_VERSION,
      ...h,
    });
    return {
      question,
      sql,
      model: generation.model,
      backend,
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
    backend,
    executionId,
    promptVersion: PROMPT_VERSION,
    ...h,
  });

  console.log("  → polling athena…");
  const poll = await pollAthenaLocal(executionId);
  const rowCount =
    poll.state === "SUCCEEDED" && poll.rows ? poll.rows.length : null;

  await recordQueryRunFinalize(executionId, {
    athenaState: poll.state,
    question,
    sql,
    model: generation.model,
    backend,
    errorReason: poll.reason ?? null,
    scannedBytes: poll.scannedBytes ?? null,
    runtimeMs: poll.runtimeMs ?? null,
    rowCount,
    promptVersion: PROMPT_VERSION,
  });

  const replay = toReplayResult(question, sql, poll);
  console.log(
    `  → athena: ${replay.athenaStatus}, rows: ${replay.rowCount ?? "n/a"}${replay.emptyResult ? " (empty)" : ""}`
  );

  return {
    question,
    sql,
    model: generation.model,
    backend,
    replay,
  };
}

async function runQuestionRemote(q: QuestionBankEntry): Promise<RunOutcome | null> {
  const question = q.question.trim();
  console.log(`  → replay via ${process.env.APP_URL ?? "http://localhost:3000"}…`);
  const replay = await replayQuestion(question);
  if (!replay.sql?.trim()) {
    console.log(`  ✗ no sql — ${replay.errorReason ?? "unknown"}`);
    return null;
  }
  console.log(
    `  → athena: ${replay.athenaStatus}, rows: ${replay.rowCount ?? "n/a"}`
  );
  return {
    question,
    sql: replay.sql,
    model: "app",
    backend: "remote",
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

function printPlan(questions: QuestionBankEntry[]): void {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Run + eval plan: ${questions.length} question(s)`);
  console.log(`  File:     ${QUESTIONS_FILE}`);
  console.log(`  Mode:     ${REMOTE ? "remote (APP_URL)" : "direct (local .env)"}`);
  console.log(`  Backend:  ${backendLabel()}`);
  console.log(`  Prompt:   ${PROMPT_VERSION} (nl2sql.query_runs.prompt_version)`);
  console.log(`  Version:  ${getAppVersion()} (nl2sql.query_runs.app_version)`);
  console.log(`  DB log:   ${isDatabaseConfigured() ? "yes" : "no (DATABASE_URL unset)"}`);
  console.log(`  Judge:    ${NO_JUDGE ? "skipped" : FULL_EVAL ? "full (SQL+result)" : "SQL only"}`);
  console.log(`  Delay:    ${RUN_DELAY_MS}ms between questions`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

function printSummary(newResults: FullJudgeResult[], all: FullJudgeResult[]): void {
  const n = newResults.length;
  const avg =
    n > 0 ? newResults.reduce((s, r) => s + r.overall, 0) / n : 0;
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Judged: ${n} pair(s), avg ${avg.toFixed(1)}/10`);
  if (!NO_JUDGE) {
    console.log(`Written to ${evalsStorageDescription()} (${all.length} total)`);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

async function main(): Promise<void> {
  if (!REMOTE) {
    if (process.env.USE_P8K8 !== "true") {
      requireEnv("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);
    }
    if (!process.env.ATHENA_OUTPUT_LOCATION?.trim()) {
      console.error("Error: ATHENA_OUTPUT_LOCATION is required for direct mode");
      process.exit(1);
    }
  } else {
    const appUrl = process.env.APP_URL?.trim();
    if (!appUrl) {
      console.error("Error: APP_URL is required for --remote");
      process.exit(1);
    }
    if (PROMPT_VERSION_EXPLICIT) {
      console.error(
        "Error: --prompt-version is not supported with --remote (the deployed app controls its own prompt). Run in direct mode."
      );
      process.exit(1);
    }
    console.log(`Remote mode: ${appUrl.replace(/\/$/, "")}`);
  }

  if (!NO_JUDGE) {
    requireEnv("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);
  }

  // Direct mode forces the agent backend with a DB-stored prompt variant (A/B testing).
  // Skipped on --dry-run, which only prints the plan.
  if (!REMOTE && !DRY_RUN) {
    const promptRow = await loadPromptVersion(PROMPT_VERSION);
    if (!promptRow) {
      console.error(
        `Error: prompt version "${PROMPT_VERSION}" not found in nl2sql.prompt_versions ` +
          "(check the name, or that DATABASE_URL points at the right DB)."
      );
      process.exit(1);
    }
    promptSystem = promptRow.systemPrompt;
  }

  let questions = applyQuestionFilters(loadQuestionsFromFile(QUESTIONS_FILE));
  const limit = Number.parseInt(process.env.RUN_LIMIT ?? "", 10);
  if (Number.isFinite(limit) && limit > 0) {
    questions = questions.slice(0, limit);
  }

  if (questions.length === 0) {
    console.error("No questions match filters.");
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

    const outcome = REMOTE
      ? await runQuestionRemote(q)
      : await runQuestionDirect(q);

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

    console.log(
      FULL_EVAL ? "  → judging (SQL + result)…" : "  → judging (SQL only)…"
    );
    const result = FULL_EVAL
      ? await judgeFullResult(
          outcome.question,
          outcome.sql,
          outcome.replay
        )
      : await judgeQueryPair(outcome.question, outcome.sql);

    newResults.push(result);
    judgedKeys.add(key);

    if (i < questions.length - 1) {
      await sleep(FULL_EVAL ? RUN_DELAY_MS : JUDGE_DELAY_MS);
    }
  }

  if (NO_JUDGE) {
    console.log("\nDone (no judge). Refresh /dashboard after deploy.");
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
      "\nNote: EVALS_S3_URI is not set — evals saved locally only. Use npm run eval:upload or set EVALS_S3_URI."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
