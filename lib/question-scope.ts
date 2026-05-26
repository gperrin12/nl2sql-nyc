/** NYC / warehouse context — ambiguous questions are allowed through to generation. */
const NYC_DATA_SIGNAL =
  /\b(nyc|new york|manhattan|brooklyn|queens|bronx|staten|311|tlc|taxi|cab|borough|nypd|collision|complaint|census|tract|h3|taxi_zones|pickup|dropoff|trip|yellow|green|fhv|athena|warehouse|geoid|nta|bedford|williamsburg|harlem|astoria|flushing|jamaica|soho|tribeca|chelsea|midtown|downtown|uptown|subway|transit|parking|violation|demographic|acs|population|per capita|heatmap|hex bin|spatial|latitude|longitude|wkt|geometry)\b/i;

/** Clearly general-knowledge or non-analytics prompts with no NYC data signal. */
const OFF_TOPIC_PATTERNS: RegExp[] = [
  /\bwhat(?:'s| is) the capital of\b/i,
  /\bwho (?:is|was|are|were) (?:the )?(?:president|prime minister|king|queen|pope)\b/i,
  /\bhow (?:do i|to) (?:learn|code|program|bake|cook)\b/i,
  /\b(?:write|tell) (?:me )?(?:a |an )?(?:joke|poem|story|essay)\b/i,
  /\brecipe for\b/i,
  /\btranslate .+ (?:to|into) \w+\b/i,
  /\bwhat is the (?:meaning|definition) of\b/i,
  /\b(?:solve|factor|integrate|differentiate) (?:this )?(?:equation|integral|problem)\b/i,
  /\bweather in (?!new york|nyc)\w+/i,
  /\b(?:bitcoin|crypto|stock) price\b/i,
  /\bwho won (?:the )?(?:world cup|super bowl|election)\b/i,
];

/**
 * Conservative pre-check before SQL generation.
 * Returns true only when the question is very likely off-topic for this warehouse.
 */
export function isOffTopicHeuristic(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (NYC_DATA_SIGNAL.test(q)) return false;

  return OFF_TOPIC_PATTERNS.some((re) => re.test(q));
}
