/**
 * guard.ts — SQL Safety & Mutation Detection Guard
 *
 * Enforces safety boundaries while enabling full SQL execution:
 *   - Allows all standard SQL operations: SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, TRUNCATE
 *   - Accurately detects mutations (DELETE, UPDATE, DROP, etc.) to trigger confirmation & backup preservation
 *   - Strictly blocks host escape vectors: system(), shell(), getenv(), ATTACH, LOAD, INSTALL
 */

export interface GuardResult {
  safe: boolean;
  reason?: string;
  isMutation?: boolean;
  mutationType?: "DELETE" | "UPDATE" | "DROP" | "TRUNCATE" | "INSERT" | "ALTER" | "CREATE";
  targetTable?: string;
}

/**
 * Host compromise vectors and unauthorized file access functions
 * that must NEVER run inside DuckDB-WASM.
 */
const HOST_ESCAPE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bINSTALL\b/i,        label: "INSTALL" },
  { pattern: /\bLOAD\b/i,           label: "LOAD" },
  { pattern: /\bATTACH\b/i,         label: "ATTACH" },
  { pattern: /\bDETACH\b/i,         label: "DETACH" },
  { pattern: /\bgetenv\s*\(/i,      label: "getenv()" },
  { pattern: /\bshell\s*\(/i,       label: "shell()" },
  { pattern: /\bsystem\s*\(/i,      label: "system()" },
  { pattern: /\bscan\s*\(/i,        label: "scan()" },
  { pattern: /\bglob\s*\(/i,        label: "glob()" },
];

/**
 * Detect whether a query performs data/schema mutation.
 */
export function isMutationQuery(sql: string): {
  isMutation: boolean;
  type?: GuardResult["mutationType"];
  targetTable?: string;
} {
  if (!sql || typeof sql !== "string") return { isMutation: false };

  const stripped = _stripStringLiterals(sql).trim();

  // 1. DELETE
  const deleteMatch = stripped.match(/^\s*DELETE\s+FROM\s+["']?([a-zA-Z0-9_]+)["']?/i);
  if (deleteMatch) {
    return { isMutation: true, type: "DELETE", targetTable: deleteMatch[1] };
  }

  // 2. DROP TABLE
  const dropMatch = stripped.match(/^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["']?([a-zA-Z0-9_]+)["']?/i);
  if (dropMatch) {
    return { isMutation: true, type: "DROP", targetTable: dropMatch[1] };
  }

  // 3. UPDATE
  const updateMatch = stripped.match(/^\s*UPDATE\s+["']?([a-zA-Z0-9_]+)["']?/i);
  if (updateMatch) {
    return { isMutation: true, type: "UPDATE", targetTable: updateMatch[1] };
  }

  // 4. TRUNCATE
  const truncateMatch = stripped.match(/^\s*TRUNCATE\s+(?:TABLE\s+)?["']?([a-zA-Z0-9_]+)["']?/i);
  if (truncateMatch) {
    return { isMutation: true, type: "TRUNCATE", targetTable: truncateMatch[1] };
  }

  // 5. INSERT
  const insertMatch = stripped.match(/^\s*INSERT\s+INTO\s+["']?([a-zA-Z0-9_]+)["']?/i);
  if (insertMatch) {
    return { isMutation: true, type: "INSERT", targetTable: insertMatch[1] };
  }

  // 6. ALTER TABLE
  const alterMatch = stripped.match(/^\s*ALTER\s+TABLE\s+["']?([a-zA-Z0-9_]+)["']?/i);
  if (alterMatch) {
    return { isMutation: true, type: "ALTER", targetTable: alterMatch[1] };
  }

  // 7. CREATE TABLE
  const createMatch = stripped.match(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([a-zA-Z0-9_]+)["']?/i);
  if (createMatch) {
    return { isMutation: true, type: "CREATE", targetTable: createMatch[1] };
  }

  // Check if any mutation keyword appears as first token
  if (/^\s*(DELETE|UPDATE|DROP|INSERT|TRUNCATE|ALTER)\b/i.test(stripped)) {
    return { isMutation: true, type: "UPDATE" };
  }

  return { isMutation: false };
}

/**
 * Validates SQL query safety:
 *   - Permits all SQL operations (SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, TRUNCATE)
 *   - Identifies data mutation queries for confirmation & backup flow
 *   - Blocks dangerous host escape functions (system(), shell(), getenv(), etc.)
 */
export function guardQuery(sql: string): GuardResult {
  if (!sql || typeof sql !== "string") {
    return { safe: false, reason: "SQL is empty or not a string." };
  }

  const stripped = _stripStringLiterals(sql);
  const trimmed = stripped.trim();

  // 1. Block true host escape vectors
  for (const { pattern, label } of HOST_ESCAPE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        safe: false,
        reason: `Query contains a blocked host-level construct: "${label}".`,
      };
    }
  }

  // 2. Multi-statement check (semicolon followed by non-whitespace)
  if (/;\s*\S/.test(trimmed)) {
    return {
      safe: false,
      reason: "Multi-statement queries are not allowed. Please execute one statement at a time.",
    };
  }

  // 3. SQL comment check
  if (/--/.test(trimmed) || /\/\*/.test(trimmed)) {
    return {
      safe: false,
      reason: "SQL comments are not allowed (to prevent hidden command injection).",
    };
  }

  // 4. Mutation detection
  const mutation = isMutationQuery(sql);
  if (mutation.isMutation) {
    return {
      safe: true,
      isMutation: true,
      mutationType: mutation.type,
      targetTable: mutation.targetTable,
    };
  }

  return { safe: true, isMutation: false };
}

/**
 * Strip string literals to prevent false positives when keywords appear inside values.
 */
function _stripStringLiterals(sql: string): string {
  let result = sql.replace(/'(?:[^']|'')*'/g, (m) => "'" + "_".repeat(m.length - 2) + "'");
  result = result.replace(/"(?:[^"]|"")*"/g, (m) => '"' + "_".repeat(m.length - 2) + '"');
  return result;
}
