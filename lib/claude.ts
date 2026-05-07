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
4. For spatial joins use ST_GEOMETRY_FROM_TEXT(geometry_wkt) and ST_POINT(TRY_CAST(longitude AS DOUBLE), TRY_CAST(latitude AS DOUBLE)) (or CAST after NULL checks).
5. NYC bounds on raw lat/lon: TRY_CAST(latitude AS DOUBLE) BETWEEN 40.4 AND 41.0 AND TRY_CAST(longitude AS DOUBLE) BETWEEN -74.3 AND -73.6. Never put uncast latitude/longitude in numeric BETWEEN.
6. nyc_311.borough is UPPERCASE ('BROOKLYN'); census_tracts.boroname is Title Case ('Brooklyn'). Don't equate them as strings — spatial join via lat/lon if you need to bridge.
7. ACS demographics live in census_tract_demographics with _2018 and _2023 suffixes. Rates are not pre-computed. Use FROM_ISO8601_TIMESTAMP() for ISO date strings in nyc_311.
8. Proximity / buffer on WGS84 lon/lat ("within N feet/meters/miles of a point or intersection"): coordinates are geographic degrees — ST_Distance(ST_Point(lon1,lat1), ST_Point(lon2,lat2)) on Geometry is planar (wrong units; not meters). Use great-circle distance in meters via spherical geography:
   ST_Distance(to_spherical_geography(ST_Point(lon1, lat1)), to_spherical_geography(ST_Point(lon2, lat2))) <= radius_meters.
   Use TRY_CAST for row lon/lat from VARCHAR. Anchor point (intersection, address): ST_Point(anchor_lon, anchor_lat) with doubles from geocoding / known coordinates in WITH clause. Convert feet→meters (* 0.3048), miles→meters (* 1609.344). Optionally tighten with a lon/lat bounding box first for partitions, then apply this distance predicate.
9. Avoid AMBIGUOUS_NAME errors: whenever two or more tables/CTEs in scope expose the same column name, qualify every reference with its alias (e.g. ct.geoid = demo.geoid). This applies especially to geoid (census_tracts + census_tract_demographics), year/month (partition columns on multiple fact tables), latitude/longitude, borough, geometry_wkt. Use short consistent aliases in WITH clauses (ct, tracts, demo, acs, c, z).
10. TLC ↔ taxi_zones joins: gtp_tlc_data.pulocationid / dolocationid are often VARCHAR while taxi_zones.locationid is often INTEGER — raw equality causes TYPE_MISMATCH (integer = varchar). Normalize in the JOIN, e.g. TRY_CAST(t.pulocationid AS INTEGER) = tz.locationid, or TRY_CAST both sides to BIGINT, or CAST both to VARCHAR. Use the same pattern when a CTE selects locationid from taxi_zones and joins to TLC.

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
