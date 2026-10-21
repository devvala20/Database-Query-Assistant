/**
 * client.ts — AI Client (Phase 4: fully wired for Direct Claude + Proxy + Mock)
 *
 * Calls:
 *   1. Anthropic Claude API directly (using API key from Settings or .env)
 *   2. Custom Backend Proxy (Cloudflare Worker or Azure Function)
 *   3. Mock mode fallback if no API key / proxy is configured
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
  /** Optional Anthropic API Key (from Settings or .env) */
  apiKey?: string;
  /** Optional custom proxy URL */
  proxyUrl?: string;
  /** Optional proxy bearer token */
  proxyToken?: string;
  /** AI provider: "gemini" | "groq" | "anthropic" | "proxy" | "mock" */
  aiProvider?: "gemini" | "groq" | "anthropic" | "proxy" | "mock";
  /** Model name (e.g. "gemini-1.5-flash", "llama-3.3-70b-versatile", "claude-3-5-sonnet-20241022") */
  modelName?: string;
}

export interface AiResponse {
  sql: string;
  explanation: string;
  assumptions: string[];
  /** Set by model when question is ambiguous — leave sql empty */
  clarification: string | null;
}

/**
 * Send a question + schema to the AI and get back SQL + explanation.
 */
export async function askAi(request: AiRequest): Promise<AiResponse> {
  const provider = request.aiProvider ?? "gemini";
  const apiKey =
    request.apiKey ||
    (typeof import.meta !== "undefined" ? import.meta.env?.VITE_ANTHROPIC_API_KEY : "") ||
    "";
  const proxyUrl =
    request.proxyUrl ||
    (typeof import.meta !== "undefined" ? import.meta.env?.VITE_PROXY_URL : "") ||
    "";
  const proxyToken =
    request.proxyToken ||
    (typeof import.meta !== "undefined" ? import.meta.env?.VITE_PROXY_AUTH_TOKEN : "") ||
    "";
  const modelName =
    request.modelName ||
    (provider === "gemini"
      ? "gemini-1.5-flash"
      : provider === "groq"
      ? "llama-3.1-8b-instant"
      : "claude-3-5-sonnet-20241022");

  // Force mock mode if explicitly requested OR if no API key/proxy is provided
  const needsKey = provider === "anthropic" || provider === "gemini" || provider === "groq";
  if (provider === "mock" || (needsKey && !apiKey && !proxyUrl)) {
    await _simulateLatency();
    return _mockResponse(request);
  }

  const proxyBody = buildProxyRequest({
    question: request.question,
    schemas: request.schemas,
    history: request.history ?? [],
    sampleValues: request.sampleValues,
    repair:
      request.previousSql && request.errorMessage
        ? {
            failedSql: request.previousSql,
            errorMessage: request.errorMessage,
            attemptNumber: 1,
          }
        : undefined,
  });

  // ── 1. Google Gemini API (100% Free at aistudio.google.com) ──────────────────
  if (provider === "gemini" && apiKey) {
    const geminiHistory = proxyBody.history.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    }));

    const contents = [
      {
        role: "user",
        parts: [{ text: `Available tables:\n\n${proxyBody.schema}` }],
      },
      {
        role: "model",
        parts: [
          {
            text: "Understood. I will generate DuckDB SQL using only these tables and columns.",
          },
        ],
      },
      ...geminiHistory,
      {
        role: "user",
        parts: [{ text: proxyBody.question }],
      },
    ];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelName
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: proxyBody.systemPrompt }],
        },
        contents,
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Google Gemini API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return _parseModelJsonResponse(text);
  }

  // ── 2. Groq Free API (100% Free at console.groq.com) ─────────────────────────
  if (provider === "groq" && apiKey) {
    const messages = [
      { role: "system", content: proxyBody.systemPrompt },
      { role: "user", content: `Available tables:\n\n${proxyBody.schema}` },
      {
        role: "assistant",
        content: "Understood. I will generate DuckDB SQL using only these tables and columns.",
      },
      ...proxyBody.history,
      { role: "user", content: proxyBody.question },
    ];

    // Ensure we avoid the retired llama-3.3-70b-versatile model ID
    let targetModel =
      modelName === "llama-3.3-70b-versatile" ? "llama-3.1-8b-instant" : modelName;

    let response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: targetModel,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });

    // Auto-fallback: If model is not found on user's tier, retry with llama-3.1-8b-instant
    if (!response.ok && response.status === 404 && targetModel !== "llama-3.1-8b-instant") {
      targetModel = "llama-3.1-8b-instant";
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: targetModel,
          messages,
          response_format: { type: "json_object" },
          temperature: 0.1,
        }),
      });
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Groq API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return _parseModelJsonResponse(text);
  }

  // ── 3. Direct Anthropic Claude API Call ───────────────────────────────────────
  if (provider === "anthropic" && apiKey) {
    const messages: Array<{ role: string; content: string }> = [
      {
        role: "user",
        content: `Available tables:\n\n${proxyBody.schema}`,
      },
      {
        role: "assistant",
        content: "Understood. I will generate DuckDB SQL using only these tables and columns.",
      },
      ...proxyBody.history,
      {
        role: "user",
        content: proxyBody.question,
      },
    ];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 1024,
        system: proxyBody.systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Anthropic Claude API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const text = data.content?.[0]?.text ?? "";
    return _parseModelJsonResponse(text);
  }

  // ── 2. Backend Proxy Call (Cloudflare / Azure / Custom) ──────────────────────
  if (proxyUrl) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (proxyToken) {
      headers["Authorization"] = `Bearer ${proxyToken}`;
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

  // Fallback
  return _mockResponse(request);
}

// ─── Response parser & validator ──────────────────────────────────────────────

function _parseModelJsonResponse(rawText: string): AiResponse {
  let cleaned = rawText.trim();
  // Strip Markdown code block fences (```json ... ``` or ```sql ... ```)
  const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) {
    cleaned = match[1].trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    _validateAiResponse(parsed);
    return parsed as AiResponse;
  } catch (err) {
    // If Claude returned raw SQL instead of the JSON wrapper, salvage it
    if (/^\s*(SELECT|WITH|DESCRIBE)\b/i.test(cleaned)) {
      return {
        sql: cleaned,
        explanation: "Generated SQL query for your question.",
        assumptions: [],
        clarification: null,
      };
    }
    // Extract any JSON object embedded in text
    const jsonBraceMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonBraceMatch) {
      try {
        const parsed = JSON.parse(jsonBraceMatch[0]);
        _validateAiResponse(parsed);
        return parsed as AiResponse;
      } catch {}
    }
    throw new Error(
      `Could not parse JSON from AI response: ${err instanceof Error ? err.message : String(err)}\nRaw text: ${cleaned.slice(0, 300)}`
    );
  }
}

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

// ─── Mock implementation ──────────────────────────────────────────────────────

async function _simulateLatency(): Promise<void> {
  await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
}

function _mockResponse(request: AiRequest): AiResponse {
  const firstTable = request.schemas[0];
  const question = request.question.toLowerCase().trim();

  // ── No tables loaded yet ────────────────────────────────────────────────────
  if (!firstTable) {
    if (
      question.includes("how") ||
      question.includes("guide") ||
      question.includes("what") ||
      question.includes("help") ||
      question.includes("explain") ||
      question.includes("start") ||
      question.includes("add")
    ) {
      return {
        sql: "",
        explanation:
          "👋 **Welcome to SQL Assistant! Here is how to get started:**\n\n" +
          "1. **Load Data**: Click **📂 CSV** to load a CSV file, or select cells in Excel and click **📋 Range**.\n" +
          "2. **Add New Entries**: After loading a table, ask: *\"Add a new entry with...\"*, or click **➕ Add Entry** in the table panel.\n" +
          "3. **Ask Any Question**: Ask in plain English (e.g., *\"Show top 5 by revenue\"* or *\"Total count grouped by category\"*).\n" +
          "4. **Safety & Recycle Bin**: All modifications are backed up for 7 days in the ♻️ Recycle Bin.\n" +
          "5. **Real AI Key**: Open **⚙️ Settings** to enter a 100% free Google Gemini or Groq API key!",
        assumptions: [
          "ℹ️ [Mock Mode] Running with local simulated responses. Configure a free API key in ⚙️ Settings for live AI generation.",
        ],
        clarification: null,
      };
    }
    return {
      sql: "",
      explanation: "No tables are currently loaded.",
      assumptions: [],
      clarification: "Please click 📂 CSV or 📋 Range to load data first, or ask for guidance on how to get started!",
    };
  }

  const tableName = firstTable.tableName;
  const cols = firstTable.columns;

  let sql = "";
  let explanation = "";

  // ── 1. User asking for guidance or "how to" ─────────────────────────────────
  if (
    question.includes("how") ||
    question.includes("guide") ||
    question.includes("help") ||
    question.includes("explain") ||
    question.includes("step")
  ) {
    if (question.includes("add") || question.includes("insert") || question.includes("entry") || question.includes("row")) {
      explanation =
        `📝 **How to add a new entry to "${tableName}":**\n\n` +
        `• **Via Chat (Plain English)**: Type \`Add a new entry with [values]\` (e.g., \`Add a new entry to ${tableName} with ${cols.slice(0, 3).map((c) => c.name).join(", ")}\`).\n` +
        `• **Via SQL**: Run a direct SQL command like \`INSERT INTO "${tableName}" VALUES (...)\`.\n` +
        `• **Via UI Form**: Click the **➕ Add Entry** button next to "${tableName}" in the Loaded Tables panel above.\n\n` +
        `🛡️ *Before any modification runs, you will be prompted to confirm, and a safety snapshot is preserved in the ♻️ Recycle Bin for 7 days.*`;
    } else {
      explanation =
        `💡 **Guide for "${tableName}":**\n\n` +
        `• **Available Columns**: ${cols.map((c) => `\`${c.name}\` (${c.type})`).join(", ")}\n` +
        `• **Example Queries to Try**:\n` +
        `   - *"How many rows are in ${tableName}?"*\n` +
        `   - *"Show the first 10 rows"*\n` +
        `   - *"Show columns and data types"*\n` +
        `   - *"Add a new entry to ${tableName}"*\n` +
        `• **Writing to Excel**: When running SELECT queries, results automatically export to a fresh Excel sheet with filters and formatting!`;
    }
    return {
      sql: "",
      explanation,
      assumptions: [
        "ℹ️ [Mock Mode] Displaying guidance for the loaded table. Connect an API key in ⚙️ Settings for AI-powered multi-step analysis.",
      ],
      clarification: null,
    };
  }

  // ── 2. User wants to add a new entry / insert row ───────────────────────────
  if (
    question.includes("add") ||
    question.includes("insert") ||
    question.includes("new entry") ||
    question.includes("new row") ||
    question.includes("create entry")
  ) {
    const targetCols = cols.slice(0, Math.min(cols.length, 5));
    const colNames = targetCols.map((c) => `"${c.name}"`).join(", ");
    const colVals = targetCols
      .map((c, i) => {
        if (c.type.includes("INT") || c.type.includes("BIGINT")) return String(100 + i);
        if (c.type.includes("DOUBLE") || c.type.includes("FLOAT") || c.type.includes("DECIMAL") || c.type.includes("NUMERIC")) return String((99.5 + i).toFixed(2));
        if (c.type.includes("BOOL")) return "true";
        if (c.type.includes("DATE")) return "'2024-10-11'";
        return `'Sample ${c.name}'`;
      })
      .join(", ");

    sql = `INSERT INTO "${tableName}" (${colNames}) VALUES (${colVals})`;
    explanation = `Inserts a new entry into the "${tableName}" table with sample column values.`;
  }
  // ── 3. Counting rows ────────────────────────────────────────────────────────
  else if (question.includes("count") || question.includes("how many")) {
    sql = `SELECT COUNT(*) AS row_count FROM "${tableName}"`;
    explanation = `Returns the total number of rows in the "${tableName}" table.`;
  }
  // ── 4. Top / grouping ───────────────────────────────────────────────────────
  else if (question.includes("top") || question.includes("most") || question.includes("highest")) {
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
  }
  // ── 5. Schema / columns ─────────────────────────────────────────────────────
  else if (
    question.includes("column") ||
    question.includes("schema") ||
    question.includes("field")
  ) {
    sql = `DESCRIBE "${tableName}"`;
    explanation = `Shows all column names and data types in the "${tableName}" table.`;
  }
  // ── 6. Default preview ──────────────────────────────────────────────────────
  else {
    sql = `SELECT * FROM "${tableName}" LIMIT 100`;
    explanation = `Returns the first 100 rows from the "${tableName}" table.`;
  }

  return {
    sql,
    explanation,
    assumptions: [
      `ℹ️ [Mock Mode] No API Key configured for ${request.aiProvider || "AI"}.`,
      `To generate custom SQL from plain English, open ⚙️ Settings and enter an API Key.`,
      `Tip: Google Gemini and Groq provide 100% FREE API keys with no credit card required!`,
      `You can also run custom SQL queries directly anytime by typing "SELECT ...", "INSERT ...", etc.`,
    ],
    clarification: null,
  };
}
