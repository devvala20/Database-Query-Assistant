/**
 * prompt.ts — Phase 4: Text-to-SQL prompt builder
 *
 * Builds the system prompt and per-request context that is sent to the AI.
 * Key design principles:
 *   - Schema only by default (no row data) for privacy
 *   - DuckDB-specific SQL hints so the model doesn't default to MySQL/Postgres syntax
 *   - Column names passed exactly (messy names like "Cust Name" are quoted)
 *   - Compact schema for wide CSVs (hundreds of columns)
 */

import type { TableSchema } from "../data/schema";
import { schemasToPromptString } from "../data/schema";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  /** SQL that was generated in this turn (if assistant) */
  sql?: string;
}

export interface PromptContext {
  question: string;
  schemas: TableSchema[];
  history: ConversationTurn[];
  /** Optional 3–5 sample values per column (user opt-in only) */
  sampleValues?: Record<string, string[]>;
  /** If set, we're asking the model to repair a failed query */
  repair?: {
    failedSql: string;
    errorMessage: string;
    attemptNumber: number;
  };
}

// ─── System prompt ────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a SQL expert that translates plain-English questions into DuckDB SQL for the tables described below.

Rules:
1. Output ONLY valid JSON — no markdown, no code blocks, no text outside the JSON.
2. The JSON schema must be exactly:
   {
     "sql": string,
     "explanation": string,
     "assumptions": string[],
     "clarification": string | null
   }
3. "sql" must be a valid DuckDB statement (SELECT, WITH, INSERT, UPDATE, DELETE, CREATE TABLE, ALTER TABLE, DROP TABLE) directly addressing the user's request.
4. Use only tables and columns listed in the schema. Quote all identifiers that contain spaces, special characters, or are reserved words using double-quotes.
5. "explanation" must be in plain English for someone who does not know SQL. Start with a verb ("Returns...", "Shows...", "Groups...").
6. "assumptions" is an array of short notes when you made a choice the user didn't specify (e.g., "Treated 'revenue' as unit_price × quantity"). Empty array if none.
7. If the question is ambiguous or refers to columns that don't exist, set "clarification" to a clarifying question and leave "sql" as an empty string.
8. Never guess column names. If unsure, ask in "clarification".

DuckDB-specific hints:
- Date functions: DATE_TRUNC('month', col), DATE_DIFF('day', a, b), STRFTIME(col, '%Y-%m')
- String: ILIKE (case-insensitive LIKE), REGEXP_MATCHES, LIST_AGG
- Window: ROW_NUMBER() OVER (...), RANK(), NTILE()
- Type casting: col::INTEGER, col::DOUBLE, col::DATE
- NULL handling: COALESCE(col, 0), col IS NOT DISTINCT FROM other
- For messy column names with spaces, ALWAYS use double-quotes: "Customer Name"
`.trim();

// ─── Repair prompt ────────────────────────────────────────────────────────────

export function buildRepairSystemPrompt(attemptNumber: number): string {
  return `${SYSTEM_PROMPT}

REPAIR MODE (attempt ${attemptNumber}):
The previous SQL query failed with an error. Your task is to fix it.
Analyse the error message, find the root cause, and produce a corrected query.
Do not repeat the same mistake. If you cannot fix it confidently, set "clarification" instead.`;
}

// ─── Per-request payload ──────────────────────────────────────────────────────

export interface ProxyRequestBody {
  systemPrompt: string;
  question: string;
  schema: string;
  history: Array<{ role: string; content: string }>;
  repair?: { failedSql: string; errorMessage: string };
  options: { sampleValues?: Record<string, string[]> };
}

/**
 * Build the full request body to send to the backend proxy.
 */
export function buildProxyRequest(ctx: PromptContext): ProxyRequestBody {
  const systemPrompt = ctx.repair
    ? buildRepairSystemPrompt(ctx.repair.attemptNumber)
    : SYSTEM_PROMPT;

  // Build schema string — compact for wide tables
  const schemaStr = _buildCompactSchema(ctx.schemas, ctx.question);

  // Build history for conversation memory
  const history: Array<{ role: string; content: string }> = ctx.history.flatMap(
    (turn) => {
      if (turn.role === "user") {
        return [{ role: "user", content: turn.content }];
      }
      // For assistant turns, include the SQL in the content so the model
      // can reference it in follow-up queries ("sort that by revenue")
      const content = turn.sql
        ? `${turn.content}\n\nSQL used:\n\`\`\`sql\n${turn.sql}\n\`\`\``
        : turn.content;
      return [{ role: "assistant", content }];
    }
  );

  // Add the current question (with repair context if applicable)
  const userMessage = ctx.repair
    ? `The following query failed:\n\`\`\`sql\n${ctx.repair.failedSql}\n\`\`\`\n\nError:\n${ctx.repair.errorMessage}\n\nPlease fix it. Original question: ${ctx.question}`
    : ctx.question;

  return {
    systemPrompt,
    question: userMessage,
    schema: schemaStr,
    history,
    ...(ctx.repair && {
      repair: {
        failedSql: ctx.repair.failedSql,
        errorMessage: ctx.repair.errorMessage,
      },
    }),
    options: {
      sampleValues: ctx.sampleValues,
    },
  };
}

// ─── Compact schema builder ───────────────────────────────────────────────────

/**
 * For wide CSVs (100+ columns), only include columns whose names are likely
 * relevant to the question (cheap string matching). Always include all columns
 * for narrow tables (≤ 30 columns).
 */
function _buildCompactSchema(schemas: TableSchema[], question: string): string {
  const NARROW_THRESHOLD = 30;
  const MAX_RELEVANT_COLS = 20;

  const filtered = schemas.map((schema) => {
    if (schema.columns.length <= NARROW_THRESHOLD) {
      return schema; // send all columns for narrow tables
    }

    // For wide tables: score columns by name similarity to the question
    const questionWords = question.toLowerCase().split(/\W+/);
    const scored = schema.columns.map((col) => {
      const colWords = col.name.toLowerCase().split(/[_\s]+/);
      const score = colWords.reduce(
        (acc, word) =>
          acc + (questionWords.some((qw) => qw.includes(word) || word.includes(qw)) ? 1 : 0),
        0
      );
      return { col, score };
    });

    const relevant = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RELEVANT_COLS)
      .map((s) => s.col);

    return { ...schema, columns: relevant };
  });

  return schemasToPromptString(filtered);
}
