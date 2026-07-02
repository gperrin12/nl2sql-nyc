/**
 * Block trivia questions that are technically queryable but meaningless in the real world.
 */

export type TriviaSenseResult =
  | { ok: true }
  | { ok: false; reason: string };

type Dataset = "311" | "collisions" | "taxi" | "census" | "transit";

const RATE_LIKE =
  /\b(per|ratio|rate|rates|for every|divided by|quotient|proportion|relative to|compared to|versus|vs\.?)\b/i;

/**
 * The verification pipeline always treats the HIGHEST-metric row as the answer
 * (lib/trivia-proof.ts) and the model is told to ORDER BY metric DESC LIMIT 4 —
 * which also truncates the true minimum out of the result set. So "lowest /
 * least / fewest / fastest" style questions are structurally unanswerable here
 * and are rejected; the pipeline just regenerates a "most / highest" question.
 * "at least" is excluded so it isn't mistaken for the superlative "least".
 */
const MIN_DIRECTION_RE =
  /\b(lowest|fewest|smallest|minimum|bottom|fastest|quickest|shortest)\b|(?<!at\s)\bleast\b/i;

const DATASET_PATTERNS: { id: Dataset; re: RegExp }[] = [
  { id: "311", re: /\b311\b|complaint|service request|rodent|noise complaint/i },
  { id: "collisions", re: /\bcollision|crash|motor vehicle|injur(y|ies)|nypd/i },
  { id: "taxi", re: /\btaxi|tlc|trip|fare|pickup|dropoff|yellow cab|gtp_/i },
  { id: "census", re: /\bcensus|acs|demographic|population|median income|household|tract/i },
  { id: "transit", re: /\bmta|turnstile|subway|ridership|omny|metrocard|fare class\b/i },
];

/** Explicitly nonsensical question templates seen in the wild. */
const BANNED_QUESTION_PATTERNS: { re: RegExp; reason: string }[] = [
  {
    re: /complaints?\s+per\s+collision/i,
    reason: "311 complaints per collision is not a meaningful civic metric.",
  },
  {
    re: /noise\s+complaints?.*collision|collision.*noise\s+complaints?/i,
    reason: "Do not combine noise complaints with collision counts in one ratio.",
  },
  {
    re: /ratio\s+of\s+(?:311|complaints?).*collision|ratio\s+of\s+.*collision.*(?:311|complaints?)/i,
    reason: "Do not ask for a ratio between 311 complaints and collisions.",
  },
  {
    re: /complaints?\s+per\s+(?:taxi\s+)?trip|311\s+per\s+trip/i,
    reason: "311 complaints per taxi trip is not interpretable.",
  },
  {
    re: /collisions?\s+per\s+(?:taxi\s+)?trip/i,
    reason: "Collisions per taxi trip mixes unrelated units.",
  },
  {
    re: /taxi\s+trips?\s+per\s+collision/i,
    reason: "Taxi trips per collision is not a meaningful question.",
  },
  {
    re: /ridership\s+per\s+(?:collision|crash|complaint|311|taxi\s+trip|trip)/i,
    reason:
      "Subway ridership per collision / complaint / taxi trip mixes unrelated datasets. Ask a single-dataset ridership ranking instead.",
  },
  {
    re: /(?:collisions?|crashes|complaints?|taxi\s+trips?)\s+per\s+(?:rider|ridership|subway\s+station)/i,
    reason:
      "Do not divide collisions / complaints / taxi trips by subway ridership — pick one dataset.",
  },
];

function datasetsInText(text: string): Set<Dataset> {
  const found = new Set<Dataset>();
  for (const { id, re } of DATASET_PATTERNS) {
    if (re.test(text)) found.add(id);
  }
  return found;
}

/** Per-capita / demographic rate using census is allowed when census is in the question. */
function isAllowedDemographicRate(question: string, datasets: Set<Dataset>): boolean {
  if (!datasets.has("census")) return false;
  if (!RATE_LIKE.test(question)) return false;
  const onlyCensusPlusOne =
    datasets.size === 2 &&
    (datasets.has("311") || datasets.has("collisions") || datasets.has("taxi"));
  if (!onlyCensusPlusOne) return false;
  return /\b(per capita|per resident|per 1,?000|per thousand|population|residents?)\b/i.test(
    question
  );
}

/**
 * Cross-dataset "rate" questions (311 per collision, etc.) are banned unless
 * clearly per-capita with census population.
 */
function checkCrossDatasetRate(question: string): TriviaSenseResult {
  if (!RATE_LIKE.test(question)) return { ok: true };

  const datasets = datasetsInText(question);
  if (datasets.size < 2) return { ok: true };

  if (isAllowedDemographicRate(question, datasets)) return { ok: true };

  const ids = [...datasets];
  if (ids.includes("311") && ids.includes("collisions")) {
    return {
      ok: false,
      reason:
        "Do not combine 311 complaints with motor vehicle collisions in one rate or ratio. " +
        "Ask a single-dataset question instead (e.g. which borough has the most noise complaints, or most injuries).",
    };
  }
  if (ids.includes("311") && ids.includes("taxi")) {
    return {
      ok: false,
      reason:
        "Do not combine 311 complaints with taxi trips in one rate. Pick one dataset.",
    };
  }
  if (ids.includes("collisions") && ids.includes("taxi")) {
    return {
      ok: false,
      reason:
        "Do not combine collisions with taxi trips in one rate. Pick one dataset.",
    };
  }
  if (
    ids.includes("transit") &&
    (ids.includes("311") || ids.includes("collisions") || ids.includes("taxi"))
  ) {
    return {
      ok: false,
      reason:
        "Do not combine MTA subway ridership with 311, collisions, or taxi data in one rate. Ask a single-dataset ridership question instead.",
    };
  }
  if (datasets.size >= 3) {
    return {
      ok: false,
      reason:
        "Do not mash multiple datasets (311 + collisions + taxi + census) into one comparative rate. Use one dataset and one clear ranking.",
    };
  }

  return { ok: true };
}

/** SQL that joins unrelated fact tables only to divide counts is usually a spurious ratio. */
function checkSpuriousSqlRatio(sql: string): TriviaSenseResult {
  const s = sql.toLowerCase();
  const has311 = /\bnyc_311\b|from\s+311\b/.test(s);
  const hasCollisions = /\bnypd_collisions\b/.test(s);
  const hasTaxi = /\bgtp_tlc_data\b/.test(s);
  const hasDivide = /\//.test(s) || /\b1\.0\s*\*|cast\s*\(.*\s+as\s+double\s*\)\s*\//i.test(s);

  if (!hasDivide) return { ok: true };

  const factCount = [has311, hasCollisions, hasTaxi].filter(Boolean).length;
  if (factCount >= 2 && has311 && hasCollisions) {
    return {
      ok: false,
      reason:
        "SQL joins 311 and collisions to form a ratio — use a single-table COUNT/SUM ranking instead.",
    };
  }
  if (has311 && hasTaxi) {
    return {
      ok: false,
      reason: "SQL mixes 311 and taxi data in a ratio — pick one dataset.",
    };
  }
  if (hasCollisions && hasTaxi) {
    return {
      ok: false,
      reason: "SQL mixes collisions and taxi data in a ratio — pick one dataset.",
    };
  }

  return { ok: true };
}

export function validateTriviaQuestionSense(
  question: string,
  sql?: string
): TriviaSenseResult {
  const q = question.trim();
  if (q.length < 12) {
    return { ok: false, reason: "Question is too short." };
  }

  for (const { re, reason } of BANNED_QUESTION_PATTERNS) {
    if (re.test(q)) return { ok: false, reason };
  }

  if (MIN_DIRECTION_RE.test(q)) {
    return {
      ok: false,
      reason:
        "Minimum-direction questions (lowest / least / fewest / smallest / fastest) are not supported — " +
        "the verifier always picks the HIGHEST-metric row, and ORDER BY DESC LIMIT 4 drops the true minimum. " +
        "Ask a highest/most/top ranking instead.",
    };
  }

  const cross = checkCrossDatasetRate(q);
  if (!cross.ok) return cross;

  if (sql?.trim()) {
    const sqlCheck = checkSpuriousSqlRatio(sql);
    if (!sqlCheck.ok) return sqlCheck;
  }

  return { ok: true };
}

export function formatTriviaSenseFeedback(reason: string): string {
  return (
    `Question rejected (not meaningful in the real world): ${reason} ` +
    "Ask a simple bar-trivia ranking: most/least/top borough or zone by ONE metric from ONE dataset."
  );
}
