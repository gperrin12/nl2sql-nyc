/**
 * Parse p8k8 session timeline events into dashboard query pairs.
 */

export type DashboardMoment = {
  id: string;
  timestamp: string;
  question: string;
  sql: string;
  model: string | null;
  tokenCount: number | null;
  agentName: string | null;
};

type P8k8TimelineEvent = {
  event_type?: string;
  moment_type?: string;
  event_id?: string;
  id?: string;
  event_timestamp?: string;
  created_at?: string;
  timestamp?: string;
  name_or_type?: string;
  message_type?: string;
  role?: string;
  content_or_summary?: string;
  content?: string;
  summary?: string;
  metadata?: Record<string, unknown> | null;
};

function isMessageEvent(ev: P8k8TimelineEvent): boolean {
  const t = ev.event_type ?? ev.moment_type ?? "";
  return t === "message";
}

function messageRole(ev: P8k8TimelineEvent): "user" | "assistant" | null {
  const raw = (ev.name_or_type ?? ev.message_type ?? ev.role ?? "").toLowerCase();
  if (raw === "user" || raw === "assistant") return raw;
  return null;
}

function messageContent(ev: P8k8TimelineEvent): string {
  const text = ev.content_or_summary ?? ev.content ?? ev.summary ?? "";
  return typeof text === "string" ? text : String(text);
}

function eventTimestamp(ev: P8k8TimelineEvent): string {
  return (
    ev.event_timestamp ??
    ev.created_at ??
    ev.timestamp ??
    new Date(0).toISOString()
  );
}

function eventId(ev: P8k8TimelineEvent): string {
  const id = ev.event_id ?? ev.id;
  return id ? String(id) : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readMetadata(ev: P8k8TimelineEvent): {
  model: string | null;
  tokenCount: number | null;
  agentName: string | null;
} {
  const m = ev.metadata ?? {};
  const model =
    typeof m.model === "string"
      ? m.model
      : typeof m.model_name === "string"
        ? m.model_name
        : null;
  const tokenRaw = m.token_count ?? m.tokenCount;
  const tokenCount =
    typeof tokenRaw === "number"
      ? tokenRaw
      : typeof tokenRaw === "string"
        ? Number.parseInt(tokenRaw, 10)
        : null;
  const agentName =
    typeof m.agent_name === "string"
      ? m.agent_name
      : typeof m.agentName === "string"
        ? m.agentName
        : null;
  return {
    model: model ?? "p8k8",
    tokenCount: Number.isFinite(tokenCount) ? tokenCount : null,
    agentName,
  };
}

/** Unwrap array or { items | events | timeline } from p8k8 session response. */
export function unwrapTimelinePayload(data: unknown): P8k8TimelineEvent[] {
  if (Array.isArray(data)) return data as P8k8TimelineEvent[];
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const key of ["items", "events", "timeline", "messages"]) {
      if (Array.isArray(o[key])) return o[key] as P8k8TimelineEvent[];
    }
  }
  return [];
}

/** Pair consecutive user → assistant messages; chronological in, newest-first out. */
export function pairSessionMessages(events: P8k8TimelineEvent[]): DashboardMoment[] {
  const messages = events.filter(isMessageEvent);
  const pairs: DashboardMoment[] = [];
  let pendingUser: P8k8TimelineEvent | null = null;

  for (const ev of messages) {
    const role = messageRole(ev);
    if (role === "user") {
      pendingUser = ev;
      continue;
    }
    if (role === "assistant" && pendingUser) {
      const meta = readMetadata(ev);
      pairs.push({
        id: eventId(ev),
        timestamp: eventTimestamp(ev),
        question: messageContent(pendingUser),
        sql: messageContent(ev),
        model: meta.model,
        tokenCount: meta.tokenCount,
        agentName: meta.agentName,
      });
      pendingUser = null;
    }
  }

  return pairs.reverse();
}

export function paginateMoments(
  moments: DashboardMoment[],
  offset: number,
  limit: number
): { moments: DashboardMoment[]; total: number } {
  const total = moments.length;
  const safeOffset = Math.max(0, offset);
  const safeLimit = Math.max(1, limit);
  return {
    moments: moments.slice(safeOffset, safeOffset + safeLimit),
    total,
  };
}
