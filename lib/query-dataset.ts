export type QueryDataset =
  | "311"
  | "collisions"
  | "taxi"
  | "census"
  | "multi"
  | "other";

export const DATASET_LABELS: Record<QueryDataset, string> = {
  "311": "311 Complaints",
  collisions: "NYPD Collisions",
  taxi: "Taxi",
  census: "ACS / Census",
  multi: "Multi-table",
  other: "Other",
};

const ALL_DATASETS: QueryDataset[] = [
  "311",
  "collisions",
  "taxi",
  "census",
  "multi",
  "other",
];

function datasetGroupsInSql(sql: string): QueryDataset[] {
  const s = sql.toLowerCase();
  const groups: QueryDataset[] = [];
  if (s.includes("nyc_311")) groups.push("311");
  if (s.includes("nypd_collisions")) groups.push("collisions");
  if (s.includes("gtp_tlc_data") || s.includes("taxi_zones")) groups.push("taxi");
  if (
    s.includes("census_tracts") ||
    s.includes("census_tract_demographics")
  ) {
    groups.push("census");
  }
  return groups;
}

/** Classify which NYC data source(s) a query touches from table names in SQL. */
export function detectDatasets(sql: string): QueryDataset {
  const groups = datasetGroupsInSql(sql);
  if (groups.length >= 2) return "multi";
  if (groups.length === 1) return groups[0]!;
  return "other";
}

/** Use stored dataset when present; otherwise classify from SQL (legacy evals). */
export function resolveEvalDataset(evalRow: {
  dataset?: QueryDataset;
  sql: string;
}): QueryDataset {
  if (
    evalRow.dataset &&
    ALL_DATASETS.includes(evalRow.dataset)
  ) {
    return evalRow.dataset;
  }
  return detectDatasets(evalRow.sql);
}
