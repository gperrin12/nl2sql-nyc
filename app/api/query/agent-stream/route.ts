import { NextRequest } from "next/server";
import { z } from "zod";
import { generateSql } from "@/lib/claude";
import { generateSqlViaP8k8WithEvents } from "@/lib/p8k8";
import { pickBackend } from "@/lib/route";
import { runSqlAgentWithEvents } from "@/lib/sql-agent/run";
import type { AgentStreamPayload } from "@/lib/sql-agent/types";
import { ensureGuardedSql } from "@/lib/ensure-guarded-sql";
import { startQuery } from "@/lib/athena";
import { isAuthenticated } from "@/lib/auth";
import { recordGenerationMetrics } from "@/lib/record-generation-metrics";
import { recordQueryRunStart, recordQueryRunTokens } from "@/lib/record-query-run";

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

      try {
        let generation;
        if (backend === "agent") {
          generation = await runSqlAgentWithEvents(parsed.question, push);
        } else if (backend === "p8k8") {
          generation = await generateSqlViaP8k8WithEvents(parsed.question, push);
        } else {
          await push({ type: "turn", index: 0 });
          await push({
            type: "reason",
            text: "Generating SQL via Claude (single-shot).",
          });
          generation = await generateSql(parsed.question);
        }

        await push({ type: "sql_generated", sql: generation.sql });

        const guarded = await ensureGuardedSql(parsed.question, generation, {
          onRepair: async ({ attempt, reason, sql }) => {
            await push({
              type: "reason",
              text: `Guardrails rejected SQL (${reason}). Auto-repair ${attempt}…`,
            });
            await push({ type: "sql_generated", sql });
          },
        });
        if (!guarded.ok) {
          await push({
            type: "guardrails_failed",
            reason: guarded.reason,
            sql: guarded.sql,
          });
          controller.close();
          return;
        }
        generation = guarded.generation;
        await recordGenerationMetrics(parsed.question, generation, backend);
        if (guarded.repairCount > 0) {
          await push({
            type: "reason",
            text: `Guardrail repair succeeded (${guarded.repairCount} pass${guarded.repairCount === 1 ? "" : "es"}).`,
          });
        }

        let executionId: string;
        try {
          executionId = await startQuery(guarded.sql);
        } catch (e) {
          await push({
            type: "athena_failed",
            detail: errorMessage(e),
            sql: guarded.sql,
          });
          controller.close();
          return;
        }

        await push({ type: "athena_started", executionId });
        void recordQueryRunStart({
          question: parsed.question,
          sql: guarded.sql,
          model: generation.model,
          backend,
          executionId,
        }).then(() => recordQueryRunTokens(executionId, generation));
        await push({
          type: "done",
          model: generation.model,
          backend,
          usage: {
            inputTokens: generation.inputTokens,
            outputTokens: generation.outputTokens,
          },
        });
      } catch (e) {
        await push({
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
