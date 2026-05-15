import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { enrichDashboardMoments } from "@/lib/enrich-dashboard-moments";
import {
  paginateMoments,
  pairSessionMessages,
  unwrapTimelinePayload,
} from "@/lib/p8k8-moments";
import { loadLatencyByKey } from "@/lib/query-metrics-store";
import { resolveP8k8ChatId } from "@/lib/p8k8";

const P8K8_URL = (process.env.P8K8_URL ?? "").replace(/\/$/, "");
const P8K8_AUTH_TOKEN = process.env.P8K8_AUTH_TOKEN ?? "";
const P8K8_FETCH_LIMIT = 200;

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!P8K8_URL || !P8K8_AUTH_TOKEN) {
    return NextResponse.json(
      {
        error: "p8k8 is not configured",
        detail: "Set P8K8_URL and P8K8_AUTH_TOKEN",
      },
      { status: 502 }
    );
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

  const sessionId = resolveP8k8ChatId();
  const url = `${P8K8_URL}/moments/session/${encodeURIComponent(sessionId)}?limit=${P8K8_FETCH_LIMIT}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${P8K8_AUTH_TOKEN}` },
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to reach p8k8",
        detail: errorMessage(e),
      },
      { status: 502 }
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    return NextResponse.json(
      {
        error: "p8k8 session timeline failed",
        detail: `HTTP ${res.status}: ${body.slice(0, 500)}`,
      },
      { status: 502 }
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    return NextResponse.json(
      {
        error: "Invalid p8k8 response",
        detail: errorMessage(e),
      },
      { status: 502 }
    );
  }

  const events = unwrapTimelinePayload(data);
  const paired = pairSessionMessages(events);
  const latencyByKey = await loadLatencyByKey();
  const enriched = enrichDashboardMoments(paired, latencyByKey);
  const { moments, total } = paginateMoments(enriched, offset, limit);

  return NextResponse.json({ moments, total });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
