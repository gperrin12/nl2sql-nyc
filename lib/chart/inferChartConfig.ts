export type ChartType = "bar" | "line" | "grouped-bar";

export type ChartConfig = {
  chartType: ChartType;
  xKey: string;
  yKeys: string[];
  xLabel: string;
  yLabel: string;
};

const NON_NUMERIC_COLS = new Set([
  "latitude",
  "longitude",
  "lat",
  "lon",
  "lng",
  "long",
  "year",
  "month",
  "zip_code",
  "geoid",
  "locationid",
  "h3_r8",
  "h3_r9",
  "h3_r10",
]);

const PREFERRED_CATEGORICAL = [
  "borough",
  "complaint_type",
  "type",
  "zone",
  "ntaname",
  "agency",
  "category",
  "contributing_factor_vehicle_1",
  "vehicle_type_code1",
  "payment_type",
];

const TIME_NAME_RE = /^(year|month|date|week|created_date|crash_date)/i;
const YEAR_VALUE_RE = /^(19|20)\d{2}$/;
const MONTH_VALUE_RE = /^(0?[1-9]|1[0-2])$/;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function normCol(c: string): string {
  return c.trim().toLowerCase().replace(/"/g, "");
}

function parseNum(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number.parseFloat(String(v).trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function humanizeLabel(col: string): string {
  return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function columnValues(
  col: string,
  rows: Record<string, string | null>[]
): (string | null)[] {
  return rows.map((r) => r[col] ?? null);
}

function isNumericColumn(
  col: string,
  rows: Record<string, string | null>[]
): boolean {
  const key = normCol(col);
  if (NON_NUMERIC_COLS.has(key) || key.startsWith("h3_r")) return false;

  const values = columnValues(col, rows).filter((v) => v != null && v !== "");
  if (values.length === 0) return false;

  let numeric = 0;
  for (const v of values) {
    if (parseNum(v) != null) numeric += 1;
  }
  return numeric / values.length >= 0.8;
}

function uniqueNonNullCount(values: (string | null)[]): number {
  const set = new Set<string>();
  for (const v of values) {
    if (v != null && v !== "") set.add(v);
  }
  return set.size;
}

function isCategoricalColumn(
  col: string,
  rows: Record<string, string | null>[]
): boolean {
  if (isNumericColumn(col, rows)) return false;
  const uniq = uniqueNonNullCount(columnValues(col, rows));
  return uniq > 0 && uniq <= 50;
}

function valuesLookLikeTime(col: string, rows: Record<string, string | null>[]): boolean {
  const values = columnValues(col, rows).filter((v) => v != null && v !== "");
  if (values.length === 0) return false;

  let matches = 0;
  for (const v of values) {
    const s = String(v).trim();
    if (YEAR_VALUE_RE.test(s) || MONTH_VALUE_RE.test(s)) matches += 1;
  }
  return matches / values.length >= 0.8;
}

function isTimeColumn(
  col: string,
  rows: Record<string, string | null>[]
): boolean {
  const key = normCol(col);
  if (TIME_NAME_RE.test(key)) return true;
  return valuesLookLikeTime(col, rows);
}

function findTimeColumn(
  columns: string[],
  rows: Record<string, string | null>[]
): string | null {
  for (const c of columns) {
    if (isTimeColumn(c, rows)) return c;
  }
  return null;
}

function findCategoricalColumn(
  columns: string[],
  rows: Record<string, string | null>[]
): string | null {
  const lowered = new Map(columns.map((c) => [normCol(c), c]));
  for (const pref of PREFERRED_CATEGORICAL) {
    const col = lowered.get(pref);
    if (col && isCategoricalColumn(col, rows)) return col;
  }
  for (const c of columns) {
    if (isCategoricalColumn(c, rows)) return c;
  }
  return null;
}

function findNumericColumns(
  columns: string[],
  rows: Record<string, string | null>[]
): string[] {
  return columns.filter((c) => isNumericColumn(c, rows));
}

function compareX(a: string | null, b: string | null): number {
  const sa = a ?? "";
  const sb = b ?? "";
  const na = parseNum(sa);
  const nb = parseNum(sb);
  if (na != null && nb != null) return na - nb;
  return sa.localeCompare(sb, undefined, { numeric: true });
}

export function formatXTick(value: string, xKey: string): string {
  if (normCol(xKey) === "month") {
    const m = Number.parseInt(String(value).trim(), 10);
    if (m >= 1 && m <= 12) return MONTH_NAMES[m - 1];
  }
  return value;
}

export function sortRowsForChart(
  config: ChartConfig,
  rows: Record<string, string | null>[]
): Record<string, string | null>[] {
  const { chartType, xKey, yKeys } = config;
  const copy = [...rows];

  if (chartType === "line") {
    copy.sort((a, b) => compareX(a[xKey], b[xKey]));
    return copy;
  }

  const y0 = yKeys[0];
  copy.sort((a, b) => {
    const va = parseNum(a[y0]) ?? -Infinity;
    const vb = parseNum(b[y0]) ?? -Infinity;
    return vb - va;
  });
  return copy.slice(0, 50);
}

export function inferChartConfig(
  columns: string[],
  rows: Record<string, string | null>[],
  options?: { hasMap?: boolean }
): ChartConfig | null {
  if (options?.hasMap) return null;
  if (rows.length < 2 || columns.length < 2) return null;

  const numericCols = findNumericColumns(columns, rows);
  if (numericCols.length === 0) return null;

  const timeCol = findTimeColumn(columns, rows);
  if (timeCol) {
    const yKeys = numericCols.slice(0, 5);
    return {
      chartType: "line",
      xKey: timeCol,
      yKeys,
      xLabel: humanizeLabel(timeCol),
      yLabel: yKeys.length === 1 ? humanizeLabel(yKeys[0]) : "Value",
    };
  }

  const catCol = findCategoricalColumn(columns, rows);
  if (!catCol) return null;

  if (numericCols.length >= 1 && numericCols.length <= 2) {
    return {
      chartType: "bar",
      xKey: catCol,
      yKeys: numericCols,
      xLabel: humanizeLabel(catCol),
      yLabel:
        numericCols.length === 1
          ? humanizeLabel(numericCols[0])
          : "Value",
    };
  }

  if (numericCols.length >= 3 && numericCols.length <= 5) {
    return {
      chartType: "grouped-bar",
      xKey: catCol,
      yKeys: numericCols,
      xLabel: humanizeLabel(catCol),
      yLabel: "Value",
    };
  }

  return null;
}
