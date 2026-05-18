import { NextRequest, NextResponse } from "next/server";
import { startQuery } from "@/lib/athena";
import { waitForAthenaResults } from "@/lib/athena-wait";
import { isAuthenticated } from "@/lib/auth";
import { checkSql } from "@/lib/guardrails";
import { generateTriviaQuestion } from "@/lib/trivia";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_ATTEMPTS = 3;

export async function POST(_req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let lastSql: string | undefined;
  let lastFeedback: string | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let generated;
    try {
      generated = await generateTriviaQuestion({
        feedback: lastFeedback,
        previousSql: lastSql,
      });
    } catch (e) {
      return NextResponse.json(
        {
          error: "Failed to generate trivia question",
          detail: errorMessage(e),
        },
        { status: 502 }
      );
    }

    const guard = checkSql(generated.sql);
    if (!guard.ok) {
      lastSql = generated.sql;
      lastFeedback = guard.reason;
      continue;
    }

    let results;
    try {
      const executionId = await startQuery(guard.sql);
      results = await waitForAthenaResults(executionId);
    } catch (e) {
      lastSql = guard.sql;
      lastFeedback = `Athena error: ${errorMessage(e)}`;
      continue;
    }

    if (results.rows.length === 0) {
      lastSql = guard.sql;
      lastFeedback =
        "Query returned zero rows — pick a different question, year partition, or filters so the proof query returns data.";
      continue;
    }

    return NextResponse.json({
      question: generated.question,
      options: generated.options,
      correctIndex: generated.correctIndex,
      sql: guard.sql,
      explanation: generated.explanation,
      model: generated.model,
      results: {
        columns: results.columns,
        rows: results.rows.slice(0, 10),
      },
      scannedBytes: results.scannedBytes,
      runtimeMs: results.executionTimeMs,
    });
  }

  return NextResponse.json(
    {
      error: "Could not produce a verified trivia question",
      detail: lastFeedback ?? "Unknown failure",
      sql: lastSql,
    },
    { status: 502 }
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
