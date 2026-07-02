import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { getPgPool } from "@/lib/db";
import type { TriviaRoomQuestion } from "@/lib/trivia-room";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  playerId: z.string().uuid(),
  questionIndex: z.number().int().min(0),
  choiceIndex: z.number().int().min(0),
});

type RoomRow = {
  status: "lobby" | "playing" | "finished";
  current_index: number;
  answer_revealed: boolean;
  questions: TriviaRoomQuestion[];
};

export async function POST(
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

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "playerId, questionIndex, and choiceIndex are required" },
      { status: 400 }
    );
  }

  try {
    const roomRes = await pool.query<RoomRow>(
      `SELECT status, current_index, answer_revealed, questions
         FROM trivia_rooms
        WHERE code = $1`,
      [roomCode]
    );
    if (roomRes.rowCount === 0) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const room = roomRes.rows[0];
    if (room.status !== "playing") {
      return NextResponse.json(
        { error: "Room is not accepting answers" },
        { status: 409 }
      );
    }

    // Reject stale/late submissions for a question that is no longer live.
    if (body.questionIndex !== room.current_index) {
      return NextResponse.json(
        { error: "This question is no longer active" },
        { status: 409 }
      );
    }

    // Once the host reveals, answers are locked for the current question.
    if (room.answer_revealed) {
      return NextResponse.json(
        { error: "Answers are locked — the host has revealed this question" },
        { status: 409 }
      );
    }

    const question = room.questions[body.questionIndex];
    if (!question) {
      return NextResponse.json(
        { error: "Question not found" },
        { status: 409 }
      );
    }
    if (body.choiceIndex >= question.choices.length) {
      return NextResponse.json(
        { error: "Invalid choice" },
        { status: 400 }
      );
    }

    // Server is the sole source of truth for the correct answer. Scored now but
    // NOT revealed to the player — correctness is disclosed only when the host
    // reveals (via the state endpoint), so an early reaction can't tip others off.
    const isCorrect = body.choiceIndex === question.correctIndex;

    // ON CONFLICT guards double-submit; RETURNING tells us whether this was the
    // first answer so we only ever score a question once per player.
    const inserted = await pool.query(
      `INSERT INTO trivia_room_answers
         (room_code, player_id, question_index, choice_index, is_correct)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (room_code, player_id, question_index) DO NOTHING
       RETURNING player_id`,
      [roomCode, body.playerId, body.questionIndex, body.choiceIndex, isCorrect]
    );

    if ((inserted.rowCount ?? 0) > 0 && isCorrect) {
      await pool.query(
        `UPDATE trivia_room_players
            SET score = score + 1
          WHERE id = $1 AND room_code = $2`,
        [body.playerId, roomCode]
      );
    }

    return NextResponse.json({ recorded: true });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to record answer",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}
