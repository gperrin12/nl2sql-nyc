"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { MomentsTable } from "@/components/MomentsTable";
import type { DashboardMoment } from "@/lib/p8k8-moments";

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

  const load = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/moments?limit=${PAGE_SIZE}&offset=${nextOffset}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as MomentsResponse & { error?: string; detail?: string };
      if (!res.ok) {
        throw new Error(
          data.detail ? `${data.error ?? "Error"}: ${data.detail}` : (data.error ?? "Failed to load moments")
        );
      }
      setMoments(data.moments);
      setTotal(data.total);
      setOffset(nextOffset);
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
    return {
      total,
      uniqueModels: models.size,
      avgTokens,
    };
  }, [moments, total]);

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <AppNav />

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-[var(--text)]">
          Query Dashboard
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Recent nl2sql-nyc queries via p8k8
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total queries" value={String(stats.total)} />
        <StatCard label="Unique models (page)" value={String(stats.uniqueModels)} />
        <StatCard
          label="Avg tokens (page)"
          value={stats.avgTokens != null ? String(stats.avgTokens) : "—"}
        />
      </div>

      <MomentsTable
        moments={moments}
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
