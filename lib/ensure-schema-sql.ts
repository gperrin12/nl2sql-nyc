import { generateSqlWithRepair, type SqlGenerationResult } from "@/lib/claude";
import { buildHallucinationRepairReason } from "@/lib/hallucination-detector";
import {
  detectWarehouseHallucinations,
  getWarehouseSchemaMap,
} from "@/lib/hallucination-schema";
import {
  ensureGuardedSql,
  mergeGenerations,
  type GuardRepairHook,
} from "@/lib/ensure-guarded-sql";

const DEFAULT_MAX_SCHEMA_REPAIRS = 1;

export type EnsureSchemaSqlResult = {
  generation: SqlGenerationResult;
  sql: string;
  schemaRepairCount: number;
  hallucination: ReturnType<typeof detectWarehouseHallucinations>;
  guardFailure?: { reason: string; sql: string; generation: SqlGenerationResult };
};

export async function ensureSchemaValidSql(
  question: string,
  initial: SqlGenerationResult,
  options?: {
    maxRepairs?: number;
    onRepair?: GuardRepairHook;
    guardOptions?: { onRepair?: GuardRepairHook };
  }
): Promise<EnsureSchemaSqlResult> {
  const maxRepairs = options?.maxRepairs ?? DEFAULT_MAX_SCHEMA_REPAIRS;
  let generation = initial;
  let hallucination = detectWarehouseHallucinations(generation.sql);
  let schemaRepairCount = 0;
  const schemaMap = getWarehouseSchemaMap();

  while (hallucination.hasHallucination && schemaRepairCount < maxRepairs) {
    schemaRepairCount += 1;
    const reason = buildHallucinationRepairReason(hallucination, schemaMap);
    const repaired = await generateSqlWithRepair(question, generation.sql, reason);
    generation = mergeGenerations(generation, repaired);

    await options?.onRepair?.({
      attempt: schemaRepairCount,
      reason: `Schema: ${reason}`,
      sql: generation.sql,
    });

    const guarded = await ensureGuardedSql(question, generation, options?.guardOptions);
    if (!guarded.ok) {
      return {
        generation: guarded.generation,
        sql: guarded.sql,
        schemaRepairCount,
        hallucination,
        guardFailure: {
          reason: guarded.reason,
          sql: guarded.sql,
          generation: guarded.generation,
        },
      };
    }
    generation = guarded.generation;
    hallucination = detectWarehouseHallucinations(generation.sql);
  }

  // Exercise baseline: if still hallucinating after max repairs, keep going to Athena.
  return {
    generation,
    sql: generation.sql,
    schemaRepairCount,
    hallucination,
  };
}
