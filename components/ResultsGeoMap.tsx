"use client";

import { useEffect } from "react";
import {
  CircleMarker,
  GeoJSON as GeoJSONLayer,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { FeatureCollection } from "geojson";
import type { LatLngExpression } from "leaflet";
import L from "leaflet";
import type { InferredMapData } from "@/lib/geo/inferMapData";

import "leaflet/dist/leaflet.css";

/** Fix default marker asset paths under bundlers (not used for CircleMarker-only maps). */
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

function FitGeoJsonBounds({ fc }: { fc: FeatureCollection }) {
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
      onEachFeature={(feature, layer) => {
        const p = feature.properties;
        if (!p || typeof p !== "object") return;
        const entries = Object.entries(p).filter(([, v]) => v != null && String(v) !== "");
        if (entries.length === 0) return;
        const text = entries
          .map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`)
          .join("\n");
        layer.bindPopup(
          `<pre style="margin:0;font-size:11px;white-space:pre-wrap;max-width:280px">${escapeHtml(
            text
          )}</pre>`
        );
      }}
    />
  );
}

type Props = {
  data: InferredMapData;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function ResultsGeoMap({ data }: Props) {
  useLeafletIconFix();

  const subtitle =
    data.kind === "points"
      ? `Points from ${data.latKey} / ${data.lngKey} (${data.points.length})`
      : `Geometries from ${data.wktKey} (${data.featureCollection.features.length})`;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] text-xs text-[var(--muted)]">
        <span className="font-medium text-[var(--text)]">Map</span>
        <span className="font-mono">{subtitle}</span>
      </div>
      <div className="h-[min(420px,55vh)] w-full [&_.leaflet-container]:h-full [&_.leaflet-container]:w-full [&_.leaflet-container]:bg-[#1a1d24]">
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
              {data.points.map((p, i) => (
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
              ))}
            </>
          )}
          {data.kind === "geojson" && <FitGeoJsonBounds fc={data.featureCollection} />}
        </MapContainer>
      </div>
    </div>
  );
}
