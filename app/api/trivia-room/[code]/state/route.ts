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

  try {
    const roomRes = await pool.query<RoomRow>(
      `SELECT status, host_player_id, questions, current_index,
              question_started_at, question_duration_seconds
         FROM trivia_rooms
        WHERE code = $1`,
      [roomCode]
    );
    if (roomRes.rowCount === 0) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const room = roomRes.rows[0];
    const isFinished = room.status === "finished";

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

    let currentQuestion: PublicTriviaRoomQuestion | null = null;
    if (
      room.status === "playing" &&
      room.current_index >= 0 &&
      room.current_index < totalQuestions
    ) {
      currentQuestion = toPublicQuestion(room.questions[room.current_index]);
    }

    return NextResponse.json({
      status: room.status,
      currentIndex: room.current_index,
      questionStartedAt: room.question_started_at,
      durationSeconds: room.question_duration_seconds,
      totalQuestions,
      players,
      currentQuestion,
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
