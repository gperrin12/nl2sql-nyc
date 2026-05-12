"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  GeoJSON as GeoJSONLayer,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { Feature, FeatureCollection } from "geojson";
import type { GeoJsonProperties } from "geojson";
import type { LatLngExpression, PathOptions } from "leaflet";
import L from "leaflet";
import type { InferredMapData, MapPointRow } from "@/lib/geo/inferMapData";
import { geoJsonSupportsChoropleth } from "@/lib/geo/inferMapData";

import "leaflet/dist/leaflet.css";
import "leaflet.heat";

function useLeafletIconFix() {
  useEffect(() => {
    delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
      iconUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
      shadowUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
    });
  }, []);
}

const NYC_CENTER: LatLngExpression = [40.7128, -74.006];
const DEFAULT_ZOOM = 11;

function BasemapTileLayer() {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();

  if (token) {
    return (
      <TileLayer
        attribution='© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/512/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(token)}`}
        tileSize={512}
        zoomOffset={-1}
        maxZoom={22}
      />
    );
  }

  return (
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      subdomains="abcd"
      maxZoom={20}
    />
  );
}

function FitPointsBounds({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 13);
      return;
    }
    const b = L.latLngBounds(points.map((p) => [p.lat, p.lng] as LatLngExpression));
    map.fitBounds(b, { padding: [28, 28], maxZoom: 15 });
  }, [map, points]);
  return null;
}

function HeatLayerCanvas({ points }: { points: MapPointRow[] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    const latlngs = points.map((p) => [p.lat, p.lng] as L.LatLngTuple);
    const layer = L.heatLayer(latlngs, {
      radius: 26,
      blur: 22,
      maxZoom: 17,
      gradient: {
        0.35: "#0f172a",
        0.5: "#134e4a",
        0.65: "#0d9488",
        0.82: "#4fd1c5",
        1: "#fef08a",
      },
    });
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, points]);

  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bindPropsPopup(feature: Feature, layer: L.Layer) {
  const p = feature.properties;
  if (!p || typeof p !== "object") return;
  const entries = Object.entries(p).filter(([, v]) => v != null && String(v) !== "");
  if (entries.length === 0) return;
  const text = entries.map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`).join("\n");
  layer.bindPopup(
    `<pre style="margin:0;font-size:11px;white-space:pre-wrap;max-width:280px">${escapeHtml(
      text
    )}</pre>`
  );
}

function OutlineGeoJsonLayer({ fc }: { fc: FeatureCollection }) {
  const map = useMap();
  return (
    <GeoJSONLayer
      data={fc}
      style={{
        color: "#4fd1c5",
        weight: 2,
        fillColor: "#4fd1c5",
        fillOpacity: 0.12,
      }}
      eventHandlers={{
        add: (e) => {
          const layer = e.target as L.GeoJSON;
          const bounds = layer.getBounds?.();
          if (bounds?.isValid?.()) {
            map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
          }
        },
      }}
      onEachFeature={(feature, layer) => bindPropsPopup(feature, layer)}
    />
  );
}

function parsePropNumber(props: GeoJsonProperties | null | undefined, key: string): number | null {
  if (!props || typeof props !== "object") return null;
  const raw = props[key];
  if (raw == null || typeof raw === "object") return null;
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function choroplethColor(t: number): string {
  const r = Math.round(12 + t * 230);
  const g = Math.round(65 + t * 190);
  const b = Math.round(95 + t * 120);
  return `rgb(${r},${g},${b})`;
}

function ChoroplethGeoJsonLayer({
  fc,
  metricKey,
}: {
  fc: FeatureCollection;
  metricKey: string;
}) {
  const map = useMap();

  const { min, max } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const f of fc.features) {
      const v = parsePropNumber(f.properties, metricKey);
      if (v == null) continue;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (!Number.isFinite(lo)) return { min: 0, max: 1 };
    return { min: lo, max: hi };
  }, [fc, metricKey]);

  const styleFn = (feat?: Feature): PathOptions => {
    if (!feat) {
      return { fillColor: "#1e293b", fillOpacity: 0.2, color: "#334155", weight: 1 };
    }
    const v = parsePropNumber(feat.properties, metricKey);
    if (v == null) {
      return {
        fillColor: "#1e293b",
        fillOpacity: 0.2,
        color: "#334155",
        weight: 1,
      };
    }
    const t = max === min ? 0.5 : (v - min) / (max - min);
    return {
      fillColor: choroplethColor(Math.min(1, Math.max(0, t))),
      fillOpacity: 0.72,
      color: "#0f172a",
      weight: 1,
    };
  };

  return (
    <GeoJSONLayer
      key={`choro-${metricKey}`}
      data={fc}
      style={styleFn}
      eventHandlers={{
        add: (e) => {
          const layer = e.target as L.GeoJSON;
          const bounds = layer.getBounds?.();
          if (bounds?.isValid?.()) {
            map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
          }
        },
      }}
      onEachFeature={(feature, layer) => bindPropsPopup(feature, layer)}
    />
  );
}

function ChoroplethLegend({
  metricKey,
  min,
  max,
}: {
  metricKey: string;
  min: number;
  max: number;
}) {
  const fmt = (n: number) =>
    Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : n.toFixed(2);
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    t,
    color: choroplethColor(t),
  }));
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-[1000] rounded border border-[var(--border)] bg-[var(--panel)]/95 px-3 py-2 text-[10px] shadow-lg backdrop-blur-sm max-w-[200px]">
      <p className="font-medium text-[var(--text)] mb-1 truncate" title={metricKey}>
        {metricKey}
      </p>
      <div className="flex h-2 rounded overflow-hidden mb-1 border border-[var(--border)]">
        {stops.map((s, i) => (
          <div key={i} className="flex-1" style={{ backgroundColor: s.color }} />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[var(--muted)]">
        <span>{fmt(min)}</span>
        <span>{fmt(max)}</span>
      </div>
    </div>
  );
}

type PointDisplayMode = "markers" | "heat";
type GeoDisplayMode = "outline" | "choropleth";

type Props = {
  data: InferredMapData;
};

export function ResultsGeoMap({ data }: Props) {
  useLeafletIconFix();

  const [pointMode, setPointMode] = useState<PointDisplayMode>("markers");
  const [geoMode, setGeoMode] = useState<GeoDisplayMode>("outline");
  const [choroplethMetric, setChoroplethMetric] = useState<string>(() =>
    data.kind === "geojson" ? data.choroplethKeys[0] ?? "" : ""
  );

  useEffect(() => {
    if (data.kind === "geojson") {
      setGeoMode("outline");
      setChoroplethMetric(data.choroplethKeys[0] ?? "");
    } else {
      setPointMode("markers");
    }
  }, [data]);

  const subtitle =
    data.kind === "points"
      ? `${data.points.length} pts · ${data.latKey} / ${data.lngKey}`
      : `${data.featureCollection.features.length} geom · ${data.wktKey}`;

  const supportsChoro =
    data.kind === "geojson" && geoJsonSupportsChoropleth(data);

  const choroplethRange = useMemo(() => {
    if (data.kind !== "geojson" || !choroplethMetric) return { min: 0, max: 1 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const f of data.featureCollection.features) {
      const v = parsePropNumber(f.properties, choroplethMetric);
      if (v == null) continue;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (!Number.isFinite(lo)) return { min: 0, max: 1 };
    return { min: lo, max: hi };
  }, [data, choroplethMetric]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      <div className="flex flex-col gap-2 px-3 py-2 border-b border-[var(--border)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--text)]">Map</span>
          <span className="font-mono text-[10px] text-[var(--muted)]">{subtitle}</span>
        </div>

        {data.kind === "points" && data.points.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase text-[var(--muted)]">Points</span>
            <MapModeButton
              active={pointMode === "markers"}
              onClick={() => setPointMode("markers")}
              label="Markers"
            />
            <MapModeButton
              active={pointMode === "heat"}
              onClick={() => setPointMode("heat")}
              label="Heat map"
            />
          </div>
        )}

        {data.kind === "geojson" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase text-[var(--muted)]">Areas</span>
            <MapModeButton
              active={geoMode === "outline"}
              onClick={() => setGeoMode("outline")}
              label="Outline"
            />
            <MapModeButton
              active={geoMode === "choropleth"}
              onClick={() => supportsChoro && setGeoMode("choropleth")}
              label="Choropleth"
              disabled={!supportsChoro}
              title={
                supportsChoro
                  ? undefined
                  : "Needs polygon/multipolygon geometries and numeric columns in the result"
              }
            />
            {supportsChoro && geoMode === "choropleth" && data.choroplethKeys.length > 0 && (
              <select
                value={choroplethMetric}
                onChange={(e) => setChoroplethMetric(e.target.value)}
                className="pointer-events-auto rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px] font-mono text-[var(--text)] max-w-[160px]"
              >
                {data.choroplethKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      <div className="relative h-[min(420px,55vh)] w-full [&_.leaflet-container]:h-full [&_.leaflet-container]:w-full [&_.leaflet-container]:bg-[#1a1d24]">
        <MapContainer
          center={NYC_CENTER}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom
          className="h-full w-full"
        >
          <BasemapTileLayer />
          {data.kind === "points" && (
            <>
              <FitPointsBounds points={data.points} />
              {pointMode === "heat" ? (
                <HeatLayerCanvas points={data.points} />
              ) : (
                data.points.map((p, i) => (
                  <CircleMarker
                    key={`${p.lat.toFixed(5)},${p.lng.toFixed(5)},${i}`}
                    center={[p.lat, p.lng]}
                    radius={6}
                    pathOptions={{
                      color: "#4fd1c5",
                      fillColor: "#4fd1c5",
                      fillOpacity: 0.55,
                      weight: 1,
                    }}
                  >
                    {p.label && (
                      <Popup className="[&_.leaflet-popup-content-wrapper]:bg-[#181b22] [&_.leaflet-popup-content-wrapper]:text-[var(--text)] [&_.leaflet-popup-tip]:bg-[#181b22]">
                        <div className="text-xs font-mono max-w-xs whitespace-pre-wrap">
                          {p.label}
                        </div>
                      </Popup>
                    )}
                  </CircleMarker>
                ))
              )}
            </>
          )}
          {data.kind === "geojson" &&
            (geoMode === "choropleth" && supportsChoro && choroplethMetric ? (
              <ChoroplethGeoJsonLayer fc={data.featureCollection} metricKey={choroplethMetric} />
            ) : (
              <OutlineGeoJsonLayer fc={data.featureCollection} />
            ))}
        </MapContainer>

        {data.kind === "geojson" &&
          geoMode === "choropleth" &&
          supportsChoro &&
          choroplethMetric && (
            <ChoroplethLegend
              metricKey={choroplethMetric}
              min={choroplethRange.min}
              max={choroplethRange.max}
            />
          )}
      </div>
    </div>
  );
}

function MapModeButton({
  active,
  onClick,
  label,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
        disabled
          ? "opacity-35 cursor-not-allowed text-[var(--muted)]"
          : active
            ? "bg-[var(--accent)] text-black"
            : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
      }`}
    >
      {label}
    </button>
  );
}
