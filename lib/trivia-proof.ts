import type { AthenaResults } from "@/lib/athena";

export type TriviaProofMatch = {
  rowIndex: number;
  column: string;
  value: string;
};

export type TriviaProof = {
  /** Plain-English line tying Athena data to the correct option */
  summary: string;
  correctOption: string;
  correctLabel: string;
  matches: TriviaProofMatch[];
  /** First row when used as ranking proof (label + metric columns) */
  rankingLabel?: string;
  rankingMetric?: { column: string; value: string };
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function digitsOnly(s: string): string {
  return s.replace(/[^\d.-]/g, "");
}

export function cellMatchesOption(
  cell: string | null | undefined,
  option: string
): boolean {
  if (cell == null || cell === "") return false;
  const c = normalize(cell);
  const o = normalize(option);
  if (c === o) return true;
  if (c.includes(o) || o.includes(c)) return true;
  const dCell = digitsOnly(cell);
  const dOpt = digitsOnly(option);
  if (dCell.length > 0 && dOpt.length > 0 && dCell === dOpt) return true;
  return false;
}

function findMatches(
  correctOption: string,
  columns: string[],
  rows: Record<string, string | null>[]
): TriviaProofMatch[] {
  const matches: TriviaProofMatch[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (const column of columns) {
      const value = rows[rowIndex][column];
      if (cellMatchesOption(value, correctOption)) {
        matches.push({
          rowIndex,
          column,
          value: value ?? "",
        });
      }
    }
  }
  return matches;
}

function firstNumericMetric(
  row: Record<string, string | null>,
  columns: string[],
  skipColumn: string
): { column: string; value: string } | undefined {
  for (const column of columns) {
    if (column === skipColumn) continue;
    const value = row[column];
    if (value == null || value === "") continue;
    const n = Number(digitsOnly(value));
    if (!Number.isNaN(n) && digitsOnly(value).length > 0) {
      return { column, value };
    }
  }
  return undefined;
}

const LABELS = ["A", "B", "C", "D"] as const;

export function deriveTriviaProof(
  options: string[],
  correctIndex: number,
  results: Pick<AthenaResults, "columns" | "rows">
): TriviaProof | null {
  const correctOption = options[correctIndex];
  if (!correctOption) return null;

  const correctLabel = LABELS[correctIndex] ?? String(correctIndex + 1);
  const { columns, rows } = results;
  if (columns.length === 0 || rows.length === 0) return null;

  const matches = findMatches(correctOption, columns, rows);

  if (matches.length > 0) {
    const primary = matches[0];
    const row = rows[primary.rowIndex];
    const metric = firstNumericMetric(row, columns, primary.column);
    const summary = metric
      ? `Athena returned ${primary.value} with ${metric.column} = ${metric.value} — that matches answer ${correctLabel}: ${correctOption}.`
      : `Athena returned "${primary.value}" — that matches answer ${correctLabel}: ${correctOption}.`;

    return {
      summary,
      correctOption,
      correctLabel,
      matches,
      rankingLabel: primary.value,
      rankingMetric: metric,
    };
  }

  // Ranking-style: first row's first column is often the winner label
  const firstCol = columns[0];
  const firstVal = rows[0][firstCol];
  if (firstVal && cellMatchesOption(firstVal, correctOption)) {
    const metric = firstNumericMetric(rows[0], columns, firstCol);
    return {
      summary: metric
        ? `Top row: ${firstVal} (${metric.column} = ${metric.value}) — answer ${correctLabel}: ${correctOption}.`
        : `Top row: ${firstVal} — answer ${correctLabel}: ${correctOption}.`,
      correctOption,
      correctLabel,
      matches: [{ rowIndex: 0, column: firstCol, value: firstVal }],
      rankingLabel: firstVal,
      rankingMetric: metric,
    };
  }

  return null;
}

export function triviaProofIsValid(proof: TriviaProof | null): boolean {
  return proof != null && proof.matches.length > 0;
}
