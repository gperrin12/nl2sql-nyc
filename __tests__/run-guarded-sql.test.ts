import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SqlGenerationResult } from "@/lib/claude";

vi.mock("@/lib/db", () => ({
  getPgPool: vi.fn(),
}));

vi.mock("@/lib/repair-attempts", () => ({
  ensureRepairAttemptsTable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/sql-agent/ensure-guarded-sql", () => ({
  ensureGuardedSqlV2: vi.fn(),
}));

import { getPgPool } from "@/lib/db";
import { ensureGuardedSqlV2 } from "@/lib/sql-agent/ensure-guarded-sql";
import {
  guardGenerationWithV2,
  guardSqlForEval,
  guardrailAbstentionMessage,
  buildGuardrailFailureBody,
  mapV2Failure,
} from "@/lib/run-guarded-sql";

const BASE_GEN: SqlGenerationResult = {
  sql: "SELECT 1",
  model: "test",
  inputTokens: 10,
  outputTokens: 5,
};

describe("guardrailAbstentionMessage", () => {
  it("prefers suggestion text", () => {
    expect(
      guardrailAbstentionMessage({
        reason: "max_repairs_exceeded",
        suggestion: "Try rephrasing.",
      })
    ).toBe("Try rephrasing.");
  });
});

describe("mapV2Failure", () => {
  it("maps V2 abstention to pipeline shape", () => {
    const failure = mapV2Failure(BASE_GEN, {
      ok: false,
      sql: "bad",
      attempts: 2,
      reason: "schema_mismatch_repeated",
      error_type: "unknown",
      suggestion: "Try again.",
    });
    expect(failure.reason).toBe("schema_mismatch_repeated");
    expect(failure.suggestion).toBe("Try again.");
    expect(failure.generation.sql).toBe("bad");
  });
});

describe("buildGuardrailFailureBody", () => {
  it("includes structured abstention fields", () => {
    const body = buildGuardrailFailureBody({
      ok: false,
      sql: "x",
      generation: BASE_GEN,
      reason: "max_repairs_exceeded",
      error_type: "unknown",
      suggestion: "Simplify the question.",
    });
    expect(body.error).toBe("SQL rejected by guardrails");
    expect(body.message).toBe("Simplify the question.");
    expect(body.abstention_reason).toBe("max_repairs_exceeded");
  });
});

describe("guardGenerationWithV2", () => {
  beforeEach(() => {
    vi.mocked(getPgPool).mockReset();
    vi.mocked(ensureGuardedSqlV2).mockReset();
  });

  it("returns poolMissing when DATABASE_URL is not configured", async () => {
    vi.mocked(getPgPool).mockReturnValue(null);
    const result = await guardGenerationWithV2("q", BASE_GEN);
    expect(result).toEqual({ ok: false, poolMissing: true });
    expect(ensureGuardedSqlV2).not.toHaveBeenCalled();
  });

  it("calls ensureGuardedSqlV2 and maps success", async () => {
    vi.mocked(getPgPool).mockReturnValue({} as never);
    vi.mocked(ensureGuardedSqlV2).mockResolvedValue({
      ok: true,
      sql: "SELECT 2",
      attempts: 1,
    });

    const result = await guardGenerationWithV2("q", BASE_GEN);
    expect(result).toMatchObject({
      ok: true,
      sql: "SELECT 2",
      repairCount: 1,
    });
    expect(ensureGuardedSqlV2).toHaveBeenCalled();
  });
});

describe("guardSqlForEval", () => {
  beforeEach(() => {
    vi.mocked(getPgPool).mockReset();
    vi.mocked(ensureGuardedSqlV2).mockReset();
  });

  it("throws when pool is missing", async () => {
    vi.mocked(getPgPool).mockReturnValue(null);
    await expect(guardSqlForEval("q", BASE_GEN)).rejects.toThrow(
      /DATABASE_URL is required/
    );
  });
});
