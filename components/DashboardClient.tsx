"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { EvalSummary } from "@/components/EvalSummary";
import { MomentsTable } from "@/components/MomentsTable";
import { buildEvalByMomentId } from "@/lib/eval-match";
import type { FullJudgeResult } from "@/lib/judge";
import type { DashboardMoment } from "@/lib/p8k8-moments";
import {
  classifyQuestion,
  type QueryCategory,
} from "@/lib/query-category";
import {
  DATASET_LABELS,
  detectDatasets,
  type QueryDataset,
} from "@/lib/query-dataset";
import { formatLatencyMs } from "@/lib/sql-metrics";

const PAGE_SIZE = 50;

type MomentsResponse = {
  moments: DashboardMoment[];
  total: number;
};

type CategoryFilter = "all" | QueryCategory;
type VerdictFilter = "all" | FullJudgeResult["verdict"];
type DatasetFilter = "all" | QueryDataset;

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

const VERDICT_OPTIONS: FullJudgeResult["verdict"][] = [
  "good",
  "acceptable",
  "poor",
];

const DATASET_OPTIONS: QueryDataset[] = [
  "311",
  "collisions",
  "taxi",
  "census",
  "multi",
  "other",
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
      <span className="text-xs uppercase tracking-wide text-[var(--muted)] shrink-0">
        {label}
      </span>
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
              active
                ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent-dim)]"
            }`}
          >
            {optionLabel(opt)}
          </button>
        );
      })}
    </div>
  );
}

export function DashboardClient() {
  const [moments, setMoments] = useState<DashboardMoment[]>([]);
  const [evals, setEvals] = useState<FullJudgeResult[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");
  const [datasetFilter, setDatasetFilter] = useState<DatasetFilter>("all");
  const [evalByMomentId, setEvalByMomentId] = useState<
    Map<string, FullJudgeResult>
  >(new Map());

  const load = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const [momentsRes, evalsRes] = await Promise.all([
        fetch(
          `/api/dashboard/moments?limit=${PAGE_SIZE}&offset=${nextOffset}`,
          { cache: "no-store" }
        ),
        fetch("/api/dashboard/evals", { cache: "no-store" }),
      ]);

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

      let loadedEvals: FullJudgeResult[] = [];
      if (evalsRes.ok) {
        const raw = (await evalsRes.json()) as unknown;
        if (Array.isArray(raw)) loadedEvals = raw as FullJudgeResult[];
      }
      setMoments(data.moments);
      setEvals(loadedEvals);
      setTotal(data.total);
      setOffset(nextOffset);
      setEvalByMomentId(buildEvalByMomentId(data.moments, loadedEvals));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(0);
  }, [load]);

  const filteredMoments = useMemo(() => {
    return moments.filter((m) => {
      const evalResult = evalByMomentId.get(m.id);
      const category =
        evalResult?.category ?? classifyQuestion(m.question);
      const dataset = detectDatasets(evalResult?.sql ?? m.sql ?? "");

      if (categoryFilter !== "all" && category !== categoryFilter) {
        return false;
      }
      if (verdictFilter !== "all") {
        if (!evalResult || evalResult.verdict !== verdictFilter) return false;
      }
      if (datasetFilter !== "all" && dataset !== datasetFilter) {
        return false;
      }
      return true;
    });
  }, [
    moments,
    evalByMomentId,
    categoryFilter,
    verdictFilter,
    datasetFilter,
  ]);

  const stats = useMemo(() => {
    const models = new Set(
      moments.map((m) => m.model).filter((m): m is string => Boolean(m))
    );
    const tokenValues = moments
      .map((m) => m.tokenCount)
      .filter((t): t is number => t != null && Number.isFinite(t));
    const avgTokens =
      tokenValues.length > 0
        ? Math.round(
            tokenValues.reduce((a, b) => a + b, 0) / tokenValues.length
          )
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
      total,
      uniqueModels: models.size,
      avgTokens,
      avgLatencyMs,
    };
  }, [moments, total]);

  const categoryPillOptions: CategoryFilter[] = ["all", ...CATEGORY_OPTIONS];
  const verdictPillOptions: VerdictFilter[] = ["all", ...VERDICT_OPTIONS];
  const datasetPillOptions: DatasetFilter[] = ["all", ...DATASET_OPTIONS];

  return (
    <main className="max-w-[min(100%,90rem)] mx-auto p-6 space-y-6">
      <AppNav />

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-[var(--text)]">
          Query Dashboard
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Recent nl2sql-nyc queries via p8k8
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total queries" value={String(stats.total)} />
        <StatCard label="Unique models (page)" value={String(stats.uniqueModels)} />
        <StatCard
          label="Avg latency (page)"
          value={formatLatencyMs(stats.avgLatencyMs)}
        />
        <StatCard
          label="Avg tokens (page)"
          value={stats.avgTokens != null ? String(stats.avgTokens) : "—"}
        />
      </div>

      <EvalSummary evals={evals} />

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 space-y-3">
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
      </div>

      <MomentsTable
        moments={filteredMoments}
        evalByMomentId={evalByMomentId}
        loading={loading}
        error={error}
        onRefresh={() => load(offset)}
        search={search}
        onSearchChange={setSearch}
        offset={offset}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={(next) => load(next)}
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
