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
 * The endpoint streams AG-UI Server-Sent Events, translated to AgentStreamPayload
 * for the UI trace when using generateSqlViaP8k8WithEvents().
 */

import type { SqlGenerationResult } from "@/lib/claude";
import type { AgentStreamPayload } from "@/lib/sql-agent/types";

// ── env ─────────────────────────────────────────────────────────────────────
const P8K8_URL = (process.env.P8K8_URL ?? "").replace(/\/$/, "");
const P8K8_AUTH_TOKEN = process.env.P8K8_AUTH_TOKEN ?? "";
const P8K8_SCHEMA = process.env.P8K8_SCHEMA ?? "nl2sql-nyc";

/** p8k8 rejects non-UUID chat paths; used when P8K8_CHAT_ID is unset. */
const DEFAULT_P8K8_CHAT_ID = "f6e3c2b1-a8d7-4e91-bc0d-1a2b3c4d5e6f";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OBSERVE_PREVIEW_MAX = 1400;
const REASON_DEBOUNCE_MS = 400;
const REASON_MAX_CHARS = 1200;

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

// ── AG-UI parsing ─────────────────────────────────────────────────────────────

type AgUiEvent = { type: string; [key: string]: unknown };

function parseAgUiSseLine(rawLine: string): AgUiEvent | null {
  const raw = rawLine.trim();
  if (!raw || !raw.startsWith("data:")) return null;

  const jsonStr = raw.startsWith("data: ") ? raw.slice(6) : raw.slice(5);
  if (!jsonStr.trim()) return null;

  try {
    return JSON.parse(jsonStr) as AgUiEvent;
  } catch {
    return null;
  }
}

async function readAgUiStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: AgUiEvent) => void | Promise<void>
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, sep);
      buf = buf.slice(sep + 1);
      const event = parseAgUiSseLine(line);
      if (event) await onEvent(event);
    }
  }
}

function truncatePreview(raw: string, max = OBSERVE_PREVIEW_MAX): string {
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}\n… (${raw.length} chars total)`;
}

function extractLeadingProseBeforeSql(fullText: string, sql: string): string {
  const trimmed = fullText.trim();
  const at = trimmed.indexOf(sql);
  if (at >= 0) return trimmed.slice(0, at).trim();

  const lines = trimmed.split(/\r?\n/);
  const sqlLineIdx = lines.findIndex((l) => /^\s*(WITH|SELECT)\b/i.test(l));
  if (sqlLineIdx >= 0) return lines.slice(0, sqlLineIdx).join("\n").trim();

  return stripCodeFences(trimmed.replace(sql, "")).trim();
}

/** Maps AG-UI events to AgentStreamPayload and accumulates assistant text. */
class AgUiStreamTranslator {
  private messageText = "";
  private turnEmitted = false;
  private reasonDebounce: ReturnType<typeof setTimeout> | null = null;
  private readonly toolCalls = new Map<
    string,
    { name: string; argsBuffer: string }
  >();

  constructor(
    private readonly onEvent: (e: AgentStreamPayload) => void | Promise<void>
  ) {}

  get assembledText(): string {
    return this.messageText;
  }

  async flush(): Promise<void> {
    if (this.reasonDebounce) {
      clearTimeout(this.reasonDebounce);
      this.reasonDebounce = null;
    }
    await this.emitReasonNow();
  }

  async handle(event: AgUiEvent): Promise<void> {
    switch (event.type) {
      case "RUN_STARTED":
        if (!this.turnEmitted) {
          this.turnEmitted = true;
          await this.onEvent({ type: "turn", index: 0 });
        }
        break;

      case "TOOL_CALL_START": {
        const toolCallId = String(event.toolCallId ?? "");
        const toolCallName = String(event.toolCallName ?? "tool");
        if (toolCallId) {
          this.toolCalls.set(toolCallId, { name: toolCallName, argsBuffer: "" });
        }
        break;
      }

      case "TOOL_CALL_ARGS": {
        const toolCallId = String(event.toolCallId ?? "");
        const delta = typeof event.delta === "string" ? event.delta : "";
        const entry = toolCallId ? this.toolCalls.get(toolCallId) : undefined;
        if (entry && delta) entry.argsBuffer += delta;
        break;
      }

      case "TOOL_CALL_END": {
        const toolCallId = String(event.toolCallId ?? "");
        const entry = toolCallId ? this.toolCalls.get(toolCallId) : undefined;
        if (entry) {
          let input: unknown = {};
          if (entry.argsBuffer.trim()) {
            try {
              input = JSON.parse(entry.argsBuffer) as unknown;
            } catch {
              input = { raw: entry.argsBuffer };
            }
          }
          await this.onEvent({
            type: "tool_act",
            name: entry.name,
            input,
          });
          this.toolCalls.delete(toolCallId);
        }
        break;
      }

      case "TOOL_CALL_RESULT": {
        const toolCallName = String(event.toolCallName ?? "tool");
        const content =
          typeof event.content === "string"
            ? event.content
            : JSON.stringify(event.content ?? "");
        await this.onEvent({
          type: "tool_observe",
          name: toolCallName,
          preview: truncatePreview(content),
          bytes: new TextEncoder().encode(content).length,
        });
        break;
      }

      case "TEXT_MESSAGE_CONTENT": {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (delta) {
          this.messageText += delta;
          this.scheduleReasonEmit();
        }
        break;
      }

      case "CUSTOM": {
        const value = event.value;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const v = value as Record<string, unknown>;
          if (v.type === "child_content" && typeof v.content === "string") {
            const agent =
              typeof v.agent_name === "string" ? v.agent_name : "agent";
            const chunk = v.content;
            this.messageText += chunk;
            await this.onEvent({
              type: "reason",
              text: `[${agent}] ${chunk}`.slice(0, REASON_MAX_CHARS),
            });
          }
        }
        break;
      }

      default:
        break;
    }
  }

  private scheduleReasonEmit(): void {
    if (this.reasonDebounce) return;
    this.reasonDebounce = setTimeout(() => {
      this.reasonDebounce = null;
      void this.emitReasonNow();
    }, REASON_DEBOUNCE_MS);
  }

  private async emitReasonNow(): Promise<void> {
    const text = this.messageText.trim().slice(0, REASON_MAX_CHARS);
    if (text) {
      await this.onEvent({ type: "reason", text });
    }
  }
}

// ── SQL extraction ────────────────────────────────────────────────────────────

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

  const unfenced = stripCodeFences(raw).trim();
  if (/^\s*(WITH|SELECT)\b/i.test(unfenced)) return unfenced;

  const fenceRe = /```(?:sql)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw)) !== null) {
    const inner = m[1].trim();
    if (/^\s*(WITH|SELECT)\b/i.test(inner)) return inner;
  }

  const lineMatch = raw.match(/(?:^|\n)(\s*(?:WITH|SELECT)\b[\s\S]*)/i);
  if (lineMatch) {
    const sql = lineMatch[1].trim().replace(/```[\s\S]*$/, "").trim();
    if (/^\s*(WITH|SELECT)\b/i.test(sql)) return sql;
  }

  const afterIntro = raw.match(/[.:]\s*(\s*(?:WITH|SELECT)\b[\s\S]*)/i);
  if (afterIntro) {
    const sql = afterIntro[1].trim().replace(/```[\s\S]*$/, "").trim();
    if (/^\s*(WITH|SELECT)\b/i.test(sql)) return sql;
  }

  return null;
}

async function postP8k8Chat(
  question: string,
  conversationId?: string
): Promise<ReadableStream<Uint8Array>> {
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
      messages: [{ id: randomUuidV4(), role: "user", content: question }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`p8k8 responded ${res.status}: ${body}`);
  }

  if (!res.body) {
    throw new Error("p8k8 returned no response body");
  }

  return res.body;
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Stream p8k8 AG-UI events as AgentStreamPayload, then return extracted SQL.
 */
export async function generateSqlViaP8k8WithEvents(
  question: string,
  onEvent: (e: AgentStreamPayload) => void | Promise<void>,
  conversationId?: string
): Promise<SqlGenerationResult> {
  const stream = await postP8k8Chat(question, conversationId);
  const translator = new AgUiStreamTranslator(onEvent);

  await readAgUiStream(stream, (event) => translator.handle(event));
  await translator.flush();

  const fullText = translator.assembledText;
  if (!fullText.trim()) {
    throw new Error("p8k8 returned an empty assistant message");
  }

  const sql = extractSql(fullText);
  if (!sql) {
    throw new Error(
      `p8k8 reply contained no SELECT or WITH statement.\n\nRaw reply (first 500 chars):\n${fullText.slice(0, 500)}`
    );
  }

  const prose = extractLeadingProseBeforeSql(fullText, sql);
  if (prose.trim()) {
    await onEvent({
      type: "summary",
      text: prose.trim().slice(0, 1200),
    });
  }

  return {
    sql: sql.trim(),
    model: "p8k8",
    inputTokens: 0,
    outputTokens: 0,
    summary: prose.trim() ? prose.trim().slice(0, 1200) : undefined,
  };
}

/**
 * Send a natural-language question to p8k8 and return the extracted SQL.
 */
export async function generateSqlViaP8k8(
  question: string,
  conversationId?: string
): Promise<SqlGenerationResult> {
  return generateSqlViaP8k8WithEvents(question, () => undefined, conversationId);
}
