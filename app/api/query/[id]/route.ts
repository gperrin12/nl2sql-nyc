import { NextRequest, NextResponse } from "next/server";
import { getStatus, getResults } from "@/lib/athena";
import { isAuthenticated } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let status;
  try {
    status = await getStatus(id);
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to get query status", detail: errorMessage(e) },
      { status: 502 }
    );
  }

  if (status.state === "SUCCEEDED") {
    try {
      const results = await getResults(id);
      // Spread results first so its scannedBytes/executionTimeMs are
      // overridden by the more authoritative status numbers if present.
      return NextResponse.json({
        ...results,
        state: status.state,
        scannedBytes: status.scannedBytes,
        runtimeMs: status.runtimeMs,
      });
    } catch (e) {
      return NextResponse.json(
        { error: "Failed to fetch results", detail: errorMessage(e) },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({
    state: status.state,
    reason: status.reason,
    scannedBytes: status.scannedBytes,
    runtimeMs: status.runtimeMs,
  });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
