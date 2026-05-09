/**
 * Detect natural-language map / spatial intent so we route through the
 * tool-using SQL agent (schema lookup) even when CLAUDE_SQL_AGENT is off.
 */
export function mapSpatialIntent(question: string): boolean {
  const q = question.trim();
  if (!q) return false;

  const mapLike =
    /\b(map|maps|mapped|heatmap|heat\s*map|geographic|geospatial|markers?|visuali[sz]e|visuali[sz]ation|choropleth|clusters?)\b/i;

  const locateLike =
    /\b(where\s+(were|are|did|have)|show\s+(me\s+)?(where|locations?)|locations?\s+of|plot\s+(me\s+)?(the\s+)?)\b/i;

  return mapLike.test(q) || locateLike.test(q);
}
