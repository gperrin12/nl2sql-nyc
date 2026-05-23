import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startQuery } from "@/lib/athena";
import { waitForAthenaResults } from "@/lib/athena-wait";
import { isAuthenticated } from "@/lib/auth";
import { checkSql } from "@/lib/guardrails";
import { generateTriviaQuestion } from "@/lib/trivia";
import {
  formatTriviaSenseFeedback,
  validateTriviaQuestionSense,
} from "@/lib/trivia-sense";
import { validateTlcProofDistances } from "@/lib/tlc-trip-filters";
import {
  findRankingMetricTie,
  formatOptionsMismatchFeedback,
  formatRankingTieFeedback,
  optionsThemeMismatch,
  proofRowLabelsFromResults,
  proofWithShuffledIndex,
  realignOptionsFromAthenaResults,
  resolveTriviaProofFromResults,
  shuffleTriviaOptions,
} from "@/lib/trivia-proof";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_ATTEMPTS = 5;

const BodySchema = z.object({
  categoryId: z.string().optional(),
  excludeQuestions: z.array(z.string()).optional(),
  usedFamilies: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let sessionBody: z.infer<typeof BodySchema> = {};
  try {
    const raw = await req.json();
    sessionBody = BodySchema.parse(raw);
  } catch {
    sessionBody = {};
  }

  let lastSql: string | undefined;
  let lastFeedback: string | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let generated;
    try {
      generated = await generateTriviaQuestion({
        session: {
          categoryId: sessionBody.categoryId,
          excludeQuestions: sessionBody.excludeQuestions,
          usedFamilies: sessionBody.usedFamilies,
        },
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

    const sense = validateTriviaQuestionSense(
      generated.question,
      generated.sql
    );
    if (!sense.ok) {
      lastSql = generated.sql;
      lastFeedback = formatTriviaSenseFeedback(sense.reason);
      continue;
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
      results = await waitForAthenaResults(executionId, { pollMs: 400 });
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

    const tlcDist = validateTlcProofDistances(
      results.columns,
      results.rows
    );
    if (!tlcDist.ok) {
      lastSql = guard.sql;
      lastFeedback = tlcDist.reason;
      continue;
    }

    const tie = findRankingMetricTie(results.columns, results.rows);
    if (tie) {
      lastSql = guard.sql;
      lastFeedback = formatRankingTieFeedback(tie, generated.options);
      continue;
    }

    let resolved = resolveTriviaProofFromResults(
      generated.options,
      generated.correctIndex,
      results
    );

    let optionsForShuffle = generated.options;

    if (resolved == null) {
      const rowLabels = proofRowLabelsFromResults(results);
      const realigned = realignOptionsFromAthenaResults(
        results,
        generated.correctIndex
      );

      if (
        realigned &&
        !optionsThemeMismatch(
          generated.options,
          generated.question,
          rowLabels
        )
      ) {
        resolved = realigned;
        optionsForShuffle = realigned.options;
      }
    }

    if (resolved == null) {
      lastSql = guard.sql;
      lastFeedback = formatOptionsMismatchFeedback(results, generated.options);
      continue;
    }

    const { correctIndex: dataCorrectIndex, proof: resolvedProof } = resolved;

    const { options, correctIndex } = shuffleTriviaOptions(
      optionsForShuffle,
      dataCorrectIndex
    );
    const proof = proofWithShuffledIndex(resolvedProof, correctIndex, options);

    const explanation = proof.correctedFromModel
      ? `The data ranks ${proof.winnerLabel} first` +
        (proof.winnerMetric
          ? ` (${proof.winnerMetric.column} = ${proof.winnerMetric.value})`
          : "") +
        `.`
      : generated.explanation;

    return NextResponse.json({
      question: generated.question,
      options,
      correctIndex,
      sql: guard.sql,
      explanation,
      model: generated.model,
      categoryId: generated.categoryId,
      categoryLabel: generated.categoryLabel,
      proof,
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

function findRankingWinnerForFeedback(
  results: Awaited<ReturnType<typeof waitForAthenaResults>>
): string | null {
  const { columns, rows } = results;
  if (!rows.length) return null;
  const label = columns[0];
  const metric = columns[1];
  if (!label) return null;
  const parts = rows.slice(0, 4).map((r) => {
    const m = metric ? ` (${metric}=${r[metric]})` : "";
    return `${r[label]}${m}`;
  });
  return parts.join("; ");
}
