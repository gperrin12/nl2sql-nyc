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
      "No raw lat/lon—locations are aggregated to zone IDs. " +
      "Partitioned by type (yellow/green/fhv/fhvhv), year (STRING), month (STRING).",
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
      "Join key: locationid (joins to gtp_tlc_data.pulocationid / dolocationid). " +
      "Geometry stored as WKT in geometry_wkt — wrap with ST_GEOMETRY_FROM_TEXT() for spatial functions. " +
      "Coordinates are WGS84 (lon/lat).",
    columns: [
      "objectid", "shape_leng", "shape_area",
      "zone", "locationid", "borough",
      "geometry", "geometry_wkt",
    ],
  },
  census_tracts: {
    description:
      "NYC census tracts (2020 Census, ~2,300 polygons), NYC DCP shoreline-clipped version. " +
      "Join key: geoid (11-digit federal tract ID, joins to census_tract_demographics.geoid). " +
      "Geometry stored as WKT in geometry_wkt — wrap with ST_GEOMETRY_FROM_TEXT() for spatial functions. " +
      "Coordinates are WGS84 (lon/lat). " +
      "Use for point-in-polygon joins from any lat/lon source (e.g. nypd_collisions, nyc_311, par): " +
      "ST_CONTAINS(ST_GEOMETRY_FROM_TEXT(t.geometry_wkt), ST_POINT(CAST(longitude AS DOUBLE), CAST(latitude AS DOUBLE))).",
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
      "Join key: geoid (joins to census_tracts.geoid). " +
      "All values stored as STRING — use TRY_CAST(col AS BIGINT) or TRY_CAST(col AS DOUBLE) at query time. " +
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
      "Has raw lat/lon — use ST_POINT(CAST(longitude AS DOUBLE), CAST(latitude AS DOUBLE)) " +
      "for spatial joins to taxi_zones or census_tracts via ST_CONTAINS. " +
      "Filter out NULL/zero coordinates and bound to NYC: " +
      "latitude BETWEEN 40.4 AND 41.0 AND longitude BETWEEN -74.3 AND -73.6. " +
      "Casualty columns are STRING — use TRY_CAST(... AS INTEGER). " +
      "Always filter by partition (year, month) for cost efficiency.",
    columns: [
      "collision_id", "crash_date", "crash_time",
      "borough", "zip_code",
      "latitude", "longitude", "location_latitude", "location_longitude",
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
      "Has raw lat/lon for finer geography. " +
      "Filter NYC bounds: latitude BETWEEN 40.4 AND 41.0 AND longitude BETWEEN -74.3 AND -73.6. " +
      "Key categorical columns: complaint_type, agency, status, open_data_channel_type. " +
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
      "latitude", "longitude", "location_latitude", "location_longitude",
      "year", "month",
    ],
  },
};

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
