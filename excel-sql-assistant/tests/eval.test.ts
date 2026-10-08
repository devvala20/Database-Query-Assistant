/**
 * eval.test.ts — Phase 9: Evaluation Suite Test Runner
 *
 * Verifies that all 40 benchmark questions produce safe SQL that passes
 * the SELECT-only guard, and categorizes evaluation coverage.
 */

import { describe, it, expect } from "vitest";
import { EVALUATION_SET } from "../eval/evalSet";
import { guardQuery } from "../src/sql/guard";

describe("Phase 9 Text-to-SQL Evaluation Benchmark Set", () => {
  it("contains at least 40 evaluation test cases", () => {
    expect(EVALUATION_SET.length).toBeGreaterThanOrEqual(40);
  });

  it("covers multiple data categories (aggregations, filters, groupings, windows, math)", () => {
    const categories = new Set(EVALUATION_SET.map((t) => t.category));
    expect(categories.has("aggregation")).toBe(true);
    expect(categories.has("filter")).toBe(true);
    expect(categories.has("grouping")).toBe(true);
    expect(categories.has("sorting")).toBe(true);
    expect(categories.has("window")).toBe(true);
    expect(categories.has("math")).toBe(true);
  });

  it("all expected SQL queries in the evaluation set pass the SELECT-only guard", () => {
    let passed = 0;
    for (const testCase of EVALUATION_SET) {
      const guard = guardQuery(testCase.expectedSql);
      expect(
        guard.safe,
        `Expected SQL for test case #${testCase.id} ("${testCase.question}") should be safe but failed with: ${guard.reason}`
      ).toBe(true);
      if (guard.safe) passed++;
    }
    const accuracy = (passed / EVALUATION_SET.length) * 100;
    expect(accuracy).toBe(100);
  });

  it("all test cases have non-empty questions and descriptions", () => {
    for (const testCase of EVALUATION_SET) {
      expect(testCase.question.trim().length).toBeGreaterThan(0);
      expect(testCase.description.trim().length).toBeGreaterThan(0);
      expect(testCase.expectedSql.trim().length).toBeGreaterThan(0);
    }
  });
});
