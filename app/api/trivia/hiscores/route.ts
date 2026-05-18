import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  isValidHiScoreName,
  HISCORE_NAME_MAX_LENGTH,
  qualifiesForHiScores,
  TRIVIA_SESSION_LENGTH,
  type TriviaHiScoreEntry,
} from "@/lib/trivia-hiscores";
import {
  loadHiScores,
  submitHiScore,
} from "@/lib/trivia-hiscores-store";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const entries = await loadHiScores();
    return NextResponse.json({ entries } satisfies { entries: TriviaHiScoreEntry[] });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to load hi-scores",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}

type PostBody = {
  name?: string;
  initials?: string;
  score?: number;
  total?: number;
};

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name =
    typeof body.name === "string"
      ? body.name
      : typeof body.initials === "string"
        ? body.initials
        : "";
  const score = body.score;
  const total = body.total ?? TRIVIA_SESSION_LENGTH;

  if (!isValidHiScoreName(name)) {
    return NextResponse.json(
      {
        error: `Name must be 1–${HISCORE_NAME_MAX_LENGTH} characters (letters, numbers, space, ', -)`,
      },
      { status: 400 }
    );
  }

  if (
    typeof score !== "number" ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > TRIVIA_SESSION_LENGTH
  ) {
    return NextResponse.json(
      { error: `Score must be an integer from 0 to ${TRIVIA_SESSION_LENGTH}` },
      { status: 400 }
    );
  }

  if (total !== TRIVIA_SESSION_LENGTH) {
    return NextResponse.json(
      { error: `Total must be ${TRIVIA_SESSION_LENGTH}` },
      { status: 400 }
    );
  }

  let board: TriviaHiScoreEntry[];
  try {
    board = await loadHiScores();
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to load hi-scores",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  if (!qualifiesForHiScores(score, board)) {
    return NextResponse.json(
      { error: "Score does not qualify for the top 10" },
      { status: 400 }
    );
  }

  try {
    const result = await submitHiScore(name, score, total);
    return NextResponse.json({
      entries: result.board,
      entry: result.entry,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to save hi-score",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}
