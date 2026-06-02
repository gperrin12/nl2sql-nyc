import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateSql } from "@/lib/claude";
import { mapSpatialIntent } from "@/lib/sql-agent/mapIntent";
import { generateSqlWithAgent } from "@/lib/sql-agent/run";
import { isAuthenticated } from "@/lib/auth";
import { runQueryPipeline } from "@/lib/run-query-pipeline";

const BodySchema = z.object({
  question: z.string().min(1).max(2000),
});

/**
 * Which SQL-generation backend to use:
 *
 *   CLAUDE_SQL_AGENT=true  → always use the local tool-using agent
 *   spatial question       → always use the local tool-using agent
 *   (default)              → single-shot generateSql() via Anthropic SDK
 */
export function pickBackend(question: string): "agent" | "claude" {
  const isSpatial =
    process.env.CLAUDE_SQL_AGENT === "true" || mapSpatialIntent(question);
  if (isSpatial) return "agent";
  return "claude";
}

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

  const backend = pickBackend(parsed.question);

  const result = await runQueryPipeline({
    question: parsed.question,
    backend,
    generate: async () => {
      if (backend === "agent") {
        return generateSqlWithAgent(parsed.question);
      }
      return generateSql(parsed.question);
    },
  });

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.httpStatus });
  }

  return NextResponse.json({
    executionId: result.executionId,
    sql: result.sql,
    model: result.model,
    backend: result.backend,
    summary: result.summary,
    usage: result.usage,
  });
}
