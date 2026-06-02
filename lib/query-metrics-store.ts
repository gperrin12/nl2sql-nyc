/**
 * Server-side store for query latency (wall-clock from local metrics file).
 * Persists to .data/query-metrics.json locally (gitignored).
 * Skipped on Vercel/serverless — no writable project disk (/var/task).
 */

import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const MAX_ENTRIES = 500;
const DATA_DIR = path.join(process.cwd(), ".data");
const METRICS_FILE = path.join(DATA_DIR, "query-metrics.json");

type StoredMetric = {
  key: string;
  question: string;
  latencyMs: number;
  recordedAt: string;
  backend: string;
};

/** Local JSON file is only usable off serverless (e.g. npm run dev). */
function canUseLocalMetricsFile(): boolean {
  if (process.env.QUERY_METRICS_DISABLE === "true") return false;
  if (process.env.VERCEL === "1") return false;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return false;
  return true;
}

export function queryMetricsKey(question: string, sql: string): string {
  return createHash("sha256")
    .update(question.trim())
    .update("\n")
    .update(sql.trim())
    .digest("hex");
}

async function readAll(): Promise<StoredMetric[]> {
  if (!canUseLocalMetricsFile()) return [];

  try {
    const raw = await readFile(METRICS_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is StoredMetric =>
        e &&
        typeof e === "object" &&
        typeof (e as StoredMetric).key === "string" &&
        typeof (e as StoredMetric).latencyMs === "number"
    );
  } catch {
    return [];
  }
}

async function writeAll(entries: StoredMetric[]): Promise<void> {
  if (!canUseLocalMetricsFile()) return;

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(METRICS_FILE, JSON.stringify(entries, null, 2), "utf8");
}

/** Record or update latency for a question+sql pair (keeps newest per key). */
export async function recordQueryLatency(
  question: string,
  sql: string,
  latencyMs: number,
  backend: string
): Promise<void> {
  if (!canUseLocalMetricsFile()) return;
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;

  try {
    const key = queryMetricsKey(question, sql);
    const entries = await readAll();
    const filtered = entries.filter((e) => e.key !== key);
    filtered.push({
      key,
      question: question.trim(),
      latencyMs: Math.round(latencyMs),
      recordedAt: new Date().toISOString(),
      backend,
    });

    filtered.sort(
      (a, b) =>
        new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
    );
    await writeAll(filtered.slice(0, MAX_ENTRIES));
  } catch (e) {
    console.warn(
      "[query-metrics] failed to persist latency:",
      e instanceof Error ? e.message : e
    );
  }
}

/** Build key → latency map for dashboard enrichment. */
export async function loadLatencyByKey(): Promise<Map<string, number>> {
  const entries = await readAll();
  const map = new Map<string, number>();
  for (const e of entries) {
    if (!map.has(e.key)) map.set(e.key, e.latencyMs);
  }
  return map;
}

export function lookupLatencyFromMap(
  map: Map<string, number>,
  question: string,
  sql: string
): number | null {
  const ms = map.get(queryMetricsKey(question, sql));
  return ms != null && Number.isFinite(ms) ? ms : null;
}
