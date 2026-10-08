/**
 * HistoryPanel.tsx — Phase 5 & 6: Query history with re-run and pin
 */

import { useStore } from "../state/useStore";
import type { HistoryEntry } from "../state/useStore";
import "./HistoryPanel.css";

interface Props {
  onRerun: (entry: HistoryEntry) => void;
  onRunSql: (sql: string) => void;
}

export default function HistoryPanel({ onRerun, onRunSql }: Props) {
  const { state, dispatch } = useStore();
  const { queryHistory } = state;

  const pinned = queryHistory.filter((e) => e.pinned);
  const unpinned = queryHistory.filter((e) => !e.pinned);

  if (queryHistory.length === 0) {
    return (
      <div className="history-panel history-panel--empty">
        <span className="history-panel__empty-icon">📜</span>
        <p>No queries yet.</p>
        <p className="history-panel__empty-sub">
          Your questions and generated SQL will appear here.
        </p>
      </div>
    );
  }

  function renderEntry(entry: HistoryEntry) {
    return (
      <li key={entry.id} className="history-panel__item animate-fade-in">
        <div className="history-panel__item-header">
          <span className="history-panel__question" title={entry.question}>
            {entry.question}
          </span>
          <div className="history-panel__item-actions">
            <button
              className={`history-panel__pin-btn ${entry.pinned ? "history-panel__pin-btn--active" : ""}`}
              onClick={() => dispatch({ type: "PIN_HISTORY", id: entry.id })}
              title={entry.pinned ? "Unpin" : "Pin this query"}
              aria-label={entry.pinned ? "Unpin query" : "Pin query"}
            >
              📌
            </button>
            <button
              className="history-panel__rerun-btn"
              onClick={() => onRerun(entry)}
              title="Re-run this question"
              aria-label="Re-run query"
            >
              ↺ Re-run
            </button>
            <button
              className="history-panel__sql-btn"
              onClick={() => onRunSql(entry.sql)}
              title="Run this SQL directly"
              aria-label="Run SQL directly"
            >
              ▶ SQL
            </button>
            <button
              className="history-panel__remove-btn"
              onClick={() => dispatch({ type: "REMOVE_HISTORY", id: entry.id })}
              title="Remove from history"
              aria-label="Remove from history"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="history-panel__item-meta">
          <span className="history-panel__time">
            {new Date(entry.timestamp).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {entry.sheetName && (
            <span className="history-panel__sheet">→ {entry.sheetName}</span>
          )}
        </div>

        <div className="history-panel__explanation">{entry.explanation}</div>

        <pre className="history-panel__sql">
          <code>{entry.sql}</code>
        </pre>
      </li>
    );
  }

  return (
    <div className="history-panel">
      {pinned.length > 0 && (
        <section className="history-panel__section">
          <h2 className="history-panel__section-title">📌 Pinned</h2>
          <ul className="history-panel__list" role="list">
            {pinned.map(renderEntry)}
          </ul>
        </section>
      )}

      {unpinned.length > 0 && (
        <section className="history-panel__section">
          {pinned.length > 0 && (
            <h2 className="history-panel__section-title">Recent</h2>
          )}
          <ul className="history-panel__list" role="list">
            {unpinned.map(renderEntry)}
          </ul>
        </section>
      )}
    </div>
  );
}
