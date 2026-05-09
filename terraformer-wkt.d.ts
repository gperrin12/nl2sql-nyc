declare module "@terraformer/wkt" {
  import type { Geometry } from "geojson";

  export function wktToGeoJSON(input: string): Geometry | null;
  export function geojsonToWKT(geometry: Geometry): string;
}
