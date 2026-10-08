/**
 * csvLoader.ts — Phase 2: Data Layer
 *
 * Registers a user-picked CSV file with DuckDB-WASM and exposes it as a table.
 * Data never leaves the browser — DuckDB reads the File object in WASM memory.
 */

import { getConnection, getDatabase } from "../sql/engine";
import { extractSchema, type TableSchema } from "../data/schema";

export interface LoadedTable {
  /** Sanitised name used as the DuckDB table name */
  tableName: string;
  /** Original file name */
  fileName: string;
  /** Number of rows */
  rowCount: number;
  /** Schema extracted after loading */
  schema: TableSchema;
}

/**
 * Sanitise a filename into a valid DuckDB table name.
 * e.g. "sales 2024 (v2).csv" → "sales_2024_v2"
 */
export function sanitiseTableName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "") // strip extension
    .replace(/[^a-zA-Z0-9_]/g, "_") // replace non-alphanum with _
    .replace(/^(\d)/, "_$1") // identifiers can't start with a digit
    .replace(/_+/g, "_") // collapse multiple underscores
    .toLowerCase()
    .slice(0, 64); // DuckDB identifier max length
}

/**
 * Load a CSV File into DuckDB and return a LoadedTable descriptor.
 *
 * Uses DuckDB's `read_csv_auto` which handles:
 *   - comma, semicolon, tab delimiters
 *   - header detection
 *   - type inference
 *   - BOM (byte-order mark)
 *   - quoted newlines
 */
export async function loadCsvFile(file: File): Promise<LoadedTable> {
  const db = getDatabase();
  const conn = getConnection();
  if (!db || !conn) throw new Error("DuckDB engine not initialised.");

  const tableName = sanitiseTableName(file.name);

  // Read the file into an ArrayBuffer and register it with DuckDB
  const buffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(buffer);

  // Register the raw bytes under the original filename so DuckDB can reference it
  await db.registerFileBuffer(file.name, uint8);

  // Create a VIEW (not a table) so we don't duplicate large files in WASM memory.
  // read_csv_auto handles delimiters, BOM, types, quoted fields automatically.
  await conn.query(`
    CREATE OR REPLACE VIEW "${tableName}" AS
    SELECT * FROM read_csv_auto('${file.name}', header=true, auto_detect=true)
  `);

  // Get row count
  const countResult = await conn.query(
    `SELECT COUNT(*) AS n FROM "${tableName}"`
  );
  const rowCount = Number(countResult.toArray()[0].n);

  // Extract schema
  const schema = await extractSchema(tableName);

  return { tableName, fileName: file.name, rowCount, schema };
}

/**
 * Remove a previously loaded table/view from DuckDB.
 */
export async function dropTable(tableName: string): Promise<void> {
  const conn = getConnection();
  if (!conn) throw new Error("DuckDB engine not initialised.");
  await conn.query(`DROP VIEW IF EXISTS "${tableName}"`);
}
