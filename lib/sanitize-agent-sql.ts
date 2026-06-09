/**
 * Agent final messages sometimes append plain-English after the SQL block.
 * Athena expects a single statement — trailing prose causes parse errors
 * (e.g. "mismatched input 'Regarding'. Expecting: <EOF>").
 */

const PROSE_LINE_START =
  /^(Regarding|Note:|However|Additionally|For context|In summary|This (?:query|result)|The (?:above|following|query)|As (?:shown|noted)|Please note)\b/i;

/** Lines that are clearly still SQL (not prose). */
const SQL_LINE =
  /^\s*(--|SELECT|WITH|FROM|WHERE|JOIN|INNER|LEFT|RIGHT|FULL|CROSS|ON|AND|OR|NOT|GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|AS|CASE|WHEN|THEN|ELSE|END|USING|SET|VALUES|INTO|BY|DISTINCT|BETWEEN|IN|LIKE|IS|EXISTS|CAST|TRY_CAST|COUNT|SUM|AVG|MIN|MAX|\)|\(|\*|,|'|"|`|\d)/i;

function isProseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("--")) return false;
  if (SQL_LINE.test(trimmed)) return false;
  if (PROSE_LINE_START.test(trimmed)) return true;
  // English sentence: capital start, several words, no SQL operators.
  if (
    /^[A-Z]/.test(trimmed) &&
    trimmed.split(/\s+/).length >= 4 &&
    !/[=<>]/.test(trimmed)
  ) {
    return true;
  }
  return false;
}

/** Drop commentary lines appended after the SQL statement. */
export function trimTrailingProseFromSql(sql: string): string {
  const lines = sql.split(/\r?\n/);
  const kept: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (kept.length > 0 && trimmed === "") {
      const rest = lines
        .slice(i + 1)
        .map((l) => l.trim())
        .filter(Boolean);
      if (rest.length > 0 && rest.every(isProseLine)) {
        break;
      }
      kept.push(lines[i]);
      continue;
    }

    if (kept.length > 0 && isProseLine(trimmed)) {
      break;
    }

    kept.push(lines[i]);
  }

  return kept.join("\n").trim().replace(/;\s*$/, "");
}
