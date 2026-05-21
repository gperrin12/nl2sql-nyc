/**
 * Infer what the web Results panel would render (map / chart / table).
 * Used by eval replay + result judge — must stay aligned with ResultsPanel.
 */

import { inferChartConfig } from "@/lib/chart/inferChartConfig";
import { inferMapData, type InferredMapData } from "@/lib/geo/inferMapData";
import type { VizType } from "@/lib/viz-infer";

export type UiVizInference = {
  /** Primary viz (map > chart > table), same priority as ResultsPanel emphasis. */
  primary: VizType;
  /** Components the UI actually mounts (table is always included). */
  components: VizType[];
  /** Human-readable summary for the result judge. */
  description: string;
  mapKind?: InferredMapData["kind"];
};

function describeMap(mapData: InferredMapData): string {
  if (mapData.kind === "h3_hex") {
    return `H3 hex choropleth map (${mapData.h3Column}, resolution ${mapData.resolution})`;
  }
  if (mapData.kind === "points") {
    return `point map (${mapData.latKey} / ${mapData.lngKey})`;
  }
  return `polygon choropleth map (${mapData.wktKey})`;
}

/** Mirror ResultsPanel: inferMapData → map, inferChartConfig → chart, always table. */
export function inferUiViz(
  columns: string[],
  rows: Record<string, string | null>[]
): UiVizInference | null {
  if (!columns.length) return null;

  const mapData = inferMapData(columns, rows);
  const chartConfig = inferChartConfig(columns, rows, { hasMap: !!mapData });

  const components: VizType[] = ["table"];
  if (mapData) components.unshift("map");
  if (chartConfig) components.splice(mapData ? 1 : 0, 0, "chart");

  const parts: string[] = [];
  if (mapData) parts.push(describeMap(mapData));
  if (chartConfig) {
    parts.push(
      `${chartConfig.chartType} chart (${chartConfig.xKey} vs ${chartConfig.yKeys.join(", ")})`
    );
  }
  parts.push("results table");

  const description = parts.join(" + ");
  const primary: VizType = mapData ? "map" : chartConfig ? "chart" : "table";

  return {
    primary,
    components: [...new Set(components)],
    description,
    mapKind: mapData?.kind,
  };
}
