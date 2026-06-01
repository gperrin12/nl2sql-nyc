import { describe, expect, it } from "vitest";
import { guardrailsFailedPayload } from "@/lib/agent-stream-guardrails";

describe("guardrailsFailedPayload", () => {
  it("maps structured abstention from pipeline body", () => {
    const payload = guardrailsFailedPayload({
      error: "SQL rejected by guardrails",
      reason: "max_repairs_exceeded",
      abstention_reason: "max_repairs_exceeded",
      error_type: "unknown",
      suggestion: "Try rephrasing your question.",
      message: "Try rephrasing your question.",
      sql: "SELECT bad",
    });

    expect(payload).toEqual({
      type: "guardrails_failed",
      reason: "Try rephrasing your question.",
      sql: "SELECT bad",
      abstention: {
        reason: "max_repairs_exceeded",
        error_type: "unknown",
        suggestion: "Try rephrasing your question.",
      },
    });
  });

  it("falls back when only legacy reason is present", () => {
    const payload = guardrailsFailedPayload({
      reason: "Only SELECT / WITH queries are allowed",
      sql: "DROP TABLE x",
    });

    expect(payload.type).toBe("guardrails_failed");
    expect(payload.reason).toContain("SELECT");
    expect(payload.abstention?.reason).toContain("SELECT");
  });
});
