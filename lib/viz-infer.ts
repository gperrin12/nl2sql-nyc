export type VizType = "map" | "chart" | "table";

export function inferVizType(columns: string[]): VizType {
  const cols = columns.map((c) => c.toLowerCase());

  const hasLatLon =
    (cols.some((c) => c === "latitude" || c === "lat") &&
      cols.some(
        (c) => c === "longitude" || c === "lon" || c === "lng" || c === "long"
      )) ||
    cols.some((c) => c.includes("geometry_wkt") || c.includes("wkt"));
  if (hasLatLon) return "map";

  const hasTimeDim = cols.some(
    (c) =>
      c === "year" ||
      c === "month" ||
      c === "date" ||
      c === "week" ||
      c.includes("_date")
  );
  const hasCatDim = cols.some(
    (c) =>
      c === "borough" ||
      c === "category" ||
      c === "type" ||
      c === "complaint_type" ||
      c === "neighborhood" ||
      c === "ntaname" ||
      c === "zone"
  );
  const hasMetric = cols.some(
    (c) =>
      c.includes("count") ||
      c.includes("total") ||
      c.includes("avg") ||
      c.includes("sum") ||
      c.includes("rate") ||
      c.includes("pct") ||
      c.includes("per_capita") ||
      c.includes("complaints") ||
      c.includes("trips")
  );
  if (hasMetric && (hasTimeDim || hasCatDim)) return "chart";

  return "table";
}
