import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { loadEvals } from "@/lib/evals-store";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let evals;
  try {
    evals = await loadEvals();
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to load evals",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  evals.sort(
    (a, b) =>
      new Date(b.judgedAt).getTime() - new Date(a.judgedAt).getTime()
  );

  return NextResponse.json(evals);
}
