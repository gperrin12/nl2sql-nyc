import { resolveDashboardDataSource, p8k8Configured } from "@/lib/dashboard-source";
import { enrichDashboardMoments } from "@/lib/enrich-dashboard-moments";
import type { DashboardMoment } from "@/lib/p8k8-moments";
import { paginateMoments } from "@/lib/p8k8-moments";
import { loadP8k8DashboardMoments } from "@/lib/load-p8k8-moments";
import { loadQueryRunMoments } from "@/lib/query-runs-dashboard";
import {
  getAppVersion,
  resolveDashboardAppVersionFilter,
} from "@/lib/app-version";
import { isDatabaseConfigured } from "@/lib/db";
import { loadLatencyByKey } from "@/lib/query-metrics-store";

export type DashboardMomentsResponse = {
  moments: DashboardMoment[];
  total: number;
  source: "postgres" | "p8k8";
  /** Build label for this running app instance. */
  currentAppVersion?: string;
  /** When set, only consider runs from this deploy (still one row per question). */
  deployFilter?: string | null;
  dedupeByQuestion: boolean;
};

export async function loadDashboardMoments(options: {
  fetchLimit: number;
  offset: number;
  pageLimit: number;
  appVersion?: string;
}): Promise<DashboardMomentsResponse> {
  const source = resolveDashboardDataSource();

  if (source === "postgres") {
    if (!isDatabaseConfigured()) {
      throw new Error(
        "DATABASE_URL is not set — required when DASHBOARD_SOURCE=postgres (or auto with no p8k8)"
      );
    }

    const deployFilter = resolveDashboardAppVersionFilter(options.appVersion);

    const bases = await loadQueryRunMoments({
      limit: options.fetchLimit,
      appVersion: deployFilter,
      latestPerQuestion: true,
    });
    const latencyByKey = await loadLatencyByKey();
    const enriched = enrichDashboardMoments(bases, latencyByKey);
    const { moments, total } = paginateMoments(
      enriched,
      options.offset,
      options.pageLimit
    );

    return {
      moments,
      total,
      source: "postgres",
      currentAppVersion: getAppVersion(),
      deployFilter: deployFilter ?? null,
      dedupeByQuestion: true,
    };
  }

  if (!p8k8Configured()) {
    throw new Error(
      "p8k8 is not configured — set P8K8_URL and P8K8_AUTH_TOKEN, or use DATABASE_URL with DASHBOARD_SOURCE=postgres"
    );
  }

  const { moments, total } = await loadP8k8DashboardMoments(options);
  return { moments, total, source: "p8k8", dedupeByQuestion: false };
}
