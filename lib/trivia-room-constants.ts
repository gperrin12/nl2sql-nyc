/**
 * Client-safe constants for room-code multiplayer trivia. Kept separate from
 * lib/trivia-room (which imports the server-only generator/verifier) so client
 * components can import these without dragging server code into the browser
 * bundle. lib/trivia-room re-exports everything here for server callers.
 */

/**
 * Per-question countdown. When it runs out (or everyone has answered) the answer
 * auto-locks and the correct choice is revealed to everyone at once.
 */
export const ROOM_QUESTION_DURATION_SECONDS = 60;

/** Round lengths the host can pick when creating a room. */
export const ROOM_QUESTION_COUNT_OPTIONS = [10, 15, 20] as const;
export type RoomQuestionCount = (typeof ROOM_QUESTION_COUNT_OPTIONS)[number];
export const DEFAULT_ROOM_QUESTION_COUNT: RoomQuestionCount = 10;

/** Whether a value is one of the allowed round lengths. */
export function isValidRoomQuestionCount(
  value: number
): value is RoomQuestionCount {
  return (ROOM_QUESTION_COUNT_OPTIONS as readonly number[]).includes(value);
}
