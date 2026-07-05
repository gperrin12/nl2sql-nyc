"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppNav } from "@/components/AppNav";
import { CrtWelcome } from "@/components/CrtWelcome";
import { DashboardSubnav } from "@/components/DashboardSubnav";
import {
  getTriviaCategoryById,
  TRIVIA_DECK_LABELS,
  type TriviaDeck,
} from "@/lib/trivia-categories";

type TriviaSummary = {
  total_generations: number;
  succeeded: number;
  failed: number;
  total_cost_usd: number;
  total_tokens: string | number;
  avg_attempts: number | null;
  avg_cost_per_question: number | null;
};

type TriviaCostTrendRow = {
  day: string;
  query_count: number;
  total_cost_usd: number;
  avg_attempts: number | null;
};

type TriviaCategoryRow = {
  category: string;
  deck: string;
  query_count: number;
  succeeded: number;
  total_cost_usd: number;
  avg_attempts: number | null;
};

type TriviaModeRow = {
  mode: string;
  query_count: number;
  succeeded: number;
  total_cost_usd: number;
  avg_attempts: number | null;
};

type TriviaRunRow = {
  id: string;
  created_at: string;
  question: string;
  sql: string | null;
  backend: string | null;
  trivia_category: string | null;
  trivia_deck: string | null;
  generation_attempts: number | null;
  athena_state: string | null;
  error_reason: string | null;
  model: string | null;
  tokens_used: { input: number; output: number; total: number } | null;
  cost_usd: number | null;
  scanned_bytes: string | null;
  runtime_ms: number | null;
};

type TriviaDashboardMetrics = {
  summary: TriviaSummary;
  costTrend: TriviaCostTrendRow[];
  byCategory: TriviaCategoryRow[];
  byMode: TriviaModeRow[];
  recentRuns: TriviaRunRow[];
};

const TOOLTIP_STYLE: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontSize: "12px",
  color: "var(--text)",
};

function formatDayLabel(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatUsd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function modeLabel(mode: string): string {
  if (mode === "trivia-solo") return "Solo";
  if (mode === "trivia-room") return "Room";
  return mode;
}

function categoryLabel(categoryId: string): string {
  const def = getTriviaCategoryById(categoryId);
  return def?.label ?? categoryId;
}

function deckLabel(deck: string): string {
  return TRIVIA_DECK_LABELS[deck as TriviaDeck] ?? deck;
}

export function TriviaDashboardClient() {
  const [metrics, setMetrics] = useState<TriviaDashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/trivia", { cache: "no-store" });
      const data = (await res.json()) as TriviaDashboardMetrics & {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(
          data.detail
            ? `${data.error ?? "Error"}: ${data.detail}`
            : (data.error ?? "Failed to load trivia dashboard metrics")
        );
      }
      setMetrics(data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load trivia dashboard metrics"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const costData = useMemo(
    () =>
      (metrics?.costTrend ?? []).map((row) => ({
        ...row,
        dayLabel: formatDayLabel(row.day),
      })),
    [metrics?.costTrend]
  );

  const categoryData = useMemo(
    () =>
      (metrics?.byCategory ?? []).map((row) => ({
        ...row,
        label: categoryLabel(row.category),
        successRate:
          row.query_count > 0 ? (100 * row.succeeded) / row.query_count : 0,
      })),
    [metrics?.byCategory]
  );

  const summary = metrics?.summary;
  const successRate =
    summary && summary.total_generations > 0
      ? (100 * summary.succeeded) / summary.total_generations
      : null;

  return (
    <main className="crt-root max-w-[min(100%,90rem)] mx-auto p-6 space-y-6">
      <AppNav />

      <CrtWelcome>
        <p className="text-[var(--muted)] text-sm">
          trivia dashboard :: generation spend · verification success · category
          mix from{" "}
          <span className="font-mono text-[var(--text)]/80">
            nl2sql.query_runs
          </span>{" "}
          (backend LIKE &apos;trivia%&apos;)
        </p>
      </CrtWelcome>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-[var(--text)]">
            Trivia
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Every generate+verify attempt is one row here — includes rejected
            questions that never reached a player.
          </p>
        </div>
        <DashboardSubnav />
      </header>

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading metrics…</p>
      ) : error ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 space-y-2">
          <p className="text-sm text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs text-[var(--accent)] hover:text-[var(--accent-dim)]"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard
              label="Total spend"
              value={summary ? formatUsd(summary.total_cost_usd) : "—"}
            />
            <StatCard
              label="Questions generated"
              value={summary ? String(summary.total_generations) : "—"}
            />
            <StatCard
              label="Verification success"
              value={successRate != null ? `${successRate.toFixed(0)}%` : "—"}
            />
            <StatCard
              label="Avg attempts / question"
              value={
                summary?.avg_attempts != null
                  ? summary.avg_attempts.toFixed(1)
                  : "—"
              }
            />
            <StatCard
              label="Avg cost / question"
              value={
                summary?.avg_cost_per_question != null
                  ? formatUsd(summary.avg_cost_per_question)
                  : "—"
              }
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <h2 className="text-sm font-medium text-[var(--text)]">
                  Trivia spend
                </h2>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  Last 30 days · daily total USD (all attempts, solo + room)
                </p>
              </div>
              <div className="p-3" style={{ height: "min(320px, 42vh)", minHeight: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={costData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="var(--border)" strokeOpacity={0.3} />
                    <XAxis
                      dataKey="day"
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      tickFormatter={(v) => formatDayLabel(String(v))}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      tickFormatter={(v) => formatUsd(Number(v))}
                      width={56}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelFormatter={(label) => formatDayLabel(String(label))}
                      formatter={(value, name) => {
                        if (name === "avg_attempts") {
                          return [Number(value).toFixed(1), "Avg attempts"];
                        }
                        return [formatUsd(Number(value)), "Total cost"];
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="total_cost_usd"
                      name="Total cost"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <h2 className="text-sm font-medium text-[var(--text)]">
                  Spend by category
                </h2>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  All-time · which categories cost the most (often the ones
                  that retry the most)
                </p>
              </div>
              <div className="p-3" style={{ height: "min(320px, 42vh)", minHeight: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={categoryData}
                    layout="vertical"
                    margin={{ top: 8, right: 24, left: 8, bottom: 4 }}
                  >
                    <CartesianGrid stroke="var(--border)" strokeOpacity={0.3} />
                    <XAxis
                      type="number"
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      tickFormatter={(v) => formatUsd(Number(v))}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tick={{ fill: "var(--muted)", fontSize: 10 }}
                      width={150}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(value, _name, item) => {
                        const row = item.payload as (typeof categoryData)[number];
                        return [
                          `${formatUsd(Number(value))} · ${row.successRate.toFixed(0)}% verified · avg ${row.avg_attempts?.toFixed(1) ?? "—"} attempts`,
                          row.label,
                        ];
                      }}
                    />
                    <Bar
                      dataKey="total_cost_usd"
                      name="Total cost"
                      fill="var(--accent)"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-[var(--text)]">
                  Solo vs room
                </h2>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  All-time · room creation fans out many generations in
                  parallel, so it usually dominates spend
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
              {(metrics?.byMode ?? []).map((row) => (
                <div key={row.mode} className="px-4 py-3 space-y-1">
                  <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                    {modeLabel(row.mode)}
                  </p>
                  <p className="text-lg font-semibold text-[var(--text)]">
                    {formatUsd(row.total_cost_usd)}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {row.query_count} generations ·{" "}
                    {row.query_count > 0
                      ? `${((100 * row.succeeded) / row.query_count).toFixed(0)}%`
                      : "—"}{" "}
                    verified · avg {row.avg_attempts?.toFixed(1) ?? "—"} attempts
                  </p>
                </div>
              ))}
              {!metrics?.byMode?.length ? (
                <div className="px-4 py-3 text-sm text-[var(--muted)]">
                  No trivia generations logged yet.
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h2 className="text-sm font-medium text-[var(--text)]">
                Recent generations
              </h2>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Latest 100 attempts · what was actually asked/queried, success
                or failure, cost, and reason for rejection
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 font-medium">Mode</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Question</th>
                    <th className="px-3 py-2 font-medium">State</th>
                    <th className="px-3 py-2 font-medium">Attempts</th>
                    <th className="px-3 py-2 font-medium">Tokens</th>
                    <th className="px-3 py-2 font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(metrics?.recentRuns ?? []).map((run) => {
                    const tokens = run.tokens_used;
                    const cost = run.cost_usd;
                    const succeeded = run.athena_state === "SUCCEEDED";
                    return (
                      <tr
                        key={run.id}
                        className="border-b border-[var(--border)]/60 align-top"
                        title={
                          !succeeded && run.error_reason
                            ? run.error_reason
                            : undefined
                        }
                      >
                        <td className="px-3 py-2 whitespace-nowrap text-[var(--muted)]">
                          {new Date(run.created_at).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {run.backend ? modeLabel(run.backend) : "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {run.trivia_deck ? deckLabel(run.trivia_deck) : "—"}
                          {run.trivia_category ? (
                            <span className="block text-[10px] text-[var(--muted)]">
                              {categoryLabel(run.trivia_category)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 max-w-md">
                          <span className="line-clamp-2 text-[var(--text)]">
                            {run.question}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            className={
                              succeeded
                                ? "text-emerald-400"
                                : "text-red-400"
                            }
                          >
                            {succeeded ? "Verified" : "Rejected"}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-[var(--muted)]">
                          {run.generation_attempts ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-[var(--muted)]">
                          {tokens ? tokens.total.toLocaleString() : "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-[var(--muted)]">
                          {cost != null ? formatUsd(cost) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {!metrics?.recentRuns?.length ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-6 text-center text-[var(--muted)]"
                      >
                        No trivia generations logged yet — play a round or
                        create a room to see data here.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
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
