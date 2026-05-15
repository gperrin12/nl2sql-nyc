import type { SqlGenerationResult } from "@/lib/claude";
import { recordQueryLatency } from "@/lib/query-metrics-store";

/** Persist measured NL→SQL latency when available (never fails the query pipeline). */
export async function recordGenerationMetrics(
  question: string,
  generation: SqlGenerationResult,
  backend: string
): Promise<void> {
  if (generation.latencyMs == null) return;
  try {
    await recordQueryLatency(
      question,
      generation.sql,
      generation.latencyMs,
      backend
    );
  } catch (e) {
    console.warn(
      "[query-metrics] recordGenerationMetrics:",
      e instanceof Error ? e.message : e
    );
  }
}
