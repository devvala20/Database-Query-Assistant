/**
 * resultsWriter.ts — Phase 7: Full Excel results integration
 *
 * Features over Phase 0 spike:
 *   ✅ Chunked writes (10k rows/batch) — Office.js has a payload limit per call
 *   ✅ Type-aware formatting (dates → Excel date serial, numbers, currency, booleans)
 *   ✅ Write modes: "new" sheet | "replace" last result | "append" | "clipboard" | "csv"
 *   ✅ SQL traceability: write generated SQL into a cell comment on the result sheet
 *   ✅ Progress callback for large exports
 *   ✅ Excel Table (ListObject) with auto-filter
 *   ✅ Auto-fit columns, frozen header row, zebra row shading via table style
 */

import type { QueryResult } from "../sql/engine";

// ─── Types ───────────────────────────────────────────────────────────────────

export type WriteMode =
  | "new"       // create a new sheet (default)
  | "replace"   // delete the previous result sheet and create a fresh one
  | "append";   // append rows to an existing sheet (for incremental loads)

export interface WriteOptions {
  mode?: WriteMode;
  /** Prefix for the new sheet name (falls back to truncated question) */
  sheetNamePrefix?: string;
  /** If true, embed the SQL as a cell note on A1 for traceability. Default: true */
  writeSqlNote?: boolean;
  /** The SQL to embed in the cell note */
  sql?: string;
  /** Table style to apply. Default: "TableStyleMedium2" */
  tableStyle?: string;
  /** Rows per Office.js batch. Default: 10_000 */
  chunkSize?: number;
  /** Called with (writtenRows, totalRows) during chunked write */
  onProgress?: (written: number, total: number) => void;
}

export interface WriteResult {
  sheetName: string;
  rowsWritten: number;
  chunksUsed: number;
  elapsedMs: number;
}

// Detect DuckDB type string → Excel formatting category
type ColType = "date" | "datetime" | "number" | "currency" | "boolean" | "text";

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Write a QueryResult to Excel with full Phase 7 features.
 */
export async function writeResultsToSheet(
  result: QueryResult,
  question: string,
  options: WriteOptions = {}
): Promise<WriteResult> {
  const {
    mode = "new",
    sheetNamePrefix,
    writeSqlNote = true,
    sql = "",
    tableStyle = "TableStyleMedium2",
    chunkSize = 10_000,
    onProgress,
  } = options;

  const t0 = performance.now();
  const baseSheetName = _makeSheetName(sheetNamePrefix ?? question);

  // Detect column types for formatting
  const colTypes = _detectColumnTypes(result.columns, result.rows);

  // Convert rows to Excel-safe values (type coercion)
  const converted = _convertRows(result.rows, colTypes);

  // When testing in a regular browser tab outside of Microsoft Excel,
  // Excel.run is not available. Return gracefully with preview data.
  if (typeof Excel === "undefined") {
    console.info(
      "[resultsWriter] Running in standalone browser mode. Excel sheet creation simulated."
    );
    return {
      sheetName: baseSheetName,
      rowsWritten: converted.length,
      chunksUsed: 1,
      elapsedMs: Math.round(performance.now() - t0),
    };
  }

  return Excel.run(async (ctx: any) => {
    // ── 1. Resolve the target sheet ───────────────────────────────────────────
    const sheets = ctx.workbook.worksheets;
    sheets.load("items/name");
    await ctx.sync();

    const existingNames: string[] = sheets.items.map((s: any) => s.name);
    let sheetName: string;
    let sheet: any;

    if (mode === "replace") {
      // Find and delete the previous result sheet for this question
      const prevName = existingNames.find((n: string) => n.startsWith(baseSheetName));
      if (prevName) {
        sheets.getItem(prevName).delete();
        await ctx.sync();
      }
      sheetName = baseSheetName;
      sheet = sheets.add(sheetName);
    } else if (mode === "append") {
      const existing = existingNames.find((n: string) => n.startsWith(baseSheetName));
      if (existing) {
        sheetName = existing;
        sheet = sheets.getItem(sheetName);
      } else {
        sheetName = _deduplicateName(baseSheetName, existingNames);
        sheet = sheets.add(sheetName);
      }
    } else {
      // "new" — always create a fresh sheet
      sheetName = _deduplicateName(baseSheetName, existingNames);
      sheet = sheets.add(sheetName);
    }

    sheet.activate();

    // ── 2. Write header row ───────────────────────────────────────────────────
    const numCols = result.columns.length;
    if (numCols === 0) {
      await ctx.sync();
      return { sheetName, rowsWritten: 0, chunksUsed: 0, elapsedMs: Math.round(performance.now() - t0) };
    }

    const headerRange = sheet.getRange(`A1:${_colLetter(numCols)}1`);
    headerRange.values = [result.columns as (string | number | boolean | null)[]];
    headerRange.format.font.bold = true;
    headerRange.format.fill.color = "#1e1b4b"; // deep indigo header
    headerRange.format.font.color = "#ffffff";
    await ctx.sync();

    // ── 3. Chunked data write ────────────────────────────────────────────────
    const totalRows = converted.length;
    let chunksUsed = 0;
    let writtenRows = 0;

    if (totalRows > 0) {
      for (let i = 0; i < totalRows; i += chunkSize) {
        const chunk = converted.slice(i, i + chunkSize);
        const startRow = i + 2; // 1-indexed; row 1 is headers
        const endRow = startRow + chunk.length - 1;
        const chunkRange = sheet.getRange(
          `A${startRow}:${_colLetter(numCols)}${endRow}`
        );
        chunkRange.values = chunk as any;
        await ctx.sync();

        writtenRows += chunk.length;
        chunksUsed++;
        onProgress?.(writtenRows, totalRows);
      }
    }

    // ── 4. Apply type-aware number formats ────────────────────────────────────
    if (totalRows > 0) {
      for (let c = 0; c < numCols; c++) {
        const fmt = _excelNumberFormat(colTypes[c]);
        if (fmt) {
          const dataRange = sheet.getRange(
            `${_colLetter(c + 1)}2:${_colLetter(c + 1)}${totalRows + 1}`
          );
          dataRange.numberFormat = [[fmt]];
        }
      }
    }

    // ── 5. Create Excel Table ────────────────────────────────────────────────
    const tableEndRow = totalRows > 0 ? totalRows + 1 : 1;
    const tableAddress = `A1:${_colLetter(numCols)}${tableEndRow}`;

    if (totalRows > 0) {
      const excelTable = sheet.tables.add(tableAddress, true);
      excelTable.style = tableStyle;
      excelTable.showBandedRows = true;
    }

    // ── 6. Auto-fit columns, freeze header ───────────────────────────────────
    sheet.getUsedRange().getEntireColumn().format.autofitColumns();
    sheet.freezePanes.freezeRows(1);

    // ── 7. SQL traceability note on A1 ────────────────────────────────────────
    if (writeSqlNote && sql) {
      // Write SQL as a cell comment (note) on A1 for traceability
      const noteRange = sheet.getRange("A1");
      noteRange.load("address");
      await ctx.sync();
      // Note: Excel.js comments API requires ExcelApiRequirement 1.10+
      // We add the comment; Office will display it as a hover note.
      sheet.comments.add("A1", sql);
    }

    await ctx.sync();

    const elapsedMs = Math.round(performance.now() - t0);
    return { sheetName, rowsWritten: writtenRows, chunksUsed, elapsedMs };
  });
}

// ─── Copy to clipboard ────────────────────────────────────────────────────────

/**
 * Copy the result rows as TSV text to the clipboard.
 * Works in all modern browsers via the Clipboard API.
 */
export function copyResultToClipboard(result: QueryResult): Promise<void> {
  const lines: string[] = [
    result.columns.join("\t"),
    ...result.rows.map((row) =>
      (row as unknown[]).map((cell) => _tsvEscape(cell)).join("\t")
    ),
  ];
  const tsv = lines.join("\n");
  return navigator.clipboard.writeText(tsv);
}

// ─── Download as CSV ──────────────────────────────────────────────────────────

/**
 * Trigger a browser download of the result as a .csv file.
 */
export function downloadResultAsCsv(result: QueryResult, filename?: string): void {
  const csvLines: string[] = [
    result.columns.map(_csvEscape).join(","),
    ...result.rows.map((row) =>
      (row as unknown[]).map((cell) => _csvEscape(cell)).join(",")
    ),
  ];
  const csv = "\uFEFF" + csvLines.join("\r\n"); // BOM for Excel UTF-8 detection
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? "query-results.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Type detection ───────────────────────────────────────────────────────────

/**
 * Infer the display type of each column by inspecting column names and
 * sampling the first non-null value. DuckDB column names often contain
 * type hints like _date, _at, _amount, _price, etc.
 */
function _detectColumnTypes(
  columns: string[],
  rows: unknown[][]
): ColType[] {
  return columns.map((name, colIdx) => {
    const nameLower = name.toLowerCase();

    // Date/datetime detection by name
    if (
      /_at$|_date$|_time$|^date$|^timestamp$|^created$|^updated$|^modified$/i.test(nameLower)
    ) {
      return "datetime";
    }

    // Currency detection by name
    if (/_price$|_amount$|_cost$|_revenue$|_salary$|_fee$|^price$|^amount$|^cost$/i.test(nameLower)) {
      return "currency";
    }

    // Sample first non-null value for type inference
    const sample = _firstNonNull(rows, colIdx);
    if (sample === null) return "text";

    if (typeof sample === "boolean") return "boolean";
    if (typeof sample === "number") {
      // Distinguish integer vs decimal
      return Number.isInteger(sample) ? "number" : "number";
    }
    if (typeof sample === "string") {
      // ISO date strings
      if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(sample)) {
        return sample.includes("T") ? "datetime" : "date";
      }
    }

    return "text";
  });
}

function _firstNonNull(rows: unknown[][], colIdx: number): unknown {
  for (const row of rows) {
    const val = (row as unknown[])[colIdx];
    if (val !== null && val !== undefined && val !== "") return val;
  }
  return null;
}

/**
 * Excel number format strings for each ColType.
 * Returns undefined for "text" (no custom format needed).
 */
function _excelNumberFormat(type: ColType): string | undefined {
  switch (type) {
    case "date":     return "yyyy-mm-dd";
    case "datetime": return "yyyy-mm-dd hh:mm";
    case "currency": return "#,##0.00";
    case "number":   return "#,##0.##";
    case "boolean":  return undefined; // booleans render as TRUE/FALSE naturally
    default:         return undefined;
  }
}

// ─── Row conversion ───────────────────────────────────────────────────────────

/**
 * Convert DuckDB row values to Excel-safe types.
 * DuckDB may return BigInt, Date objects, or strings for dates.
 */
function _convertRows(
  rows: unknown[][],
  colTypes: ColType[]
): (string | number | boolean | null)[][] {
  return rows.map((row) =>
    (row as unknown[]).map((cell, c) => {
      if (cell === null || cell === undefined) return null;
      if (typeof cell === "bigint") return Number(cell);
      if (typeof cell === "boolean") return cell;
      if (typeof cell === "number") return cell;

      const type = colTypes[c];
      const str = String(cell);

      // Convert ISO date strings to Excel date serial numbers
      if ((type === "date" || type === "datetime") && str.match(/^\d{4}-\d{2}-\d{2}/)) {
        const ms = Date.parse(str);
        if (!isNaN(ms)) {
          // Excel serial: days since 1900-01-01 (with the 1900 leap year bug offset)
          return _dateToExcelSerial(new Date(ms));
        }
      }

      return str;
    })
  );
}

/**
 * Convert a JS Date to an Excel date serial number.
 * Excel counts days from 1900-01-00 (day 1 = 1900-01-01),
 * and incorrectly treats 1900 as a leap year (Lotus 123 compat).
 */
function _dateToExcelSerial(date: Date): number {
  const EPOCH = new Date(Date.UTC(1899, 11, 31)).getTime();
  const dayMs = 86400_000;
  const days = Math.round((date.getTime() - EPOCH) / dayMs);
  // Add 1 for the Lotus 1900 leap-year bug
  return days > 59 ? days + 1 : days;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _makeSheetName(text: string): string {
  return text
    .replace(/[*?:/\\[\]]/g, "")
    .trim()
    .slice(0, 28);
}

function _deduplicateName(name: string, existing: string[]): string {
  if (!existing.includes(name)) return name;
  let i = 2;
  while (existing.includes(`${name} (${i})`)) i++;
  return `${name} (${i})`;
}

function _colLetter(n: number): string {
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function _tsvEscape(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).replace(/\t/g, " ").replace(/\n/g, " ");
}

function _csvEscape(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  const s = String(cell);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
