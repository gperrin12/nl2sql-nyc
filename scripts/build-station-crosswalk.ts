/**
 * Build data/station-crosswalk.json: station → tract/neighborhood/line crosswalk.
 *
 * Usage (reads .env / .env.local):
 *   npx tsx scripts/build-station-crosswalk.ts
 *
 * Env: ATHENA_OUTPUT_LOCATION, AWS credentials, ATHENA_DATABASE (optional)
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "../lib/load-env-file";

loadEnvFile();

import { startQuery } from "../lib/athena";
import { waitForAthenaResults } from "../lib/athena-wait";

// MTA Subway Stations dataset (data.ny.gov). VERIFY resource id + field names before running;
// Socrata schemas drift. Expected fields: complex_id, daytime_routes, stop_name.
const MTA_STATIONS_URL =
  "https://data.ny.gov/resource/39hk-dx4f.json?$select=complex_id,daytime_routes,stop_name&$limit=5000";

const TRACT_ASSIGN_SQL = `
WITH stn AS (
  SELECT station_complex_id,
         MIN(station_complex) AS station_complex,
         AVG(latitude)  AS lat,
         AVG(longitude) AS lon
  FROM mta_turnstile
  WHERE year = '2025'
    AND latitude  IS NOT NULL
    AND longitude IS NOT NULL
  GROUP BY station_complex_id
)
SELECT stn.station_complex_id,
       stn.station_complex,
       ct.geoid,
       ct.ntaname,
       ct.boroname
FROM stn
JOIN census_tracts ct
  ON ST_CONTAINS(ST_GEOMETRY_FROM_TEXT(ct.geometry_wkt), ST_Point(stn.lon, stn.lat))
`;

type Row = {
  station_complex_id: string;
  station_complex: string;
  geoid: string;
  ntaname: string;
  boroname: string;
  daytime_routes: string;
};

async function fetchRoutesByComplex(): Promise<Map<string, Set<string>>> {
  const res = await fetch(MTA_STATIONS_URL);
  if (!res.ok) throw new Error(`MTA stations fetch failed: ${res.status}`);
  const rows = (await res.json()) as Array<{
    complex_id?: string;
    daytime_routes?: string;
  }>;
  const byComplex = new Map<string, Set<string>>();
  for (const r of rows) {
    const id = String(r.complex_id ?? "").trim();
    if (!id) continue;
    const set = byComplex.get(id) ?? new Set<string>();
    for (const route of String(r.daytime_routes ?? "").split(/[\s,]+/)) {
      const t = route.trim();
      if (t) set.add(t);
    }
    byComplex.set(id, set);
  }
  return byComplex;
}

async function main() {
  const [assign, routesByComplex] = await Promise.all([
    (async () => {
      const executionId = await startQuery(TRACT_ASSIGN_SQL);
      return waitForAthenaResults(executionId, { pollMs: 400 });
    })(),
    fetchRoutesByComplex(),
  ]);

  const out: Row[] = [];
  let missingRoutes = 0;
  for (const r of assign.rows) {
    const id = String(r.station_complex_id ?? "").trim();
    if (!id) continue;
    const routes = routesByComplex.get(id);
    if (!routes || routes.size === 0) missingRoutes++;
    out.push({
      station_complex_id: id,
      station_complex: String(r.station_complex ?? "").trim(),
      geoid: String(r.geoid ?? "").trim(),
      ntaname: String(r.ntaname ?? "").trim(),
      boroname: String(r.boroname ?? "").trim(),
      daytime_routes: routes ? [...routes].sort().join(",") : "",
    });
  }

  out.sort((a, b) => a.station_complex_id.localeCompare(b.station_complex_id));
  const path = resolve(process.cwd(), "data/station-crosswalk.json");
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n");

  console.log(`Wrote ${out.length} stations to ${path}`);
  console.log(`  ${out.filter((r) => r.ntaname).length} with a neighborhood (NTA) match`);
  console.log(
    `  ${out.length - missingRoutes} with daytime_routes; ${missingRoutes} missing routes`
  );
  if (out.length < 300) {
    console.warn(
      "WARNING: fewer stations than expected — check the tract spatial join / ST_Point order."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
