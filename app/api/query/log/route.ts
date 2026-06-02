import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { getAppVersion } from "@/lib/app-version";
import { recordQueryRunFinalize } from "@/lib/record-query-run";
import { upsertQueryRun } from "@/lib/query-runs-store";
import { isDatabaseConfigured, probeDatabase } from "@/lib/db";

/** Verify Vercel → Postgres before debugging missing rows. */
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configured = isDatabaseConfigured();
  const probe = configured ? await probeDatabase() : { ok: false as const, detail: "NEON_DATABASE_URL is not set" };

  return NextResponse.json({
    configured,
    connected: probe.ok,
    detail: probe.ok ? undefined : probe.detail,
    appVersion: getAppVersion(),
  });
}

const BodySchema = z.object({
  question: z.string().min(1).max(2000),
  sql: z.string().min(1).max(32000),
  model: z.string().max(200).optional(),
  backend: z.string().max(64).optional(),
  executionId: z.string().max(256).optional(),
  athenaState: z.string().min(1).max(64),
  errorReason: z.string().max(8000).optional(),
  scannedBytes: z.number().int().nonnegative().optional(),
  runtimeMs: z.number().int().nonnegative().optional(),
  rowCount: z.number().int().nonnegative().optional(),
  trace: z.array(z.object({ type: z.string() }).passthrough()).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_database" });
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    const trace = parsed.trace as
      | import("@/lib/sql-agent/types").AgentStreamPayload[]
      | undefined;

    const executionId = parsed.executionId?.trim();
    if (executionId) {
      await recordQueryRunFinalize(executionId, {
        athenaState: parsed.athenaState,
        question: parsed.question,
        sql: parsed.sql,
        model: parsed.model,
        backend: parsed.backend,
        errorReason: parsed.errorReason,
        scannedBytes: parsed.scannedBytes,
        runtimeMs: parsed.runtimeMs,
        rowCount: parsed.rowCount,
        trace,
      });
      return NextResponse.json({
        ok: true,
        appVersion: getAppVersion(),
        note: "finalized_by_execution_id",
      });
    }

    // Legacy clients without server-side beginQueryRun (pre-universal logging deploys)
    const id = await upsertQueryRun({
      question: parsed.question,
      sql: parsed.sql,
      model: parsed.model,
      backend: parsed.backend,
      athenaState: parsed.athenaState,
      errorReason: parsed.errorReason,
      scannedBytes: parsed.scannedBytes,
      runtimeMs: parsed.runtimeMs,
      rowCount: parsed.rowCount,
      trace,
    });

    return NextResponse.json({ ok: true, id, appVersion: getAppVersion() });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : undefined;
    console.error("[query/log] failed:", code, detail);
    return NextResponse.json(
      {
        error: "Failed to log query run",
        detail,
        hint:
          code === "42703"
            ? "Missing column — run scripts/sql/add-app-version.sql on the database"
            : undefined,
      },
      { status: 502 }
    );
  }
}
