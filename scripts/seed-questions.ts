/**
 * Submit questions from data/questions.json to the running app and record outcomes.
 *
 * Usage:
 *   APP_URL=http://localhost:3000 APP_PASSWORD=... npm run seed
 *   npm run seed:dry
 *   npm run seed:spatial
 *
 * Env:
 *   APP_URL          (default http://localhost:3000)
 *   APP_PASSWORD     (optional — only if app has password protection enabled)
 *   SEED_DELAY_MS    (default 4000)
 *   SEED_CATEGORY    optional filter
 *   SEED_DIFFICULTY  optional filter
 *   SEED_DRY_RUN     true = print plan only
 *   SEED_IDS         comma-separated question ids
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { inferVizType } from "../lib/viz-infer";

type Question = {
  id: string;
  question: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  tables: string[];
  expectedViz: "chart" | "map" | "table";
  notes?: string;
};

export type SeedResultStatus =
  | "succeeded"
  | "failed"
  | "timeout"
  | "start_failed"
  | "empty";

export type SeedResult = {
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

const QUESTIONS_PATH = path.join(process.cwd(), "data", "questions.json");
const RESULTS_PATH = path.join(process.cwd(), "data", "seed-results.json");

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);
const SEED_DELAY_MS =
  Number.parseInt(process.env.SEED_DELAY_MS ?? "4000", 10) || 4000;
const SEED_DRY_RUN = process.env.SEED_DRY_RUN === "true";
const POLL_MS = 2000;
const POLL_TIMEOUT_MS = 90_000;

type StartResponse = {
  executionId?: string;
  sql?: string;
  error?: string;
  reason?: string;
  detail?: string;
};

type PollResponse = {
  state: string;
  reason?: string;
  columns?: string[];
  rows?: Record<string, string | null>[];
  scannedBytes?: number;
  runtimeMs?: number;
  error?: string;
  detail?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseAuthCookie(headers: Headers): string | null {
  const fromGetSetCookie =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const line of fromGetSetCookie) {
    const m = line.match(/(?:^|,\s*)auth=([^;]+)/);
    if (m) return m[1];
  }
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return null;
  const m = setCookie.match(/(?:^|,\s*)auth=([^;]+)/);
  return m ? m[1] : null;
}

async function login(): Promise<string | null> {
  const password = process.env.APP_PASSWORD?.trim();
  if (!password) return null;

  const res = await fetch(`${APP_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed: HTTP ${res.status}`);
  }
  const cookie = parseAuthCookie(res.headers);
  if (!cookie) {
    throw new Error("Login succeeded but no auth cookie returned");
  }
  return cookie;
}

function authHeaders(cookie: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cookie) headers.Cookie = `auth=${cookie}`;
  return headers;
}

/** questions.json uses // section headers — strip line comments before parse */
function parseJsonWithLineComments(raw: string): unknown {
  const stripped = raw
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  return JSON.parse(stripped);
}

function loadQuestions(): Question[] {
  const raw = readFileSync(QUESTIONS_PATH, "utf8");
  const parsed = parseJsonWithLineComments(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("questions.json must be a JSON array");
  }
  return parsed as Question[];
}

function applyFilters(questions: Question[]): Question[] {
  let list = questions;

  const idsRaw = process.env.SEED_IDS?.trim();
  if (idsRaw) {
    const ids = new Set(
      idsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    );
    list = list.filter((q) => ids.has(q.id));
  }

  const category = process.env.SEED_CATEGORY?.trim();
  if (category) {
    list = list.filter((q) => q.category === category);
  }

  const difficulty = process.env.SEED_DIFFICULTY?.trim();
  if (difficulty) {
    list = list.filter((q) => q.difficulty === difficulty);
  }

  return list;
}

function loadExistingResults(): SeedResult[] {
  if (!existsSync(RESULTS_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as SeedResult[]) : [];
  } catch {
    return [];
  }
}

function saveResults(results: SeedResult[]): void {
  mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2), "utf8");
}

function countByField(
  items: Question[],
  field: "category" | "difficulty"
): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of items) {
    const v = item[field];
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return m;
}

function formatCountMap(m: Map<string, number>): string {
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k}(${n})`)
    .join(" ");
}

function printPlan(questions: Question[]): void {
  const cat = countByField(questions, "category");
  const diff = countByField(questions, "difficulty");
  const estMin = Math.ceil(
    (questions.length * (SEED_DELAY_MS + 15000)) / 60_000
  );

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Seed plan: ${questions.length} questions`);
  console.log(`  Categories: ${formatCountMap(cat)}`);
  console.log(`  Difficulties: ${formatCountMap(diff)}`);
  console.log(`  App: ${APP_URL}`);
  console.log(`  Delay: ${SEED_DELAY_MS}ms between questions`);
  console.log(`  Estimated time: ~${estMin} minutes`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

function printDryRun(questions: Question[]): void {
  console.log("\nDry run — questions that would be seeded:\n");
  questions.forEach((q, i) => {
    const notes = q.notes ? ` — ${q.notes}` : "";
    console.log(
      `${String(i + 1).padStart(3)}. ${q.id} (${q.category}/${q.difficulty})${notes}`
    );
    console.log(`     "${q.question}"`);
  });
  console.log(`\nTotal: ${questions.length}`);
}

function baseResult(q: Question): Omit<SeedResult, "status" | "seededAt"> {
  return {
    id: q.id,
    question: q.question,
    category: q.category,
    difficulty: q.difficulty,
    tables: q.tables,
    expectedViz: q.expectedViz,
    notes: q.notes,
  };
}

async function pollAthena(
  executionId: string,
  cookie: string | null
): Promise<{
  status: "succeeded" | "failed" | "timeout" | "empty";
  columns?: string[];
  rowCount?: number;
  scannedBytes?: number;
  runtimeMs?: number;
  errorReason?: string;
}> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_MS);

    const res = await fetch(`${APP_URL}/api/query/${executionId}`, {
      headers: cookie ? { Cookie: `auth=${cookie}` } : {},
    });

    let poll: PollResponse;
    try {
      poll = (await res.json()) as PollResponse;
    } catch {
      return { status: "failed", errorReason: `Invalid poll JSON: HTTP ${res.status}` };
    }

    if (!res.ok) {
      return {
        status: "failed",
        errorReason:
          poll.detail ?? poll.error ?? `Poll failed: HTTP ${res.status}`,
      };
    }

    if (poll.state === "SUCCEEDED") {
      const columns = poll.columns ?? [];
      const rows = poll.rows ?? [];
      const rowCount = rows.length;
      if (rowCount === 0) {
        return {
          status: "empty",
          columns,
          rowCount: 0,
          scannedBytes: poll.scannedBytes,
          runtimeMs: poll.runtimeMs,
        };
      }
      return {
        status: "succeeded",
        columns,
        rowCount,
        scannedBytes: poll.scannedBytes,
        runtimeMs: poll.runtimeMs,
      };
    }

    if (poll.state === "FAILED" || poll.state === "CANCELLED") {
      return {
        status: "failed",
        errorReason: poll.reason ?? poll.state,
        scannedBytes: poll.scannedBytes,
        runtimeMs: poll.runtimeMs,
      };
    }
  }

  return { status: "timeout", errorReason: `Exceeded ${POLL_TIMEOUT_MS / 1000}s` };
}

function vizTag(columns: string[] | undefined, expected: string): string {
  if (columns?.length) {
    return `[${inferVizType(columns)}]`;
  }
  return `[${expected}]`;
}

function printResultLine(
  outcome: {
    status: SeedResultStatus;
    rowCount?: number;
    columns?: string[];
    runtimeMs?: number;
    errorReason?: string;
  },
  expectedViz: string
): void {
  const cols = outcome.columns?.length ?? 0;
  const viz = vizTag(outcome.columns, expectedViz);

  switch (outcome.status) {
    case "succeeded":
      console.log(
        `  ✓ SUCCEEDED — ${outcome.rowCount} rows, ${cols} cols ${viz}${outcome.runtimeMs != null ? ` (${outcome.runtimeMs}ms)` : ""}`
      );
      break;
    case "empty":
      console.log(`  ✓ SUCCEEDED — 0 rows ⚠ empty result`);
      break;
    case "failed":
      console.log(`  ✗ FAILED — ${outcome.errorReason ?? "unknown"}`);
      break;
    case "timeout":
      console.log(`  ✗ TIMEOUT — ${outcome.errorReason ?? "exceeded limit"}`);
      break;
    case "start_failed":
      console.log(`  ✗ start failed — ${outcome.errorReason ?? "unknown"}`);
      break;
  }
}

function printSummary(results: SeedResult[]): void {
  const n = results.length;
  const succeeded = results.filter((r) => r.status === "succeeded").length;
  const empty = results.filter((r) => r.status === "empty").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const timeout = results.filter((r) => r.status === "timeout").length;
  const startFailed = results.filter((r) => r.status === "start_failed").length;

  const pct = (x: number) => (n > 0 ? Math.round((x / n) * 100) : 0);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`SEED COMPLETE — ${n} questions`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✓ Succeeded:      ${succeeded}  (${pct(succeeded)}%)`);
  console.log(`⚠ Empty results:  ${empty}  (${pct(empty)}%)   ← silent failures`);
  console.log(`✗ Failed:         ${failed}  (${pct(failed)}%)`);
  console.log(`✗ Timeout:        ${timeout}  (${pct(timeout)}%)`);
  console.log(`✗ Start failed:   ${startFailed}  (${pct(startFailed)}%)`);

  const categories = [...new Set(results.map((r) => r.category))].sort();
  console.log("\nBy category:");
  for (const cat of categories) {
    const rows = results.filter((r) => r.category === cat);
    const ok = rows.filter((r) => r.status === "succeeded").length;
    const emp = rows.filter((r) => r.status === "empty").length;
    const bad = rows.filter(
      (r) =>
        r.status === "failed" ||
        r.status === "timeout" ||
        r.status === "start_failed"
    ).length;
    console.log(
      `  ${cat.padEnd(14)} ${String(rows.length).padStart(3)}  ✓${String(ok).padStart(2)}  ⚠${String(emp).padStart(1)}  ✗${String(bad).padStart(2)}`
    );
  }

  const difficulties = ["easy", "medium", "hard"];
  console.log("\nBy difficulty:");
  for (const d of difficulties) {
    const rows = results.filter((r) => r.difficulty === d);
    if (rows.length === 0) continue;
    const ok = rows.filter((r) => r.status === "succeeded").length;
    const bad = rows.filter(
      (r) =>
        r.status !== "succeeded" && r.status !== "empty"
    ).length;
    console.log(
      `  ${d.padEnd(8)} ${String(rows.length).padStart(3)}  ✓${String(ok).padStart(2)}  ✗${String(bad).padStart(2)}`
    );
  }

  const failedRows = results.filter(
    (r) =>
      r.status === "failed" ||
      r.status === "timeout" ||
      r.status === "start_failed"
  );
  if (failedRows.length > 0) {
    console.log("\nFailed questions:");
    for (const r of failedRows) {
      console.log(
        `  ${r.id}  ${r.category}/${r.difficulty}  — "${r.question.slice(0, 55)}${r.question.length > 55 ? "..." : ""}"`
      );
      if (r.errorReason) console.log(`             Error: ${r.errorReason}`);
    }
  }

  const emptyRows = results.filter((r) => r.status === "empty");
  if (emptyRows.length > 0) {
    console.log("\nEmpty result questions:");
    for (const r of emptyRows) {
      console.log(
        `  ${r.id}  ${r.category}/${r.difficulty} — "${r.question.slice(0, 55)}${r.question.length > 55 ? "..." : ""}"`
      );
    }
  }

  console.log(`\nWritten to ${RESULTS_PATH}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

async function main(): Promise<void> {

  const allQuestions = loadQuestions();
  const questions = applyFilters(allQuestions);

  if (questions.length === 0) {
    console.error("No questions match the current filters.");
    process.exit(1);
  }

  printPlan(questions);

  if (SEED_DRY_RUN) {
    printDryRun(questions);
    return;
  }

  const cookie = await login();

  const existing = loadExistingResults();
  const doneIds = new Set(existing.map((r) => r.id));
  const toRun = questions.filter((q) => !doneIds.has(q.id));

  if (doneIds.size > 0) {
    console.log(
      `\nResuming — skipping ${questions.length - toRun.length} already-completed questions.`
    );
  }

  const resultsMap = new Map<string, SeedResult>();
  for (const r of existing) resultsMap.set(r.id, r);

  const total = toRun.length;

  for (let i = 0; i < total; i++) {
    const q = toRun[i];
    const idx = questions.findIndex((x) => x.id === q.id) + 1;
    console.log(
      `\n[${idx}/${questions.length}] ${q.id} (${q.category}/${q.difficulty}) — "${q.question.slice(0, 60)}${q.question.length > 60 ? "..." : ""}"`
    );

    let result: SeedResult;

    try {
      const startRes = await fetch(`${APP_URL}/api/query/start`, {
        method: "POST",
        headers: authHeaders(cookie),
        body: JSON.stringify({ question: q.question }),
      });

      let startBody: StartResponse;
      try {
        startBody = (await startRes.json()) as StartResponse;
      } catch {
        result = {
          ...baseResult(q),
          status: "start_failed",
          errorReason: `Invalid JSON from start: HTTP ${startRes.status}`,
          seededAt: new Date().toISOString(),
        };
        printResultLine(result, q.expectedViz);
        resultsMap.set(q.id, result);
        saveResults([...resultsMap.values()]);
        if (i < total - 1) await sleep(SEED_DELAY_MS);
        continue;
      }

      if (!startRes.ok) {
        const reason =
          startBody.reason ??
          startBody.detail ??
          startBody.error ??
          `HTTP ${startRes.status}`;
        result = {
          ...baseResult(q),
          status: "start_failed",
          errorReason: reason,
          sql: startBody.sql,
          seededAt: new Date().toISOString(),
        };
        console.log(`  ✗ start failed: HTTP ${startRes.status} — ${reason}`);
        resultsMap.set(q.id, result);
        saveResults([...resultsMap.values()]);
        if (i < total - 1) await sleep(SEED_DELAY_MS);
        continue;
      }

      const executionId = startBody.executionId;
      const sql = startBody.sql ?? "";

      if (!executionId) {
        result = {
          ...baseResult(q),
          status: "start_failed",
          errorReason: "Start response missing executionId",
          sql,
          seededAt: new Date().toISOString(),
        };
        printResultLine(result, q.expectedViz);
        resultsMap.set(q.id, result);
        saveResults([...resultsMap.values()]);
        if (i < total - 1) await sleep(SEED_DELAY_MS);
        continue;
      }

      console.log("  → sql generated, polling athena...");
      const poll = await pollAthena(executionId, cookie);

      result = {
        ...baseResult(q),
        status: poll.status,
        sql,
        errorReason: poll.errorReason,
        rowCount: poll.rowCount,
        columnCount: poll.columns?.length,
        columns: poll.columns,
        scannedBytes: poll.scannedBytes,
        runtimeMs: poll.runtimeMs,
        seededAt: new Date().toISOString(),
      };
      printResultLine(result, q.expectedViz);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result = {
        ...baseResult(q),
        status: "start_failed",
        errorReason: msg,
        seededAt: new Date().toISOString(),
      };
      console.log(`  ✗ start failed — ${msg}`);
    }

    resultsMap.set(q.id, result);
    saveResults([...resultsMap.values()]);

    if (i < total - 1) await sleep(SEED_DELAY_MS);
  }

  const summaryResults = questions
    .map((q) => resultsMap.get(q.id))
    .filter((r): r is SeedResult => r != null);
  printSummary(summaryResults);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
