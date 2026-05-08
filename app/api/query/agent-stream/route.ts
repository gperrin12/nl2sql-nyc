import { NextRequest } from "next/server";
import { z } from "zod";
import { runSqlAgentWithEvents } from "@/lib/sql-agent/run";
import type { AgentStreamPayload } from "@/lib/sql-agent/types";
import { checkSql } from "@/lib/guardrails";
import { startQuery } from "@/lib/athena";
import { isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  question: z.string().min(1).max(2000),
});

function sseLine(payload: AgentStreamPayload): Uint8Array {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  return new TextEncoder().encode(line);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  if (process.env.CLAUDE_SQL_AGENT !== "true") {
    return new Response(
      JSON.stringify({
        error: "Agent streaming disabled",
        detail: "Set CLAUDE_SQL_AGENT=true on the server.",
      }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return new Response(JSON.stringify({ error: "Bad request" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const push = (p: AgentStreamPayload) => controller.enqueue(sseLine(p));

      try {
        const generation = await runSqlAgentWithEvents(parsed.question, push);

        push({ type: "sql_generated", sql: generation.sql });

        const guard = checkSql(generation.sql);
        if (!guard.ok) {
          push({
            type: "guardrails_failed",
            reason: guard.reason,
            sql: generation.sql,
          });
          controller.close();
          return;
        }

        let executionId: string;
        try {
          executionId = await startQuery(guard.sql);
        } catch (e) {
          push({
            type: "athena_failed",
            detail: errorMessage(e),
            sql: guard.sql,
          });
          controller.close();
          return;
        }

        push({ type: "athena_started", executionId });
        push({
          type: "done",
          model: generation.model,
          usage: {
            inputTokens: generation.inputTokens,
            outputTokens: generation.outputTokens,
          },
        });
      } catch (e) {
        push({
          type: "error",
          message: "Agent or pipeline failed",
          detail: errorMessage(e),
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
