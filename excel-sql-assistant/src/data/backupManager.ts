/**
 * backupManager.ts — Data Preservation & Recycle Bin (7-day retention)
 *
 * Preserves data before DELETE, DROP, UPDATE, TRUNCATE, or other mutations:
 *   - Automatically snapshots table records before mutation execution
 *   - Retains snapshots for 7 days with expiration countdown
 *   - Allows one-click table restoration back into DuckDB
 *   - Provides CSV export of deleted/modified data
 */

import { runQuery } from "../sql/engine";

export interface TableBackup {
  id: string;
  tableName: string;
  timestamp: number;
  /** Expiration timestamp (default: 7 days after creation) */
  expiresAt: number;
  operation: string;
  sql: string;
  rowCount: number;
  columns: string[];
  rows: (string | number | boolean | null)[][];
}

const STORAGE_KEY = "excel_sql_trash_backups";
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Retrieve all active backups, automatically purging any that have expired (> 7 days).
 */
export function getActiveBackups(): TableBackup[] {
  if (typeof localStorage === "undefined") return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const backups: TableBackup[] = JSON.parse(raw);
    const now = Date.now();

    // Filter out expired backups
    const active = backups.filter((b) => b.expiresAt > now);

    // Save cleaned list if any expired were removed
    if (active.length !== backups.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
    }

    // Return newest first
    return active.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

/**
 * Create a safety snapshot of a table before a mutation executes.
 */
export async function createTableSnapshot(
  tableName: string,
  operation: string,
  sql: string
): Promise<TableBackup | null> {
  if (!tableName) return null;

  try {
    // 1. Fetch current table data from DuckDB
    const result = await runQuery(`SELECT * FROM "${tableName}"`);

    const now = Date.now();
    const backup: TableBackup = {
      id: `bkp-${now}-${Math.random().toString(36).slice(2, 7)}`,
      tableName,
      timestamp: now,
      expiresAt: now + RETENTION_MS,
      operation: operation.toUpperCase(),
      sql,
      rowCount: result.rowCount,
      columns: result.columns,
      rows: result.rows as (string | number | boolean | null)[][],
    };

    // 2. Also keep a session copy inside DuckDB memory
    try {
      const internalBackupName = `_trash_${tableName}_${now}`;
      await runQuery(
        `CREATE TABLE IF NOT EXISTS "${internalBackupName}" AS SELECT * FROM "${tableName}"`
      );
    } catch {
      // Non-fatal if session copy fails, localStorage backup remains
    }

    // 3. Persist into localStorage
    const existing = getActiveBackups();
    // Keep max 20 backups to prevent browser storage quota overflow
    const updated = [backup, ...existing].slice(0, 20);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

    return backup;
  } catch (err) {
    console.warn(`[backupManager] Failed to create snapshot for table "${tableName}":`, err);
    return null;
  }
}

/**
 * Restore a backed-up table back into DuckDB.
 */
export async function restoreBackup(backupId: string): Promise<{
  success: boolean;
  tableName: string;
  rowCount: number;
  message?: string;
}> {
  const backups = getActiveBackups();
  const backup = backups.find((b) => b.id === backupId);

  if (!backup) {
    return { success: false, tableName: "", rowCount: 0, message: "Backup snapshot not found." };
  }

  try {
    const tableName = backup.tableName;

    if (backup.columns.length === 0 || backup.rows.length === 0) {
      // Create empty table
      const colDefs = backup.columns.map((c) => `"${c}" VARCHAR`).join(", ");
      await runQuery(`CREATE OR REPLACE TABLE "${tableName}" (${colDefs || "dummy VARCHAR"})`);
      return { success: true, tableName, rowCount: 0 };
    }

    // Reconstruct column types and insert data
    // Escape string values
    const colList = backup.columns.map((c) => `"${c}"`).join(", ");

    // Create table from structure
    const firstRow = backup.rows[0];
    const inferredTypes = backup.columns.map((_, i) => {
      const val = firstRow[i];
      if (typeof val === "number") return Number.isInteger(val) ? "BIGINT" : "DOUBLE";
      if (typeof val === "boolean") return "BOOLEAN";
      return "VARCHAR";
    });

    const colDefinitions = backup.columns
      .map((col, idx) => `"${col}" ${inferredTypes[idx]}`)
      .join(", ");

    await runQuery(`CREATE OR REPLACE TABLE "${tableName}" (${colDefinitions})`);

    // Insert rows in batches of 500
    const batchSize = 500;
    for (let i = 0; i < backup.rows.length; i += batchSize) {
      const batch = backup.rows.slice(i, i + batchSize);
      const valuesSql = batch
        .map(
          (row) =>
            "(" +
            row
              .map((val) => {
                if (val === null || val === undefined) return "NULL";
                if (typeof val === "number" || typeof val === "boolean") return String(val);
                return `'${String(val).replace(/'/g, "''")}'`;
              })
              .join(", ") +
            ")"
        )
        .join(",\n");

      await runQuery(`INSERT INTO "${tableName}" (${colList}) VALUES ${valuesSql}`);
    }

    return {
      success: true,
      tableName,
      rowCount: backup.rowCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, tableName: backup.tableName, rowCount: 0, message: msg };
  }
}

/**
 * Delete a specific backup snapshot manually.
 */
export function deleteBackup(backupId: string): void {
  const backups = getActiveBackups();
  const filtered = backups.filter((b) => b.id !== backupId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

/**
 * Export a backup snapshot as a downloadable CSV.
 */
export function exportBackupAsCsv(backup: TableBackup): void {
  const header = backup.columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(",");
  const rows = backup.rows.map((row) =>
    row
      .map((v) => {
        if (v === null || v === undefined) return "";
        return `"${String(v).replace(/"/g, '""')}"`;
      })
      .join(",")
  );

  const csvContent = "\uFEFF" + [header, ...rows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup_${backup.tableName}_${new Date(backup.timestamp).toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
