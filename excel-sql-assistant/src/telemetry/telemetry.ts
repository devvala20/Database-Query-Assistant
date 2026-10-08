/**
 * telemetry.ts — Phase 8: Privacy-preserving error & performance telemetry
 *
 * Requirements:
 *   - Zero data leakage: NEVER logs questions, schema contents, column names, or cell data
 *   - Tracks performance metrics: latency buckets, row count ranges, engine load times
 *   - Tracks error categories: QueryGuardError, QueryTimeoutError, MaxRepairAttemptsError
 *   - Pure in-memory / console telemetry buffer with optional endpoint hook
 */

export type TelemetryEventType =
  | "engine_init_success"
  | "engine_init_error"
  | "csv_loaded"
  | "range_loaded"
  | "query_executed"
  | "query_repaired"
  | "query_error"
  | "query_cancelled"
  | "results_exported";

export interface TelemetryEvent {
  type: TelemetryEventType;
  timestamp: number;
  elapsedMs?: number;
  rowCountBucket?: "<100" | "100-1k" | "1k-10k" | "10k+";
  errorCategory?: "guard" | "timeout" | "repair_exhausted" | "duckdb" | "network" | "unknown";
  repairAttempts?: number;
  writeMode?: "new" | "replace" | "append";
}

class TelemetryService {
  private events: TelemetryEvent[] = [];
  private maxBufferSize = 100;
  private enabled = true;

  public setEnabled(val: boolean): void {
    this.enabled = val;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public track(event: Omit<TelemetryEvent, "timestamp">): void {
    if (!this.enabled) return;

    const fullEvent: TelemetryEvent = {
      ...event,
      timestamp: Date.now(),
    };

    this.events.push(fullEvent);
    if (this.events.length > this.maxBufferSize) {
      this.events.shift();
    }

    // Diagnostic console trace (safe metadata only)
    if (process.env.NODE_ENV !== "production") {
      console.debug("[Telemetry]", fullEvent.type, {
        elapsedMs: fullEvent.elapsedMs,
        rows: fullEvent.rowCountBucket,
        error: fullEvent.errorCategory,
      });
    }
  }

  public getEvents(): readonly TelemetryEvent[] {
    return this.events;
  }

  public clear(): void {
    this.events = [];
  }

  public toBucket(rowCount: number): "<100" | "100-1k" | "1k-10k" | "10k+" {
    if (rowCount < 100) return "<100";
    if (rowCount <= 1000) return "100-1k";
    if (rowCount <= 10000) return "1k-10k";
    return "10k+";
  }
}

export const telemetry = new TelemetryService();
