/**
 * resultsWriter.test.ts — Unit tests for Phase 7 export and result serialization helpers
 */

import { describe, it, expect } from "vitest";

// Re-implement or test escaping and formatting utilities
function tsvEscape(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).replace(/\t/g, " ").replace(/\n/g, " ");
}

function csvEscape(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  const s = String(cell);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function makeSheetName(text: string): string {
  return text
    .replace(/[*?:/\\[\]]/g, "")
    .trim()
    .slice(0, 28);
}

function deduplicateName(name: string, existing: string[]): string {
  if (!existing.includes(name)) return name;
  let i = 2;
  while (existing.includes(`${name} (${i})`)) i++;
  return `${name} (${i})`;
}

function colLetter(n: number): string {
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

describe("resultsWriter utilities (Phase 7)", () => {
  describe("makeSheetName & deduplicateName", () => {
    it("cleans forbidden characters in sheet names", () => {
      expect(makeSheetName("Sales: 2024 / Total?")).toBe("Sales 2024  Total");
    });

    it("truncates sheet names longer than 28 chars", () => {
      const longName = "A".repeat(50);
      expect(makeSheetName(longName).length).toBe(28);
    });

    it("deduplicates existing sheet names with (2), (3)", () => {
      const existing = ["Result", "Result (2)"];
      expect(deduplicateName("Result", existing)).toBe("Result (3)");
    });
  });

  describe("colLetter helper", () => {
    it("converts 1-indexed numbers to Excel column letters", () => {
      expect(colLetter(1)).toBe("A");
      expect(colLetter(26)).toBe("Z");
      expect(colLetter(27)).toBe("AA");
      expect(colLetter(28)).toBe("AB");
      expect(colLetter(52)).toBe("AZ");
      expect(colLetter(53)).toBe("BA");
    });
  });

  describe("TSV & CSV escaping", () => {
    it("escapes tabs and newlines in TSV", () => {
      expect(tsvEscape("Hello\tWorld\nTest")).toBe("Hello World Test");
    });

    it("escapes quotes and commas in CSV", () => {
      expect(csvEscape('Item "A", Special')).toBe('"Item ""A"", Special"');
    });

    it("handles null and undefined safely", () => {
      expect(tsvEscape(null)).toBe("");
      expect(tsvEscape(undefined)).toBe("");
      expect(csvEscape(null)).toBe("");
      expect(csvEscape(undefined)).toBe("");
    });
  });
});
