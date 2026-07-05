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
import { injectStationCrosswalk } from "@/lib/station-crosswalk";
import { checkSql } from "@/lib/guardrails";
import { recordTriviaGeneration } from "@/lib/record-query-run";
import {
  addUsage,
  buildTokenSummary,
  computeCostUsd,
  createAccumulator,
} from "@/lib/query-run-tokens";
import {
  generateTriviaQuestion,
  getTriviaModel,
  TriviaGenerationError,
} from "@/lib/trivia";
import {
  checkMtaFareColumnsBanned,
  formatTriviaSenseFeedback,
  validateTriviaQuestionSense,
} from "@/lib/trivia-sense";
import {
  validateTlcProofDistances,
  validateTlcZoneMinPickups,
} from "@/lib/tlc-trip-filters";
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
  /** Which surface triggered this generation — logged as backend "trivia-solo" / "trivia-room". */
  mode?: "solo" | "room";
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
  const mode = session.mode ?? "solo";
  const tokenAcc = createAccumulator();
  const model = getTriviaModel();

  const logFailure = (attempts: number, question?: string) => {
    void recordTriviaGeneration({
      mode,
      question: question ?? "(trivia question generation failed)",
      sql: lastSql,
      model,
      athenaState: "FAILED",
      errorReason: lastFeedback ?? "Unknown failure",
      tokensUsed: buildTokenSummary(tokenAcc),
      costUsd: computeCostUsd(tokenAcc.input_tokens, tokenAcc.output_tokens, model),
      categoryId: session.categoryId,
      deck: session.deck,
      attempts,
    });
  };

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
      if (e instanceof TriviaGenerationError) {
        addUsage(tokenAcc, {
          input_tokens: e.usage.inputTokens,
          output_tokens: e.usage.outputTokens,
        });
      }
      lastFeedback = errorMessage(e);
      logFailure(attempt + 1);
      return {
        ok: false,
        error: "Failed to generate trivia question",
        detail: errorMessage(e),
      };
    }

    addUsage(tokenAcc, {
      input_tokens: generated.usage.inputTokens,
      output_tokens: generated.usage.outputTokens,
    });

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

    const mtaFareSql = checkMtaFareColumnsBanned(guard.sql);
    if (!mtaFareSql.ok) {
      lastSql = guard.sql;
      lastFeedback = mtaFareSql.reason;
      continue;
    }

    let results;
    try {
      const executableSql = injectStationCrosswalk(guard.sql);
      const executionId = await startQuery(executableSql);
      results = await waitForAthenaResults(executionId, { pollMs: 400 });
    } catch (e) {
      lastSql = guard.sql;
      const athenaMsg = errorMessage(e);
      if (/FUNCTION_NOT_FOUND.*\btrim\b/i.test(athenaMsg)) {
        lastFeedback =
          "Athena rejected TRIM() on a numeric value (DOUBLE/BIGINT). " +
          "TRIM is VARCHAR-only: TRY_CAST(TRIM(REGEXP_REPLACE(acs_col, ',', '')) AS DOUBLE) for census; " +
          "TRIM(CAST(geoid AS VARCHAR)) for geoid joins; never TRIM(TRY_CAST(... AS DOUBLE)), TRIM(SUM(...)), or TRIM(latitude). " +
          `Original error: ${athenaMsg}`;
        console.warn("[trivia] TRIM on numeric — rejected SQL:\n", guard.sql);
      } else {
        lastFeedback = `Athena error: ${athenaMsg}`;
      }
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

    const zoneSample = validateTlcZoneMinPickups(
      guard.sql,
      results.columns,
      results.rows
    );
    if (!zoneSample.ok) {
      lastSql = guard.sql;
      lastFeedback = zoneSample.reason;
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

    void recordTriviaGeneration({
      mode,
      question: generated.question,
      sql: guard.sql,
      model: generated.model,
      athenaState: "SUCCEEDED",
      scannedBytes: results.scannedBytes,
      runtimeMs: results.executionTimeMs,
      rowCount: results.rows.length,
      tokensUsed: buildTokenSummary(tokenAcc),
      costUsd: computeCostUsd(
        tokenAcc.input_tokens,
        tokenAcc.output_tokens,
        generated.model
      ),
      categoryId: generated.categoryId,
      deck: session.deck,
      attempts: attempt + 1,
    });

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

  logFailure(MAX_ATTEMPTS);

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
