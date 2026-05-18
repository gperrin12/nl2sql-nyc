"use client";

import { useMemo, type CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartConfig } from "@/lib/chart/inferChartConfig";
import { formatXTick, sortRowsForChart } from "@/lib/chart/inferChartConfig";

const COLORS = [
  "var(--accent)",
  "#60a5fa",
  "#34d399",
  "#f59e0b",
  "#f472b6",
];

const TOOLTIP_STYLE: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontSize: "12px",
  color: "var(--text)",
};

type Props = {
  config: ChartConfig;
  rows: Record<string, string | null>[];
};

function parseY(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number.parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function buildChartData(
  config: ChartConfig,
  rows: Record<string, string | null>[]
): Record<string, string | number>[] {
  const sorted = sortRowsForChart(config, rows);
  const out: Record<string, string | number>[] = [];

  for (const row of sorted) {
    const xRaw = row[config.xKey];
    if (xRaw == null || String(xRaw).trim() === "") continue;

    const point: Record<string, string | number> = {
      [config.xKey]: String(xRaw),
    };
    let hasY = false;
    for (const yKey of config.yKeys) {
      const n = parseY(row[yKey]);
      if (n != null) {
        point[yKey] = n;
        hasY = true;
      }
    }
    if (hasY) out.push(point);
  }

  return out;
}

function ChartIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[var(--muted)] shrink-0"
      aria-hidden
    >
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

export function ResultsChart({ config, rows }: Props) {
  const data = useMemo(() => buildChartData(config, rows), [config, rows]);

  const rotateTicks = useMemo(
    () => data.some((d) => String(d[config.xKey]).length > 12),
    [data, config.xKey]
  );

  const tickFormatter = (value: string) =>
    formatXTick(String(value), config.xKey);

  const yFormatter = (v: number) =>
    Math.abs(v) >= 1000 ? v.toLocaleString() : String(v);

  if (data.length === 0) return null;

  const subtitle = `${data.length} rows · ${config.xKey} × ${config.yKeys.join(", ")}`;

  const commonAxes = (
    <>
      <CartesianGrid stroke="var(--border)" strokeOpacity={0.3} />
      <XAxis
        dataKey={config.xKey}
        tick={{ fill: "var(--muted)", fontSize: 11 }}
        tickFormatter={tickFormatter}
        angle={rotateTicks ? -45 : 0}
        textAnchor={rotateTicks ? "end" : "middle"}
        height={rotateTicks ? 70 : 30}
        interval={0}
      />
      <YAxis
        tick={{ fill: "var(--muted)", fontSize: 11 }}
        tickFormatter={yFormatter}
        width={56}
      />
      <Tooltip
        contentStyle={TOOLTIP_STYLE}
        labelFormatter={(label) => tickFormatter(String(label))}
        formatter={(value) => [
          typeof value === "number" ? yFormatter(value) : String(value ?? ""),
          "",
        ]}
      />
      {config.yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
    </>
  );

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
        <ChartIcon />
        <span className="text-xs font-medium text-[var(--text)]">Results chart</span>
        <span className="font-mono text-[10px] text-[var(--muted)]">{subtitle}</span>
      </div>
      <div
        className="p-2"
        style={{ height: "min(340px, 45vh)", minHeight: 200 }}
      >
        <ResponsiveContainer width="100%" height={340}>
          {config.chartType === "line" ? (
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              {commonAxes}
              {config.yKeys.map((yKey, i) => (
                <Line
                  key={yKey}
                  type="monotone"
                  dataKey={yKey}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name={yKey}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart
              data={data}
              margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
              barCategoryGap={config.chartType === "grouped-bar" ? "20%" : undefined}
            >
              {commonAxes}
              {config.yKeys.map((yKey, i) => (
                <Bar
                  key={yKey}
                  dataKey={yKey}
                  fill={COLORS[i % COLORS.length]}
                  name={yKey}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
