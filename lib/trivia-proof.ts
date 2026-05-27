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

type RankingColumns = {
  metricColumn: string;
  labelColumn: string;
};

function resolveRankingColumns(
  columns: string[],
  rows: Record<string, string | null>[]
): RankingColumns | null {
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

  return { metricColumn, labelColumn };
}

/** Multiple distinct labels share the top metric — trivia must not pick one arbitrarily. */
export function findRankingMetricTie(
  columns: string[],
  rows: Record<string, string | null>[]
): { metricColumn: string; metricValue: string; tiedLabels: string[] } | null {
  const cols = resolveRankingColumns(columns, rows);
  if (!cols) return null;

  const { metricColumn, labelColumn } = cols;
  let bestVal = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const n = parseNumeric(rows[i][metricColumn]);
    if (n !== null && n > bestVal) bestVal = n;
  }
  if (!Number.isFinite(bestVal)) return null;

  const tiedLabels: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const n = parseNumeric(rows[i][metricColumn]);
    if (n === null || n !== bestVal) continue;
    const label = rows[i][labelColumn]?.trim();
    if (!label) continue;
    if (!tiedLabels.some((t) => normalize(t) === normalize(label))) {
      tiedLabels.push(label);
    }
  }

  if (tiedLabels.length <= 1) return null;

  const metricValue = rows.find(
    (r) => normalize(r[labelColumn] ?? "") === normalize(tiedLabels[0])
  )?.[metricColumn];

  return {
    metricColumn,
    metricValue: metricValue ?? String(bestVal),
    tiedLabels,
  };
}

/** Row with the highest numeric metric (ground-truth winner for ranking questions). */
function findRankingWinner(
  columns: string[],
  rows: Record<string, string | null>[]
): RankingWinner | null {
  if (findRankingMetricTie(columns, rows)) return null;

  const cols = resolveRankingColumns(columns, rows);
  if (!cols) return null;

  const { metricColumn, labelColumn } = cols;

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

/** Winner by SQL row order (ORDER BY ... DESC LIMIT 4 expected). */
function findOrderedWinner(
  columns: string[],
  rows: Record<string, string | null>[]
): RankingWinner | null {
  if (rows.length === 0) return null;
  const cols = resolveRankingColumns(columns, rows);
  if (!cols) return null;
  const { metricColumn, labelColumn } = cols;
  const labelValue = rows[0][labelColumn];
  if (labelValue == null || labelValue === "") return null;
  return {
    rowIndex: 0,
    labelColumn,
    labelValue,
    metricColumn,
    metricValue: rows[0][metricColumn] ?? "",
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

  // Primary truth source: first row after ORDER BY ... DESC LIMIT 4.
  // Fallback to metric inference only when ordered winner can't be read.
  const winner = findOrderedWinner(columns, rows) ?? findRankingWinner(columns, rows);
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

/** Human-readable retry hint when proof resolution fails due to a tie. */
/** True when MC options / question theme clearly disagrees with SQL row labels (e.g. airports vs neighborhoods). */
export function optionsThemeMismatch(
  options: string[],
  question: string,
  rowLabels: string[]
): boolean {
  const blob = `${options.join(" ")} ${question}`.toLowerCase();
  const labels = rowLabels.join(" ").toLowerCase();

  const airportish =
    /\b(airport|laguardia|lga|jfk|ewr|newark)\b/i.test(blob) &&
    !/\b(airport|laguardia|lga|jfk|ewr|newark)\b/i.test(labels);

  const boroughish =
    /\b(borough|brooklyn|manhattan|bronx|queens|staten)\b/i.test(blob) &&
    /fordham|concourse|morris park|ntaname|neighborhood/i.test(labels) &&
    !/\b(brooklyn|manhattan|bronx|queens|staten island)\b/i.test(labels);

  return airportish || boroughish;
}

export function formatOptionsMismatchFeedback(
  results: Pick<AthenaResults, "columns" | "rows">,
  options: string[]
): string {
  const winner = findRankingWinner(results.columns, results.rows);
  const cols = resolveRankingColumns(results.columns, results.rows);
  const labelCol = cols?.labelColumn ?? "answer_label";
  const rowLabels = results.rows
    .slice(0, 4)
    .map((r) => r[labelCol]?.trim())
    .filter((l): l is string => Boolean(l));

  const top = results.rows
    .slice(0, 4)
    .map((r) => {
      const label = r[labelCol] ?? "?";
      const metric = cols?.metricColumn;
      return metric ? `${label} (${metric}=${r[metric]})` : label;
    })
    .join("; ");

  return (
    "The four options MUST be the exact answer_label values from your SQL (LIMIT 4 rows), " +
    "and correctIndex must be the highest-metric row. " +
    `Athena top rows: ${top || "(none)"}. ` +
    `Your options: ${JSON.stringify(options)}. ` +
    (rowLabels.length >= 4
      ? `Rebuild options as: ${JSON.stringify(rowLabels)} (in any order) and align the question.`
      : "Rewrite SQL so it returns four labeled rows matching your four options.")
  );
}

/**
 * When the model's options don't match Athena, rebuild options from the proof table
 * if rows are consistent (skipped when theme mismatch would make the question nonsense).
 */
/** First four answer_label (or label) values from the proof table, in row order. */
export function proofRowLabelsFromResults(
  results: Pick<AthenaResults, "columns" | "rows">
): string[] {
  const cols = resolveRankingColumns(results.columns, results.rows);
  if (!cols) return [];
  const { labelColumn } = cols;
  const labels: string[] = [];
  for (const row of results.rows) {
    if (labels.length >= 4) break;
    const label = row[labelColumn]?.trim();
    if (!label) continue;
    if (labels.some((l) => normalize(l) === normalize(label))) continue;
    labels.push(label);
  }
  return labels;
}

export function realignOptionsFromAthenaResults(
  results: Pick<AthenaResults, "columns" | "rows">,
  modelCorrectIndex: number
): (TriviaProofResolution & { options: string[] }) | null {
  const labels = proofRowLabelsFromResults(results);
  if (labels.length < 4) return null;

  const winner = findRankingWinner(results.columns, results.rows);
  if (!winner) return null;

  const idx = labels.findIndex((l) => cellMatchesOption(l, winner.labelValue));
  if (idx < 0) return null;

  const resolution = buildResolution(labels, idx, modelCorrectIndex, winner);
  return { ...resolution, options: labels };
}

export function formatRankingTieFeedback(
  tie: { metricColumn: string; metricValue: string; tiedLabels: string[] },
  options: string[]
): string {
  const inOptions = tie.tiedLabels.filter(
    (l) => optionIndexForValue(options, l) !== null
  );
  const labelList =
    inOptions.length >= 2 ? inOptions.join(" and ") : tie.tiedLabels.join(" and ");
  return (
    `Tie for highest ${tie.metricColumn} (${tie.metricValue}): ${labelList}. ` +
    "Trivia must have exactly one winner — use ORDER BY metric DESC, borough ASC LIMIT 1, " +
    "or pick a metric/year where ACS top-coded values (e.g. 250001) do not tie multiple boroughs."
  );
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

const AIRPORT_TERMS_RE =
  /\b(jfk|kennedy|laguardia|lga|ewr|newark|airport)\b/i;

/** Plain-English explanation tied to Athena proof (not the model's draft). */
export function buildTriviaExplanationFromProof(proof: TriviaProof): string {
  const label = proof.winnerLabel || proof.correctOption;
  const metric = proof.winnerMetric;
  const metricLabel = metric ? humanizeMetricColumn(metric.column) : "the ranking metric";

  if (metric?.value) {
    return (
      `The query ranks ${label} first on ${metricLabel} (${metric.value}), ` +
      `so ${proof.correctOption} is the correct answer.`
    );
  }
  return `The query ranks ${label} first, so ${proof.correctOption} is the correct answer.`;
}

function humanizeMetricColumn(column: string): string {
  return column
    .replace(/_/g, " ")
    .replace(/\bavg\b/gi, "average")
    .replace(/\bct\b/gi, "count")
    .trim();
}

function distinctiveLabelParts(label: string): string[] {
  const whole = normalize(label);
  const parts = label
    .split(/[/,–-]/)
    .map((p) => normalize(p))
    .filter((p) => p.length >= 4);
  return parts.length > 0 ? parts : [whole];
}

/** Model explanation must name the verified winner, not a different entity (e.g. JFK vs a zone). */
export function explanationAlignsWithProof(
  explanation: string,
  proof: TriviaProof,
  options: string[]
): boolean {
  const correct = proof.correctOption;
  const winner = proof.winnerLabel;
  const ex = normalize(explanation);

  const mustMatch = distinctiveLabelParts(correct);
  const winnerParts = distinctiveLabelParts(winner);
  const referencesCorrect = [...mustMatch, ...winnerParts].some((part) => {
    if (part.length < 4) return ex.includes(part);
    return ex.includes(part);
  });
  if (!referencesCorrect) return false;

  const correctBlob = `${correct} ${winner}`.toLowerCase();
  if (
    AIRPORT_TERMS_RE.test(explanation) &&
    !AIRPORT_TERMS_RE.test(correctBlob)
  ) {
    return false;
  }

  for (const opt of options) {
    if (cellMatchesOption(opt, correct) || cellMatchesOption(opt, winner)) {
      continue;
    }
    for (const part of distinctiveLabelParts(opt)) {
      if (part.length < 5) continue;
      if (ex.includes(part) && !mustMatch.some((m) => ex.includes(m))) {
        return false;
      }
    }
  }

  return true;
}

export function resolveTriviaExplanation(
  modelExplanation: string,
  proof: TriviaProof,
  options: string[],
  optionsRealignedFromAthena: boolean
): string {
  if (proof.correctedFromModel || optionsRealignedFromAthena) {
    return buildTriviaExplanationFromProof(proof);
  }
  if (explanationAlignsWithProof(modelExplanation, proof, options)) {
    return modelExplanation;
  }
  return buildTriviaExplanationFromProof(proof);
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
