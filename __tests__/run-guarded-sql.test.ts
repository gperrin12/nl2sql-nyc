import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SqlGenerationResult } from "@/lib/claude";

vi.mock("@/lib/db", () => ({
  getPgPool: vi.fn(),
}));

vi.mock("@/lib/repair-attempts", () => ({
  ensureRepairAttemptsTable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ensure-guarded-sql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ensure-guarded-sql")>();
  return {
    ...actual,
    ensureGuardedSql: vi.fn(),
  };
});

vi.mock("@/lib/sql-agent/ensure-guarded-sql", () => ({
  ensureGuardedSqlV2: vi.fn(),
}));

import { getPgPool } from "@/lib/db";
import { ensureGuardedSql } from "@/lib/ensure-guarded-sql";
import { ensureGuardedSqlV2 } from "@/lib/sql-agent/ensure-guarded-sql";
import {
  ensureGuardedForPipeline,
  guardrailAbstentionMessage,
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

describe("ensureGuardedForPipeline", () => {
  beforeEach(() => {
    vi.mocked(getPgPool).mockReset();
    vi.mocked(ensureGuardedSql).mockReset();
    vi.mocked(ensureGuardedSqlV2).mockReset();
  });

  it("uses legacy guard when no pool", async () => {
    vi.mocked(getPgPool).mockReturnValue(null);
    vi.mocked(ensureGuardedSql).mockResolvedValue({
      ok: true,
      sql: "SELECT 1",
      generation: BASE_GEN,
      repairCount: 0,
    });

    const result = await ensureGuardedForPipeline("q", BASE_GEN);
    expect(result.ok).toBe(true);
    expect(ensureGuardedSql).toHaveBeenCalled();
    expect(ensureGuardedSqlV2).not.toHaveBeenCalled();
  });

  it("uses V2 when pool is configured", async () => {
    vi.mocked(getPgPool).mockReturnValue({} as never);
    vi.mocked(ensureGuardedSqlV2).mockResolvedValue({
      ok: false,
      sql: "bad",
      attempts: 2,
      reason: "schema_mismatch_repeated",
      error_type: "unknown",
      suggestion: "Try again.",
    });

    const result = await ensureGuardedForPipeline("q", BASE_GEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("schema_mismatch_repeated");
      expect(result.suggestion).toBe("Try again.");
    }
    expect(ensureGuardedSqlV2).toHaveBeenCalled();
  });
});
