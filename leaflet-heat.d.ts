import type * as L from "leaflet";

declare module "leaflet" {
  function heatLayer(
    latlngs: L.LatLngTuple[] | [number, number, number][],
    options?: {
      minOpacity?: number;
      maxZoom?: number;
      max?: number;
      radius?: number;
      blur?: number;
      gradient?: Record<number, string>;
    }
  ): L.Layer;
}
