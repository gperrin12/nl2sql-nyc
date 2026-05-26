import type { HallucinationType } from "@/lib/query-runs-store";

export type { HallucinationType };

export type QueryOutcome = {
  athenaState: string;
  hallucinationType: HallucinationType | null;
  errorReason?: string | null;
};

const SELECT_OR_WITH = /^\s*(SELECT|WITH)\b/i;

const OFF_TOPIC_REFUSAL_PATTERNS: RegExp[] = [
  /\b(?:i )?(?:can(?:not|'t)|unable to) (?:help|answer|assist)\b/i,
  /\boutside (?:the )?scope\b/i,
  /\bnot (?:related|relevant) to (?:this|the) (?:dataset|warehouse|data)\b/i,
  /\bonly (?:answer|help with) questions (?:about|on)\b/i,
  /\boff[- ]topic\b/i,
  /\b(?:general knowledge|trivia) (?:question|query)\b/i,
  /\bno (?:valid )?sql\b/i,
];

export function isValidSelectSql(sql: string): boolean {
  const trimmed = sql.trim();
  return trimmed.length > 0 && SELECT_OR_WITH.test(trimmed);
}

/** Post-generation prose that declines warehouse questions. */
export function isOffTopicRefusal(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isValidSelectSql(t)) return false;
  return OFF_TOPIC_REFUSAL_PATTERNS.some((re) => re.test(t));
}

export function outcomeForOffTopic(reason?: string): QueryOutcome {
  return {
    athenaState: "BLOCKED",
    hallucinationType: "off_topic",
    errorReason: reason ?? "Question is outside NYC civic-data scope",
  };
}

export function outcomeForGuardrailBlocked(reason: string): QueryOutcome {
  return {
    athenaState: "BLOCKED",
    hallucinationType: "guardrail_blocked",
    errorReason: reason,
  };
}

export function outcomeForNoSql(reason?: string): QueryOutcome {
  return {
    athenaState: "FAILED",
    hallucinationType: "no_sql_produced",
    errorReason: reason ?? "Model did not return a SELECT or WITH statement",
  };
}

export function outcomeForGenerationError(detail: string): QueryOutcome {
  return {
    athenaState: "FAILED",
    hallucinationType: "no_sql_produced",
    errorReason: detail,
  };
}

export function outcomeForAthenaFailure(detail: string): QueryOutcome {
  return {
    athenaState: "FAILED",
    hallucinationType: null,
    errorReason: detail,
  };
}

export function outcomeForRunning(): Pick<QueryOutcome, "athenaState" | "hallucinationType"> {
  return { athenaState: "RUNNING", hallucinationType: null };
}

/**
 * Classify model output when it is not executable SQL.
 * Returns null when generation looks like valid SQL (caller should continue).
 */
export function classifyNonSqlGeneration(sqlOrText: string): QueryOutcome | null {
  if (isValidSelectSql(sqlOrText)) return null;
  if (isOffTopicRefusal(sqlOrText)) {
    return outcomeForOffTopic(
      sqlOrText.slice(0, 500) || "Model refused or answered without SQL"
    );
  }
  return outcomeForNoSql(
    sqlOrText.slice(0, 500) || "Model did not return a SELECT or WITH statement"
  );
}
