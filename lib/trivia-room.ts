/**
 * Helpers for room-code multiplayer trivia (/trivia/live).
 * Pure functions plus the room-creation question builder, which calls the shared
 * in-process trivia generator/verifier (lib/trivia-generate-verified) — the same
 * pipeline /api/trivia/question uses — so there is never a second generator and
 * no fragile HTTP self-call.
 */

import {
  buildSessionCategoryPlan,
  categoriesForDeck,
} from "@/lib/trivia-categories";
import { EXCLUDE_ANSWERS_WINDOW } from "@/lib/trivia-session";
import { generateVerifiedTriviaQuestion } from "@/lib/trivia-generate-verified";

// Re-exported so server callers can keep importing constants from lib/trivia-room.
export {
  ROOM_QUESTION_DURATION_SECONDS,
  ROOM_QUESTION_COUNT_OPTIONS,
  DEFAULT_ROOM_QUESTION_COUNT,
  isValidRoomQuestionCount,
  type RoomQuestionCount,
} from "@/lib/trivia-room-constants";

/** A single locked question stored in trivia_rooms.questions (JSONB). */
export type TriviaRoomQuestion = {
  question: string;
  choices: string[];
  correctIndex: number;
  categoryLabel: string;
};

/** What a player is allowed to see — never includes correctIndex. */
export type PublicTriviaRoomQuestion = {
  question: string;
  choices: string[];
  categoryLabel: string;
};

const ROOM_CODE_LENGTH = 6;
// Uppercase letters + digits, minus visually ambiguous chars (0/O, 1/I/L).
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * 6-char room code from an unambiguous alphabet. Not guaranteed unique — the
 * caller retries the insert on a unique-violation and generates a fresh code.
 */
export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[idx];
  }
  return code;
}

/** Strip the answer before sending a question to a player. */
export function toPublicQuestion(
  q: TriviaRoomQuestion
): PublicTriviaRoomQuestion {
  return {
    question: q.question,
    choices: q.choices,
    categoryLabel: q.categoryLabel,
  };
}

/** Seconds left in the current question window; never negative. */
export function computeTimeRemaining(
  startedAt: string,
  durationSeconds: number
): number {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return 0;
  const elapsedSeconds = (Date.now() - started) / 1000;
  return Math.max(0, Math.ceil(durationSeconds - elapsedSeconds));
}

/**
 * Decide whether the current question's answer should auto-reveal. Reveal when
 * the countdown has run out, or when every player who can answer already has
 * (i.e. before the timer, so the room doesn't wait needlessly). `expectedAnswerers`
 * excludes the host, who runs the game and never submits an answer — passing 0
 * disables the "everyone answered" path so a host-only room only reveals on time.
 */
export function shouldAutoReveal({
  startedAt,
  durationSeconds,
  answeredCount,
  expectedAnswerers,
}: {
  startedAt: string | null;
  durationSeconds: number;
  answeredCount: number;
  expectedAnswerers: number;
}): boolean {
  if (startedAt && computeTimeRemaining(startedAt, durationSeconds) <= 0) {
    return true;
  }
  return expectedAnswerers > 0 && answeredCount >= expectedAnswerers;
}

// Per-slot retry multiplier for the global attempt budget. A persistently
// failing category must not abort the whole deck — we rotate and keep filling.
const MAX_BUILD_ROUNDS = 4;

/**
 * Build a fixed array of `length` verified questions for a room at creation
 * time, running the shared in-process trivia generator/verifier once per attempt.
 * Categories come from the MTA session plan for variety.
 *
 * Verification (sense/proof checks + Athena) rejects some candidates. When a
 * category keeps failing we advance to the next plan entry and prefer
 * less-failed categories, bounded by `length * MAX_BUILD_ROUNDS` total attempts.
 * Requires the exact requested length — a short deck is an error, not a
 * silent success (hosts asked for N questions for their friends).
 */
export async function buildLockedQuestionSet(
  length: number
): Promise<TriviaRoomQuestion[]> {
  const plan = buildSessionCategoryPlan(length, categoriesForDeck("mta"));
  if (plan.length === 0) {
    throw new Error("Failed to build trivia category plan for the room");
  }

  const questions: TriviaRoomQuestion[] = [];
  let lastFailure: string | null = null;
  const failCounts = new Map<string, number>();
  const maxAttempts = length * MAX_BUILD_ROUNDS;

  for (
    let attempt = 0;
    attempt < maxAttempts && questions.length < length;
    attempt++
  ) {
    const categoryId = pickNextBuildCategory(plan, failCounts, attempt);
    const excludeQuestions = questions.map((q) => q.question);
    const excludeAnswers = questions
      .map((q) => q.choices[q.correctIndex])
      .slice(-EXCLUDE_ANSWERS_WINDOW);

    const r = await generateOneRoomQuestion(categoryId, {
      excludeQuestions: excludeQuestions.length ? excludeQuestions : undefined,
      excludeAnswers: excludeAnswers.length ? excludeAnswers : undefined,
    });

    if (r.ok) {
      questions.push(r.question);
      continue;
    }

    lastFailure = r.reason;
    failCounts.set(categoryId, (failCounts.get(categoryId) ?? 0) + 1);
    console.warn(
      `[trivia-room] generation failed category=${categoryId} filled=${questions.length}/${length}: ${r.reason}`
    );
  }

  if (questions.length < length) {
    throw new Error(
      `Failed to build full trivia question set (${questions.length}/${length}): ${lastFailure ?? "unknown error"}`
    );
  }

  return questions;
}

/**
 * Rotate through the category plan, preferring ids with fewer prior failures so
 * a sticky-bad category does not monopolize the attempt budget.
 */
export function pickNextBuildCategory(
  plan: string[],
  failCounts: Map<string, number>,
  attempt: number
): string {
  let bestId = plan[attempt % plan.length];
  let bestFails = failCounts.get(bestId) ?? 0;

  for (let i = 0; i < plan.length; i++) {
    const id = plan[(attempt + i) % plan.length];
    const fails = failCounts.get(id) ?? 0;
    if (fails < bestFails) {
      bestId = id;
      bestFails = fails;
    }
  }

  return bestId;
}

type RoomQuestionResult =
  | { ok: true; question: TriviaRoomQuestion }
  | { ok: false; reason: string };

async function generateOneRoomQuestion(
  categoryId: string | undefined,
  session?: { excludeQuestions?: string[]; excludeAnswers?: string[] }
): Promise<RoomQuestionResult> {
  try {
    const result = await generateVerifiedTriviaQuestion({
      deck: "mta",
      categoryId,
      excludeQuestions: session?.excludeQuestions,
      excludeAnswers: session?.excludeAnswers,
      mode: "room",
    });
    if (!result.ok) {
      return { ok: false, reason: result.detail || result.error };
    }
    const { question } = result;
    return {
      ok: true,
      question: {
        question: question.question,
        choices: question.options,
        correctIndex: question.correctIndex,
        categoryLabel: question.categoryLabel ?? "",
      },
    };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
