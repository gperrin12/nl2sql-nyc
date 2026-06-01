/**
 * Adversarial NL→SQL eval: agent generation + ensureGuardedSqlV2 + repair_attempts stats.
 *
 * Scope (important):
 *   - actual = guardrail outcome only (ensureGuardedSqlV2 / checkSql + repair). No Athena.
 *   - expected in adversarial-questions.json = end-to-end intent (often abstain on schema
 *     hallucination at execution time). Invalid column names frequently pass checkSql, so
 *     actual=succeed with expected=abstain is normal and informative — not a script bug.
 *
 * Postgres: getPgPool() from lib/db (same as eval-moments / token-report). If
 * nl2sql.repair_attempts is missing, migration runs automatically; or use --migrate.
 *
 * Usage (reads .env / .env.local):
 *   tsx scripts/run-adversarial.ts
 *   npm run run:adversarial
 *
 * Flags:
 *   --dry-run   — print plan only (no API / DB writes)
 *   --migrate   — create nl2sql.repair_attempts then exit
 *
 * Env:
 *   DATABASE_URL, ANTHROPIC_API_KEY (required unless --dry-run)
 *   RUN_DELAY_MS=4000  — pause between questions
 *   ADVERSARIAL_IDS=aq-001,aq-003  — optional subset
 */

import { readFileSync } from "fs";
import path from "path";
import type { Pool } from "pg";
import { loadEnvFile } from "../lib/load-env-file";

loadEnvFile();

import { getPgPool, isDatabaseConfigured } from "../lib/db";
import { ensureRepairAttemptsTable } from "../lib/repair-attempts";
import { ensureGuardedSqlV2, type GuardedSqlResult } from "../lib/sql-agent/ensure-guarded-sql";
import { runSqlAgentWithEvents } from "../lib/sql-agent/run";
import type { AgentStreamPayload } from "../lib/sql-agent/types";

const QUESTIONS_PATH = path.join(process.cwd(), "data/adversarial-questions.json");

const DRY_RUN = process.argv.includes("--dry-run");
const MIGRATE_ONLY = process.argv.includes("--migrate");
const RUN_DELAY_MS =
  Number.parseInt(process.env.RUN_DELAY_MS ?? "4000", 10) || 4000;

type ExpectedOutcome = "abstain" | "succeed";

type AdversarialQuestion = {
  id: string;
  question: string;
  expected_outcome: ExpectedOutcome;
  target_failure?: string;
  notes?: string;
};

/** actual = guardrail-layer outcome only (not Athena execution). */
type QuestionRunResult = {
  id: string;
  question: string;
  /** From adversarial-questions.json (end-to-end intent). */
  expected: ExpectedOutcome;
  /** From ensureGuardedSqlV2: succeed if guard ok, else abstain. */
  actual: ExpectedOutcome;
  /** expected === actual; mismatches are often expected (schema checked at Athena). */
  alignsWithDataset: boolean;
  agentError?: string;
  guarded?: GuardedSqlResult;
  sqlPreview?: string;
};

function requireEnv(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    console.error(`Error: ${name} is required`);
    process.exit(1);
  }
  return value.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadAdversarialQuestions(): AdversarialQuestion[] {
  const raw = readFileSync(QUESTIONS_PATH, "utf8");
  const all = JSON.parse(raw) as AdversarialQuestion[];
  const filter = process.env.ADVERSARIAL_IDS?.trim();
  if (!filter) return all;
  const ids = new Set(filter.split(",").map((s) => s.trim()).filter(Boolean));
  const subset = all.filter((q) => ids.has(q.id));
  if (subset.length === 0) {
    console.error(`Error: ADVERSARIAL_IDS matched no questions in ${QUESTIONS_PATH}`);
    process.exit(1);
  }
  return subset;
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function formatAgentEvent(e: AgentStreamPayload): string | null {
  switch (e.type) {
    case "turn":
      return `  [agent] turn ${e.index + 1}`;
    case "reason":
      return `  [agent] ${truncate(e.text, 100)}`;
    case "tool_act":
      return `  [agent] tool ${e.name}`;
    case "summary":
      return `  [agent] summary: ${truncate(e.text, 80)}`;
    default:
      return null;
  }
}

/** Guardrail-layer outcome only — does not reflect Athena/schema-at-runtime. */
function guardrailOutcome(
  guarded: GuardedSqlResult | undefined,
  agentFailed: boolean
): ExpectedOutcome {
  if (agentFailed || !guarded?.ok) return "abstain";
  return "succeed";
}

function printScopeBanner(): void {
  console.log(`
Scope: guardrails + repair only (ensureGuardedSqlV2). No Athena execution.
  actual     = guard passed (succeed) or guard/agent abstained
  expected   = dataset label (often assumes execution-time schema failure)
  aligns?    = expected === actual — low alignment is OK when checkSql passes
               hallucinated columns that would fail only at query time.
`);
}

function printMismatchNotes(results: QuestionRunResult[]): void {
  const guardPassedDatasetAbstain = results.filter(
    (r) => r.expected === "abstain" && r.actual === "succeed"
  );
  const guardAbstainedDatasetSucceed = results.filter(
    (r) => r.expected === "succeed" && r.actual === "abstain"
  );

  if (
    guardPassedDatasetAbstain.length === 0 &&
    guardAbstainedDatasetSucceed.length === 0
  ) {
    return;
  }

  console.log("\n=== Mismatch notes (informational) ===");
  if (guardPassedDatasetAbstain.length > 0) {
    console.log(
      "Expected abstain, guard succeeded (schema likely validated at execution, not checkSql):"
    );
    for (const r of guardPassedDatasetAbstain) {
      console.log(`  ${r.id}  [${r.guarded?.attempts ?? 0} guard attempts]`);
    }
  }
  if (guardAbstainedDatasetSucceed.length > 0) {
    console.log("Expected succeed, guard abstained:");
    for (const r of guardAbstainedDatasetSucceed) {
      const detail =
        r.guarded?.reason ?? r.agentError ?? "unknown";
      console.log(`  ${r.id}: ${detail}`);
    }
  }
}

function printRowTable(
  headers: string[],
  rows: string[][],
  widths?: number[]
): void {
  const w =
    widths ??
    headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
    );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(w[i])).join("  ");
  console.log(line(headers));
  console.log(w.map((n) => "-".repeat(n)).join("  "));
  for (const row of rows) console.log(line(row));
}

async function printRepairStats(
  pool: Pool,
  sessionStart: Date,
  questions: string[],
  runResults: QuestionRunResult[]
): Promise<void> {
  const params = [sessionStart.toISOString(), questions];

  const overall = await pool.query<{
    total_attempts: number;
    succeeded: number;
    failed: number;
  }>(
    `SELECT
       COUNT(*)::int AS total_attempts,
       COUNT(*) FILTER (WHERE repair_succeeded)::int AS succeeded,
       COUNT(*) FILTER (WHERE NOT repair_succeeded)::int AS failed
     FROM nl2sql.repair_attempts
     WHERE created_at >= $1::timestamptz
       AND question = ANY($2::text[])`,
    params
  );

  const byType = await pool.query<{
    error_type: string;
    attempts: number;
    repaired: number;
  }>(
    `SELECT
       error_type,
       COUNT(*)::int AS attempts,
       COUNT(*) FILTER (WHERE repair_succeeded)::int AS repaired
     FROM nl2sql.repair_attempts
     WHERE created_at >= $1::timestamptz
       AND question = ANY($2::text[])
     GROUP BY error_type
     ORDER BY attempts DESC, error_type`,
    params
  );

  const row = overall.rows[0];
  const total = row?.total_attempts ?? 0;
  const succeeded = row?.succeeded ?? 0;
  const rate =
    total > 0 ? `${((100 * succeeded) / total).toFixed(1)}%` : "n/a";

  console.log("\n=== nl2sql.repair_attempts (this run) ===");
  console.log(`Session since: ${sessionStart.toISOString()}`);
  console.log(`Total repair log rows: ${total}`);
  console.log(`Repair success rate:   ${rate} (${succeeded}/${total} marked repair_succeeded)`);

  if (byType.rows.length > 0) {
    console.log("\nBy error_type:");
    printRowTable(
      ["error_type", "attempts", "repaired", "rate"],
      byType.rows.map((r) => {
        const pct =
          r.attempts > 0
            ? `${((100 * r.repaired) / r.attempts).toFixed(0)}%`
            : "n/a";
        return [r.error_type, String(r.attempts), String(r.repaired), pct];
      })
    );
  } else {
    console.log("(no repair_attempts rows for these questions in this window)");
  }

  const abstained = runResults.filter((r) => r.actual === "abstain");
  console.log("\n=== Questions that abstained at guard layer (guard_actual) ===");
  if (abstained.length === 0) {
    console.log("(none)");
  } else {
    for (const r of abstained) {
      const detail = r.guarded?.reason
        ? `${r.guarded.reason}${r.guarded.error_type ? ` [${r.guarded.error_type}]` : ""}`
        : r.agentError ?? "unknown";
      console.log(`  ${r.id}: ${detail}`);
    }
  }
}

async function main(): Promise<void> {
  const questions = loadAdversarialQuestions();
  console.log(`Loaded ${questions.length} adversarial question(s) from data/adversarial-questions.json`);

  if (MIGRATE_ONLY) {
    if (!isDatabaseConfigured()) {
      console.error("Error: DATABASE_URL is required for --migrate");
      process.exit(1);
    }
    const pool = getPgPool();
    if (!pool) {
      console.error("Error: could not create Postgres pool");
      process.exit(1);
    }
    await ensureRepairAttemptsTable(pool);
    console.log("Migration applied: nl2sql.repair_attempts");
    await pool.end();
    return;
  }

  if (DRY_RUN) {
    printScopeBanner();
    console.log("Dry run — would execute:");
    for (const q of questions) {
      console.log(
        `  ${q.id}  dataset_expected=${q.expected_outcome}  target=${q.target_failure ?? "-"}`
      );
      console.log(`    ${truncate(q.question, 90)}`);
    }
    console.log("\nRequires: DATABASE_URL, ANTHROPIC_API_KEY");
    console.log("Postgres: getPgPool(); auto-migrate repair_attempts if missing");
    return;
  }

  requireEnv("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);
  if (!isDatabaseConfigured()) {
    console.error("Error: DATABASE_URL is required");
    process.exit(1);
  }

  const pool = getPgPool();
  if (!pool) {
    console.error("Error: could not create Postgres pool");
    process.exit(1);
  }

  await ensureRepairAttemptsTable(pool);

  const sessionStart = new Date();
  const questionTexts = questions.map((q) => q.question);
  const runResults: QuestionRunResult[] = [];

  printScopeBanner();
  console.log(`Starting adversarial run at ${sessionStart.toISOString()}\n`);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(`[${i + 1}/${questions.length}] ${q.id} — ${truncate(q.question, 70)}`);
    console.log(
      `  dataset expected: ${q.expected_outcome} (${q.target_failure ?? "—"})`
    );

    let generation: { sql: string } | undefined;
    let agentError: string | undefined;
    let guarded: GuardedSqlResult | undefined;

    try {
      const gen = await runSqlAgentWithEvents(q.question, async (e) => {
        const line = formatAgentEvent(e);
        if (line) console.log(line);
      });
      generation = gen;
      console.log(`  [agent] SQL generated (${gen.sql.length} chars)`);

      guarded = await ensureGuardedSqlV2(pool, q.question, gen.sql);
    } catch (e) {
      agentError = e instanceof Error ? e.message : String(e);
      console.log(`  [error] ${agentError}`);
    }

    const actual = guardrailOutcome(guarded, Boolean(agentError));
    const alignsWithDataset = actual === q.expected_outcome;

    if (guarded) {
      if (guarded.ok) {
        console.log(
          `  [guard] ok (attempts=${guarded.attempts}) → actual=succeed`
        );
      } else {
        console.log(
          `  [guard] abstain: ${guarded.reason ?? "unknown"}${guarded.error_type ? ` (${guarded.error_type})` : ""} → actual=abstain`
        );
        if (guarded.suggestion) {
          console.log(`  [hint] ${truncate(guarded.suggestion, 120)}`);
        }
      }
    } else {
      console.log(`  [outcome] abstain (agent failed) → actual=abstain`);
    }

    console.log(
      `  compare: dataset_expected=${q.expected_outcome} guard_actual=${actual} aligns=${alignsWithDataset ? "yes" : "no"}`
    );
    if (!alignsWithDataset && q.expected_outcome === "abstain" && actual === "succeed") {
      console.log(
        `  note: guard passed; dataset expected abstain (schema check is at execution time)`
      );
    }

    runResults.push({
      id: q.id,
      question: q.question,
      expected: q.expected_outcome,
      actual,
      alignsWithDataset,
      agentError,
      guarded,
      sqlPreview: generation?.sql
        ? truncate(generation.sql, 100)
        : guarded?.sql
          ? truncate(guarded.sql, 100)
          : undefined,
    });

    if (i < questions.length - 1 && RUN_DELAY_MS > 0) {
      await sleep(RUN_DELAY_MS);
    }
    console.log("");
  }

  const aligned = runResults.filter((r) => r.alignsWithDataset).length;
  console.log("=== Per-question summary (guard_actual vs dataset_expected) ===");
  printRowTable(
    ["id", "dataset_exp", "guard_actual", "aligns", "detail"],
    runResults.map((r) => [
      r.id,
      r.expected,
      r.actual,
      r.alignsWithDataset ? "yes" : "no",
      r.guarded?.reason ?? r.agentError ?? (r.guarded?.ok ? "guard ok" : "—"),
    ])
  );

  console.log(
    `\nAligns with dataset label: ${aligned}/${runResults.length} (${runResults.length ? ((100 * aligned) / runResults.length).toFixed(0) : 0}%)`
  );
  console.log(
    "Low alignment is expected when checkSql passes SQL that would fail at Athena (schema hallucination)."
  );

  printMismatchNotes(runResults);
  await printRepairStats(pool, sessionStart, questionTexts, runResults);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
