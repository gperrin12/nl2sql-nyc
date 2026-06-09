/**
 * POST /api/hybrid/query
 *
 * Thin HTTP wrapper around lib/hybrid-query.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { executeHybrid } from "@/lib/hybrid-query";

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
    const result = await executeHybrid(question);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[hybrid/query] error:", err);
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "development"
            ? message
            : "Internal error during hybrid query execution",
      },
      { status: 500 }
    );
  }
}
