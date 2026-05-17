import { inferVizType, type VizType } from "@/lib/viz-infer";

export type ReplayResult = {
  question: string;
  sql: string;
  athenaStatus: "SUCCEEDED" | "FAILED" | "TIMEOUT" | "ERROR";
  errorReason?: string;
  rowCount: number | null;
  columns: string[] | null;
  sampleRows: Record<string, string | null>[] | null;
  scannedBytes: number | null;
  runtimeMs: number | null;
  vizType: VizType | null;
  emptyResult: boolean;
};

type StartResponse = {
  executionId?: string;
  sql?: string;
  error?: string;
  reason?: string;
  detail?: string;
};

type PollResponse = {
  state: string;
  reason?: string;
  columns?: string[];
  rows?: Record<string, string | null>[];
  scannedBytes?: number;
  runtimeMs?: number;
  error?: string;
  detail?: string;
};

const POLL_MS = 1500;
const TIMEOUT_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function parseAuthCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/(?:^|,\s*)auth=([^;]+)/);
  return match ? match[1] : null;
}

async function login(): Promise<string | null> {
  const password = process.env.APP_PASSWORD?.trim();
  if (!password) return null;

  const res = await fetch(`${baseUrl()}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    throw new Error(`Login failed: HTTP ${res.status}`);
  }

  const cookie = parseAuthCookie(res.headers.get("set-cookie"));
  if (!cookie) {
    throw new Error("Login succeeded but no auth cookie returned");
  }
  return cookie;
}

function authHeaders(cookie: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cookie) headers.Cookie = `auth=${cookie}`;
  return headers;
}

function errorReplay(
  question: string,
  sql: string,
  errorReason: string
): ReplayResult {
  return {
    question,
    sql,
    athenaStatus: "ERROR",
    errorReason,
    rowCount: null,
    columns: null,
    sampleRows: null,
    scannedBytes: null,
    runtimeMs: null,
    vizType: null,
    emptyResult: false,
  };
}

/** Replay a question through the running app and capture Athena result data. */
export async function replayQuestion(question: string): Promise<ReplayResult> {
  const cookie = await login();
  const headers = authHeaders(cookie);

  const startRes = await fetch(`${baseUrl()}/api/query/start`, {
    method: "POST",
    headers,
    body: JSON.stringify({ question }),
  });

  let startBody: StartResponse;
  try {
    startBody = (await startRes.json()) as StartResponse;
  } catch {
    return errorReplay(question, "", `Invalid JSON from start: HTTP ${startRes.status}`);
  }

  if (startRes.status === 401) {
    return errorReplay(
      question,
      startBody.sql ?? "",
      "Unauthorized — check APP_PASSWORD"
    );
  }

  if (!startRes.ok) {
    const reason =
      startBody.reason ??
      startBody.detail ??
      startBody.error ??
      `HTTP ${startRes.status}`;
    return errorReplay(question, startBody.sql ?? "", reason);
  }

  const executionId = startBody.executionId;
  const sql = startBody.sql ?? "";
  if (!executionId) {
    return errorReplay(question, sql, "Start response missing executionId");
  }

  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_MS);

    const pollRes = await fetch(`${baseUrl()}/api/query/${executionId}`, {
      headers: cookie ? { Cookie: `auth=${cookie}` } : {},
    });

    let poll: PollResponse;
    try {
      poll = (await pollRes.json()) as PollResponse;
    } catch {
      return errorReplay(question, sql, `Invalid JSON from poll: HTTP ${pollRes.status}`);
    }

    if (!pollRes.ok) {
      const reason =
        poll.detail ?? poll.error ?? `Poll failed: HTTP ${pollRes.status}`;
      return errorReplay(question, sql, reason);
    }

    const state = poll.state;

    if (state === "SUCCEEDED") {
      const columns = poll.columns ?? [];
      const rows = poll.rows ?? [];
      const sampleRows = rows.slice(0, 5);
      const rowCount = rows.length;
      return {
        question,
        sql,
        athenaStatus: "SUCCEEDED",
        rowCount,
        columns,
        sampleRows,
        scannedBytes: poll.scannedBytes ?? null,
        runtimeMs: poll.runtimeMs ?? null,
        vizType: columns.length > 0 ? inferVizType(columns) : null,
        emptyResult: rowCount === 0,
      };
    }

    if (state === "FAILED" || state === "CANCELLED") {
      return {
        question,
        sql,
        athenaStatus: "FAILED",
        errorReason: poll.reason ?? state,
        rowCount: null,
        columns: null,
        sampleRows: null,
        scannedBytes: poll.scannedBytes ?? null,
        runtimeMs: poll.runtimeMs ?? null,
        vizType: null,
        emptyResult: false,
      };
    }
  }

  return {
    question,
    sql,
    athenaStatus: "TIMEOUT",
    errorReason: `Athena did not finish within ${TIMEOUT_MS / 1000}s`,
    rowCount: null,
    columns: null,
    sampleRows: null,
    scannedBytes: null,
    runtimeMs: null,
    vizType: null,
    emptyResult: false,
  };
}
