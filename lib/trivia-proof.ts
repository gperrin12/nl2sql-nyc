import type { AthenaResults } from "@/lib/athena";

export type TriviaProofMatch = {
  rowIndex: number;
  column: string;
  value: string;
};

export type TriviaProof = {
  summary: string;
  correctOption: string;
  correctLabel: string;
  matches: TriviaProofMatch[];
  winnerLabel: string;
  winnerMetric?: { column: string; value: string };
  /** True when Athena data overrode the model's correctIndex */
  correctedFromModel: boolean;
};

export type TriviaProofResolution = {
  correctIndex: number;
  proof: TriviaProof;
};

const LABELS = ["A", "B", "C", "D"] as const;

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

function parseNumeric(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(digitsOnly(value));
  return Number.isNaN(n) ? null : n;
}

type RankingWinner = {
  rowIndex: number;
  labelColumn: string;
  labelValue: string;
  metricColumn: string;
  metricValue: string;
};

/** Row with the highest numeric metric (ground-truth winner for ranking questions). */
function findRankingWinner(
  columns: string[],
  rows: Record<string, string | null>[]
): RankingWinner | null {
  if (rows.length === 0 || columns.length === 0) return null;

  const metricScores = columns.map((col) => {
    const parsed = rows.map((r) => parseNumeric(r[col])).filter((n) => n !== null);
    return { col, count: parsed.length, max: parsed.length ? Math.max(...parsed) : -1 };
  });
  const metricCandidates = metricScores
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count || b.max - a.max);
  const metricColumn = metricCandidates[0]?.col;
  if (!metricColumn) return null;

  const labelColumn =
    columns.find(
      (c) =>
        c !== metricColumn &&
        /answer|label|borough|zone|name|type/i.test(c)
    ) ??
    columns.find((c) => c !== metricColumn) ??
    columns[0];

  let bestRow = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const n = parseNumeric(rows[i][metricColumn]);
    if (n !== null && n > bestVal) {
      bestVal = n;
      bestRow = i;
    }
  }

  const labelValue = rows[bestRow][labelColumn];
  const metricValue = rows[bestRow][metricColumn];
  if (labelValue == null || labelValue === "") return null;

  return {
    rowIndex: bestRow,
    labelColumn,
    labelValue,
    metricColumn,
    metricValue: metricValue ?? "",
  };
}

function optionIndexForValue(
  options: string[],
  value: string
): number | null {
  for (let i = 0; i < options.length; i++) {
    if (cellMatchesOption(value, options[i])) return i;
  }
  return null;
}

/**
 * Resolve the correct answer from Athena data (winner = max metric row).
 * Overrides the model's correctIndex when they disagree.
 */
export function resolveTriviaProofFromResults(
  options: string[],
  modelCorrectIndex: number,
  results: Pick<AthenaResults, "columns" | "rows">
): TriviaProofResolution | null {
  const { columns, rows } = results;
  if (columns.length === 0 || rows.length === 0) return null;

  // Scalar / single-row answers
  if (rows.length === 1) {
    for (const col of columns) {
      const val = rows[0][col];
      const idx = optionIndexForValue(options, val ?? "");
      if (idx === null) continue;
      const metricCol = columns.find((c) => c !== col && parseNumeric(rows[0][c]) !== null);
      return buildResolution(
        options,
        idx,
        modelCorrectIndex,
        {
          rowIndex: 0,
          labelColumn: col,
          labelValue: val ?? "",
          metricColumn: metricCol ?? col,
          metricValue: metricCol ? (rows[0][metricCol] ?? "") : (val ?? ""),
        }
      );
    }
  }

  const winner = findRankingWinner(columns, rows);
  if (!winner) return null;

  const idx = optionIndexForValue(options, winner.labelValue);
  if (idx === null) return null;
  return buildResolution(options, idx, modelCorrectIndex, winner);
}

function formatProofSummary(
  winner: RankingWinner,
  correctLabel: string,
  correctOption: string
): string {
  return `Athena ranks ${winner.labelValue} #1 (${winner.metricColumn} = ${winner.metricValue}) — answer ${correctLabel}: ${correctOption}.`;
}

function buildResolution(
  options: string[],
  dataCorrectIndex: number,
  modelCorrectIndex: number,
  winner: RankingWinner
): TriviaProofResolution {
  const correctedFromModel = dataCorrectIndex !== modelCorrectIndex;
  const correctOption = options[dataCorrectIndex];
  const correctLabel = LABELS[dataCorrectIndex] ?? String(dataCorrectIndex + 1);

  const summary = formatProofSummary(winner, correctLabel, correctOption);

  const proof: TriviaProof = {
    summary,
    correctOption,
    correctLabel,
    matches: [
      {
        rowIndex: winner.rowIndex,
        column: winner.labelColumn,
        value: winner.labelValue,
      },
      {
        rowIndex: winner.rowIndex,
        column: winner.metricColumn,
        value: winner.metricValue,
      },
    ],
    winnerLabel: winner.labelValue,
    winnerMetric: {
      column: winner.metricColumn,
      value: winner.metricValue,
    },
    correctedFromModel,
  };

  return { correctIndex: dataCorrectIndex, proof };
}

/** @deprecated Use resolveTriviaProofFromResults */
export function deriveTriviaProof(
  options: string[],
  correctIndex: number,
  results: Pick<AthenaResults, "columns" | "rows">
): TriviaProof | null {
  return resolveTriviaProofFromResults(options, correctIndex, results)?.proof ?? null;
}

export function triviaProofIsValid(
  resolution: TriviaProofResolution | null
): boolean {
  return resolution != null;
}

/** Shuffle MC options so the correct answer is not always slot A. */
export function shuffleTriviaOptions(
  options: string[],
  correctIndex: number
): { options: string[]; correctIndex: number } {
  const items = options.map((text, originalIndex) => ({ text, originalIndex }));
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  const shuffledOptions = items.map((x) => x.text);
  const newCorrectIndex = items.findIndex((x) => x.originalIndex === correctIndex);
  return { options: shuffledOptions, correctIndex: newCorrectIndex };
}

export function proofWithShuffledIndex(
  proof: TriviaProof,
  correctIndex: number,
  options: string[]
): TriviaProof {
  const correctOption = options[correctIndex];
  const correctLabel = LABELS[correctIndex] ?? String(correctIndex + 1);
  const winner: RankingWinner = {
    rowIndex: proof.matches[0]?.rowIndex ?? 0,
    labelColumn: proof.matches[0]?.column ?? "answer_label",
    labelValue: proof.winnerLabel,
    metricColumn: proof.winnerMetric?.column ?? "value",
    metricValue: proof.winnerMetric?.value ?? "",
  };

  return {
    ...proof,
    correctOption,
    correctLabel,
    summary: formatProofSummary(winner, correctLabel, correctOption),
  };
}
