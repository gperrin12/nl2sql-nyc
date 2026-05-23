import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { loadDashboardMoments } from "@/lib/load-dashboard-moments";

const FETCH_LIMIT = 200;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(
    200,
    Math.max(1, Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50)
  );
  const offset = Math.max(
    0,
    Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0
  );
  const appVersion = searchParams.get("appVersion") ?? undefined;

  try {
    const payload = await loadDashboardMoments({
      fetchLimit: FETCH_LIMIT,
      offset,
      pageLimit: limit,
      appVersion,
    });
    return NextResponse.json(payload);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[dashboard/moments]", detail);
    return NextResponse.json(
      { error: "Failed to load dashboard queries", detail },
      { status: 502 }
    );
  }
}
