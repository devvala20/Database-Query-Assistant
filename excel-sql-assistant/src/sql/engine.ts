/**
 * engine.ts — Phase 0 feasibility spike + Phase 2 data layer
 *
 * Initialises DuckDB-WASM once and exposes runQuery().
 * This is the critical proof-of-concept: if DuckDB-WASM loads inside
 * Excel's embedded browser, the whole approach is validated.
 */

import * as duckdb from "@duckdb/duckdb-wasm";

// DuckDB-WASM bundles ship two variants: the default uses eh (exception handling)
// and the mvp bundle is the safest cross-browser fallback.
const DUCKDB_BUNDLES = duckdb.getJsDelivrBundles();

let _db: duckdb.AsyncDuckDB | null = null;
let _conn: duckdb.AsyncDuckDBConnection | null = null;
let _initPromise: Promise<void> | null = null;

/** Result shape returned by runQuery */
export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  elapsedMs: number;
}

/**
 * Initialise DuckDB-WASM. Idempotent — safe to call multiple times.
 * Resolves once the engine is ready.
 */
export async function initEngine(): Promise<void> {
  if (_db) return; // already done
  if (_initPromise) return _initPromise; // init in progress

  _initPromise = (async () => {
    console.log("[DuckDB] Selecting bundle…");
    const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
    console.log("[DuckDB] Bundle selected:", bundle.mainModule);

    // The logger forwards DuckDB's internal messages to the console.
    const logger = new duckdb.ConsoleLogger();

    // Worker is loaded from a blob URL so it works in sandboxed webviews.
    const worker = await duckdb.createWorker(bundle.mainWorker!);

    _db = new duckdb.AsyncDuckDB(logger, worker);
    await _db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    _conn = await _db.connect();

    // Prove the engine works — this query must succeed for Phase 0 to pass.
    const version = await _conn.query("SELECT version() AS v");
    console.log(
      "[DuckDB] ✅ Engine ready. Version:",
      version.toArray()[0].v
    );
  })();

  return _initPromise;
}

/**
 * Run a SQL query and return typed results.
 * Throws if the engine is not initialised — call initEngine() first.
 */
export async function runQuery(sql: string): Promise<QueryResult> {
  if (!_conn) throw new Error("DuckDB not initialised. Call initEngine() first.");

  const start = performance.now();
  const arrowResult = await _conn.query(sql);
  const elapsedMs = Math.round(performance.now() - start);

  const schema = arrowResult.schema.fields;
  const columns = schema.map((f) => f.name);
  const rawRows = arrowResult.toArray();

  // Convert Arrow rows to plain JS arrays for easy consumption by React / Office.js
  // .toJSON() converts each Arrow StructRow into a plain object that's safely indexable.
  const rows: unknown[][] = rawRows.map((row) => {
    const plain = row.toJSON() as Record<string, unknown>;
    return columns.map((col) => {
      const val = plain[col];
      // BigInt → Number for JSON-serializability
      if (typeof val === "bigint") return Number(val);
      return val;
    });
  });

  return { columns, rows, rowCount: rows.length, elapsedMs };
}

/**
 * Expose the raw connection for advanced use (e.g., registerFileBuffer).
 * Returns null if the engine is not yet initialised.
 */
export function getConnection(): duckdb.AsyncDuckDBConnection | null {
  return _conn;
}

/**
 * Expose the raw DB instance.
 * Returns null if the engine is not yet initialised.
 */
export function getDatabase(): duckdb.AsyncDuckDB | null {
  return _db;
}
