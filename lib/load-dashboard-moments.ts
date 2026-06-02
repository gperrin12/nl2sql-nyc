import { enrichDashboardMoments } from "@/lib/enrich-dashboard-moments";
import type { DashboardMoment } from "@/lib/dashboard-moments";
import { paginateMoments } from "@/lib/dashboard-moments";
import { loadEvaluatedQueryRunMoments } from "@/lib/query-runs-dashboard";
import {
  getAppVersion,
  resolveDashboardAppVersionFilter,
} from "@/lib/app-version";
import { isDatabaseConfigured } from "@/lib/db";
import { loadLatencyByKey } from "@/lib/query-metrics-store";
import type { QuestionSource } from "@/lib/question-source-types";

export type DashboardMomentsResponse = {
  moments: DashboardMoment[];
  total: number;
  source: "postgres";
  currentAppVersion?: string;
  deployFilter?: string | null;
  dedupeByQuestion: boolean;
  judgedOnly: boolean;
  sinceDays?: 1 | 7 | 30 | null;
  questionSourceFilter?: QuestionSource | "all";
};

function parseSinceDays(raw: string | null | undefined): 1 | 7 | 30 | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const n = Number.parseInt(raw, 10);
  if (n === 1 || n === 7 || n === 30) return n;
  return undefined;
}

function parseQuestionSource(
  raw: string | null | undefined
): QuestionSource | "all" {
  const v = raw?.trim().toLowerCase();
  if (v === "golden" || v === "bank" || v === "adhoc") return v;
  return "all";
}

export async function loadDashboardMoments(options: {
  fetchLimit: number;
  offset: number;
  pageLimit: number;
  appVersion?: string;
  sinceDays?: 1 | 7 | 30;
  questionSource?: QuestionSource | "all";
}): Promise<DashboardMomentsResponse> {
  if (!isDatabaseConfigured()) {
    throw new Error(
      "NEON_DATABASE_URL is not set — required for the eval dashboard (nl2sql.query_runs)"
    );
  }

  const deployFilter = resolveDashboardAppVersionFilter(options.appVersion);
  const sinceDays = options.sinceDays;
  const questionSource = options.questionSource ?? "all";

  const bases = await loadEvaluatedQueryRunMoments({
    limit: Math.min(options.fetchLimit, 500),
    sinceDays,
    appVersion: deployFilter,
    questionSource,
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
    judgedOnly: true,
    sinceDays: sinceDays ?? null,
    questionSourceFilter: questionSource,
  };
}

export { parseSinceDays, parseQuestionSource };
