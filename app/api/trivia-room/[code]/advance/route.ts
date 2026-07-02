import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { getPgPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  playerId: z.string().uuid(),
});

type AdvanceRow = {
  status: "lobby" | "playing" | "finished";
  current_index: number;
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
      { error: "playerId is required" },
      { status: 400 }
    );
  }

  try {
    // Single atomic transition — lobby→playing (index 0), playing→next index,
    // or playing→finished when the last question has been shown. Guarding on
    // host_player_id and computing the new index in-statement avoids
    // read-then-write double-advance races.
    const updated = await pool.query<AdvanceRow>(
      `UPDATE trivia_rooms
          SET status = CASE
                WHEN status = 'lobby' THEN 'playing'
                WHEN status = 'playing'
                     AND current_index + 1 >= jsonb_array_length(questions)
                  THEN 'finished'
                ELSE status
              END,
              current_index = CASE
                WHEN status = 'lobby' THEN 0
                WHEN status = 'playing'
                     AND current_index + 1 < jsonb_array_length(questions)
                  THEN current_index + 1
                ELSE current_index
              END,
              question_started_at = CASE
                WHEN status = 'lobby' THEN now()
                WHEN status = 'playing'
                     AND current_index + 1 < jsonb_array_length(questions)
                  THEN now()
                ELSE question_started_at
              END
        WHERE code = $1 AND host_player_id = $2
        RETURNING status, current_index`,
      [roomCode, body.playerId]
    );

    if (updated.rowCount === 0) {
      const exists = await pool.query(
        `SELECT 1 FROM trivia_rooms WHERE code = $1`,
        [roomCode]
      );
      if (exists.rowCount === 0) {
        return NextResponse.json({ error: "Room not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Only the host can advance the game" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      status: updated.rows[0].status,
      currentIndex: updated.rows[0].current_index,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to advance room",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}
