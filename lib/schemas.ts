/**
 * Schema definitions for the NYC civic data warehouse in Athena.
 * Ported from the original mcp_server.py — descriptions are intentionally
 * verbose because they are the primary signal Claude uses to generate
 * correct SQL. Edit with care.
 */

export type TableSchema = {
  description: string;
  columns: string[];
};

export const TABLE_SCHEMAS: Record<string, TableSchema> = {
  gtp_tlc_data: {
    description:
      "Taxi trip data (yellow and green taxis) with neighborhood-level geography. " +
      "Uses pulocationid and dolocationid (~200 taxi zones); join to taxi_zones for geometry. " +
      "There are NO latitude/longitude columns—never reference lat/lon on this table; zone polygons live only on taxi_zones via geometry_wkt. " +
      "pulocationid / dolocationid may be INTEGER or VARCHAR depending on catalog — never TRIM() these columns (FUNCTION_NOT_FOUND on integer). Filter with IS NOT NULL; join taxi_zones with TRY_CAST both sides to BIGINT or CAST both to VARCHAR (TYPE_MISMATCH if types differ). " +
      "No raw lat/lon—locations are aggregated to zone IDs. " +
      "Partitioned by type (yellow/green/fhv/fhvhv), year (STRING), month (STRING). " +
      "tpep_pickup_datetime / tpep_dropoff_datetime may be TIMESTAMP or VARCHAR — never SUBSTRING(); use day_of_week() after FROM_ISO8601_TIMESTAMP or TRY_CAST AS TIMESTAMP for weekday/weekend splits.",
    columns: [
      "vendorid", "tpep_pickup_datetime", "tpep_dropoff_datetime",
      "passenger_count", "trip_distance", "ratecodeid",
      "store_and_fwd_flag", "pulocationid", "dolocationid",
      "payment_type", "fare_amount", "extra", "mta_tax",
      "tip_amount", "tolls_amount", "improvement_surcharge",
      "total_amount", "congestion_surcharge", "airport_fee",
      "type", "year", "month",
    ],
  },
  par: {
    description:
      "Pre-2016 archived TLC trip data with raw pickup/dropoff coordinates. " +
      "Has pickup_longitude, pickup_latitude, dropoff_longitude, dropoff_latitude. " +
      "Column 'color' maps to 'type' in gtp_tlc_data (taxi type: yellow, green, etc.). " +
      "Use for pre-2016 analysis and point-level geography; gtp_tlc_data is zone-level.",
    columns: [
      "vendorid", "lpep_pickup_datetime", "lpep_dropoff_datetime",
      "store_and_fwd_flag", "ratecodeid",
      "pickup_longitude", "pickup_latitude", "dropoff_longitude", "dropoff_latitude",
      "passenger_count", "trip_distance", "fare_amount", "extra",
      "mta_tax", "tip_amount", "tolls_amount", "ehail_fee",
      "improvement_surcharge", "total_amount", "payment_type",
      "trip_type", "tcolor", "year", "month", "color",
    ],
  },
  taxi_zones: {
    description:
      "Taxi zone boundaries (263 zones across NYC). " +
      "NO latitude/longitude columns — only polygon geometry in geometry_wkt (plus zone name, locationid, borough). " +
      "Never reference tz.latitude, tz.longitude, or similar; they do not exist (COLUMN_NOT_FOUND). " +
      "For a zone center or distance-from-point use ST_CENTROID(ST_GEOMETRY_FROM_TEXT(tz.geometry_wkt)) or the full polygon with ST_GEOMETRY_FROM_TEXT(tz.geometry_wkt); combine with to_spherical_geography / ST_Distance as needed. " +
      "Join key: locationid type varies by catalog (INTEGER or VARCHAR); gtp_tlc_data zone IDs are VARCHAR — always CAST/TRY_CAST both sides to a common type for JOIN / IN / EXISTS (see system RULE 10). " +
      "Coordinates are WGS84 (lon/lat) inside the WKT — use ST_X/ST_Y on centroid points if you need numeric lon/lat.",
    columns: [
      "objectid", "shape_leng", "shape_area",
      "zone", "locationid", "borough",
      "geometry", "geometry_wkt",
    ],
  },
  census_tracts: {
    description:
      "NYC census tracts (2020 Census, ~2,300 polygons), NYC DCP shoreline-clipped version. " +
      "Join to census_tract_demographics ONLY on geoid (11-digit Census tract GEOID string: state+county+tract). " +
      "Do NOT join tracts to demographics using boroname, ctlabel, boroct2020, or ct2020 alone — those will not match ACS keys and yield wrong or empty joins. " +
      "Canonical join predicate (handles VARCHAR vs BIGINT and stray whitespace): " +
      "TRIM(CAST(ct.geoid AS VARCHAR)) = TRIM(CAST(demo.geoid AS VARCHAR)) with aliases ct and demo (adjust aliases as needed). " +
      "Always qualify ct.geoid / demo.geoid in ON and SELECT (AMBIGUOUS_NAME). " +
      "Geometry stored as WKT in geometry_wkt — wrap with ST_GEOMETRY_FROM_TEXT() for spatial functions. " +
      "Coordinates are WGS84 (lon/lat). " +
      "Use for point-in-polygon joins from any lat/lon source (e.g. nypd_collisions, nyc_311, par). " +
      "CRITICAL: ST_Point takes (longitude, latitude) — X then Y. ST_Point(latitude, longitude) swaps coords and matches NO NYC tracts (silent zero rows). " +
      "Prefer ST_Within(ST_Point(TRY_CAST(longitude_col AS DOUBLE), TRY_CAST(latitude_col AS DOUBLE)), ST_GEOMETRY_FROM_TEXT(ct.geometry_wkt)) (point inside polygon). Equivalent: ST_CONTAINS(ST_GEOMETRY_FROM_TEXT(ct.geometry_wkt), ST_Point(lon, lat)) with polygon FIRST. " +
      "For neighborhood-level rollups with census population use NTA fields nta2020 + ntaname (~195 areas); do not match nyc_311.borough to boroname (different casing/format). Case-insensitive ntaname filters in Athena: use LOWER(ntaname) LIKE 'distinctive-prefix%' (never PostgreSQL ILIKE). Avoid short substring patterns like LOWER(ntaname) LIKE '%bedford%' — they pull in unrelated NTAs (e.g. Bedford Park, Bronx). Prefer a unique stem: Bed-Stuy ↔ LOWER(ntaname) LIKE 'bedford-stuyvesant%' (matches Bedford-Stuyvesant (West) and (East)) or ntaname IN ('Bedford-Stuyvesant (West)', 'Bedford-Stuyvesant (East)'), or spatial filter via geometry_wkt.",
    columns: [
      "boroct2020", "ct2020", "boroname", "borocode", "ctlabel",
      "nta2020", "ntaname", "cdta2020", "cdtaname",
      "geoid", "shape_leng", "shape_area", "geometry_wkt",
    ],
  },
  census_tract_demographics: {
    description:
      "ACS 5-year demographic estimates per census tract for two non-overlapping vintages: " +
      "_2018 suffix = 2014-2018 ACS, _2023 suffix = 2019-2023 ACS. " +
      "Grain: one row per tract GEOID in this table — join to census_tracts ONLY on geoid. " +
      "Mandatory ON clause pattern with tract alias ct and demographics alias demo: " +
      "TRIM(CAST(ct.geoid AS VARCHAR)) = TRIM(CAST(demo.geoid AS VARCHAR)). " +
      "Never join ACS to tract polygons on borough names or tract labels. If catalogs typed geoid as BIGINT on one side, CAST both to VARCHAR (or both to BIGINT) — mixed types break joins silently or with TYPE_MISMATCH. " +
      "ACS may omit some waterfront/misc tract GEOIDs present in census_tracts — use LEFT JOIN census_tract_demographics demo ON … when you must keep every tract from a spatial assignment; use INNER JOIN when you require population denominators only where ACS exists. " +
      "Always qualify demo.geoid / ct.geoid in ON and SELECT when both tables are in scope. " +
      "For per-capita rates alongside recent 311/calendar years (e.g. 2024), prefer total_pop_2023 as denominator (_2023 = 2019-2023 ACS vintage); total_pop_2018 is older vintage. " +
      "All measure columns are STRING in Athena — SELECT them as VARCHAR when you only need to show counts (values stay visible). " +
      "Blind TRY_CAST(col AS BIGINT) often yields NULL even when the VARCHAR looks numeric — ACS-style strings often end with .0 (e.g. 45231.0): DOUBLE parses those, BIGINT does not. Prefer TRY_CAST(TRIM(REGEXP_REPLACE(col, ',', '')) AS DOUBLE) for counts, universes, medians, and rates; use CAST(that_double AS BIGINT) only after DOUBLE parses if you need integers. " +
      "Do NOT add WHERE TRY_CAST(... AS BIGINT) IS NOT NULL as a gate — if BIGINT fails for every row you get an empty table; filter or NULLIF on the DOUBLE form instead (e.g. WHERE TRY_CAST(TRIM(REGEXP_REPLACE(total_pop_2023, ',', '')) AS DOUBLE) IS NOT NULL). " +
      "Census uses negative sentinels (~-666666666) for unavailable estimates; the loader nulls these out, " +
      "but always wrap aggregations defensively. " +
      "Rates are NOT pre-computed: poverty rate = poverty_below / poverty_universe; " +
      "% bachelor's+ = (edu_bachelors + edu_masters + edu_professional + edu_doctorate) / edu_universe_25plus; " +
      "homeownership rate = housing_owner_occupied / housing_universe; " +
      "% limited English households = (lang_lim_eng_spanish + lang_lim_eng_other_indo_european + " +
      "lang_lim_eng_asian_pacific_island + lang_lim_eng_other) / lang_universe.",
    columns: [
      "geoid",
      "total_pop_2018", "median_age_2018",
      "median_household_income_2018", "poverty_universe_2018", "poverty_below_2018",
      "race_white_alone_2018", "race_black_alone_2018", "race_asian_alone_2018",
      "hispanic_or_latino_2018",
      "edu_universe_25plus_2018", "edu_bachelors_2018", "edu_masters_2018",
      "edu_professional_2018", "edu_doctorate_2018",
      "housing_universe_2018", "housing_owner_occupied_2018",
      "median_gross_rent_2018", "median_household_size_2018",
      "lang_universe_2018", "lang_lim_eng_spanish_2018",
      "lang_lim_eng_other_indo_european_2018", "lang_lim_eng_asian_pacific_island_2018",
      "lang_lim_eng_other_2018",
      "total_pop_2023", "median_age_2023",
      "median_household_income_2023", "poverty_universe_2023", "poverty_below_2023",
      "race_white_alone_2023", "race_black_alone_2023", "race_asian_alone_2023",
      "hispanic_or_latino_2023",
      "edu_universe_25plus_2023", "edu_bachelors_2023", "edu_masters_2023",
      "edu_professional_2023", "edu_doctorate_2023",
      "housing_universe_2023", "housing_owner_occupied_2023",
      "median_gross_rent_2023", "median_household_size_2023",
      "lang_universe_2023", "lang_lim_eng_spanish_2023",
      "lang_lim_eng_other_indo_european_2023", "lang_lim_eng_asian_pacific_island_2023",
      "lang_lim_eng_other_2023",
    ],
  },
  nypd_collisions: {
    description:
      "NYPD Motor Vehicle Collisions (~2M rows, 2012-present). " +
      "Partitioned by year (STRING) and month (STRING, zero-padded). " +
      "Filter partitions with string literals: year = '2025' AND month BETWEEN '01' AND '12' (never compare year/month to bare numbers). " +
      "latitude, longitude, crash_date, crash_time are VARCHAR in Athena — never use them in numeric BETWEEN. " +
      "NYC bounds: TRY_CAST(latitude AS DOUBLE) BETWEEN 40.4 AND 41.0 AND TRY_CAST(longitude AS DOUBLE) BETWEEN -74.3 AND -73.6; " +
      "exclude blanks with latitude <> '' AND longitude <> ''. " +
      "Parse dates with TRY(DATE_PARSE(crash_date, '%m/%d/%Y')) or CAST(... AS DATE) only after verifying format; prefer partition year/month for year-scoped counts. " +
      "Spatial joins: ST_POINT(TRY_CAST(longitude AS DOUBLE), TRY_CAST(latitude AS DOUBLE)) with ST_CONTAINS(ST_GEOMETRY_FROM_TEXT(t.geometry_wkt), ...). " +
      "Within-radius (feet/meters) from a lat/lon anchor: ST_Distance(to_spherical_geography(ST_Point(row_lon, row_lat)), to_spherical_geography(ST_Point(anchor_lon, anchor_lat))) <= meters — never planar ST_Distance on raw ST_Point for radius filters. " +
      "Casualty columns are STRING — use TRY_CAST(... AS INTEGER). " +
      "Precomputed H3 indexes for crash coordinates (STRING cell IDs — Uber H3 index text): h3_r8, h3_r9, h3_r10 match resolutions 8–10. For hex-binned counts / heat maps by resolution, GROUP BY the matching column (e.g. h3_r9 for res 9) with COUNT(*) or SUM; filter nonempty cells with h3_r9 IS NOT NULL AND TRIM(h3_r9) <> ''. Prefer these over geo_to_h3 UDFs when present. Join/filter geography still uses latitude/longitude or tract polygons when needed; qualify h3_r* if multiple tables expose them. " +
      "Always filter by partition (year, month) for cost efficiency.",
    columns: [
      "collision_id", "crash_date", "crash_time",
      "borough", "zip_code",
      "latitude", "longitude",
      "on_street_name", "cross_street_name", "off_street_name",
      "number_of_persons_injured", "number_of_persons_killed",
      "number_of_pedestrians_injured", "number_of_pedestrians_killed",
      "number_of_cyclist_injured", "number_of_cyclist_killed",
      "number_of_motorist_injured", "number_of_motorist_killed",
      "contributing_factor_vehicle_1", "contributing_factor_vehicle_2",
      "contributing_factor_vehicle_3", "contributing_factor_vehicle_4",
      "contributing_factor_vehicle_5",
      "vehicle_type_code1", "vehicle_type_code2",
      "vehicle_type_code_3", "vehicle_type_code_4", "vehicle_type_code_5",
      "h3_r8", "h3_r9", "h3_r10",
      "year", "month",
    ],
  },
  nyc_311: {
    description:
      "NYC 311 Service Requests (2020-present, ~40M+ rows). " +
      "Partitioned by year (STRING) and month (STRING, zero-padded) — " +
      "ALWAYS filter by year/month partition to avoid full-table scans. " +
      "All columns are STRING; cast at query time with TRY_CAST. " +
      "Date columns (created_date, closed_date, due_date, resolution_action_updated_date) " +
      "are ISO-8601 strings — parse with FROM_ISO8601_TIMESTAMP(). " +
      "Borough column is populated natively (UPPERCASE: 'BROOKLYN', 'MANHATTAN', 'QUEENS', 'BRONX', " +
      "'STATEN ISLAND', or 'Unspecified') — no spatial join needed for borough-level analysis. " +
      "Has raw latitude / longitude only for finer geography (VARCHAR — TRY_CAST before numeric BETWEEN); many loaders omit NYC Open Data's alternate coord columns — never reference location_latitude or location_longitude unless they exist in your Athena DDL. " +
      "Filter NYC bounds: TRY_CAST(latitude AS DOUBLE) BETWEEN 40.4 AND 41.0 AND TRY_CAST(longitude AS DOUBLE) BETWEEN -74.3 AND -73.6. " +
      "Within radius of a point (feet/meters): ST_Distance(to_spherical_geography(ST_Point(lon, lat)), to_spherical_geography(ST_Point(anchor_lon, anchor_lat))) <= meters (never planar ST_Distance on Geometry points for radius). " +
      "Key categorical columns: complaint_type, agency, status, open_data_channel_type. " +
      "311 complaint_type values are specific strings (e.g. 'Noise - Residential', 'Noise - Street/Sidewalk'); never use complaint_type = 'Noise' alone — use LOWER(complaint_type) LIKE '%noise%' (still excludes non-Noise categories). " +
      "Many rows lack coordinates; INNER JOIN to census polygons only on rows with non-null lat/lon inside NYC bounds — others drop entirely. For borough-level per capita use borough + ACS borough aggregates or accept tract-limited coverage. " +
      "Precomputed H3 indexes for incident coordinates (STRING cell IDs): h3_r8, h3_r9, h3_r10 at resolutions 8–10. For hex buckets / density by resolution, GROUP BY h3_r9 (etc.) with COUNT(*); filter TRIM(h3_r9) <> ''. Prefer these columns over H3 UDFs when present. " +
      "Resolution time = closed_date - created_date; many requests have NULL closed_date if still open.",
    columns: [
      "unique_key", "created_date", "closed_date",
      "agency", "agency_name",
      "complaint_type", "descriptor", "location_type",
      "incident_zip", "incident_address", "street_name",
      "cross_street_1", "cross_street_2",
      "intersection_street_1", "intersection_street_2",
      "address_type", "city", "landmark", "facility_type",
      "status", "due_date", "resolution_description",
      "resolution_action_updated_date",
      "community_board", "bbl", "borough",
      "x_coordinate_state_plane", "y_coordinate_state_plane",
      "open_data_channel_type",
      "park_facility_name", "park_borough",
      "vehicle_type", "taxi_company_borough", "taxi_pick_up_location",
      "bridge_highway_name", "bridge_highway_direction",
      "road_ramp", "bridge_highway_segment",
      "latitude", "longitude",
      "h3_r8", "h3_r9", "h3_r10",
      "year", "month",
    ],
  },
};

/** Render schema entries for a subset of tables (for agent tool responses). */
export function renderTablesForPrompt(tableNames: string[]): string {
  const parts: string[] = [];
  for (const name of tableNames) {
    const info = TABLE_SCHEMAS[name];
    if (!info) {
      parts.push(`Table: ${name}\n(unknown table name — use list_tables)\n`);
      continue;
    }
    parts.push(
      `Table: ${name}\n` +
      `Description: ${info.description}\n` +
      `Columns: ${info.columns.join(", ")}\n`
    );
  }
  return parts.join("\n");
}

/** Stable ordered list of table keys for tool responses. */
export function listWarehouseTableNames(): string[] {
  return Object.keys(TABLE_SCHEMAS);
}

/** Render the schema dictionary as a string for the system prompt. */
export function renderSchemaForPrompt(): string {
  const parts: string[] = [];
  for (const [name, info] of Object.entries(TABLE_SCHEMAS)) {
    parts.push(
      `Table: ${name}\n` +
      `Description: ${info.description}\n` +
      `Columns: ${info.columns.join(", ")}\n`
    );
  }
  return parts.join("\n");
}
