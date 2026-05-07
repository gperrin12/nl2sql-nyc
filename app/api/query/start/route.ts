import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateSql } from "@/lib/claude";
import { checkSql } from "@/lib/guardrails";
import { startQuery } from "@/lib/athena";
import { isAuthenticated } from "@/lib/auth";

const BodySchema = z.object({
  question: z.string().min(1).max(2000),
});

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

  // 1. Ask Claude for SQL
  let generation;
  try {
    generation = await generateSql(parsed.question);
  } catch (e) {
    return NextResponse.json(
      { error: "SQL generation failed", detail: errorMessage(e) },
      { status: 502 }
    );
  }

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
    usage: {
      inputTokens: generation.inputTokens,
      outputTokens: generation.outputTokens,
    },
  });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
