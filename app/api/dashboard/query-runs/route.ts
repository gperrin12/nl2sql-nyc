import { NextRequest, NextResponse } from "next/server";
import { getAppVersion, resolveQueryRunsAppVersion } from "@/lib/app-version";
import { isAuthenticated } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { listQueryRuns } from "@/lib/query-runs-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({
      runs: [],
      configured: false,
    });
  }

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : 50;
  const versionFilter = resolveQueryRunsAppVersion(
    req.nextUrl.searchParams.get("appVersion")
  );

  try {
    const runs = await listQueryRuns(Number.isFinite(limit) ? limit : 50, {
      appVersion: versionFilter,
    });
    return NextResponse.json({
      runs,
      configured: true,
      currentAppVersion: getAppVersion(),
      filteredAppVersion: versionFilter ?? null,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[dashboard/query-runs]", detail);
    return NextResponse.json(
      { error: "Failed to load query runs", detail },
      { status: 502 }
    );
  }
}
