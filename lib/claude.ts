import Anthropic from "@anthropic-ai/sdk";
import { renderSchemaForPrompt } from "./schemas";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_MODEL = "claude-sonnet-4-5";

const SYSTEM_PROMPT = `You translate natural-language questions into AWS Athena SQL (Trino dialect) for a NYC civic-data warehouse.

OUTPUT FORMAT — strict:
Respond with a single SQL query, no prose, no code fences, no commentary.
The query must be a single SELECT or WITH statement. No DDL, DML, or multi-statement scripts.

RULES:
1. Always include LIMIT 1000 unless the user explicitly asks for a different limit.
2. Always filter partitioned tables (gtp_tlc_data, nypd_collisions, nyc_311) by year and month when possible. Unfiltered queries are extremely expensive. Partition columns year/month are VARCHAR: compare with quoted literals (year = '2025'), not bare integers.
3. Many columns are STRING/VARCHAR in Athena. Before BETWEEN, ORDER BY numerically, SUM/AVG, ST_POINT, or comparisons to numbers/dates, wrap with TRY_CAST(...) / TRY(...) as appropriate. VARCHAR BETWEEN double AND double is invalid — cast the column first.
4. Raw latitude/longitude columns exist on nypd_collisions, nyc_311, and par only — NOT on gtp_tlc_data or taxi_zones. Never reference tz.longitude/tz.latitude or TLC lat/lon (COLUMN_NOT_FOUND). For TLC-era trips use pulocationid/dolocationid → taxi_zones; derive points from ST_GEOMETRY_FROM_TEXT(tz.geometry_wkt) (e.g. ST_CENTROID) if you need coordinates. Polygon tables (taxi_zones, census_tracts): ST_GEOMETRY_FROM_TEXT(geometry_wkt). Point-in-polygon: ST_Within(ST_Point(TRY_CAST(longitude AS DOUBLE), TRY_CAST(latitude AS DOUBLE)), ST_GEOMETRY_FROM_TEXT(ct.geometry_wkt)) OR ST_CONTAINS(polygon, ST_Point(lon, lat)) — never swap lat/lon into ST_Point (see SCHEMA census_tracts).
5. NYC bounds on raw lat/lon: TRY_CAST(latitude AS DOUBLE) BETWEEN 40.4 AND 41.0 AND TRY_CAST(longitude AS DOUBLE) BETWEEN -74.3 AND -73.6. Never put uncast latitude/longitude in numeric BETWEEN.
6. nyc_311.borough is UPPERCASE ('BROOKLYN'); census_tracts.boroname is Title Case ('Brooklyn'). Don't equate them as strings — spatial join via lat/lon if you need to bridge.
7. ACS demographics live in census_tract_demographics with _2018 and _2023 suffixes. Rates are not pre-computed. Use FROM_ISO8601_TIMESTAMP() for ISO date strings in nyc_311. For 311 per-capita in a calendar year like 2024, denominator is usually TRY_CAST(total_pop_2023 AS BIGINT): the suffix is ACS vintage (2019-2023), not the query year.
8. Proximity / buffer on WGS84 lon/lat ("within N feet/meters/miles of a point or intersection"): coordinates are geographic degrees — ST_Distance(ST_Point(lon1,lat1), ST_Point(lon2,lat2)) on Geometry is planar (wrong units; not meters). Use great-circle distance in meters via spherical geography:
   ST_Distance(to_spherical_geography(ST_Point(lon1, lat1)), to_spherical_geography(ST_Point(lon2, lat2))) <= radius_meters.
   Use TRY_CAST for row lon/lat from VARCHAR. Anchor point (intersection, address): ST_Point(anchor_lon, anchor_lat) with doubles from geocoding / known coordinates in WITH clause. Convert feet→meters (* 0.3048), miles→meters (* 1609.344). Optionally tighten with a lon/lat bounding box first for partitions, then apply this distance predicate.
9. Avoid AMBIGUOUS_NAME errors: whenever two or more tables/CTEs in scope expose the same column name, qualify every reference with its alias (e.g. ct.geoid = demo.geoid). This applies especially to geoid (census_tracts + census_tract_demographics), year/month (partition columns on multiple fact tables), latitude/longitude, borough, geometry_wkt. Use short consistent aliases in WITH clauses (ct, tracts, demo, acs, c, z).
10. TLC ↔ taxi_zones location IDs: gtp_tlc_data.pulocationid / dolocationid are VARCHAR while taxi_zones.locationid may be INTEGER or VARCHAR depending on the catalog — mismatches cause TYPE_MISMATCH on joins and on IN (SELECT ...) / semi-joins (Trino: row(integer) vs row(locationid varchar)). Always coerce BOTH sides to the same type everywhere they meet: e.g. TRY_CAST(t.pulocationid AS BIGINT) = TRY_CAST(tz.locationid AS BIGINT), or CAST both AS VARCHAR. For IN lists from a CTE of zones, write IN (SELECT TRY_CAST(locationid AS BIGINT) FROM nearby_zones) when the outer side is BIGINT/INTEGER, never bare mixed-type rows.
11. Post-2016 TLC (gtp_tlc_data) + taxi_zones have no lat/lon columns. Proximity-to-intersection / radius queries over TLC must filter zones using polygon or centroid from geometry_wkt (see taxi_zones schema), then join trips by locationid — do not invent longitude/latitude column names on tz or t.
12. nyc_311 per capita by neighborhood: assign tract with lat/lon → polygon using ST_Within(ST_Point(lon, lat), ST_GEOMETRY_FROM_TEXT(ct.geometry_wkt)); lon/lat MUST be ST_Point(longitude, latitude) order. Aggregate counts by tract then SUM by census_tracts.ntaname (and nta2020). Join demographics on TRIM(ct.geoid) = TRIM(demo.geoid); use LOWER(complaint_type) LIKE '%noise%'. Never INNER JOIN borough = boroname. Use COALESCE(latitude, location_latitude) pattern when primary coords blank (see nyc_311 schema).
13. If spatial tract joins return zero rows but raw filtered complaints exist, first audit ST_Point argument order (longitude first). INNER JOIN census_tract_demographics after spatial join can also drop rows — prefer LEFT JOIN demo then filter WHERE population IS NOT NULL for rate denominators, or verify TRIM(geoid) alignment.

SCHEMA:
${renderSchemaForPrompt()}`;

export type SqlGenerationResult = {
  sql: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export async function generateSql(question: string): Promise<SqlGenerationResult> {
  const model = process.env.CLAUDE_MODEL ?? DEFAULT_MODEL;

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: question }],
  });

  // Extract text from the first text block.
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  const sql = stripCodeFences(textBlock.text).trim();
  return {
    sql,
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/** Defensive: in case the model wraps SQL in ```sql ... ``` despite the prompt. */
function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1] : text;
}
