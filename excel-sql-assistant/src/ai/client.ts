/**
 * client.ts — AI Client (Phase 4: fully wired)
 *
 * Calls the backend proxy which adds the API key and calls Claude.
 * MOCK_MODE is still available for local testing without a backend.
 *
 * Set VITE_PROXY_URL in .env.local to your deployed proxy URL.
 * Set VITE_MOCK_AI=true to force mock mode regardless of MOCK_MODE constant.
 */

import type { TableSchema } from "../data/schema";
import type { ConversationTurn } from "./prompt";
import { buildProxyRequest } from "./prompt";

export interface AiRequest {
  question: string;
  schemas: TableSchema[];
  /** Full conversation history for follow-up support */
  history?: ConversationTurn[];
  /** Previous SQL (for repair loop) */
  previousSql?: string;
  /** Error from the last execution attempt (for repair loop) */
  errorMessage?: string;
  /** Optional sample values per column (user opt-in) */
  sampleValues?: Record<string, string[]>;
}

export interface AiResponse {
  sql: string;
  explanation: string;
  assumptions: string[];
  /** Set by model when question is ambiguous — leave sql empty */
  clarification: string | null;
}

// ─── Mock mode ────────────────────────────────────────────────────────────────
// Flip to false when the backend proxy is deployed.
// Override with env var VITE_MOCK_AI=true for CI/testing.
const MOCK_MODE: boolean =
  import.meta.env.VITE_MOCK_AI === "true" ? true : true;
//                                                  ^^^^
//                    Change this `true` → `false` when proxy is ready

/**
 * Send a question + schema to the AI and get back SQL + explanation.
 */
export async function askAi(request: AiRequest): Promise<AiResponse> {
  if (MOCK_MODE) {
    await _simulateLatency();
    return _mockResponse(request);
  }

  // ── Real proxy call ──────────────────────────────────────────────────────
  const proxyBody = buildProxyRequest({
    question: request.question,
    schemas: request.schemas,
    history: request.history ?? [],
    sampleValues: request.sampleValues,
    repair: request.previousSql && request.errorMessage
      ? {
          failedSql: request.previousSql,
          errorMessage: request.errorMessage,
          attemptNumber: 1, // repairLoop increments this externally
        }
      : undefined,
  });

  const proxyUrl = import.meta.env.VITE_PROXY_URL ?? "/api/ask";
  const proxyAuthToken = import.meta.env.VITE_PROXY_AUTH_TOKEN;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (proxyAuthToken) {
    headers["Authorization"] = `Bearer ${proxyAuthToken}`;
  }

  const response = await fetch(proxyUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(proxyBody),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(`AI proxy error ${response.status}: ${text}`);
  }

  const json: unknown = await response.json();
  _validateAiResponse(json);
  return json as AiResponse;
}

// ─── Mock implementation ──────────────────────────────────────────────────────

async function _simulateLatency(): Promise<void> {
  await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
}

function _mockResponse(request: AiRequest): AiResponse {
  const firstTable = request.schemas[0];

  if (!firstTable) {
    return {
      sql: "",
      explanation: "No tables are loaded yet.",
      assumptions: [],
      clarification: "Please load a CSV file first, then ask your question.",
    };
  }

  const tableName = firstTable.tableName;
  const cols = firstTable.columns;
  const question = request.question.toLowerCase();

  // Simulate a few query patterns so mock mode is more useful
  let sql: string;
  let explanation: string;

  if (question.includes("count") || question.includes("how many")) {
    sql = `SELECT COUNT(*) AS row_count FROM "${tableName}"`;
    explanation = `Returns the total number of rows in the "${tableName}" table.`;
  } else if (question.includes("top") || question.includes("most")) {
    const numCol = cols.find(
      (c) =>
        c.type.includes("INT") ||
        c.type.includes("DOUBLE") ||
        c.type.includes("FLOAT") ||
        c.type.includes("DECIMAL")
    );
    const nameCol = cols.find(
      (c) => c.type.includes("VARCHAR") || c.type.includes("TEXT")
    );
    if (numCol && nameCol) {
      sql = `SELECT "${nameCol.name}", SUM("${numCol.name}") AS total\nFROM "${tableName}"\nGROUP BY "${nameCol.name}"\nORDER BY total DESC\nLIMIT 10`;
      explanation = `Groups rows by "${nameCol.name}" and sums "${numCol.name}", returning the top 10.`;
    } else {
      sql = `SELECT * FROM "${tableName}" LIMIT 10`;
      explanation = `Returns the first 10 rows from "${tableName}".`;
    }
  } else if (question.includes("column") || question.includes("schema") || question.includes("field")) {
    sql = `DESCRIBE "${tableName}"`;
    explanation = `Shows all column names and data types in the "${tableName}" table.`;
  } else {
    sql = `SELECT * FROM "${tableName}" LIMIT 100`;
    explanation = `Returns the first 100 rows from the "${tableName}" table.`;
  }

  return {
    sql,
    explanation,
    assumptions: [
      `[Mock mode] No real AI call was made. Deploy the backend proxy to enable Claude.`,
      `Question received: "${request.question}"`,
    ],
    clarification: null,
  };
}

// ─── Response validation ──────────────────────────────────────────────────────

function _validateAiResponse(json: unknown): asserts json is AiResponse {
  if (typeof json !== "object" || json === null) {
    throw new Error("AI response is not a JSON object.");
  }
  const r = json as Record<string, unknown>;
  if (typeof r.sql !== "string")
    throw new Error("AI response missing or invalid 'sql' field.");
  if (typeof r.explanation !== "string")
    throw new Error("AI response missing or invalid 'explanation' field.");
  if (!Array.isArray(r.assumptions))
    throw new Error("AI response missing or invalid 'assumptions' field.");
  if (r.clarification !== null && typeof r.clarification !== "string")
    throw new Error("AI response 'clarification' must be string or null.");
}
