/**
 * Server-only: merge query run pairs with local latency store + computed metrics.
 */

import type { DashboardMoment, DashboardMomentBase } from "@/lib/dashboard-moments";
import { lookupLatencyFromMap } from "@/lib/query-metrics-store";
import { questionMetrics, sqlComplexity } from "@/lib/sql-metrics";

export function enrichDashboardMoments(
  moments: DashboardMomentBase[],
  latencyByKey: Map<string, number>
): DashboardMoment[] {
  return moments.map((m) => ({
    ...m,
    latencyMs:
      m.runtimeMsFromDb ??
      lookupLatencyFromMap(latencyByKey, m.question, m.sql),
    questionMetrics: questionMetrics(m.question),
    sqlComplexity: sqlComplexity(m.sql),
  }));
}
