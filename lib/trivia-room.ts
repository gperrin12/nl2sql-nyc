/**
 * Helpers for room-code multiplayer trivia (/trivia/live).
 * No framework code here — pure functions plus the room-creation question builder,
 * which reuses the existing /api/trivia/question path (the same endpoint
 * useTriviaQuestion.ts hits) so we never build a second question generator.
 */

import {
  buildSessionCategoryPlan,
  categoriesForDeck,
} from "@/lib/trivia-categories";
import type { TriviaQuestionResponse } from "@/lib/trivia-fetch";

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

/** Base URL for server-side calls to our own API (matches lib/replay.ts). */
function internalBaseUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

/**
 * Build a fixed, identical array of questions for a room at creation time by
 * calling the existing verified trivia question endpoint once per slot. Each
 * slot gets a distinct category from the grab-bag session plan for variety.
 * Requests run in parallel; a couple of failures are tolerated as long as we
 * still meet the minimum length.
 */
export async function buildLockedQuestionSet(
  length: number
): Promise<TriviaRoomQuestion[]> {
  const base = internalBaseUrl();
  const plan = buildSessionCategoryPlan(length, categoriesForDeck("grab-bag"));

  const requests = Array.from({ length }, (_, i) =>
    fetchOneRoomQuestion(base, plan[i])
  );
  const settled = await Promise.all(requests);
  const questions = settled.filter(
    (r): r is { ok: true; question: TriviaRoomQuestion } => r.ok
  ).map((r) => r.question);

  if (questions.length === 0) {
    // Surface the underlying reason (e.g. wrong base URL, 502 from Anthropic /
    // Athena) instead of a blanket failure — otherwise this is undebuggable.
    const firstReason = settled.find((r) => !r.ok);
    const reason = firstReason && !firstReason.ok ? firstReason.reason : "unknown error";
    throw new Error(
      `Failed to generate any trivia questions for the room ` +
        `(called ${base}/api/trivia/question): ${reason}`
    );
  }

  return questions;
}

type RoomQuestionResult =
  | { ok: true; question: TriviaRoomQuestion }
  | { ok: false; reason: string };

async function fetchOneRoomQuestion(
  base: string,
  categoryId: string | undefined
): Promise<RoomQuestionResult> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/trivia/question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deck: "grab-bag", categoryId }),
      cache: "no-store",
    });
  } catch (e) {
    // Network-level failure — almost always a wrong base URL/port for the
    // server calling itself.
    return {
      ok: false,
      reason: `fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!res.ok) {
    let detail = "";
    try {
      const err = (await res.json()) as { error?: string; detail?: string };
      detail = err.detail ?? err.error ?? "";
    } catch {
      // response body not JSON
    }
    return {
      ok: false,
      reason: `HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
    };
  }

  let data: TriviaQuestionResponse;
  try {
    data = (await res.json()) as TriviaQuestionResponse;
  } catch (e) {
    return {
      ok: false,
      reason: `invalid JSON response: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (
    typeof data.question !== "string" ||
    !Array.isArray(data.options) ||
    typeof data.correctIndex !== "number"
  ) {
    return { ok: false, reason: "response missing question/options/correctIndex" };
  }

  return {
    ok: true,
    question: {
      question: data.question,
      choices: data.options,
      correctIndex: data.correctIndex,
      categoryLabel: data.categoryLabel ?? "",
    },
  };
}
