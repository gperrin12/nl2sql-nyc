/**
 * Deterministic rewrites for TRY_CAST(col AS TIMESTAMP) on VARCHAR date columns.
 * TRY_CAST silently NULLs many warehouse string formats; each table has a canonical parser.
 */

type DateCastRule = {
  /** Query must reference this table (word boundary). */
  tablePattern: RegExp;
  columns: readonly string[];
  rewrite: (columnRef: string) => string;
};

const DATE_CAST_RULES: DateCastRule[] = [
  {
    tablePattern: /\bnyc_311\b/i,
    columns: [
      "created_date",
      "closed_date",
      "due_date",
      "resolution_action_updated_date",
    ],
    rewrite: (col) => `FROM_ISO8601_TIMESTAMP(${col})`,
  },
  {
    tablePattern: /\bgtp_tlc_data\b/i,
    columns: ["tpep_pickup_datetime", "tpep_dropoff_datetime"],
    rewrite: (col) => `FROM_ISO8601_TIMESTAMP(${col})`,
  },
  {
    tablePattern: /\bpar\b/i,
    columns: ["lpep_pickup_datetime", "lpep_dropoff_datetime"],
    rewrite: (col) => `FROM_ISO8601_TIMESTAMP(${col})`,
  },
  {
    tablePattern: /\bnypd_collisions\b/i,
    columns: ["crash_date"],
    rewrite: (col) => `TRY(DATE_PARSE(${col}, '%m/%d/%Y'))`,
  },
  // mta_turnstile.transit_timestamp uses space-separated timestamps — keep TRY_CAST AS TIMESTAMP.
];

function castPatternForColumns(columns: readonly string[]): RegExp {
  const colGroup = columns.join("|");
  return new RegExp(
    `\\b(?:TRY_)?CAST\\s*\\(\\s*((?:\\w+\\.)?(?:${colGroup}))\\s+AS\\s+(?:TIMESTAMP(?:\\s+WITH\\s+TIME\\s+ZONE)?|DATE)\\s*\\)`,
    "gi"
  );
}

/** Rewrite invalid TIMESTAMP/DATE casts on known warehouse date VARCHAR columns. */
export function fixWarehouseDateCasts(sql: string): string {
  let result = sql;
  for (const rule of DATE_CAST_RULES) {
    if (!rule.tablePattern.test(result)) continue;
    result = result.replace(castPatternForColumns(rule.columns), (_, colRef: string) =>
      rule.rewrite(colRef)
    );
  }
  return result;
}

/** @deprecated Use fixWarehouseDateCasts */
export const fixNyc311IsoDateCasts = fixWarehouseDateCasts;
