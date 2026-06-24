"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppNav } from "@/components/AppNav";
import { DashboardSubnav } from "@/components/DashboardSubnav";
import { formatLatencyMs } from "@/lib/sql-metrics";

type CostTrendRow = {
  day: string;
  query_count: number;
  total_cost_usd: number;
  avg_cost_usd: number | null;
};

type LatencyRow = {
  day: string;
  sample_count: number;
  p50_ms: number | null;
  p95_ms: number | null;
};

type ErrorRateRow = {
  category: string;
  count: number;
  pct: number;
};

type ScoreTrendRow = {
  day: string;
  judged_count: number;
  avg_score: number | null;
  min_score: number | null;
  max_score: number | null;
};

type RoutingRow = {
  route: string;
  count: number;
  pct: number;
};

type DashboardMetrics = {
  costTrend: CostTrendRow[];
  latency: LatencyRow[];
  errorRates: ErrorRateRow[];
  scoreTrend: ScoreTrendRow[];
  routing: RoutingRow[];
};

const COLORS = [
  "var(--accent)",
  "#60a5fa",
  "#34d399",
  "#f59e0b",
  "#f472b6",
  "#a78bfa",
];

const TOOLTIP_STYLE: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontSize: "12px",
  color: "var(--text)",
};

const ERROR_CATEGORY_LABELS: Record<string, string> = {
  success: "Success",
  athena_failed: "Athena failed",
  blocked: "Blocked",
  running: "Running",
  off_topic: "Off topic",
  guardrail_blocked: "Guardrail blocked",
  no_sql_produced: "No SQL",
  schema_hallucination: "Schema hallucination",
  unknown: "Unknown",
};

function formatDayLabel(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCategoryLabel(category: string): string {
  return ERROR_CATEGORY_LABELS[category] ?? category.replace(/_/g, " ");
}

function formatUsd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h2 className="text-sm font-medium text-[var(--text)]">{title}</h2>
        {subtitle ? (
          <p className="text-xs text-[var(--muted)] mt-0.5">{subtitle}</p>
        ) : null}
      </div>
      <div className="p-3" style={{ height: "min(320px, 42vh)", minHeight: 220 }}>
        {children}
      </div>
    </section>
  );
}

export function DashboardChartsClient() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      const data = (await res.json()) as DashboardMetrics & {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(
          data.detail
            ? `${data.error ?? "Error"}: ${data.detail}`
            : (data.error ?? "Failed to load dashboard metrics")
        );
      }
      setMetrics(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard metrics");
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

  const latencyData = useMemo(
    () =>
      (metrics?.latency ?? []).map((row) => ({
        ...row,
        dayLabel: formatDayLabel(row.day),
      })),
    [metrics?.latency]
  );

  const scoreData = useMemo(
    () =>
      (metrics?.scoreTrend ?? []).map((row) => ({
        ...row,
        dayLabel: formatDayLabel(row.day),
      })),
    [metrics?.scoreTrend]
  );

  const errorData = useMemo(
    () =>
      (metrics?.errorRates ?? []).map((row) => ({
        ...row,
        label: formatCategoryLabel(row.category),
      })),
    [metrics?.errorRates]
  );

  const routingData = metrics?.routing ?? [];

  const axisDayProps = {
    tick: { fill: "var(--muted)", fontSize: 11 },
    tickFormatter: (value: string) => formatDayLabel(String(value)),
    interval: "preserveStartEnd" as const,
  };

  return (
    <main className="max-w-[min(100%,90rem)] mx-auto p-6 space-y-6">
      <AppNav />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-[var(--text)]">
            Eval Dashboard
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Operational metrics from{" "}
            <span className="font-mono text-[var(--foreground)]">
              nl2sql.query_runs
            </span>{" "}
            and{" "}
            <span className="font-mono text-[var(--foreground)]">
              nl2sql.routing_log
            </span>
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
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ChartCard title="Total cost" subtitle="Last 30 days · daily sum USD">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={costData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.3} />
                <XAxis dataKey="day" {...axisDayProps} />
                <YAxis
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  tickFormatter={(v) => formatUsd(Number(v))}
                  width={56}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(label) => formatDayLabel(String(label))}
                  formatter={(value) => [formatUsd(Number(value)), "Total cost"]}
                />
                <Line
                  type="monotone"
                  dataKey="total_cost_usd"
                  name="Total cost"
                  stroke={COLORS[0]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Average cost per query" subtitle="Last 30 days · daily avg USD">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={costData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.3} />
                <XAxis dataKey="day" {...axisDayProps} />
                <YAxis
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  tickFormatter={(v) => formatUsd(Number(v))}
                  width={56}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(label) => formatDayLabel(String(label))}
                  formatter={(value) => [formatUsd(Number(value)), "Avg cost"]}
                />
                <Line
                  type="monotone"
                  dataKey="avg_cost_usd"
                  name="Avg cost"
                  stroke={COLORS[1]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Latency" subtitle="Last 30 days · Athena runtime p50 / p95">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={latencyData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.3} />
                <XAxis dataKey="day" {...axisDayProps} />
                <YAxis
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  tickFormatter={(v) => formatLatencyMs(Number(v))}
                  width={56}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(label) => formatDayLabel(String(label))}
                  formatter={(value, name) => [
                    formatLatencyMs(Number(value)),
                    name === "p50_ms" ? "p50" : "p95",
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="p50_ms"
                  name="p50"
                  stroke={COLORS[0]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="p95_ms"
                  name="p95"
                  stroke={COLORS[2]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Eval score trend" subtitle="Last 30 days · daily avg judge score (1–5)">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={scoreData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.3} />
                <XAxis dataKey="day" {...axisDayProps} />
                <YAxis
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  domain={[1, 5]}
                  ticks={[1, 2, 3, 4, 5]}
                  width={40}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(label) => formatDayLabel(String(label))}
                  formatter={(value, name) => {
                    if (name === "avg_score") {
                      return [`${Number(value).toFixed(2)}/5`, "Avg score"];
                    }
                    if (name === "judged_count") {
                      return [String(value), "Judged runs"];
                    }
                    return [String(value ?? ""), String(name)];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="avg_score"
                  name="Avg score"
                  stroke={COLORS[0]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Error rates" subtitle="Last 7 days · share of all runs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={errorData} margin={{ top: 8, right: 12, left: 0, bottom: 48 }}>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.3} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--muted)", fontSize: 10 }}
                  angle={-30}
                  textAnchor="end"
                  height={70}
                  interval={0}
                />
                <YAxis
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  tickFormatter={(v) => `${v}%`}
                  width={44}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value, _name, item) => {
                    const row = item.payload as ErrorRateRow & { label: string };
                    return [`${Number(value).toFixed(1)}% (${row.count} runs)`, row.label];
                  }}
                />
                <Bar dataKey="pct" name="Share" fill={COLORS[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden xl:col-span-2 max-w-2xl xl:max-w-xl xl:mx-auto xl:w-full">
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h2 className="text-sm font-medium text-[var(--text)]">
                Routing distribution
              </h2>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Last 7 days · SQL / RAG / HYBRID
              </p>
            </div>
            <div
              className="p-3"
              style={{ height: "min(320px, 42vh)", minHeight: 220 }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={routingData}
                    dataKey="count"
                    nameKey="route"
                    cx="50%"
                    cy="50%"
                    outerRadius="70%"
                    label={(props) => {
                      const row = props.payload as RoutingRow | undefined;
                      if (!row) return "";
                      return `${row.route} (${row.pct}%)`;
                    }}
                    labelLine={{ stroke: "var(--muted)" }}
                  >
                    {routingData.map((entry, index) => (
                      <Cell
                        key={entry.route}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value, _name, item) => {
                      const row = item.payload as RoutingRow;
                      return [`${row.count} (${row.pct}%)`, row.route];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
