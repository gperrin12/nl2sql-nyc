import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { getPgPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  nickname: z.string().trim().min(1).max(24),
});

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
      { error: "nickname is required (1–24 chars)" },
      { status: 400 }
    );
  }

  try {
    const room = await pool.query<{ status: string }>(
      `SELECT status FROM trivia_rooms WHERE code = $1`,
      [roomCode]
    );
    if (room.rowCount === 0) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    if (room.rows[0].status !== "lobby") {
      return NextResponse.json(
        { error: "This room has already started" },
        { status: 409 }
      );
    }

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO trivia_room_players (room_code, nickname)
       VALUES ($1, $2)
       RETURNING id`,
      [roomCode, body.nickname]
    );

    return NextResponse.json({ playerId: inserted.rows[0].id });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to join room",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}
