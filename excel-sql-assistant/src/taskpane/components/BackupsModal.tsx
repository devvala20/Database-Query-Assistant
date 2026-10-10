/**
 * BackupsModal.tsx — Recycle Bin & Preserved Snapshots Viewer
 *
 * Displays all data snapshots preserved before DELETE/UPDATE/DROP mutations.
 * Allows one-click table restoration and CSV download.
 */

import { useState } from "react";
import {
  getActiveBackups,
  restoreBackup,
  deleteBackup,
  exportBackupAsCsv,
  type TableBackup,
} from "../../data/backupManager";
import "./BackupsModal.css";

interface Props {
  onClose: () => void;
  onRestored?: (tableName: string, rowCount: number) => void;
}

export default function BackupsModal({ onClose, onRestored }: Props) {
  const [backups, setBackups] = useState<TableBackup[]>(() => getActiveBackups());
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  async function handleRestore(backup: TableBackup) {
    setStatusMsg(`Restoring "${backup.tableName}"…`);
    const res = await restoreBackup(backup.id);
    if (res.success) {
      setStatusMsg(`✅ Table "${backup.tableName}" restored successfully (${res.rowCount} rows)!`);
      onRestored?.(res.tableName, res.rowCount);
      setTimeout(() => setStatusMsg(null), 3000);
    } else {
      setStatusMsg(`❌ Failed to restore: ${res.message || "Unknown error"}`);
    }
  }

  function handleDelete(id: string) {
    deleteBackup(id);
    setBackups(getActiveBackups());
  }

  function formatTimeRemaining(expiresAt: number): string {
    const diffMs = expiresAt - Date.now();
    if (diffMs <= 0) return "Expired";
    const days = Math.floor(diffMs / (24 * 3600 * 1000));
    const hours = Math.floor((diffMs % (24 * 3600 * 1000)) / (3600 * 1000));
    if (days > 0) return `Preserved for ${days}d ${hours}h`;
    return `Preserved for ${hours}h`;
  }

  return (
    <div className="backups-overlay" role="dialog" aria-modal="true" aria-labelledby="backups-title">
      <div className="backups-modal">
        <div className="backups-modal__header">
          <div className="backups-modal__title-group">
            <span className="backups-modal__icon" aria-hidden="true">♻️</span>
            <h2 id="backups-title" className="backups-modal__title">
              Recycle Bin & Preserved Data
            </h2>
          </div>
          <button
            type="button"
            className="backups-modal__close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {statusMsg && (
          <div
            style={{
              padding: "8px 16px",
              background: statusMsg.startsWith("✅") ? "#f0fdf4" : "#fee2e2",
              color: statusMsg.startsWith("✅") ? "#166534" : "#991b1b",
              fontSize: "12px",
              fontWeight: 500,
            }}
          >
            {statusMsg}
          </div>
        )}

        <div className="backups-modal__body">
          {backups.length === 0 ? (
            <div className="backups-modal__empty">
              <span className="backups-modal__empty-icon" aria-hidden="true">📂</span>
              <p>No preserved backups found.</p>
              <span style={{ fontSize: "11px", color: "var(--color-text-dim)" }}>
                Any DELETE, DROP, or UPDATE operation automatically preserves a 7-day safety snapshot here.
              </span>
            </div>
          ) : (
            backups.map((b) => (
              <div key={b.id} className="backups-item">
                <div className="backups-item__top">
                  <div className="backups-item__table">
                    <span>📊</span>
                    <span>{b.tableName}</span>
                    <span
                      className={`backups-item__tag ${
                        b.operation === "DELETE" || b.operation === "DROP"
                          ? "backups-item__tag--delete"
                          : ""
                      }`}
                    >
                      {b.operation}
                    </span>
                  </div>
                  <span style={{ fontSize: "11px", color: "#166534", fontWeight: 600 }}>
                    ⏳ {formatTimeRemaining(b.expiresAt)}
                  </span>
                </div>

                <div className="backups-item__meta">
                  <span>📅 {new Date(b.timestamp).toLocaleString()}</span>
                  <span>📦 {b.rowCount.toLocaleString()} rows</span>
                  <span>📑 {b.columns.length} columns</span>
                </div>

                <pre className="backups-item__sql">{b.sql}</pre>

                <div className="backups-item__actions">
                  <button
                    type="button"
                    className="backups-item__btn backups-item__btn--restore"
                    onClick={() => void handleRestore(b)}
                    title="Restore table into DuckDB"
                  >
                    ↺ Restore Table
                  </button>
                  <button
                    type="button"
                    className="backups-item__btn backups-item__btn--csv"
                    onClick={() => exportBackupAsCsv(b)}
                    title="Export preserved rows as CSV file"
                  >
                    ⬇ Export CSV
                  </button>
                  <button
                    type="button"
                    className="backups-item__btn backups-item__btn--delete"
                    onClick={() => handleDelete(b.id)}
                    title="Delete backup snapshot"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
