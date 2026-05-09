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

  return {
    kind: "geojson",
    wktKey,
    featureCollection: { type: "FeatureCollection", features },
  };
}

/**
 * Inspect Athena result columns/rows and decide if we can draw a map.
 * Prefers lat/lng points when valid NYC coords exist; otherwise WKT geometries.
 */
export function inferMapData(
  columns: string[],
  rows: Record<string, string | null>[]
): InferredMapData | null {
  if (!columns.length || !rows.length) return null;

  const points = inferPoints(columns, rows);
  if (points) return points;

  return inferGeoJsonFromWkt(columns, rows);
}
