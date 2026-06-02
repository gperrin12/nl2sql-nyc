"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/AppNav";
import {
  EvalSummary,
  type BreakdownDimension,
} from "@/components/EvalSummary";
import { MomentsTable } from "@/components/MomentsTable";
import { momentToJudgeView } from "@/lib/dashboard-judge-view";
import type { CorrectnessVerdict } from "@/lib/judge";
import type { DashboardMoment } from "@/lib/dashboard-moments";
import type { QueryCategory } from "@/lib/query-category";
import {
  DIFFICULTY_LABELS,
  type QueryDifficulty,
} from "@/lib/query-difficulty";
import { DATASET_LABELS, type QueryDataset } from "@/lib/query-dataset";
import type { QuestionSource } from "@/lib/question-source-types";
import { formatLatencyMs } from "@/lib/sql-metrics";

const PAGE_SIZE = 20;
const MOMENTS_FETCH_LIMIT = 500;

type SinceDaysFilter = "all" | "1" | "7" | "30";
type QuestionSourceFilter = "all" | QuestionSource;
type CategoryFilter = "all" | QueryCategory;
type VerdictFilter = "all" | CorrectnessVerdict;
type DatasetFilter = "all" | QueryDataset;
type DifficultyFilter = "all" | QueryDifficulty;
type HallucinationFilterValue =
  | "off_topic"
  | "guardrail_blocked"
  | "no_sql_produced"
  | "schema_hallucination";
type HallucinationFilter = "all" | "none" | HallucinationFilterValue;

type MomentsResponse = {
  moments: DashboardMoment[];
  total: number;
  source?: "postgres";
  deployFilter?: string | null;
};

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

const HALLUCINATION_OPTIONS: HallucinationFilter[] = [
  "all",
  "none",
  "off_topic",
  "guardrail_blocked",
  "no_sql_produced",
  "schema_hallucination",
];

const SINCE_OPTIONS: SinceDaysFilter[] = ["all", "1", "7", "30"];
const SOURCE_OPTIONS: QuestionSourceFilter[] = [
  "all",
  "golden",
  "bank",
  "adhoc",
];

const SELECT_CLASS =
  "w-full min-w-0 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

function FilterSelect<T extends string>({
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
    <label className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-[var(--muted)] truncate">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={SELECT_CLASS}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {optionLabel(opt)}
          </option>
        ))}
      </select>
    </label>
  );
}

function sinceLabel(v: SinceDaysFilter): string {
  if (v === "all") return "All time";
  return `Last ${v}d`;
}

function sourceLabel(v: QuestionSourceFilter): string {
  if (v === "all") return "All sources";
  if (v === "golden") return "Golden";
  if (v === "bank") return "Question bank";
  return "Ad-hoc";
}

function hallucinationLabel(v: HallucinationFilter): string {
  if (v === "all") return "All";
  if (v === "none") return "None";
  return v.replace(/_/g, " ");
}

function categoryLabel(v: CategoryFilter): string {
  return v === "all" ? "All" : v.replace(/-/g, " ");
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
  const [hallucinationFilter, setHallucinationFilter] =
    useState<HallucinationFilter>("all");

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

  const filtersActive =
    categoryFilter !== "all" ||
    verdictFilter !== "all" ||
    datasetFilter !== "all" ||
    difficultyFilter !== "all" ||
    hallucinationFilter !== "all" ||
    search.trim().length > 0;

  useEffect(() => {
    setPageOffset(0);
  }, [
    categoryFilter,
    verdictFilter,
    datasetFilter,
    difficultyFilter,
    hallucinationFilter,
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
      if (hallucinationFilter !== "all") {
        const ht = m.hallucinationType ?? null;
        if (hallucinationFilter === "none") {
          if (ht != null) return false;
        } else if (ht !== hallucinationFilter) {
          return false;
        }
      }
      return true;
    });
  }, [
    moments,
    categoryFilter,
    verdictFilter,
    datasetFilter,
    difficultyFilter,
    hallucinationFilter,
    search,
  ]);

  const filteredSummaryRows = useMemo(
    () =>
      filteredMoments
        .map((m) => momentToJudgeView(m))
        .filter((v): v is NonNullable<typeof v> => v != null),
    [filteredMoments]
  );

  const filteredHallucinationCounts = useMemo(() => {
    const counts: Record<string, number> = { none: 0 };
    for (const m of filteredMoments) {
      const key = m.hallucinationType ?? "none";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [filteredMoments]);

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
      filteredMoments.map((m) => m.model).filter((m): m is string => Boolean(m))
    );
    const tokenValues = filteredMoments
      .map((m) => m.tokensUsed?.total ?? m.tokenCount)
      .filter((t): t is number => t != null && Number.isFinite(t));
    const avgTokens =
      tokenValues.length > 0
        ? Math.round(
            tokenValues.reduce((a, b) => a + b, 0) / tokenValues.length
          )
        : null;
    const costValues = filteredMoments
      .map((m) => m.costUsd)
      .filter((c): c is number => c != null && Number.isFinite(c));
    const avgCostUsd =
      costValues.length > 0
        ? costValues.reduce((a, b) => a + b, 0) / costValues.length
        : null;
    const latencyValues = filteredMoments
      .map((m) => m.latencyMs)
      .filter((ms): ms is number => ms != null && Number.isFinite(ms));
    const avgLatencyMs =
      latencyValues.length > 0
        ? Math.round(
            latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length
          )
        : null;
    return {
      total: filteredMoments.length,
      uniqueModels: models.size,
      avgTokens,
      avgCostUsd,
      avgLatencyMs,
    };
  }, [filteredMoments]);

  const activeBreakdownFilters = useMemo(
    (): Partial<Record<BreakdownDimension, string>> => ({
      ...(categoryFilter !== "all" ? { category: categoryFilter } : {}),
      ...(verdictFilter !== "all" ? { verdict: verdictFilter } : {}),
      ...(datasetFilter !== "all" ? { dataset: datasetFilter } : {}),
      ...(difficultyFilter !== "all" ? { difficulty: difficultyFilter } : {}),
      ...(hallucinationFilter !== "all"
        ? { hallucination: hallucinationFilter }
        : {}),
    }),
    [
      categoryFilter,
      verdictFilter,
      datasetFilter,
      difficultyFilter,
      hallucinationFilter,
    ]
  );

  const handleBreakdownSelect = useCallback(
    (dimension: BreakdownDimension, key: string) => {
      switch (dimension) {
        case "category":
          setCategoryFilter((prev) =>
            prev === key ? "all" : (key as CategoryFilter)
          );
          break;
        case "verdict":
          setVerdictFilter((prev) =>
            prev === key ? "all" : (key as VerdictFilter)
          );
          break;
        case "dataset":
          setDatasetFilter((prev) =>
            prev === key ? "all" : (key as DatasetFilter)
          );
          break;
        case "difficulty":
          setDifficultyFilter((prev) =>
            prev === key ? "all" : (key as DifficultyFilter)
          );
          break;
        case "hallucination":
          setHallucinationFilter((prev) =>
            prev === key ? "all" : (key as HallucinationFilter)
          );
          break;
      }
    },
    []
  );

  const clearDrillFilters = () => {
    setCategoryFilter("all");
    setVerdictFilter("all");
    setDatasetFilter("all");
    setDifficultyFilter("all");
    setHallucinationFilter("all");
    setSearch("");
  };

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

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Filters
          </p>
          {filtersActive ? (
            <button
              type="button"
              onClick={clearDrillFilters}
              className="text-xs text-[var(--accent)] hover:text-[var(--accent-dim)]"
            >
              Clear drill-down
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <FilterSelect
            label="Time"
            value={sinceDaysFilter}
            options={SINCE_OPTIONS}
            optionLabel={sinceLabel}
            onChange={setSinceDaysFilter}
          />
          <FilterSelect
            label="Questions"
            value={questionSourceFilter}
            options={SOURCE_OPTIONS}
            optionLabel={sourceLabel}
            onChange={setQuestionSourceFilter}
          />
          <FilterSelect
            label="Category"
            value={categoryFilter}
            options={["all", ...CATEGORY_OPTIONS] as CategoryFilter[]}
            optionLabel={categoryLabel}
            onChange={setCategoryFilter}
          />
          <FilterSelect
            label="Verdict"
            value={verdictFilter}
            options={["all", ...VERDICT_OPTIONS] as VerdictFilter[]}
            optionLabel={(v) => (v === "all" ? "All" : v)}
            onChange={setVerdictFilter}
          />
          <FilterSelect
            label="Dataset"
            value={datasetFilter}
            options={["all", ...DATASET_OPTIONS] as DatasetFilter[]}
            optionLabel={(v) => (v === "all" ? "All" : DATASET_LABELS[v])}
            onChange={setDatasetFilter}
          />
          <FilterSelect
            label="Difficulty"
            value={difficultyFilter}
            options={["all", ...DIFFICULTY_OPTIONS] as DifficultyFilter[]}
            optionLabel={(v) => (v === "all" ? "All" : DIFFICULTY_LABELS[v])}
            onChange={setDifficultyFilter}
          />
          <FilterSelect
            label="Hallucination"
            value={hallucinationFilter}
            options={HALLUCINATION_OPTIONS}
            optionLabel={hallucinationLabel}
            onChange={setHallucinationFilter}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
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

      <section className="space-y-3 pt-2 border-t border-[var(--border)]">
        <h2 className="text-sm font-medium text-[var(--text)]">
          Eval breakdown
        </h2>
        <EvalSummary
          rows={filteredSummaryRows}
          hallucinationCounts={filteredHallucinationCounts}
          avgCostUsd={stats.avgCostUsd}
          avgTotalTokens={stats.avgTokens}
          activeFilters={activeBreakdownFilters}
          onBreakdownSelect={handleBreakdownSelect}
        />
      </section>
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
