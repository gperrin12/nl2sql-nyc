"use client";

import dynamic from "next/dynamic";
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
  const mapData = inferMapData(columns, rows);

  return (
    <div className="space-y-4">
      {mapData && <ResultsGeoMap key={mapResetKey} data={mapData} />}
      <ResultsTable
        columns={columns}
        rows={rows}
        scannedBytes={scannedBytes}
        runtimeMs={runtimeMs}
      />
    </div>
  );
}
