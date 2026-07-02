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

// Initial pass + this many retry rounds to backfill slots that failed
// verification. Bounded so a persistently failing generator can't loop forever.
const MAX_BUILD_ROUNDS = 4;

/**
 * Build a fixed array of `length` verified questions for a room at creation
 * time, running the shared in-process trivia generator/verifier once per slot.
 * Each slot gets a distinct category from the grab-bag session plan for variety.
 *
 * Verification (sense/proof checks + the Athena query) rejects some questions,
 * so the first parallel pass often comes up short. We retry only the shortfall,
 * in parallel, over a few bounded rounds until we hit the exact count. If we
 * genuinely can't reach it we return whatever verified (a slightly shorter room
 * beats a failed creation); only a completely empty result throws.
 */
export async function buildLockedQuestionSet(
  length: number
): Promise<TriviaRoomQuestion[]> {
  const plan = buildSessionCategoryPlan(length, categoriesForDeck("grab-bag"));

  const questions: TriviaRoomQuestion[] = [];
  let lastFailure: string | null = null;

  for (
    let round = 0;
    round < MAX_BUILD_ROUNDS && questions.length < length;
    round++
  ) {
    const remaining = length - questions.length;
    const settled = await Promise.all(
      Array.from({ length: remaining }, (_, i) => {
        // Keep category variety across rounds by continuing through the plan.
        const planIndex = (questions.length + i) % plan.length;
        return generateOneRoomQuestion(plan[planIndex]);
      })
    );

    for (const r of settled) {
      if (r.ok) questions.push(r.question);
      else lastFailure = r.reason;
    }
  }

  if (questions.length === 0) {
    // Surface the underlying reason (e.g. Anthropic/Athena failure) instead of
    // a blanket failure — otherwise this is undebuggable.
    throw new Error(
      `Failed to generate any trivia questions for the room: ${lastFailure ?? "unknown error"}`
    );
  }

  // Never exceed the requested count (rounds are sized to the shortfall, so this
  // is just a safety clamp).
  return questions.slice(0, length);
}

type RoomQuestionResult =
  | { ok: true; question: TriviaRoomQuestion }
  | { ok: false; reason: string };

async function generateOneRoomQuestion(
  categoryId: string | undefined
): Promise<RoomQuestionResult> {
  try {
    const result = await generateVerifiedTriviaQuestion({
      deck: "grab-bag",
      categoryId,
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
