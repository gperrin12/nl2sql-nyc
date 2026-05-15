import type { SqlGenerationResult } from "@/lib/claude";
import { recordQueryLatency } from "@/lib/query-metrics-store";

/** Persist measured NL→SQL latency when available (p8k8 path). */
export async function recordGenerationMetrics(
  question: string,
  generation: SqlGenerationResult,
  backend: string
): Promise<void> {
  if (generation.latencyMs == null) return;
  await recordQueryLatency(
    question,
    generation.sql,
    generation.latencyMs,
    backend
  );
}
