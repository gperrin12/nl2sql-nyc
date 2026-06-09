/**
 * POST /api/rag/query
 *
 * Thin HTTP wrapper around lib/rag/query.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { ragConfigError, ragQuery } from "@/lib/rag/query";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let question: string;

  try {
    const body = await req.json();
    question = body.question?.trim();
    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const configError = ragConfigError();
    if (configError) {
      return NextResponse.json({ error: configError }, { status: 503 });
    }

    const result = await ragQuery(question);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rag/query] error:", err);
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "development"
            ? message
            : "Internal server error",
      },
      { status: 500 }
    );
  }
}
