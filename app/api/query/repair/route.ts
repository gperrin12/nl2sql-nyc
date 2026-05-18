import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateSqlWithRepair } from "@/lib/claude";
import { ensureGuardedSql } from "@/lib/ensure-guarded-sql";
import { startQuery } from "@/lib/athena";
import { isAuthenticated } from "@/lib/auth";

const BodySchema = z.object({
  question: z.string().min(1).max(2000),
  sql: z.string().min(1).max(32000),
  feedback: z.string().min(1).max(8000),
});

/** Agentic repair pass: revise SQL using Athena errors or analyst notes, then re-run Athena. */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  let generation;
  try {
    generation = await generateSqlWithRepair(parsed.question, parsed.sql, parsed.feedback);
  } catch (e) {
    return NextResponse.json(
      { error: "SQL repair generation failed", detail: errorMessage(e) },
      { status: 502 }
    );
  }

  const guarded = await ensureGuardedSql(parsed.question, generation);
  if (!guarded.ok) {
    return NextResponse.json(
      {
        error: "SQL rejected by guardrails",
        reason: guarded.reason,
        sql: guarded.sql,
      },
      { status: 400 }
    );
  }
  generation = guarded.generation;

  let executionId;
  try {
    executionId = await startQuery(guarded.sql);
  } catch (e) {
    return NextResponse.json(
      {
        error: "Athena rejected the query",
        detail: errorMessage(e),
        sql: guarded.sql,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    executionId,
    sql: guarded.sql,
    model: generation.model,
    usage: {
      inputTokens: generation.inputTokens,
      outputTokens: generation.outputTokens,
    },
  });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
