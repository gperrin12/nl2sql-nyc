import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { getPgPool } from "@/lib/db";
import { TRIVIA_SESSION_LENGTH } from "@/lib/trivia-hiscores";
import { buildLockedQuestionSet, generateRoomCode } from "@/lib/trivia-room";

export const dynamic = "force-dynamic";
// Building the locked question set generates + verifies TRIVIA_SESSION_LENGTH
// questions against Athena, so give the handler generous headroom.
export const maxDuration = 300;

const MAX_CODE_ATTEMPTS = 8;
const PG_UNIQUE_VIOLATION = "23505";

const BodySchema = z.object({
  hostNickname: z.string().trim().min(1).max(24),
});

export async function POST(req: NextRequest) {
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

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "hostNickname is required (1–24 chars)" },
      { status: 400 }
    );
  }

  let questions;
  try {
    questions = await buildLockedQuestionSet(TRIVIA_SESSION_LENGTH);
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to build trivia questions",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  const playerId = randomUUID();
  const questionsJson = JSON.stringify(questions);

  let code: string | null = null;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const candidate = generateRoomCode();
    try {
      await pool.query(
        `INSERT INTO trivia_rooms (code, host_player_id, questions)
         VALUES ($1, $2, $3::jsonb)`,
        [candidate, playerId, questionsJson]
      );
      code = candidate;
      break;
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      return NextResponse.json(
        {
          error: "Failed to create room",
          detail: e instanceof Error ? e.message : String(e),
        },
        { status: 502 }
      );
    }
  }

  if (!code) {
    return NextResponse.json(
      { error: "Could not allocate a unique room code, please retry" },
      { status: 503 }
    );
  }

  try {
    await pool.query(
      `INSERT INTO trivia_room_players (id, room_code, nickname)
       VALUES ($1, $2, $3)`,
      [playerId, code, body.hostNickname]
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to register host player",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ code, playerId });
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}
