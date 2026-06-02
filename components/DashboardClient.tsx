"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { EvalSummary } from "@/components/EvalSummary";
import { MomentsTable } from "@/components/MomentsTable";
import { momentToJudgeView } from "@/lib/dashboard-judge";
import type { CorrectnessVerdict } from "@/lib/judge";
import type { DashboardMoment } from "@/lib/p8k8-moments";
import type { QueryCategory } from "@/lib/query-category";
import {
  DIFFICULTY_LABELS,
  type QueryDifficulty,
} from "@/lib/query-difficulty";
import { DATASET_LABELS, type QueryDataset } from "@/lib/query-dataset";
import type { QuestionSource } from "@/lib/question-source";
import { formatLatencyMs } from "@/lib/sql-metrics";

const PAGE_SIZE = 20;
const MOMENTS_FETCH_LIMIT = 500;

type SinceDaysFilter = "all" | "1" | "7" | "30";
type QuestionSourceFilter = "all" | QuestionSource;

type MomentsResponse = {
  moments: DashboardMoment[];
  total: number;
  source?: "postgres";
  currentAppVersion?: string;
  deployFilter?: string | null;
  dedupeByQuestion?: boolean;
  judgedOnly?: boolean;
  sinceDays?: 1 | 7 | 30 | null;
  questionSourceFilter?: QuestionSourceFilter;
};

type CategoryFilter = "all" | QueryCategory;
type VerdictFilter = "all" | CorrectnessVerdict;
type DatasetFilter = "all" | QueryDataset;
type DifficultyFilter = "all" | QueryDifficulty;

const CATEGORY_OPTIONS: QueryCategory[] = [
  "spatial",
  "demographic",
  "time-series",
  "ranking",
  "comparison",
  "aggregation",
  "lookup",
  "other",
];

const VERDICT_OPTIONS: CorrectnessVerdict[] = [
  "correct",
  "partial",
  "incorrect",
];

const DATASET_OPTIONS: QueryDataset[] = [
  "311",
  "collisions",
  "taxi",
  "census",
  "transit",
  "multi",
  "other",
];

const DIFFICULTY_OPTIONS: QueryDifficulty[] = ["easy", "medium", "hard"];

const SINCE_OPTIONS: SinceDaysFilter[] = ["all", "1", "7", "30"];
const SOURCE_OPTIONS: QuestionSourceFilter[] = [
  "all",
  "golden",
  "bank",
  "adhoc",
];

function FilterPills<T extends string>({
  label,
  value,
  options,
  optionLabel,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  optionLabel: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-[var(--muted)] shrink-0 w-20">
        {label}
      </span>
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
              active
                ? "bg-[var(--accent)] text-[var(--bg)]"
                : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {optionLabel(opt)}
          </button>
        );
      })}
    </div>
  );
}

function sinceLabel(v: SinceDaysFilter): string {
  if (v === "all") return "All time";
  return `Last ${v}d`;
}

function sourceLabel(v: QuestionSourceFilter): string {
  if (v === "all") return "All";
  if (v === "golden") return "Golden";
  if (v === "bank") return "Question bank";
  return "Ad-hoc";
}

export function DashboardClient() {
  const [moments, setMoments] = useState<DashboardMoment[]>([]);
  const [deployFilter, setDeployFilter] = useState<string | null>(null);
  const [sinceDaysFilter, setSinceDaysFilter] = useState<SinceDaysFilter>("all");
  const [questionSourceFilter, setQuestionSourceFilter] =
    useState<QuestionSourceFilter>("all");
  const [pageOffset, setPageOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");
  const [datasetFilter, setDatasetFilter] = useState<DatasetFilter>("all");
  const [difficultyFilter, setDifficultyFilter] =
    useState<DifficultyFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(MOMENTS_FETCH_LIMIT),
        offset: "0",
      });
      if (sinceDaysFilter !== "all") {
        params.set("sinceDays", sinceDaysFilter);
      }
      if (questionSourceFilter !== "all") {
        params.set("questionSource", questionSourceFilter);
      }

      const momentsRes = await fetch(
        `/api/dashboard/moments?${params.toString()}`,
        { cache: "no-store" }
      );

      const data = (await momentsRes.json()) as MomentsResponse & {
        error?: string;
        detail?: string;
      };
      if (!momentsRes.ok) {
        throw new Error(
          data.detail
            ? `${data.error ?? "Error"}: ${data.detail}`
            : (data.error ?? "Failed to load moments")
        );
      }

      setMoments(data.moments);
      setDeployFilter(data.deployFilter ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [sinceDaysFilter, questionSourceFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const summaryRows = useMemo(
    () =>
      moments
        .map((m) => momentToJudgeView(m))
        .filter((v): v is NonNullable<typeof v> => v != null),
    [moments]
  );

  const hallucinationCounts = useMemo(() => {
    const counts: Record<string, number> = { none: 0 };
    for (const m of moments) {
      const key = m.hallucinationType ?? "none";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [moments]);

  const filtersActive =
    categoryFilter !== "all" ||
    verdictFilter !== "all" ||
    datasetFilter !== "all" ||
    difficultyFilter !== "all" ||
    search.trim().length > 0;

  useEffect(() => {
    setPageOffset(0);
  }, [
    categoryFilter,
    verdictFilter,
    datasetFilter,
    difficultyFilter,
    search,
    sinceDaysFilter,
    questionSourceFilter,
  ]);

  const filteredMoments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return moments.filter((m) => {
      if (q && !m.question.toLowerCase().includes(q)) return false;
      const view = momentToJudgeView(m);
      if (!view) return false;
      if (categoryFilter !== "all" && view.category !== categoryFilter) {
        return false;
      }
      if (verdictFilter !== "all" && view.verdict !== verdictFilter) {
        return false;
      }
      if (datasetFilter !== "all" && view.dataset !== datasetFilter) {
        return false;
      }
      if (difficultyFilter !== "all" && view.difficulty !== difficultyFilter) {
        return false;
      }
      return true;
    });
  }, [
    moments,
    categoryFilter,
    verdictFilter,
    datasetFilter,
    difficultyFilter,
    search,
  ]);

  const sortedMoments = useMemo(
    () =>
      [...filteredMoments].sort((a, b) => {
        const sa = a.judgeOverall ?? -1;
        const sb = b.judgeOverall ?? -1;
        return sa - sb;
      }),
    [filteredMoments]
  );

  const pageMoments = useMemo(
    () => sortedMoments.slice(pageOffset, pageOffset + PAGE_SIZE),
    [sortedMoments, pageOffset]
  );

  const filteredTotal = sortedMoments.length;

  const stats = useMemo(() => {
    const models = new Set(
      moments.map((m) => m.model).filter((m): m is string => Boolean(m))
    );
    const tokenValues = moments
      .map((m) => m.tokensUsed?.total ?? m.tokenCount)
      .filter((t): t is number => t != null && Number.isFinite(t));
    const avgTokens =
      tokenValues.length > 0
        ? Math.round(
            tokenValues.reduce((a, b) => a + b, 0) / tokenValues.length
          )
        : null;
    const costValues = moments
      .map((m) => m.costUsd)
      .filter((c): c is number => c != null && Number.isFinite(c));
    const avgCostUsd =
      costValues.length > 0
        ? costValues.reduce((a, b) => a + b, 0) / costValues.length
        : null;
    const latencyValues = moments
      .map((m) => m.latencyMs)
      .filter((ms): ms is number => ms != null && Number.isFinite(ms));
    const avgLatencyMs =
      latencyValues.length > 0
        ? Math.round(
            latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length
          )
        : null;
    return {
      total: moments.length,
      uniqueModels: models.size,
      avgTokens,
      avgCostUsd,
      avgLatencyMs,
    };
  }, [moments]);

  const summaryCostTokens = useMemo(() => {
    const costs = moments
      .map((m) => m.costUsd)
      .filter((c): c is number => c != null && Number.isFinite(c));
    const tokens = moments
      .map((m) => m.tokensUsed?.total ?? m.tokenCount)
      .filter((t): t is number => t != null && Number.isFinite(t));
    return {
      avgCostUsd:
        costs.length > 0
          ? costs.reduce((a, b) => a + b, 0) / costs.length
          : null,
      avgTotalTokens:
        tokens.length > 0
          ? tokens.reduce((a, b) => a + b, 0) / tokens.length
          : null,
    };
  }, [moments]);

  const categoryPillOptions: CategoryFilter[] = ["all", ...CATEGORY_OPTIONS];
  const verdictPillOptions: VerdictFilter[] = ["all", ...VERDICT_OPTIONS];
  const datasetPillOptions: DatasetFilter[] = ["all", ...DATASET_OPTIONS];
  const difficultyPillOptions: DifficultyFilter[] = [
    "all",
    ...DIFFICULTY_OPTIONS,
  ];

  return (
    <main className="max-w-[min(100%,90rem)] mx-auto p-6 space-y-6">
      <AppNav />

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-[var(--text)]">
          Query Dashboard
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Judged eval summary from{" "}
          <span className="font-mono text-[var(--foreground)]">
            nl2sql.query_runs
          </span>
          {" "}
          · latest judged run per question
          {deployFilter ? (
            <>
              {" "}
              · deploy{" "}
              <span className="font-mono">{deployFilter}</span>
            </>
          ) : null}
        </p>
      </header>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 space-y-2.5">
        <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
          Scope
        </p>
        <FilterPills
          label="Time"
          value={sinceDaysFilter}
          options={SINCE_OPTIONS}
          optionLabel={sinceLabel}
          onChange={setSinceDaysFilter}
        />
        <FilterPills
          label="Questions"
          value={questionSourceFilter}
          options={SOURCE_OPTIONS}
          optionLabel={sourceLabel}
          onChange={setQuestionSourceFilter}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Judged queries" value={String(stats.total)} />
        <StatCard label="Unique models" value={String(stats.uniqueModels)} />
        <StatCard
          label="Avg latency"
          value={formatLatencyMs(stats.avgLatencyMs)}
        />
        <StatCard
          label="Avg tokens"
          value={stats.avgTokens != null ? String(stats.avgTokens) : "—"}
        />
        <StatCard
          label="Avg cost"
          value={
            stats.avgCostUsd != null
              ? `$${stats.avgCostUsd.toFixed(4)}`
              : "—"
          }
        />
      </div>

      <EvalSummary
        rows={summaryRows}
        hallucinationCounts={hallucinationCounts}
        avgCostUsd={summaryCostTokens.avgCostUsd}
        avgTotalTokens={summaryCostTokens.avgTotalTokens}
      />

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 space-y-2.5">
        <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
          Filter drill-down
        </p>
        <FilterPills
          label="Category"
          value={categoryFilter}
          options={categoryPillOptions}
          optionLabel={(v) => (v === "all" ? "All" : v.replace(/-/g, " "))}
          onChange={setCategoryFilter}
        />
        <FilterPills
          label="Verdict"
          value={verdictFilter}
          options={verdictPillOptions}
          optionLabel={(v) => (v === "all" ? "All" : v)}
          onChange={setVerdictFilter}
        />
        <FilterPills
          label="Dataset"
          value={datasetFilter}
          options={datasetPillOptions}
          optionLabel={(v) => (v === "all" ? "All" : DATASET_LABELS[v])}
          onChange={setDatasetFilter}
        />
        <FilterPills
          label="Difficulty"
          value={difficultyFilter}
          options={difficultyPillOptions}
          optionLabel={(v) => (v === "all" ? "All" : DIFFICULTY_LABELS[v])}
          onChange={setDifficultyFilter}
        />
      </div>

      <MomentsTable
        moments={pageMoments}
        loading={loading}
        error={error}
        onRefresh={() => load()}
        search={search}
        onSearchChange={setSearch}
        offset={pageOffset}
        total={filteredTotal}
        pageSize={PAGE_SIZE}
        onPageChange={setPageOffset}
        emptyMessage={
          filtersActive
            ? "No queries match the current filters."
            : undefined
        }
      />
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p className="text-2xl font-semibold tabular-nums text-[var(--text)] mt-1">
        {value}
      </p>
    </div>
  );
}
