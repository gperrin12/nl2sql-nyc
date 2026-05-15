"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { MomentsTable } from "@/components/MomentsTable";
import { evalMatchKey } from "@/lib/eval-match";
import type { JudgeResult } from "@/lib/judge";
import type { DashboardMoment } from "@/lib/p8k8-moments";
import { formatLatencyMs } from "@/lib/sql-metrics";

const PAGE_SIZE = 50;

type MomentsResponse = {
  moments: DashboardMoment[];
  total: number;
};

export function DashboardClient() {
  const [moments, setMoments] = useState<DashboardMoment[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [evalByQuestion, setEvalByQuestion] = useState<
    Map<string, JudgeResult>
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

      let evals: JudgeResult[] = [];
      if (evalsRes.ok) {
        const raw = (await evalsRes.json()) as unknown;
        if (Array.isArray(raw)) evals = raw as JudgeResult[];
      }
      const evalMap = new Map<string, JudgeResult>();
      for (const e of evals) {
        evalMap.set(evalMatchKey(e.question, e.sql), e);
      }

      setMoments(data.moments);
      setTotal(data.total);
      setOffset(nextOffset);
      setEvalByQuestion(evalMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(0);
  }, [load]);

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

      <MomentsTable
        moments={moments}
        evalByQuestion={evalByQuestion}
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
      <p className="text-2xl font-semibold text-[var(--text)] tabular-nums">
        {value}
      </p>
    </div>
  );
}
