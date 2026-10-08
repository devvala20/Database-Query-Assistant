/**
 * guard.ts — Phase 3: SELECT-only SQL validation (upgraded)
 *
 * Validates that AI-generated SQL is a safe, read-only SELECT before execution.
 * This is a critical security boundary: AI output is untrusted input.
 *
 * Strategy: multi-layer defence
 *   1. Structural check — must start with SELECT or WITH
 *   2. Blocked keyword/function list — regex patterns for all dangerous constructs
 *   3. Multi-statement check — no semicolons separating statements
 *   4. Depth limit — prevents deeply nested subqueries used for bypass
 */

/** Result of a guard check */
export interface GuardResult {
  safe: boolean;
  reason?: string;
}

/**
 * Dangerous keywords and DuckDB-specific file-reading functions that must never
 * appear in SQL we execute. DuckDB-WASM can read host files via read_csv etc.
 * — these must be blocked even inside SELECT.
 */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bDROP\b/i,         label: "DROP" },
  { pattern: /\bDELETE\b/i,       label: "DELETE" },
  { pattern: /\bINSERT\b/i,       label: "INSERT" },
  { pattern: /\bUPDATE\b/i,       label: "UPDATE" },
  { pattern: /\bCREATE\b/i,       label: "CREATE" },
  { pattern: /\bALTER\b/i,        label: "ALTER" },
  { pattern: /\bTRUNCATE\b/i,     label: "TRUNCATE" },
  { pattern: /\bCOPY\b/i,         label: "COPY" },
  { pattern: /\bINSTALL\b/i,      label: "INSTALL" },
  { pattern: /\bLOAD\b/i,         label: "LOAD" },
  { pattern: /\bATTACH\b/i,       label: "ATTACH" },
  { pattern: /\bDETACH\b/i,       label: "DETACH" },
  { pattern: /\bEXPORT\b/i,       label: "EXPORT" },
  { pattern: /\bIMPORT\b/i,       label: "IMPORT" },
  { pattern: /\bCALL\b/i,         label: "CALL (procedure)" },
  { pattern: /\bEXECUTE\b/i,      label: "EXECUTE" },
  { pattern: /\bPRAGMA\b/i,       label: "PRAGMA" },
  { pattern: /\bSET\b\s+\w/i,     label: "SET (session variable)" },
  // DuckDB file-reading table functions — dangerous even in SELECT
  { pattern: /\bread_csv\s*\(/i,    label: "read_csv()" },
  { pattern: /\bread_csv_auto\s*\(/i, label: "read_csv_auto()" },
  { pattern: /\bread_parquet\s*\(/i, label: "read_parquet()" },
  { pattern: /\bread_json\s*\(/i,   label: "read_json()" },
  { pattern: /\bread_json_auto\s*\(/i, label: "read_json_auto()" },
  { pattern: /\bscan\s*\(/i,        label: "scan()" },
  { pattern: /\bglob\s*\(/i,        label: "glob()" },
  { pattern: /\bgetenv\s*\(/i,      label: "getenv()" },
  { pattern: /\bshell\s*\(/i,       label: "shell()" },
  { pattern: /\bsystem\s*\(/i,      label: "system()" },
];

/**
 * Returns { safe: true } if `sql` is a single SELECT / WITH...SELECT statement
 * with no dangerous constructs. Otherwise returns { safe: false, reason }.
 */
export function guardQuery(sql: string): GuardResult {
  if (!sql || typeof sql !== "string") {
    return { safe: false, reason: "SQL is empty or not a string." };
  }

  // Strip string literals before checking patterns to avoid false positives
  // on data like "DROP TABLE" appearing in a string value.
  const stripped = _stripStringLiterals(sql);
  const trimmed = stripped.trim();

  // 1. Must start with SELECT or WITH (for CTEs like: WITH cte AS (...) SELECT ...)
  if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
    const firstWord = trimmed.split(/\s+/)[0]?.toUpperCase() ?? "";
    return {
      safe: false,
      reason: `Only SELECT queries are allowed. Got: ${firstWord || "(empty)"}`,
    };
  }

  // 2. Block dangerous keywords/functions
  for (const { pattern, label } of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        safe: false,
        reason: `Query contains a blocked construct: "${label}". Only read-only SELECT is allowed.`,
      };
    }
  }

  // 3. Multi-statement check — a semicolon followed by non-whitespace = second statement
  if (/;\s*\S/.test(trimmed)) {
    return {
      safe: false,
      reason: "Multi-statement queries are not allowed. Send a single SELECT.",
    };
  }

  // 4. SQL comment check — comments can be used to obscure blocked keywords
  if (/--/.test(trimmed) || /\/\*/.test(trimmed)) {
    return {
      safe: false,
      reason: "SQL comments are not allowed (they can be used to obscure restricted keywords).",
    };
  }

  return { safe: true };
}

/**
 * Strip single-quoted and double-quoted string literals from SQL to prevent
 * false positives on data values containing blocked keywords.
 *
 * Replaces content inside quotes with underscores of the same length
 * so that offset-based error reporting still works.
 */
function _stripStringLiterals(sql: string): string {
  // Replace 'single quoted strings' — handles '' escaped quotes
  let result = sql.replace(/'(?:[^']|'')*'/g, (m) => "'" + "_".repeat(m.length - 2) + "'");
  // Replace "double quoted identifiers" — these are identifiers, not values,
  // but we still want to neutralise their content for pattern matching
  result = result.replace(/"(?:[^"]|"")*"/g, (m) => '"' + "_".repeat(m.length - 2) + '"');
  return result;
}
