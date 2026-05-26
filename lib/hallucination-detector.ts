export type SchemaMap = Record<string, string[]>;

export interface ParsedIdentifiers {
    /** Table names found after FROM, JOIN, UPDATE, INSERT INTO */
    tables: string[];
    /** Column-like identifiers found in SELECT, WHERE, GROUP BY, ORDER BY, ON */
    columns: string[];
  }

  export interface HallucinationResult {
    /** True if any table or column reference is not in the schema */
    hasHallucination: boolean;
    /** Table names referenced in the SQL that don't exist in the schema */
    invalidTables: string[];
    /** Column names referenced in the SQL that don't exist in any schema table */
    invalidColumns: string[];
    /** All table names extracted from the SQL (valid + invalid) */
    referencedTables: string[];
    /** All column names extracted from the SQL (valid + invalid) */
    referencedColumns: string[];
  }

const SQL_KEYWORDS = new Set([
    'select', 'from', 'where', 'join', 'inner', 'left', 'right', 'outer', 'full',
    'cross', 'on', 'and', 'or', 'not', 'in', 'is', 'null', 'like', 'between',
    'group', 'by', 'order', 'having', 'limit', 'offset', 'union', 'all', 'distinct',
    'as', 'case', 'when', 'then', 'else', 'end', 'exists', 'with', 'recursive',
    'insert', 'into', 'update', 'set', 'delete', 'create', 'drop', 'alter', 'table',
    'true', 'false', 'asc', 'desc', 'nulls', 'first', 'last', 'over', 'partition',
    'rows', 'range', 'unbounded', 'preceding', 'following', 'current', 'row',
    // Athena/Trino-specific
    'tablesample', 'unnest', 'lateral', 'ordinality', 'values',
  ]);
  
  const SQL_FUNCTIONS = new Set([
    'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'nullif', 'ifnull',
    'cast', 'try_cast', 'date_trunc', 'date_add', 'date_diff', 'date_parse',
    'format_datetime', 'from_unixtime', 'to_unixtime', 'year', 'month', 'day',
    'hour', 'minute', 'second', 'dow', 'doy', 'week', 'quarter',
    'lower', 'upper', 'trim', 'ltrim', 'rtrim', 'substr', 'substring', 'length',
    'replace', 'regexp_like', 'regexp_extract', 'split', 'cardinality',
    'array_agg', 'string_agg', 'listagg', 'arbitrary', 'bool_and', 'bool_or',
    'approx_distinct', 'approx_percentile', 'percentile_approx',
    'st_geomfromtext', 'st_point', 'st_distance', 'st_within', 'st_contains',
    'st_x', 'st_y', 'st_area', 'st_buffer', 'st_centroid', 'st_intersects',
    'row_number', 'rank', 'dense_rank', 'ntile', 'lag', 'lead',
    'first_value', 'last_value', 'nth_value',
    'if', 'iff', 'try', 'abs', 'ceil', 'floor', 'round', 'truncate', 'log',
    'power', 'sqrt', 'exp', 'ln', 'mod', 'rand', 'random',
    'concat', 'array', 'map', 'json_extract', 'json_extract_scalar',
    'element_at', 'contains', 'transform', 'filter', 'reduce',
  ]);
  
  const SQL_TYPES = new Set([
    'int', 'integer', 'bigint', 'smallint', 'tinyint', 'double', 'float',
    'real', 'decimal', 'numeric', 'varchar', 'char', 'string', 'text',
    'boolean', 'bool', 'date', 'time', 'timestamp', 'interval', 'binary',
    'varbinary', 'array', 'map', 'row', 'json', 'ipaddress', 'uuid',
    'hyperloglog', 'geometry',
  ]);
  
  function stripStringLiterals(sql: string): string {
    return sql.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  }
  
  function stripComments(sql: string): string {
    return sql
      .replace(/--[^\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
  }
  
  function isSchemaIdentifierCandidate(token: string): boolean {
    if (!token || token.length === 0) return false;
    if (/^\d/.test(token)) return false;
    if (/^\d+\.?\d*$/.test(token)) return false;
    if (SQL_KEYWORDS.has(token)) return false;
    if (SQL_FUNCTIONS.has(token)) return false;
    if (SQL_TYPES.has(token)) return false;
    return true;
  }
  
  function stripQualifier(identifier: string): string {
    const unquoted = identifier.replace(/[`"]/g, '');
    const parts = unquoted.split('.');
    return parts[parts.length - 1];
  }

export function parseSQLIdentifiers(sql: string): ParsedIdentifiers {
    let normalized = sql.toLowerCase();
    normalized = stripComments(normalized);
    normalized = stripStringLiterals(normalized);
  
    const tables = new Set<string>();
    const cteNames = new Set<string>();
  
    const simpleCtePattern = /\b(\w+)\s+as\s*\(/g;
    let cteMatch: RegExpExecArray | null;
    while ((cteMatch = simpleCtePattern.exec(normalized)) !== null) {
      cteNames.add(cteMatch[1]);
    }
  
    const tablePattern =
      /\b(?:from|join|inner\s+join|left\s+join|right\s+join|left\s+outer\s+join|right\s+outer\s+join|full\s+join|cross\s+join|update|insert\s+into)\s+([\w."` ]+?)(?:\s+(?:where|on|inner|left|right|full|cross|join|group|order|having|limit|set|;)|$)/g;
  
    let tableMatch: RegExpExecArray | null;
    while ((tableMatch = tablePattern.exec(normalized)) !== null) {
      const rawName = tableMatch[1].trim().split(/\s+/)[0];
      const cleaned = stripQualifier(rawName);
      if (cleaned && !SQL_KEYWORDS.has(cleaned) && !cteNames.has(cleaned)) {
        tables.add(cleaned);
      }
    }
  
    const columns = new Set<string>();
    const aliases = new Set<string>();
  
    // Capture aliases from both:
    // 1) explicit "AS alias" (including quoted aliases), and
    // 2) implicit select aliases: "expr alias" in SELECT lists.
    const aliasPatterns = [
      /\bas\s+(?:"([^"]+)"|`([^`]+)`|(\w+))/g,
      /\bselect\s+[\s\S]*?\b(?:,|\b)\s*(?:[\w.()]+)\s+(?!from\b|where\b|group\b|order\b|having\b|limit\b)(\w+)\b/g,
    ];
    for (const aliasPattern of aliasPatterns) {
      let aliasMatch: RegExpExecArray | null;
      while ((aliasMatch = aliasPattern.exec(normalized)) !== null) {
        const alias = (aliasMatch[1] || aliasMatch[2] || aliasMatch[3] || '').toLowerCase();
        if (alias) aliases.add(alias);
      }
    }
  
    const clauseRegions = [
      /\bselect\s+([\s\S]+?)\s+from\b/,
      /\bwhere\s+([\s\S]+?)(?:\bgroup\b|\border\b|\bhaving\b|\blimit\b|$)/,
      /\bgroup\s+by\s+([\s\S]+?)(?:\border\b|\bhaving\b|\blimit\b|$)/,
      /\border\s+by\s+([\s\S]+?)(?:\blimit\b|$)/,
      /\bhaving\s+([\s\S]+?)(?:\border\b|\blimit\b|$)/,
      /\bon\s+([\s\S]+?)(?:\bwhere\b|\bjoin\b|\bgroup\b|\border\b|\blimit\b|$)/,
    ];
  
    for (const pattern of clauseRegions) {
      const match = normalized.match(pattern);
      if (!match) continue;
  
      const clauseContent = match[1];
      const tokens = clauseContent.split(/[\s,()=<>!+\-*/%|&^~]+/);
  
      for (const rawToken of tokens) {
        const parts = rawToken.split('.');
        const token = parts[parts.length - 1].replace(/[`"]/g, '');
  
        if (!token) continue;
        if (!isSchemaIdentifierCandidate(token)) continue;
        if (aliases.has(token)) continue;
        if (cteNames.has(token)) continue;
        if (tables.has(token)) continue;
  
        columns.add(token);
      }
    }
  
    return {
      tables: Array.from(tables),
      columns: Array.from(columns),
    };
  }
  

  export function detectSchemaHallucinations(
    sql: string,
    schema: SchemaMap
  ): HallucinationResult {
    const { tables: referencedTables, columns: referencedColumns } =
      parseSQLIdentifiers(sql);
  
    const validTables = new Set(
      Object.keys(schema).map((table) => table.toLowerCase())
    );
    const validColumns = new Set(
      Object.values(schema)
        .flat()
        .map((column) => column.toLowerCase())
    );
  
    const invalidTables = referencedTables.filter(
      (table) => !validTables.has(table)
    );
    const invalidColumns = referencedColumns.filter(
      (column) => !validColumns.has(column)
    );
  
    return {
      hasHallucination: invalidTables.length > 0 || invalidColumns.length > 0,
      invalidTables,
      invalidColumns,
      referencedTables,
      referencedColumns,
    };
  }


/**
 * fuzzy matching for targeted repair prompts
 */

export function findClosestSchemaColumn(
  invalidColumn: string,
  schema: SchemaMap
): string | null {
  const allColumns = Object.values(schema).flat().map((c) => c.toLowerCase());
  const parts = invalidColumn.toLowerCase().split('_');

  let bestMatch: string | null = null;
  let bestScore = -1;
  let bestDistance = Infinity;

  for (const candidate of allColumns) {
    const candidateParts = candidate.split('_');
    // Score: count of shared parts
    const sharedParts = parts.filter((p) => candidateParts.includes(p)).length;
    const distance = levenshtein(invalidColumn, candidate);

    if (
      sharedParts > bestScore ||
      (sharedParts === bestScore && distance < bestDistance)
    ) {
      bestScore = sharedParts;
      bestDistance = distance;
      bestMatch = candidate;
    }
  }

  // Only suggest if we have at least 1 shared part or the distance is small
  if (bestScore === 0 && bestDistance > 5) return null;
  return bestMatch;
}

/**
 * Build a targeted repair reason string for the model when schema hallucinations
 * are detected. Includes specific invalid identifiers and schema-based suggestions.
 *
 * This is meant to replace the generic "SQL failed, please try again" repair
 * prompt with actionable information about what specifically was wrong.
 */
export function buildHallucinationRepairReason(
  result: HallucinationResult,
  schema: SchemaMap
): string {
  const lines: string[] = ['Schema hallucination detected. The following identifiers do not exist:'];

  for (const invalidTable of result.invalidTables) {
    const validTables = Object.keys(schema).join(', ');
    lines.push(`- Table "${invalidTable}" does not exist. Valid tables: ${validTables}`);
  }

  for (const invalidColumn of result.invalidColumns) {
    const suggestion = findClosestSchemaColumn(invalidColumn, schema);
    if (suggestion) {
      lines.push(`- Column "${invalidColumn}" does not exist. Did you mean "${suggestion}"?`);
    } else {
      lines.push(`- Column "${invalidColumn}" does not exist in any table in the schema.`);
    }
  }

  lines.push('');
  lines.push('Please correct only these specific references. Do not change the query logic.');
  lines.push('Before writing the corrected SQL, verify each column name against the schema provided in the system prompt.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Utility: build a SchemaMap from the get_schema tool output
// ---------------------------------------------------------------------------

export function buildSchemaMap(
  rawSchema: Record<string, { columns: Array<{ name: string; type: string; description?: string }> }>
): SchemaMap {
  const result: SchemaMap = {};
  for (const [tableName, tableData] of Object.entries(rawSchema)) {
    result[tableName.toLowerCase()] = tableData.columns.map((col) =>
      col.name.toLowerCase()
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Levenshtein distance (compact implementation for fuzzy matching)
// ---------------------------------------------------------------------------

/**
 * Compute Levenshtein edit distance between two strings.
 * Used for fuzzy column name suggestion when no parts overlap.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Use a single row of the DP matrix to save memory
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,       // insertion
        prev[j] + 1,           // deletion
        prev[j - 1] + cost     // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}
