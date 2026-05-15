/**
 * Server-only: merge p8k8 pairs with local latency store + computed metrics.
 */

import type { DashboardMoment, DashboardMomentBase } from "@/lib/p8k8-moments";
import { lookupLatencyFromMap } from "@/lib/query-metrics-store";
import { questionMetrics, sqlComplexity } from "@/lib/sql-metrics";

export function enrichDashboardMoments(
  moments: DashboardMomentBase[],
  latencyByKey: Map<string, number>
): DashboardMoment[] {
  return moments.map((m) => ({
    ...m,
    latencyMs: lookupLatencyFromMap(latencyByKey, m.question, m.sql),
    questionMetrics: questionMetrics(m.question),
    sqlComplexity: sqlComplexity(m.sql),
  }));
}
