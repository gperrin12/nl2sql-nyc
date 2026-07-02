import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getPgPool } from "@/lib/db";
import {
  toPublicQuestion,
  type PublicTriviaRoomQuestion,
  type TriviaRoomQuestion,
} from "@/lib/trivia-room";

export const dynamic = "force-dynamic";

type RoomRow = {
  status: "lobby" | "playing" | "finished";
  host_player_id: string;
  questions: TriviaRoomQuestion[];
  current_index: number;
  question_started_at: string | null;
  question_duration_seconds: number;
  answer_revealed: boolean;
};

type PlayerRow = {
  id: string;
  nickname: string;
  score: number;
  correct_count: number | null;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pool = getPgPool();
  if (!pool) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const { code } = await params;
  const roomCode = code.toUpperCase();
  const playerId = req.nextUrl.searchParams.get("playerId") ?? undefined;

  try {
    const roomRes = await pool.query<RoomRow>(
      `SELECT status, host_player_id, questions, current_index,
              question_started_at, question_duration_seconds, answer_revealed
         FROM trivia_rooms
        WHERE code = $1`,
      [roomCode]
    );
    if (roomRes.rowCount === 0) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const room = roomRes.rows[0];
    const isFinished = room.status === "finished";
    const isPlaying = room.status === "playing";
    const answerRevealed = isPlaying && room.answer_revealed;

    // correct_count is only meaningful (and only computed) once the game ends.
    const playersRes = await pool.query<PlayerRow>(
      `SELECT p.id,
              p.nickname,
              p.score,
              CASE WHEN $2 THEN COUNT(a.player_id) FILTER (WHERE a.is_correct)
                   ELSE NULL END AS correct_count
         FROM trivia_room_players p
         LEFT JOIN trivia_room_answers a
           ON a.player_id = p.id AND a.room_code = p.room_code
        WHERE p.room_code = $1
        GROUP BY p.id, p.nickname, p.score, p.joined_at
        ORDER BY p.joined_at ASC`,
      [roomCode, isFinished]
    );

    const players = playersRes.rows.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      ...(isFinished ? { correctCount: Number(p.correct_count ?? 0) } : {}),
    }));

    const totalQuestions = room.questions.length;

    const hasLiveQuestion =
      isPlaying &&
      room.current_index >= 0 &&
      room.current_index < totalQuestions;

    let currentQuestion: PublicTriviaRoomQuestion | null = null;
    let revealedCorrectIndex: number | null = null;
    if (hasLiveQuestion) {
      const q = room.questions[room.current_index];
      currentQuestion = toPublicQuestion(q);
      // The correct answer is only ever exposed after the host reveals.
      if (answerRevealed) revealedCorrectIndex = q.correctIndex;
    }

    // How many players have locked in an answer for the current question, and
    // the requesting player's own answer (so their UI survives a refresh).
    let answeredCount = 0;
    let yourChoiceIndex: number | null = null;
    if (hasLiveQuestion) {
      const answersRes = await pool.query<{ player_id: string; choice_index: number }>(
        `SELECT player_id, choice_index
           FROM trivia_room_answers
          WHERE room_code = $1 AND question_index = $2`,
        [roomCode, room.current_index]
      );
      answeredCount = answersRes.rowCount ?? 0;
      if (playerId) {
        const mine = answersRes.rows.find((r) => r.player_id === playerId);
        yourChoiceIndex = mine ? mine.choice_index : null;
      }
    }

    return NextResponse.json({
      status: room.status,
      currentIndex: room.current_index,
      questionStartedAt: room.question_started_at,
      durationSeconds: room.question_duration_seconds,
      totalQuestions,
      players,
      currentQuestion,
      answerRevealed,
      revealedCorrectIndex,
      answeredCount,
      you: playerId ? { choiceIndex: yourChoiceIndex } : null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to load room state",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}
