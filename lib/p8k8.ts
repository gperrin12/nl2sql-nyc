/**
 * lib/p8k8.ts
 *
 * Thin client for the p8k8 agentic memory backend.
 * Docs: https://github.com/Percolation-Labs/p8k8
 *
 * POST /chat/{chat_uuid}
 *   Header: x-agent-schema-name: nl2sql-nyc   (override via P8K8_SCHEMA env)
 *   Header: Authorization: Bearer <P8K8_AUTH_TOKEN>
 *   Body:   { "messages": [{ "id": "<uuid>", "role": "user", "content": "..." }] }
 *
 * The endpoint streams AG-UI Server-Sent Events.  We only care about
 * TEXT_MESSAGE_CONTENT delta events, which carry the assistant's reply
 * incrementally.  All deltas are accumulated and returned as full text.
 *
 * SqlGenerationResult shape is identical to lib/claude.ts so the route
 * handler needs no schema changes.
 */

import type { SqlGenerationResult } from "@/lib/claude";

// ── env ─────────────────────────────────────────────────────────────────────
const P8K8_URL = (process.env.P8K8_URL ?? "").replace(/\/$/, "");
const P8K8_AUTH_TOKEN = process.env.P8K8_AUTH_TOKEN ?? "";
const P8K8_SCHEMA = process.env.P8K8_SCHEMA ?? "nl2sql-nyc";

/** p8k8 rejects non-UUID chat paths; used when P8K8_CHAT_ID is unset. */
const DEFAULT_P8K8_CHAT_ID = "f6e3c2b1-a8d7-4e91-bc0d-1a2b3c4d5e6f";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!P8K8_URL) {
  console.warn("[p8k8] P8K8_URL is not set — calls will fail at runtime");
}

function assertValidUuid(id: string, label: string): string {
  const t = id.trim();
  if (!UUID_RE.test(t)) {
    throw new Error(
      `${label} must be a UUID for p8k8 /chat/{id}. Got ${JSON.stringify(id)}. ` +
        "Set P8K8_CHAT_ID to a stable value from uuidgen(), or pass a UUID as conversationId."
    );
  }
  return t;
}

/** Resolves chat path segment: explicit arg > P8K8_CHAT_ID env > repo default UUID. */
export function resolveP8k8ChatId(conversationId?: string): string {
  if (conversationId !== undefined && conversationId !== "") {
    return assertValidUuid(conversationId, "conversationId");
  }
  const fromEnv = process.env.P8K8_CHAT_ID?.trim();
  if (fromEnv) return assertValidUuid(fromEnv, "P8K8_CHAT_ID");
  return DEFAULT_P8K8_CHAT_ID;
}

/** RFC-style UUID v4 for AG-UI message `id` (p8k8 examples include per-message ids). */
function randomUuidV4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── AG-UI event types we handle ──────────────────────────────────────────────
type AgUiEvent =
  | { type: "TEXT_MESSAGE_CONTENT"; delta: string }
  | { type: string; [key: string]: unknown };

// ── helpers ──────────────────────────────────────────────────────────────────

/** Strip ```sql … ``` fences the model may still emit. */
function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1] : text;
}

/**
 * Pull the first SELECT/WITH block out of the assistant text.
 * Mirrors the extraction logic in lib/sql-agent/run.ts.
 */
function extractSql(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;

  // Whole reply is SQL after fence-stripping.
  const unfenced = stripCodeFences(raw).trim();
  if (/^\s*(WITH|SELECT)\b/i.test(unfenced)) return unfenced;

  // Scan fenced blocks.
  const fenceRe = /```(?:sql)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw)) !== null) {
    const inner = m[1].trim();
    if (/^\s*(WITH|SELECT)\b/i.test(inner)) return inner;
  }

  // Line-anchored SELECT/WITH.
  const lineMatch = raw.match(/(?:^|\n)(\s*(?:WITH|SELECT)\b[\s\S]*)/i);
  if (lineMatch) {
    const sql = lineMatch[1].trim().replace(/```[\s\S]*$/, "").trim();
    if (/^\s*(WITH|SELECT)\b/i.test(sql)) return sql;
  }

  // After a colon/period intro sentence.
  const afterIntro = raw.match(/[.:]\s*(\s*(?:WITH|SELECT)\b[\s\S]*)/i);
  if (afterIntro) {
    const sql = afterIntro[1].trim().replace(/```[\s\S]*$/, "").trim();
    if (/^\s*(WITH|SELECT)\b/i.test(sql)) return sql;
  }

  return null;
}

/**
 * Consume an SSE response stream, accumulating TEXT_MESSAGE_CONTENT deltas.
 *
 * AG-UI events arrive as newline-delimited SSE lines:
 *   data: {"type":"TEXT_MESSAGE_CONTENT","delta":"SELECT ..."}
 */
async function consumeAgUiStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let assembled = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buf.indexOf("\n")) !== -1) {
      const raw = buf.slice(0, sep).trim();
      buf = buf.slice(sep + 1);

      if (!raw || !raw.startsWith("data:")) continue;

      const jsonStr = raw.startsWith("data: ") ? raw.slice(6) : raw.slice(5);
      if (!jsonStr.trim()) continue;

      let event: AgUiEvent;
      try {
        event = JSON.parse(jsonStr) as AgUiEvent;
      } catch {
        continue; // malformed line — skip
      }

      if (event.type === "TEXT_MESSAGE_CONTENT" && typeof event.delta === "string") {
        assembled += event.delta;
      }
    }
  }

  return assembled;
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Send a natural-language question to p8k8 and return the extracted SQL.
 *
 * @param question        The user's NL question.
 * @param conversationId  Optional UUID for `/chat/{uuid}`. If omitted, uses
 *                          `P8K8_CHAT_ID` or a stable built-in default (shared context).
 */
export async function generateSqlViaP8k8(
  question: string,
  conversationId?: string
): Promise<SqlGenerationResult> {
  if (!P8K8_URL) {
    throw new Error("P8K8_URL environment variable is not configured");
  }
  if (!P8K8_AUTH_TOKEN) {
    throw new Error("P8K8_AUTH_TOKEN environment variable is not configured");
  }

  const chatId = resolveP8k8ChatId(conversationId);
  const url = `${P8K8_URL}/chat/${encodeURIComponent(chatId)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      Authorization: `Bearer ${P8K8_AUTH_TOKEN}`,
      "x-agent-schema-name": P8K8_SCHEMA,
    },
    body: JSON.stringify({
      messages: [
        { id: randomUuidV4(), role: "user", content: question },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`p8k8 responded ${res.status}: ${body}`);
  }

  if (!res.body) {
    throw new Error("p8k8 returned no response body");
  }

  const fullText = await consumeAgUiStream(res.body);

  if (!fullText.trim()) {
    throw new Error("p8k8 returned an empty assistant message");
  }

  const sql = extractSql(fullText);
  if (!sql) {
    throw new Error(
      `p8k8 reply contained no SELECT or WITH statement.\n\nRaw reply (first 500 chars):\n${fullText.slice(0, 500)}`
    );
  }

  // p8k8 doesn't surface the underlying model name or token counts in the
  // streaming events — use sentinel values so downstream code compiles cleanly.
  return {
    sql: sql.trim(),
    model: "p8k8",
    inputTokens: 0,
    outputTokens: 0,
  };
}
