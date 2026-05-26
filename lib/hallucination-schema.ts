import {
  detectSchemaHallucinations,
  type HallucinationResult,
  type SchemaMap,
} from "@/lib/hallucination-detector";
import { safeUpdateQueryRun } from "@/lib/record-query-run";
import { TABLE_SCHEMAS } from "@/lib/schemas";

let cachedSchemaMap: SchemaMap | null = null;

/** Canonical schema map used by hallucination detection. */
export function getWarehouseSchemaMap(): SchemaMap {
  if (cachedSchemaMap) return cachedSchemaMap;

  const map: SchemaMap = {};
  for (const [table, info] of Object.entries(TABLE_SCHEMAS)) {
    map[table.toLowerCase()] = info.columns.map((col) => col.toLowerCase());
  }
  cachedSchemaMap = map;
  return map;
}

/** Safe detector wrapper for pipeline callers. */
export function detectWarehouseHallucinations(sql: string): HallucinationResult {
  try {
    return detectSchemaHallucinations(sql, getWarehouseSchemaMap());
  } catch {
    return {
      hasHallucination: false,
      invalidTables: [],
      invalidColumns: [],
      referencedTables: [],
      referencedColumns: [],
    };
  }
}

/** Persist detector output on query_runs without breaking request flow. */
export async function persistSchemaHallucination(
  queryRunId: string | null,
  result: HallucinationResult
): Promise<void> {
  await safeUpdateQueryRun(queryRunId, {
    hallucinations: result,
    hallucinationType: result.hasHallucination ? "schema_hallucination" : null,
  });

  if (result.hasHallucination) {
    console.warn("[schema-hallucination]", {
      invalidTables: result.invalidTables,
      invalidColumns: result.invalidColumns,
    });
  }
}
