import { NextRequest, NextResponse } from "next/server";
import {
  getAppVersion,
  resolveDashboardAppVersionFilter,
} from "@/lib/app-version";
import { listLatestQueryRunsPerQuestion } from "@/lib/query-runs-store";
import { isAuthenticated } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";

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
  const deployFilter = resolveDashboardAppVersionFilter(
    req.nextUrl.searchParams.get("appVersion")
  );

  try {
    const runs = await listLatestQueryRunsPerQuestion(
      Number.isFinite(limit) ? limit : 50,
      { appVersion: deployFilter }
    );
    return NextResponse.json({
      runs,
      configured: true,
      currentAppVersion: getAppVersion(),
      deployFilter: deployFilter ?? null,
      dedupeByQuestion: true,
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
