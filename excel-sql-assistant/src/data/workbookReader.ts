/**
 * workbookReader.ts — Phase 2: Workbook Reader
 *
 * Reads a selected range or Excel Table from the active workbook via Office.js,
 * then registers it as a DuckDB table so it can be queried alongside CSVs.
 *
 * IMPORTANT: All Office.js operations MUST run inside Excel.run() to get a
 * valid RequestContext. Never use Office.context.workbook outside Excel.run().
 */

import { getConnection } from "../sql/engine";
import type { TableSchema } from "./schema";
import { sanitiseTableName } from "./csvLoader";

export interface WorkbookTableInfo {
  tableName: string;
  /** The original Excel table name or sheet/range address */
  sourceLabel: string;
  rowCount: number;
  schema: TableSchema;
}

/**
 * Read the currently selected range from the active workbook and load it
 * into DuckDB as an in-memory table.
 *
 * Assumes the first row is a header row.
 */
export async function loadSelectedRange(
  label?: string
): Promise<WorkbookTableInfo> {
  const conn = getConnection();
  if (!conn) throw new Error("DuckDB engine not initialised.");

  if (typeof Excel === "undefined") {
    throw new Error(
      "Excel.js API is only available inside Microsoft Excel. In a standalone browser, please click '📂 Load CSV' to load CSV data files."
    );
  }

  return Excel.run(async (ctx: any) => {
    const range = ctx.workbook.getSelectedRange();
    range.load("values,address");
    await ctx.sync();

    const values: (string | number | boolean | null)[][] =
      range.values as (string | number | boolean | null)[][];

    if (!values || values.length < 2) {
      throw new Error(
        "Selected range has no data rows. Please select a range that includes a header row and at least one data row."
      );
    }

    const headers = values[0].map((h, i) => String(h ?? `col_${i + 1}`));
    const dataRows = values.slice(1);

    const sourceLabel = label ?? range.address;
    const tableName = sanitiseTableName(sourceLabel.replace(/[!:]/g, "_"));

    const schema = await _registerAsTable(conn, tableName, headers, dataRows);

    return { tableName, sourceLabel, rowCount: dataRows.length, schema };
  });
}

/**
 * Load a named Excel Table (ListObject) from the workbook into DuckDB.
 */
export async function loadExcelTable(
  excelTableName: string
): Promise<WorkbookTableInfo> {
  const conn = getConnection();
  if (!conn) throw new Error("DuckDB engine not initialised.");

  if (typeof Excel === "undefined") {
    throw new Error(
      "Excel.js API is only available inside Microsoft Excel. In a standalone browser, please click '📂 Load CSV' to load CSV data files."
    );
  }

  return Excel.run(async (ctx: any) => {
    const table = ctx.workbook.tables.getItem(excelTableName);
    const bodyRange = table.getRange();
    bodyRange.load("values");
    await ctx.sync();

    const values: (string | number | boolean | null)[][] =
      bodyRange.values as (string | number | boolean | null)[][];

    if (!values || values.length < 2) {
      throw new Error("Excel table is empty.");
    }

    const headers = values[0].map((h, i) => String(h ?? `col_${i + 1}`));
    const dataRows = values.slice(1);
    const duckDbName = sanitiseTableName(excelTableName);

    const schema = await _registerAsTable(conn, duckDbName, headers, dataRows);

    return {
      tableName: duckDbName,
      sourceLabel: excelTableName,
      rowCount: dataRows.length,
      schema,
    };
  });
}

/**
 * Internal helper: create a DuckDB table from a 2D array of values.
 * Uses INSERT INTO VALUES for correctness; for very large ranges this
 * could be optimised with registerFileBuffer + CSV parsing.
 */
async function _registerAsTable(
  conn: import("@duckdb/duckdb-wasm").AsyncDuckDBConnection,
  tableName: string,
  headers: string[],
  dataRows: (string | number | boolean | null)[][]
): Promise<TableSchema> {
  // Drop if exists and re-create
  await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);

  // Create table with all VARCHAR columns
  const colDefs = headers.map((h) => `"${h}" VARCHAR`).join(", ");
  await conn.query(`CREATE TABLE "${tableName}" (${colDefs})`);

  // Batch insert (chunks of 1000 rows to avoid huge SQL strings)
  const CHUNK = 1000;
  for (let i = 0; i < dataRows.length; i += CHUNK) {
    const chunk = dataRows.slice(i, i + CHUNK);
    const valuesClause = chunk
      .map((row) => {
        const cells = row.map((cell) => {
          if (cell === null || cell === undefined || cell === "") return "NULL";
          return `'${String(cell).replace(/'/g, "''")}'`; // escape single quotes
        });
        return `(${cells.join(", ")})`;
      })
      .join(",\n");

    await conn.query(`INSERT INTO "${tableName}" VALUES ${valuesClause}`);
  }

  // Return schema
  const { extractSchema } = await import("./schema");
  return extractSchema(tableName);
}
