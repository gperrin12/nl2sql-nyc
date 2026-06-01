import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Pool } from "pg";
import {
  buildSuggestion,
  classifyError,
  ensureGuardedSqlV2,
} from "@/lib/sql-agent/ensure-guarded-sql";

vi.mock("@/lib/claude", () => ({
  generateSqlWithRepair: vi.fn(),
}));

import { generateSqlWithRepair } from "@/lib/claude";

const VALID_SQL =
  "SELECT 1 FROM gtp_tlc_data t WHERE TRY_CAST(t.trip_distance AS DOUBLE) > 0 AND TRY_CAST(t.trip_distance AS DOUBLE) <= 50";

function mockPool(queryImpl?: (sql: string) => unknown): Pool {
  return {
    query: vi.fn(async (sql: string) => {
      if (queryImpl) return queryImpl(sql);
      if (sql.includes("INSERT INTO nl2sql.repair_attempts")) {
        return { rows: [{ id: 42 }] };
      }
      if (sql.includes("COUNT")) {
        return { rows: [{ count: 0 }] };
      }
      return { rows: [] };
    }),
  } as unknown as Pool;
}

describe("classifyError", () => {
  it("maps column resolution failures", () => {
    expect(
      classifyError('Column "foo" cannot be resolved')
    ).toBe("column_not_found");
  });

  it("returns unknown for guardrail messages", () => {
    expect(classifyError("Empty SQL")).toBe("unknown");
  });
});

describe("buildSuggestion", () => {
  it("falls back to unknown suggestion", () => {
    expect(buildSuggestion("not_a_real_type")).toBe(buildSuggestion("unknown"));
  });
});

describe("ensureGuardedSqlV2", () => {
  beforeEach(() => {
    vi.mocked(generateSqlWithRepair).mockReset();
  });

  it("returns ok when SQL passes guardrails", async () => {
    const pool = mockPool();
    const result = await ensureGuardedSqlV2(pool, "how many trips?", VALID_SQL);
    expect(result).toEqual({ ok: true, sql: VALID_SQL, attempts: 0 });
    expect(generateSqlWithRepair).not.toHaveBeenCalled();
  });

  it("repairs once then succeeds", async () => {
    vi.mocked(generateSqlWithRepair).mockResolvedValue({
      sql: VALID_SQL,
      model: "test",
      inputTokens: 0,
      outputTokens: 0,
    });

    const pool = mockPool();
    const badSql = "INSERT INTO foo VALUES (1)";
    const result = await ensureGuardedSqlV2(pool, "how many trips?", badSql, 1);

    expect(result.ok).toBe(true);
    expect(generateSqlWithRepair).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE nl2sql.repair_attempts"),
      [42]
    );
  });

  it("abstains after max repairs", async () => {
    vi.mocked(generateSqlWithRepair).mockResolvedValue({
      sql: "DROP TABLE foo",
      model: "test",
      inputTokens: 0,
      outputTokens: 0,
    });

    const pool = mockPool();
    const result = await ensureGuardedSqlV2(
      pool,
      "how many trips?",
      "INSERT INTO foo VALUES (1)",
      1
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("max_repairs_exceeded");
    expect(result.error_type).toBe("unknown");
  });
});
