/**
 * data.test.ts — Unit tests for data loading, table naming, and schema helpers
 *
 * Tests Phase 2 & Phase 8 logic:
 *   - Table name sanitisation (accents, spaces, digits, file extensions)
 *   - Schema prompting
 *   - Column masking (Phase 8 privacy)
 */

import { describe, it, expect } from "vitest";
import { sanitiseTableName } from "../src/data/csvLoader";
import {
  filterMaskedColumns,
  schemaToPromptString,
  schemasToPromptString,
  type TableSchema,
} from "../src/data/schema";

describe("sanitiseTableName", () => {
  it("strips extension and replaces spaces with underscores", () => {
    expect(sanitiseTableName("monthly sales 2024.csv")).toBe("monthly_sales_2024");
  });

  it("handles special characters and parentheses", () => {
    expect(sanitiseTableName("orders (US & EU) - final.csv")).toBe("orders_us_eu_final");
  });

  it("prepends an underscore if starts with a number", () => {
    expect(sanitiseTableName("2024_forecast.csv")).toBe("_2024_forecast");
  });

  it("lowercases names", () => {
    expect(sanitiseTableName("FINANCIAL_REPORT.CSV")).toBe("financial_report");
  });

  it("collapses multiple underscores", () => {
    expect(sanitiseTableName("my___messy___file.tsv")).toBe("my_messy_file");
  });
});

describe("filterMaskedColumns (Phase 8 privacy)", () => {
  const sampleSchema: TableSchema = {
    tableName: "users",
    columns: [
      { name: "id", type: "INTEGER", nullable: false },
      { name: "name", type: "VARCHAR", nullable: true },
      { name: "ssn", type: "VARCHAR", nullable: true },
      { name: "credit_card", type: "VARCHAR", nullable: true },
      { name: "salary", type: "DOUBLE", nullable: true },
    ],
  };

  it("returns the original schema when masked columns list is empty", () => {
    const filtered = filterMaskedColumns(sampleSchema, []);
    expect(filtered.columns.length).toBe(5);
  });

  it("removes specified masked columns case-insensitively", () => {
    const filtered = filterMaskedColumns(sampleSchema, ["SSN", "credit_card"]);
    expect(filtered.columns.map((c) => c.name)).toEqual(["id", "name", "salary"]);
  });

  it("handles whitespace in masked column names", () => {
    const filtered = filterMaskedColumns(sampleSchema, ["  salary  "]);
    expect(filtered.columns.some((c) => c.name === "salary")).toBe(false);
  });
});

describe("schemaToPromptString & schemasToPromptString", () => {
  const sampleSchema: TableSchema = {
    tableName: "orders",
    columns: [
      { name: "order_id", type: "INTEGER", nullable: false },
      { name: "amount", type: "DOUBLE", nullable: true },
    ],
  };

  it("formats schema into SQL table syntax", () => {
    const str = schemaToPromptString(sampleSchema);
    expect(str).toContain("TABLE orders (");
    expect(str).toContain("order_id INTEGER");
    expect(str).toContain("amount DOUBLE");
  });

  it("formats multiple schemas joined by double newline", () => {
    const str = schemasToPromptString([sampleSchema, sampleSchema]);
    expect(str).toContain("TABLE orders");
    expect(str.split("TABLE orders").length).toBe(3);
  });
});
