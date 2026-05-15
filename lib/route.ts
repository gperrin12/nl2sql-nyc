import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateSql } from "@/lib/claude";
import { generateSqlViaP8k8 } from "@/lib/p8k8";
import { mapSpatialIntent } from "@/lib/sql-agent/mapIntent";
import { generateSqlWithAgent } from "@/lib/sql-agent/run";
import { checkSql } from "@/lib/guardrails";
import { startQuery } from "@/lib/athena";
import { isAuthenticated } from "@/lib/auth";
import { recordGenerationMetrics } from "@/lib/record-generation-metrics";

const BodySchema = z.object({
  question: z.string().min(1).max(2000),
});

/**
 * Which SQL-generation backend to use:
 *
 *   USE_P8K8=true              → always route through p8k8
 *   CLAUDE_SQL_AGENT=true      → always use the local tool-using agent
 *   spatial question           → always use the local tool-using agent
 *   (default)                  → single-shot generateSql() via Anthropic SDK
 *
 * Priority: agent (spatial/flag) > p8k8 > direct Claude
 */
export function pickBackend(question: string): "agent" | "p8k8" | "claude" {
  const isSpatial =
    process.env.CLAUDE_SQL_AGENT === "true" || mapSpatialIntent(question);
  if (isSpatial) return "agent";
  if (process.env.USE_P8K8 === "true") return "p8k8";
  return "claude";
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const backend = pickBackend(parsed.question);

  // 1. Generate SQL
  let generation;
  try {
    if (backend === "agent") {
      generation = await generateSqlWithAgent(parsed.question);
    } else if (backend === "p8k8") {
      generation = await generateSqlViaP8k8(parsed.question);
    } else {
      generation = await generateSql(parsed.question);
    }
  } catch (e) {
    return NextResponse.json(
      { error: "SQL generation failed", detail: errorMessage(e) },
      { status: 502 }
    );
  }

  await recordGenerationMetrics(parsed.question, generation, backend);

  // 2. Guardrail check
  const check = checkSql(generation.sql);
  if (!check.ok) {
    return NextResponse.json(
      {
        error: "SQL rejected by guardrails",
        reason: check.reason,
        sql: generation.sql,
      },
      { status: 400 }
    );
  }

  // 3. Start the Athena query
  let executionId;
  try {
    executionId = await startQuery(check.sql);
  } catch (e) {
    return NextResponse.json(
      {
        error: "Athena rejected the query",
        detail: errorMessage(e),
        sql: check.sql,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    executionId,
    sql: check.sql,
    model: generation.model,
    summary: generation.summary,
    usage: {
      inputTokens: generation.inputTokens,
      outputTokens: generation.outputTokens,
    },
  });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
