/**
 * telemetry.test.ts — Unit tests for privacy-safe telemetry
 */

import { describe, it, expect, beforeEach } from "vitest";
import { telemetry } from "../src/telemetry/telemetry";

describe("TelemetryService (Phase 8)", () => {
  beforeEach(() => {
    telemetry.clear();
    telemetry.setEnabled(true);
  });

  it("records events with timestamps", () => {
    telemetry.track({
      type: "query_executed",
      elapsedMs: 42,
      rowCountBucket: "100-1k",
    });

    const events = telemetry.getEvents();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("query_executed");
    expect(events[0].elapsedMs).toBe(42);
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  it("does not log events when disabled", () => {
    telemetry.setEnabled(false);
    telemetry.track({ type: "csv_loaded" });
    expect(telemetry.getEvents().length).toBe(0);
  });

  it("correctly buckets row counts", () => {
    expect(telemetry.toBucket(10)).toBe("<100");
    expect(telemetry.toBucket(100)).toBe("100-1k");
    expect(telemetry.toBucket(5000)).toBe("1k-10k");
    expect(telemetry.toBucket(50000)).toBe("10k+");
  });
});
