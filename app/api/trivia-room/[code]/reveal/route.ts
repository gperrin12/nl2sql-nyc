import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { getPgPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  playerId: z.string().uuid(),
});

type RevealRow = {
  current_index: number;
  answer_revealed: boolean;
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
    return NextResponse.json({ error: "playerId is required" }, { status: 400 });
  }

  try {
    // Host-only, and only while a question is live. Setting answer_revealed
    // locks further submissions (enforced in the answer route) and lets every
    // client show the correct answer at the same time.
    const updated = await pool.query<RevealRow>(
      `UPDATE trivia_rooms
          SET answer_revealed = true
        WHERE code = $1 AND host_player_id = $2 AND status = 'playing'
        RETURNING current_index, answer_revealed`,
      [roomCode, body.playerId]
    );

    if (updated.rowCount === 0) {
      const room = await pool.query<{ host_player_id: string; status: string }>(
        `SELECT host_player_id, status FROM trivia_rooms WHERE code = $1`,
        [roomCode]
      );
      if (room.rowCount === 0) {
        return NextResponse.json({ error: "Room not found" }, { status: 404 });
      }
      if (room.rows[0].host_player_id !== body.playerId) {
        return NextResponse.json(
          { error: "Only the host can reveal the answer" },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: "No live question to reveal" },
        { status: 409 }
      );
    }

    return NextResponse.json({
      currentIndex: updated.rows[0].current_index,
      answerRevealed: updated.rows[0].answer_revealed,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to reveal answer",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}
