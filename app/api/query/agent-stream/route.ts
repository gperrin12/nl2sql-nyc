import { NextRequest } from "next/server";
import { z } from "zod";
import { generateSql } from "@/lib/claude";
import { pickBackend } from "@/lib/route";
import { runSqlAgentWithEvents } from "@/lib/sql-agent/run";
import type { AgentStreamPayload } from "@/lib/sql-agent/types";
import { isAuthenticated } from "@/lib/auth";
import { guardrailsFailedPayload } from "@/lib/agent-stream-guardrails";
import { runQueryPipeline } from "@/lib/run-query-pipeline";

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

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return new Response(JSON.stringify({ error: "Bad request" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const backend = pickBackend(parsed.question);

  const stream = new ReadableStream({
    async start(controller) {
      const push = (p: AgentStreamPayload) => controller.enqueue(sseLine(p));

      const result = await runQueryPipeline({
        question: parsed.question,
        backend,
        generate: async () => {
          if (backend === "agent") {
            return runSqlAgentWithEvents(parsed.question, push);
          }
          await push({ type: "turn", index: 0 });
          await push({
            type: "reason",
            text: "Generating SQL via Claude (single-shot).",
          });
          return generateSql(parsed.question);
        },
        onSqlGenerated: (sql) => push({ type: "sql_generated", sql }),
        guardOptions: {
          onRepair: async ({ attempt, reason, sql }) => {
            await push({
              type: "reason",
              text: `Guardrails rejected SQL (${reason}). Auto-repair ${attempt}…`,
            });
            await push({ type: "sql_generated", sql });
          },
        },
        onGuardSuccess: async (repairCount) => {
          await push({
            type: "reason",
            text: `Guardrail repair succeeded (${repairCount} pass${repairCount === 1 ? "" : "es"}).`,
          });
        },
      });

      if (!result.ok) {
        const err = String(result.body.error ?? "");
        if (err === "SQL rejected by guardrails") {
          await push(guardrailsFailedPayload(result.body));
        } else if (err === "Athena rejected the query") {
          await push({
            type: "athena_failed",
            detail: String(result.body.detail ?? "Athena error"),
            sql:
              typeof result.body.sql === "string" ? result.body.sql : undefined,
          });
        } else {
          await push({
            type: "error",
            message: err || "Agent or pipeline failed",
            detail:
              typeof result.body.detail === "string"
                ? result.body.detail
                : undefined,
          });
        }
        controller.close();
        return;
      }

      await push({ type: "athena_started", executionId: result.executionId });
      await push({
        type: "done",
        model: result.model,
        backend: result.backend,
        usage: result.usage,
      });
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
