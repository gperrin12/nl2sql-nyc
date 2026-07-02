/**
 * Generate a single trivia question and verify it end-to-end against Athena.
 *
 * This is the shared, in-process pipeline used by both the /api/trivia/question
 * route (solo mode) and the room-creation question builder (live mode). Keeping
 * it here means there is exactly ONE generator/verifier — callers never re-run
 * the HTTP endpoint against themselves.
 */

import { startQuery } from "@/lib/athena";
import { waitForAthenaResults } from "@/lib/athena-wait";
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
  resolveTriviaExplanation,
  resolveTriviaProofFromResults,
  shuffleTriviaOptions,
  type TriviaProof,
} from "@/lib/trivia-proof";

const MAX_ATTEMPTS = 5;

export type VerifiedTriviaSession = {
  deck?: "mta" | "311" | "grab-bag";
  categoryId?: string;
  excludeQuestions?: string[];
  usedFamilies?: string[];
};

export type VerifiedTriviaQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  sql: string;
  explanation: string;
  model: string;
  categoryId: string;
  categoryLabel: string;
  proof: TriviaProof;
  results: {
    columns: string[];
    rows: Record<string, string | null>[];
  };
  scannedBytes: number;
  runtimeMs: number;
};

export type VerifiedTriviaResult =
  | { ok: true; question: VerifiedTriviaQuestion }
  | { ok: false; error: string; detail: string; sql?: string };

export async function generateVerifiedTriviaQuestion(
  session: VerifiedTriviaSession
): Promise<VerifiedTriviaResult> {
  let lastSql: string | undefined;
  let lastFeedback: string | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let generated;
    try {
      generated = await generateTriviaQuestion({
        session: {
          deck: session.deck,
          categoryId: session.categoryId,
          excludeQuestions: session.excludeQuestions,
          usedFamilies: session.usedFamilies,
        },
        feedback: lastFeedback,
        previousSql: lastSql,
      });
    } catch (e) {
      return {
        ok: false,
        error: "Failed to generate trivia question",
        detail: errorMessage(e),
      };
    }

    const sense = validateTriviaQuestionSense(generated.question, generated.sql);
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

    const tlcDist = validateTlcProofDistances(results.columns, results.rows);
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
    let optionsRealignedFromAthena = false;

    if (resolved == null) {
      const rowLabels = proofRowLabelsFromResults(results);
      const realigned = realignOptionsFromAthenaResults(
        results,
        generated.correctIndex
      );

      if (
        realigned &&
        !optionsThemeMismatch(generated.options, generated.question, rowLabels)
      ) {
        resolved = realigned;
        optionsForShuffle = realigned.options;
        optionsRealignedFromAthena = true;
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

    const explanation = resolveTriviaExplanation(
      generated.explanation,
      proof,
      options,
      optionsRealignedFromAthena
    );

    return {
      ok: true,
      question: {
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
      },
    };
  }

  return {
    ok: false,
    error: "Could not produce a verified trivia question",
    detail: lastFeedback ?? "Unknown failure",
    sql: lastSql,
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
