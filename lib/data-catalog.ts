/** User-facing summaries of NYC civic tables (home page, docs). */

export type DataCatalogEntry = {
  id: string;
  title: string;
  table: string;
  /** Short label for badges, e.g. "311 Complaints" */
  tag: string;
  summary: string;
  coverage: string;
  highlights: string[];
  relatedTables?: string[];
};

export const DATA_CATALOG: DataCatalogEntry[] = [
  {
    id: "311",
    title: "311 Service Requests",
    table: "nyc_311",
    tag: "311",
    summary:
      "Non-emergency requests filed with NYC 311 — noise, heat/hot water, street conditions, " +
      "sanitation, and hundreds of other complaint types routed to city agencies.",
    coverage: "2020–present · ~40M+ rows · partitioned by year & month",
    highlights: [
      "Borough is native (UPPERCASE: BROOKLYN, MANHATTAN, …)",
      "Dates as ISO strings — use FROM_ISO8601_TIMESTAMP(created_date)",
      "Lat/lon when present; precomputed H3 cells (h3_r8–h3_r10) for hex maps",
    ],
    relatedTables: ["census_tracts", "census_tract_demographics"],
  },
  {
    id: "collisions",
    title: "NYPD Motor Vehicle Collisions",
    table: "nypd_collisions",
    tag: "Collisions",
    summary:
      "NYPD-reported crashes in NYC: location, contributing factors, vehicle types, " +
      "and injury/fatality counts for pedestrians, cyclists, and motorists.",
    coverage: "2012–present · ~2M rows · partitioned by year & month",
    highlights: [
      "crash_date / lat-lon are VARCHAR — cast before math or maps",
      "H3 hex columns for aggregation without spatial UDFs",
      "Join to census tracts via ST_Point(longitude, latitude) in polygon",
    ],
    relatedTables: ["census_tracts"],
  },
  {
    id: "taxi",
    title: "TLC Taxi & For-Hire Trips",
    table: "gtp_tlc_data",
    tag: "Taxi / TLC",
    summary:
      "Yellow and green taxi trips (and other TLC types in the warehouse) with fares, tips, " +
      "passenger counts, and pickup/dropoff taxi zone IDs — not street addresses.",
    coverage:
      "2016–present (zone-level) · pre-2016 point-level trips in par · partitioned by type, year & month",
    highlights: [
      "No lat/lon on trips — join taxi_zones on pulocationid / dolocationid",
      "Zone IDs may be VARCHAR vs INTEGER — cast both sides on joins",
      "tpep_pickup_datetime for time-of-day and weekday vs weekend",
    ],
    relatedTables: ["taxi_zones", "par"],
  },
  {
    id: "census",
    title: "ACS Census Tract Demographics",
    table: "census_tract_demographics",
    tag: "ACS",
    summary:
      "American Community Survey (ACS) 5-year estimates at census tract grain: population, " +
      "income, poverty, education, housing, race/ethnicity, and language — for per-capita and " +
      "demographic context alongside 311, crashes, or trips.",
    coverage:
      "Two vintages: _2018 = 2014–2018 ACS · _2023 = 2019–2023 ACS · join on geoid only",
    highlights: [
      "Measure columns are STRING — TRY_CAST via DOUBLE for rates, not raw BIGINT",
      "For 2024-style questions, use total_pop_2023 as the usual denominator",
      "Pair with census_tracts (2020 boundaries, ~2,300 NYC tracts) for maps & NTAs",
    ],
    relatedTables: ["census_tracts"],
  },
];

export const DATA_CATALOG_SUPPORTING: {
  table: string;
  role: string;
}[] = [
  {
    table: "taxi_zones",
    role: "263 TLC zone polygons — borough, zone name, geometry_wkt for maps and spatial filters",
  },
  {
    table: "census_tracts",
    role: "2020 Census tract & neighborhood (NTA) boundaries — spatial joins from lat/lon",
  },
  {
    table: "par",
    role: "Archived pre-2016 TLC trips with raw pickup/dropoff coordinates",
  },
];
