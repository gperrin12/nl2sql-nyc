import { readFileSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import type { JudgeResult } from "@/lib/judge";

const EVALS_PATH = path.join(process.cwd(), "data", "evals.json");

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let evals: JudgeResult[] = [];
  try {
    const raw = readFileSync(EVALS_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      evals = parsed.filter(
        (e): e is JudgeResult =>
          e &&
          typeof e === "object" &&
          typeof (e as JudgeResult).question === "string"
      );
    }
  } catch {
    evals = [];
  }

  evals.sort(
    (a, b) =>
      new Date(b.judgedAt).getTime() - new Date(a.judgedAt).getTime()
  );

  return NextResponse.json(evals);
}
