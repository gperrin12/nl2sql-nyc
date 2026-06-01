import type { AgentStreamPayload } from "@/lib/sql-agent/types";

/** Map pipeline guardrail failure body to SSE abstention payload. */
export function guardrailsFailedPayload(
  body: Record<string, unknown>
): Extract<AgentStreamPayload, { type: "guardrails_failed" }> {
  const reason = String(
    body.message ?? body.suggestion ?? body.reason ?? "Guardrails rejected SQL"
  );
  const sql = String(body.sql ?? "");
  const abstentionReason = String(body.abstention_reason ?? body.reason ?? "");
  const errorType =
    typeof body.error_type === "string" ? body.error_type : undefined;
  const suggestion =
    typeof body.suggestion === "string" ? body.suggestion : undefined;

  return {
    type: "guardrails_failed",
    reason,
    sql,
    abstention: {
      reason: abstentionReason,
      error_type: errorType,
      suggestion,
    },
  };
}
