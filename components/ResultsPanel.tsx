"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { inferChartConfig } from "@/lib/chart/inferChartConfig";
import { inferMapData } from "@/lib/geo/inferMapData";
import { ResultsTable } from "@/components/ResultsTable";

const ResultsGeoMap = dynamic(
  () =>
    import("@/components/ResultsGeoMap").then((m) => ({
      default: m.ResultsGeoMap,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] h-[min(420px,55vh)] flex items-center justify-center text-xs text-[var(--muted)]">
        Loading map…
      </div>
    ),
  }
);

const ResultsChart = dynamic(
  () =>
    import("@/components/ResultsChart").then((m) => ({
      default: m.ResultsChart,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] h-[min(340px,45vh)] flex items-center justify-center text-xs text-[var(--muted)]">
        Loading chart…
      </div>
    ),
  }
);

type Props = {
  /** Remount the Leaflet map when a new Athena execution completes */
  mapResetKey: string;
  columns: string[];
  rows: Record<string, string | null>[];
  scannedBytes: number;
  runtimeMs: number;
};

export function ResultsPanel({
  mapResetKey,
  columns,
  rows,
  scannedBytes,
  runtimeMs,
}: Props) {
  const mapData = useMemo(() => inferMapData(columns, rows), [columns, rows]);
  const chartConfig = useMemo(
    () => inferChartConfig(columns, rows, { hasMap: !!mapData }),
    [columns, rows, mapData]
  );

  return (
    <div className="space-y-4">
      {mapData && <ResultsGeoMap key={mapResetKey} data={mapData} />}
      {chartConfig && <ResultsChart config={chartConfig} rows={rows} />}
      <ResultsTable
        columns={columns}
        rows={rows}
        scannedBytes={scannedBytes}
        runtimeMs={runtimeMs}
      />
    </div>
  );
}
