import { enrichDashboardMoments } from "@/lib/enrich-dashboard-moments";
import type { DashboardMoment, DashboardMomentBase } from "@/lib/p8k8-moments";
import {
  paginateMoments,
  pairSessionMessages,
  unwrapTimelinePayload,
} from "@/lib/p8k8-moments";
import { loadLatencyByKey } from "@/lib/query-metrics-store";
import { resolveP8k8ChatId } from "@/lib/p8k8";

const P8K8_URL = (process.env.P8K8_URL ?? "").replace(/\/$/, "");
const P8K8_AUTH_TOKEN = process.env.P8K8_AUTH_TOKEN ?? "";

export async function fetchP8k8MomentBases(
  fetchLimit: number
): Promise<DashboardMomentBase[]> {
  if (!P8K8_URL || !P8K8_AUTH_TOKEN) {
    throw new Error("P8K8_URL and P8K8_AUTH_TOKEN are required for p8k8 source");
  }

  const sessionId = resolveP8k8ChatId();
  const url = `${P8K8_URL}/moments/session/${encodeURIComponent(sessionId)}?limit=${fetchLimit}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${P8K8_AUTH_TOKEN}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`p8k8 session timeline failed: HTTP ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as unknown;
  const events = unwrapTimelinePayload(data);
  return pairSessionMessages(events);
}

export async function loadP8k8DashboardMoments(options: {
  fetchLimit: number;
  offset: number;
  pageLimit: number;
}): Promise<{ moments: DashboardMoment[]; total: number }> {
  const paired = await fetchP8k8MomentBases(options.fetchLimit);
  const latencyByKey = await loadLatencyByKey();
  const enriched = enrichDashboardMoments(paired, latencyByKey);
  const { moments, total } = paginateMoments(enriched, options.offset, options.pageLimit);
  return { moments, total };
}
