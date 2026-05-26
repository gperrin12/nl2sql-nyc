import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateSqlWithRepair } from "@/lib/claude";
import { isAuthenticated } from "@/lib/auth";
import { runQueryPipeline } from "@/lib/run-query-pipeline";

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

  const result = await runQueryPipeline({
    question: parsed.question,
    backend: "repair",
    skipScopeCheck: true,
    generate: () =>
      generateSqlWithRepair(parsed.question, parsed.sql, parsed.feedback),
  });

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.httpStatus });
  }

  return NextResponse.json({
    executionId: result.executionId,
    sql: result.sql,
    model: result.model,
    backend: result.backend,
    usage: result.usage,
  });
}
