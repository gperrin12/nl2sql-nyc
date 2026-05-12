import { cellToBoundary, getResolution, isValidCell } from "h3-js";
import { wktToGeoJSON } from "@terraformer/wkt";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

export type MapPointRow = {
  lat: number;
  lng: number;
  /** Short popup text from first non-coordinate column */
  label?: string;
};

export type InferredMapData =
  | {
      kind: "points";
      latKey: string;
      lngKey: string;
      points: MapPointRow[];
    }
  | {
      kind: "geojson";
      wktKey: string;
      featureCollection: FeatureCollection;
      /** Column names from row properties that look numeric — choropleth metric picker */
      choroplethKeys: string[];
    }
  | {
      kind: "h3_hex";
      h3Column: string;
      /** Resolution inferred from column name (h3_r9 → 9) or from the first valid cell */
      resolution: number;
      featureCollection: FeatureCollection;
      choroplethKeys: string[];
    };

function normCol(c: string): string {
  return c.trim().toLowerCase().replace(/"/g, "");
}

function parseCoord(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Rough NYC metro box — drops obviously swapped lon/lat exported as strings */
function looksLikeNycLatLon(lat: number, lng: number): boolean {
  return lat >= 40.35 && lat <= 41.05 && lng <= -73.45 && lng >= -74.45;
}

function findLatLngColumns(columns: string[]): { lat: string; lng: string } | null {
  const originals = new Map<string, string>();
  for (const c of columns) {
    originals.set(normCol(c), c);
  }

  const latNames = ["latitude", "lat"];
  const lngNames = ["longitude", "lon", "lng", "long"];

  for (const ln of latNames) {
    const latCol = originals.get(ln);
    if (!latCol) continue;
    for (const gn of lngNames) {
      const lngCol = originals.get(gn);
      if (lngCol && lngCol !== latCol) return { lat: latCol, lng: lngCol };
    }
  }
  return null;
}

const WKT_COLUMN_HINTS = [
  "geometry_wkt",
  "geom_wkt",
  "the_geom",
  "geom",
  "wkt",
  "footprint_wkt",
];

function findWktColumn(columns: string[]): string | null {
  const lowered = columns.map((c) => [c, normCol(c)] as const);

  for (const hint of WKT_COLUMN_HINTS) {
    const hit = lowered.find(([, n]) => n === hint);
    if (hit) return hit[0];
  }

  const fuzzy = lowered.find(
    ([, n]) => n.includes("wkt") || n.endsWith("_geom") || n === "geometry"
  );
  return fuzzy?.[0] ?? null;
}

function sampleLooksLikeWkt(v: string): boolean {
  return /^(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*\(/i.test(
    v.trim()
  );
}

function inferPoints(
  columns: string[],
  rows: Record<string, string | null>[]
): InferredMapData | null {
  const keys = findLatLngColumns(columns);
  if (!keys) return null;

  const points: MapPointRow[] = [];
  const labelCandidates = columns.filter((c) => c !== keys.lat && c !== keys.lng);

  for (const row of rows) {
    const lat = parseCoord(row[keys.lat]);
    const lng = parseCoord(row[keys.lng]);
    if (lat == null || lng == null) continue;
    if (!looksLikeNycLatLon(lat, lng)) continue;

    let label: string | undefined;
    for (const col of labelCandidates) {
      const v = row[col];
      if (v != null && v !== "") {
        const s = v.length > 120 ? `${v.slice(0, 117)}…` : v;
        label = `${col}: ${s}`;
        break;
      }
    }
    points.push({ lat, lng, label });
  }

  if (points.length === 0) return null;

  return {
    kind: "points",
    latKey: keys.lat,
    lngKey: keys.lng,
    points,
  };
}

function parseMaybeNumber(raw: unknown): number | null {
  if (raw == null || typeof raw === "object") return null;
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

const CHORO_KEY_SKIP =
  /^(latitude|longitude|lat|lon|lng|long|geometry|geom|wkt|h3_r\d+)$/i;

function inferChoroplethKeys(features: Feature[]): string[] {
  const stats = new Map<string, { total: number; numeric: number }>();
  const sample = features.slice(0, 80);
  for (const f of sample) {
    const p = f.properties;
    if (!p || typeof p !== "object") continue;
    for (const k of Object.keys(p)) {
      if (CHORO_KEY_SKIP.test(k)) continue;
      const v = p[k];
      const prev = stats.get(k) ?? { total: 0, numeric: 0 };
      prev.total++;
      if (parseMaybeNumber(v) != null) prev.numeric++;
      stats.set(k, prev);
    }
  }
  const keys: string[] = [];
  for (const [k, { total, numeric }] of stats) {
    if (total >= 2 && numeric / total >= 0.45) keys.push(k);
  }
  return keys.sort((a, b) => a.localeCompare(b));
}

function featureCollectionHasArea(fc: FeatureCollection): boolean {
  return fc.features.some((f) => {
    const t = f.geometry?.type;
    return t === "Polygon" || t === "MultiPolygon";
  });
}

export function geoJsonSupportsChoropleth(data: {
  kind: "geojson";
  featureCollection: FeatureCollection;
  choroplethKeys: string[];
}): boolean {
  return (
    featureCollectionHasArea(data.featureCollection) &&
    data.choroplethKeys.length > 0
  );
}

export type PolygonLayerMapData = Extract<
  InferredMapData,
  { kind: "geojson" | "h3_hex" }
>;

export function isPolygonLayerMapData(d: InferredMapData): d is PolygonLayerMapData {
  return d.kind === "geojson" || d.kind === "h3_hex";
}

/** Choropleth is available when we have polygons + at least one numeric attribute (counts, rates, etc.). */
export function polygonMapSupportsChoropleth(d: PolygonLayerMapData): boolean {
  if (d.kind === "h3_hex") return d.choroplethKeys.length > 0;
  return geoJsonSupportsChoropleth(d);
}

function findH3AggregateColumn(columns: string[]): string | null {
  const lowered = new Map(columns.map((c) => [normCol(c), c] as const));
  for (const key of ["h3_r9", "h3_r10", "h3_r8"] as const) {
    const orig = lowered.get(key);
    if (orig) return orig;
  }
  return null;
}

function resolutionFromH3ColumnName(col: string): number | null {
  const m = normCol(col).match(/^h3_r(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function inferH3HexFeatures(
  columns: string[],
  rows: Record<string, string | null>[]
): InferredMapData | null {
  const h3Col = findH3AggregateColumn(columns);
  if (!h3Col) return null;

  const features: Feature[] = [];
  let firstValidCell: string | null = null;

  for (const row of rows) {
    const cell = row[h3Col]?.trim();
    if (!cell || !isValidCell(cell)) continue;

    let ring: [number, number][];
    try {
      ring = cellToBoundary(cell, true) as [number, number][];
    } catch {
      continue;
    }
    if (!ring?.length) continue;

    if (!firstValidCell) firstValidCell = cell;

    const geometry: Geometry = {
      type: "Polygon",
      coordinates: [ring],
    };

    const props: GeoJsonProperties = {};
    for (const col of columns) {
      const v = row[col];
      if (v != null && String(v).length <= 160) props[col] = v;
    }

    features.push({ type: "Feature", geometry, properties: props });
  }

  if (features.length === 0) return null;

  const declaredRes = resolutionFromH3ColumnName(h3Col);
  const resolution =
    declaredRes ??
    (firstValidCell ? getResolution(firstValidCell) : 0);

  const choroplethKeys = inferChoroplethKeys(features);

  return {
    kind: "h3_hex",
    h3Column: h3Col,
    resolution,
    featureCollection: { type: "FeatureCollection", features },
    choroplethKeys,
  };
}

function inferGeoJsonFromWkt(
  columns: string[],
  rows: Record<string, string | null>[]
): InferredMapData | null {
  const wktKey = findWktColumn(columns);
  if (!wktKey) return null;

  const features: Feature[] = [];

  for (const row of rows) {
    const raw = row[wktKey];
    if (raw == null || !sampleLooksLikeWkt(raw)) continue;
    try {
      const geometry = wktToGeoJSON(raw) as Geometry;
      if (!geometry) continue;
      const props: GeoJsonProperties = {};
      for (const col of columns) {
        if (col === wktKey) continue;
        const v = row[col];
        if (v != null && v.length <= 160) props[col] = v;
      }
      features.push({ type: "Feature", geometry, properties: props });
    } catch {
      /* skip malformed WKT */
    }
  }

  if (features.length === 0) return null;

  const choroplethKeys = inferChoroplethKeys(features);

  return {
    kind: "geojson",
    wktKey,
    featureCollection: { type: "FeatureCollection", features },
    choroplethKeys,
  };
}

/**
 * Inspect Athena result columns/rows and decide if we can draw a map.
 * Prefers lat/lng points; then H3 aggregate rows (h3_r8/9/10); else WKT geometries.
 */
export function inferMapData(
  columns: string[],
  rows: Record<string, string | null>[]
): InferredMapData | null {
  if (!columns.length || !rows.length) return null;

  const points = inferPoints(columns, rows);
  if (points) return points;

  const h3hex = inferH3HexFeatures(columns, rows);
  if (h3hex) return h3hex;

  return inferGeoJsonFromWkt(columns, rows);
}
