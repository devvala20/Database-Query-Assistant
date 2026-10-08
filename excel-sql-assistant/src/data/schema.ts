/**
 * schema.ts — Phase 2 & Phase 8: Schema Extractor, Masking, and Sample Values
 *
 * Extracts column names and types from a DuckDB table/view via DESCRIBE.
 * Phase 8 enhancements:
 *   - Column masking: strips sensitive columns from prompt schema
 *   - Sample values collector: opt-in retrieval of 3-5 distinct safe sample values
 */

import { getConnection } from "../sql/engine";

export interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
}

export interface TableSchema {
  tableName: string;
  columns: ColumnDef[];
}

/**
 * Extract the schema for a given DuckDB table/view.
 * Uses `DESCRIBE <table>` which is supported in DuckDB.
 */
export async function extractSchema(tableName: string): Promise<TableSchema> {
  const conn = getConnection();
  if (!conn) throw new Error("DuckDB engine not initialised.");

  // DESCRIBE returns: column_name, column_type, null, key, default, extra
  const result = await conn.query(`DESCRIBE "${tableName}"`);
  const rows = result.toArray();

  const columns: ColumnDef[] = rows.map((row) => ({
    name: String(row.column_name ?? row["Field"] ?? ""),
    type: String(row.column_type ?? row["Type"] ?? ""),
    nullable: String(row["Null"] ?? "YES").toUpperCase() !== "NO",
  }));

  return { tableName, columns };
}

/**
 * Phase 8: Filter masked columns from a schema so sensitive column names
 * are never included in prompts sent to the AI.
 */
export function filterMaskedColumns(
  schema: TableSchema,
  maskedColumns: string[]
): TableSchema {
  if (!maskedColumns || maskedColumns.length === 0) return schema;
  const maskedSet = new Set(
    maskedColumns.map((c) => c.toLowerCase().trim()).filter(Boolean)
  );
  return {
    ...schema,
    columns: schema.columns.filter(
      (col) => !maskedSet.has(col.name.toLowerCase().trim())
    ),
  };
}

/**
 * Phase 8: Collect 3-5 representative sample values per column from DuckDB.
 * Only runs if the user has explicitly enabled "Send sample values to AI".
 * Never samples masked columns. Values are truncated to 50 characters max.
 */
export async function collectSampleValues(
  tableName: string,
  schema: TableSchema,
  sampleLimit: number = 3
): Promise<Record<string, string[]>> {
  const conn = getConnection();
  if (!conn) return {};

  const result: Record<string, string[]> = {};
  if (schema.columns.length === 0) return result;

  try {
    const colList = schema.columns.map((c) => `"${c.name}"`).join(", ");
    const queryResult = await conn.query(
      `SELECT ${colList} FROM "${tableName}" LIMIT ${Math.max(1, sampleLimit * 2)}`
    );
    const rows = queryResult.toArray();

    for (const col of schema.columns) {
      const distinctVals: string[] = [];
      for (const row of rows) {
        const plain = typeof row.toJSON === "function" ? row.toJSON() : (row as Record<string, unknown>);
        const val = plain[col.name];
        if (val !== null && val !== undefined && String(val).trim() !== "") {
          const str = String(val).slice(0, 50).replace(/\r?\n/g, " ");
          if (!distinctVals.includes(str)) {
            distinctVals.push(str);
            if (distinctVals.length >= sampleLimit) break;
          }
        }
      }
      if (distinctVals.length > 0) {
        result[`${tableName}.${col.name}`] = distinctVals;
      }
    }
  } catch (err) {
    console.warn(`[schema] Could not collect sample values for ${tableName}:`, err);
  }

  return result;
}

/**
 * Format a TableSchema into the compact string that gets included in the AI prompt.
 *
 * Example output:
 *   TABLE sales_2024 (
 *     customer_id INTEGER,
 *     customer_name VARCHAR,
 *     revenue DOUBLE,
 *     order_date DATE
 *   )
 */
export function schemaToPromptString(schema: TableSchema): string {
  const cols = schema.columns
    .map((c) => `  ${c.name} ${c.type}`)
    .join(",\n");
  return `TABLE ${schema.tableName} (\n${cols}\n)`;
}

/**
 * Format multiple schemas into a single prompt string.
 */
export function schemasToPromptString(schemas: TableSchema[]): string {
  return schemas.map(schemaToPromptString).join("\n\n");
}
