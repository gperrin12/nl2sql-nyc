/**
 * SSE payloads for POST /api/query/agent-stream (single sequence:
 * agent loop → guardrails → Athena start → done).
 */
export type AgentStreamPayload =
  | { type: "turn"; index: number }
  | { type: "reason"; text: string }
  | { type: "summary"; text: string }
  | { type: "tool_act"; name: string; input: unknown }
  | { type: "tool_observe"; name: string; preview: string; bytes: number }
  | { type: "sql_generated"; sql: string }
  | { type: "guardrails_failed"; reason: string; sql: string }
  | { type: "athena_started"; executionId: string }
  | { type: "athena_failed"; detail: string; sql?: string }
  | {
      type: "done";
      model: string;
      backend: string;
      usage: { inputTokens: number; outputTokens: number };
    }
  | { type: "error"; message: string; detail?: string };
