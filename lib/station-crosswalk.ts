import crosswalk from "@/data/station-crosswalk.json";

export type StationCrosswalkRow = {
  station_complex_id: string;
  station_complex: string;
  geoid: string;
  ntaname: string;
  boroname: string;
  daytime_routes: string;
};

const ROWS = crosswalk as StationCrosswalkRow[];
const XWALK_REF = /\bstation_xwalk\b/i;

function sqlStr(v: string): string {
  return `'${String(v ?? "").replace(/'/g, "''")}'`;
}

/** WITH station_xwalk(...) AS (VALUES ...) — the injected relation. */
export function buildStationXwalkCte(): string {
  const cols =
    "station_complex_id, station_complex, geoid, ntaname, boroname, daytime_routes";
  const values = ROWS.map(
    (r) =>
      `(${sqlStr(r.station_complex_id)}, ${sqlStr(r.station_complex)}, ${sqlStr(r.geoid)}, ` +
      `${sqlStr(r.ntaname)}, ${sqlStr(r.boroname)}, ${sqlStr(r.daytime_routes)})`
  ).join(",\n    ");
  return `WITH station_xwalk(${cols}) AS (\n  VALUES\n    ${values}\n)`;
}

/**
 * Prepend the crosswalk CTE only when the SQL references station_xwalk.
 * Merges cleanly if the model's SQL already starts with its own WITH.
 * Returns the SQL untouched otherwise.
 */
export function injectStationCrosswalk(sql: string): string {
  if (!XWALK_REF.test(sql)) return sql;
  const cte = buildStationXwalkCte();
  const trimmed = sql.trimStart();
  if (/^with\s/i.test(trimmed)) {
    return `${cte},\n${trimmed.replace(/^with\s+/i, "")}`;
  }
  return `${cte}\n${trimmed}`;
}
