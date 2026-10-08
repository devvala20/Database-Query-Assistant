/**
 * guard.test.ts — Phase 3: Unit tests for the SELECT-only guard
 *
 * Run with: npm test
 * Tests hostile inputs from the implementation plan §9
 */

import { describe, it, expect } from "vitest";
import { guardQuery } from "../src/sql/guard";

// ─── Safe queries (should pass) ───────────────────────────────────────────────

describe("guardQuery — safe queries", () => {
  it("allows a plain SELECT", () => {
    expect(guardQuery("SELECT * FROM sales")).toEqual({ safe: true });
  });

  it("allows SELECT with WHERE, ORDER BY, LIMIT", () => {
    const sql = `
      SELECT customer_name, SUM(revenue) AS total
      FROM sales
      WHERE year = 2024
      GROUP BY customer_name
      ORDER BY total DESC
      LIMIT 10
    `;
    expect(guardQuery(sql)).toEqual({ safe: true });
  });

  it("allows WITH ... SELECT (CTE)", () => {
    const sql = `
      WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY category ORDER BY revenue DESC) AS rn
        FROM products
      )
      SELECT * FROM ranked WHERE rn = 1
    `;
    expect(guardQuery(sql)).toEqual({ safe: true });
  });

  it("allows nested subqueries", () => {
    const sql = `
      SELECT * FROM (
        SELECT id, name FROM customers WHERE active = true
      ) sub
      WHERE name LIKE 'A%'
    `;
    expect(guardQuery(sql)).toEqual({ safe: true });
  });

  it("allows UNION ALL", () => {
    const sql = `
      SELECT id, 'csv' AS source FROM table1
      UNION ALL
      SELECT id, 'sheet' AS source FROM table2
    `;
    expect(guardQuery(sql)).toEqual({ safe: true });
  });

  it("allows a string value that contains a blocked keyword in data", () => {
    // The word DROP appears inside a string literal — should not be blocked
    const sql = `SELECT * FROM orders WHERE status = 'DROP SHIP'`;
    expect(guardQuery(sql)).toEqual({ safe: true });
  });

  it("allows column named 'load_date'", () => {
    // LOAD is a blocked keyword but this is part of an identifier
    const sql = `SELECT load_date, amount FROM shipments`;
    expect(guardQuery(sql)).toEqual({ safe: true });
  });
});

// ─── Hostile inputs (should be blocked) ──────────────────────────────────────

describe("guardQuery — hostile inputs", () => {
  it("blocks DROP TABLE", () => {
    expect(guardQuery("DROP TABLE sales").safe).toBe(false);
  });

  it("blocks DELETE FROM", () => {
    expect(guardQuery("DELETE FROM users WHERE id = 1").safe).toBe(false);
  });

  it("blocks INSERT INTO", () => {
    expect(guardQuery("INSERT INTO t VALUES (1)").safe).toBe(false);
  });

  it("blocks UPDATE", () => {
    expect(guardQuery("UPDATE t SET a = 1").safe).toBe(false);
  });

  it("blocks CREATE TABLE", () => {
    expect(guardQuery("CREATE TABLE x (id INT)").safe).toBe(false);
  });

  it("blocks ATTACH", () => {
    expect(guardQuery("ATTACH 'data.db'").safe).toBe(false);
  });

  it("blocks INSTALL extension", () => {
    expect(guardQuery("INSTALL httpfs").safe).toBe(false);
  });

  it("blocks COPY TO file", () => {
    expect(guardQuery("COPY sales TO '/tmp/out.csv' (FORMAT CSV)").safe).toBe(false);
  });

  it("blocks read_csv() even inside SELECT", () => {
    expect(guardQuery("SELECT * FROM read_csv('/etc/passwd')").safe).toBe(false);
  });

  it("blocks read_parquet()", () => {
    expect(guardQuery("SELECT * FROM read_parquet('s3://bucket/file.parquet')").safe).toBe(false);
  });

  it("blocks read_json_auto()", () => {
    expect(guardQuery("SELECT * FROM read_json_auto('/secrets.json')").safe).toBe(false);
  });

  it("blocks getenv()", () => {
    expect(guardQuery("SELECT getenv('API_KEY') AS key").safe).toBe(false);
  });

  it("blocks multi-statement injection", () => {
    expect(guardQuery("SELECT 1; DROP TABLE users").safe).toBe(false);
  });

  it("blocks SQL comment injection (--)", () => {
    expect(guardQuery("SELECT * FROM t -- WHERE 1=0").safe).toBe(false);
  });

  it("blocks block comment injection (/* */)", () => {
    expect(guardQuery("SELECT * FROM t /* injected */ LIMIT 1").safe).toBe(false);
  });

  it("blocks PRAGMA", () => {
    expect(guardQuery("PRAGMA database_list").safe).toBe(false);
  });

  it("blocks SET session variable", () => {
    expect(guardQuery("SET memory_limit='10GB'").safe).toBe(false);
  });

  it("returns a human-readable reason on failure", () => {
    const result = guardQuery("DROP TABLE sales");
    expect(result.safe).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(typeof result.reason).toBe("string");
  });
});
