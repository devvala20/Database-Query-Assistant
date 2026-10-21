/**
 * prompt.test.ts — Unit tests for AI prompt builder and repair mode
 */

import { describe, it, expect } from "vitest";
import {
  SYSTEM_PROMPT,
  buildRepairSystemPrompt,
  buildProxyRequest,
  type PromptContext,
} from "../src/ai/prompt";
import type { TableSchema } from "../src/data/schema";

describe("Prompt Builder", () => {
  const schema: TableSchema = {
    tableName: "sales",
    columns: [
      { name: "id", type: "INTEGER", nullable: false },
      { name: "region", type: "VARCHAR", nullable: true },
      { name: "revenue", type: "DOUBLE", nullable: true },
    ],
  };

  it("SYSTEM_PROMPT instructs the model to return JSON only", () => {
    expect(SYSTEM_PROMPT).toContain("Output ONLY valid JSON");
    expect(SYSTEM_PROMPT).toContain('"sql": string');
    expect(SYSTEM_PROMPT).toContain('"explanation": string');
    expect(SYSTEM_PROMPT).toContain('"assumptions": string[]');
    expect(SYSTEM_PROMPT).toContain('"clarification": string | null');
  });

  it("buildRepairSystemPrompt includes attempt number and repair instructions", () => {
    const prompt = buildRepairSystemPrompt(2);
    expect(prompt).toContain("REPAIR MODE (attempt 2)");
    expect(prompt).toContain("The previous SQL query failed with an error");
  });

  it("buildProxyRequest formats request context into proxy payload", () => {
    const ctx: PromptContext = {
      question: "Top 5 regions by revenue",
      schemas: [schema],
      history: [
        { role: "user", content: "Show me all data" },
        { role: "assistant", content: "Returned all rows", sql: "SELECT * FROM sales" },
      ],
      sampleValues: { "sales.region": ["North", "South"] },
    };

    const req = buildProxyRequest(ctx);
    expect(req.question).toBe("Top 5 regions by revenue");
    expect(req.schema).toContain("TABLE sales");
    expect(req.history.length).toBe(2);
    expect(req.history[1].content).toContain("SELECT * FROM sales");
    expect(req.options.sampleValues).toEqual({ "sales.region": ["North", "South"] });
  });

  it("buildProxyRequest includes failed SQL and error message during repair", () => {
    const ctx: PromptContext = {
      question: "Show total revenue",
      schemas: [schema],
      history: [],
      repair: {
        failedSql: "SELECT rev FROM sales",
        errorMessage: 'Binder Error: Column "rev" not found',
        attemptNumber: 1,
      },
    };

    const req = buildProxyRequest(ctx);
    expect(req.systemPrompt).toContain("REPAIR MODE (attempt 1)");
    expect(req.question).toContain("SELECT rev FROM sales");
    expect(req.question).toContain('Binder Error: Column "rev" not found');
    expect(req.repair?.failedSql).toBe("SELECT rev FROM sales");
  });

  it("SYSTEM_PROMPT includes instructions for adding entries and user guidance", () => {
    expect(SYSTEM_PROMPT).toContain("INSERT INTO");
    expect(SYSTEM_PROMPT).toContain("Guidance & Answering Questions");
  });

  it("buildProxyRequest provides fallback when no schemas are loaded yet", () => {
    const ctx: PromptContext = {
      question: "How do I use this extension?",
      schemas: [],
      history: [],
    };
    const req = buildProxyRequest(ctx);
    expect(req.schema).toContain("No tables are currently loaded");
  });
});

