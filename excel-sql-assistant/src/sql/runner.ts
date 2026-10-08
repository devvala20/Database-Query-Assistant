/**
 * runner.ts — Phase 3: Safe query execution wrapper
 *
 * Wraps engine.runQuery() with:
 *   - SELECT-only guard (mandatory)
 *   - Row limit on preview (default 1,000 rows displayed)
 *   - Query timeout with AbortController-style cancel token
 *   - Structured error output
 */

import { runQuery as _runQuery, type QueryResult } from "./engine";
import { guardQuery } from "./guard";

export interface RunOptions {
  /** Max rows to return in preview. Full result count is still reported. Default: 1000 */
  previewLimit?: number;
  /** Timeout in milliseconds. Default: 30_000 (30s) */
  timeoutMs?: number;
  /** Pass a cancel token to abort in-flight queries */
  cancelToken?: CancelToken;
}

export interface SafeQueryResult extends QueryResult {
  /** True if rows were truncated to previewLimit */
  truncated: boolean;
  /** Full row count before truncation (same as rowCount when not truncated) */
  fullRowCount: number;
}

export class QueryGuardError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "QueryGuardError";
  }
}

export class QueryTimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`Query timed out after ${timeoutMs}ms`);
    this.name = "QueryTimeoutError";
  }
}

export class QueryCancelledError extends Error {
  constructor() {
    super("Query was cancelled by the user.");
    this.name = "QueryCancelledError";
  }
}

// ─── Cancel token ─────────────────────────────────────────────────────────────

export class CancelToken {
  private _cancelled = false;
  private _listeners: Array<() => void> = [];

  get cancelled(): boolean {
    return this._cancelled;
  }

  cancel(): void {
    this._cancelled = true;
    this._listeners.forEach((fn) => fn());
    this._listeners = [];
  }

  onCancel(fn: () => void): void {
    if (this._cancelled) {
      fn();
    } else {
      this._listeners.push(fn);
    }
  }
}

// ─── Main wrapper ─────────────────────────────────────────────────────────────

/**
 * Execute a SQL query safely:
 *   1. Runs the SELECT-only guard — throws QueryGuardError if unsafe
 *   2. Executes via DuckDB-WASM with a timeout and cancel token
 *   3. Truncates rows to previewLimit and reports fullRowCount
 */
export async function safeRunQuery(
  sql: string,
  options: RunOptions = {}
): Promise<SafeQueryResult> {
  const {
    previewLimit = 1000,
    timeoutMs = 30_000,
    cancelToken,
  } = options;

  // 1. Guard check — mandatory, runs synchronously
  const guard = guardQuery(sql);
  if (!guard.safe) {
    throw new QueryGuardError(guard.reason ?? "SQL failed safety check.");
  }

  // 2. Check for pre-cancelled token
  if (cancelToken?.cancelled) {
    throw new QueryCancelledError();
  }

  // 3. Run with timeout and cancel support
  const result = await _raceWithTimeout(
    _runQuery(sql),
    timeoutMs,
    cancelToken
  );

  // 4. Apply preview limit
  const fullRowCount = result.rowCount;
  const truncated = result.rowCount > previewLimit;
  const rows = truncated ? result.rows.slice(0, previewLimit) : result.rows;

  return {
    ...result,
    rows,
    rowCount: rows.length,
    fullRowCount,
    truncated,
  };
}

// ─── Timeout race ──────────────────────────────────────────────────────────────

async function _raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  cancelToken?: CancelToken
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    // Timeout
    const timer = setTimeout(() => {
      settle(() => reject(new QueryTimeoutError(timeoutMs)));
    }, timeoutMs);

    // Cancel token
    cancelToken?.onCancel(() => {
      settle(() => {
        clearTimeout(timer);
        reject(new QueryCancelledError());
      });
    });

    // Normal completion
    promise.then(
      (val) => settle(() => { clearTimeout(timer); resolve(val); }),
      (err) => settle(() => { clearTimeout(timer); reject(err as Error); })
    );
  });
}
