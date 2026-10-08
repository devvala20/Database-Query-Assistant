/**
 * TablesPanel.tsx — Shows loaded CSV + workbook tables with schema details
 */

import { useState } from "react";
import { dropTable } from "../../data/csvLoader";
import { useStore } from "../state/useStore";
import "./TablesPanel.css";

interface Props {
  onLoadCsv: () => void;
  onLoadWorkbookRange: () => void;
}

export default function TablesPanel({ onLoadCsv, onLoadWorkbookRange }: Props) {
  const { state, dispatch } = useStore();
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  const allTables = [
    ...state.csvTables.map((t) => ({ ...t, source: "csv" as const })),
    ...state.workbookTables.map((t) => ({ ...t, source: "workbook" as const })),
  ];

  async function handleDropCsv(tableName: string) {
    try {
      await dropTable(tableName);
      dispatch({ type: "REMOVE_CSV_TABLE", tableName });
    } catch (err) {
      console.error("Failed to drop table:", err);
    }
  }

  return (
    <div className="tables-panel">
      <div className="tables-panel__header">
        <span className="tables-panel__title">Loaded Tables</span>
        <div className="tables-panel__actions">
          <button
            id="load-csv-btn"
            className="tables-panel__btn"
            onClick={onLoadCsv}
            title="Load CSV file"
            aria-label="Load CSV file"
          >
            📂 CSV
          </button>
          <button
            id="load-range-btn"
            className="tables-panel__btn"
            onClick={onLoadWorkbookRange}
            title="Load selected Excel range"
            aria-label="Load selected Excel range"
          >
            📋 Range
          </button>
        </div>
      </div>

      {allTables.length === 0 ? (
        <div className="tables-panel__empty">
          <span className="tables-panel__empty-icon">🗂️</span>
          <p>No tables loaded yet.</p>
          <p>Click <strong>📂 CSV</strong> to load a file.</p>
        </div>
      ) : (
        <ul className="tables-panel__list" role="list">
          {allTables.map((table) => {
            const isExpanded = expandedTable === table.tableName;
            return (
              <li
                key={table.tableName}
                className="tables-panel__item animate-slide-in"
              >
                <div className="tables-panel__item-header">
                  <button
                    className="tables-panel__expand-btn"
                    onClick={() =>
                      setExpandedTable(isExpanded ? null : table.tableName)
                    }
                    aria-expanded={isExpanded}
                    aria-controls={`schema-${table.tableName}`}
                  >
                    <span className="tables-panel__chevron">
                      {isExpanded ? "▼" : "▶"}
                    </span>
                    <span className="tables-panel__table-name">
                      {table.tableName}
                    </span>
                    <span
                      className={`tables-panel__source-badge tables-panel__source-badge--${table.source}`}
                    >
                      {table.source === "csv" ? "CSV" : "Sheet"}
                    </span>
                  </button>

                  <div className="tables-panel__item-meta">
                    <span className="tables-panel__row-count">
                      {table.rowCount.toLocaleString()} rows
                    </span>
                    {table.source === "csv" && (
                      <button
                        className="tables-panel__drop-btn"
                        onClick={() => handleDropCsv(table.tableName)}
                        title={`Remove ${table.tableName}`}
                        aria-label={`Remove table ${table.tableName}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Collapsible schema */}
                {isExpanded && (
                  <div
                    id={`schema-${table.tableName}`}
                    className="tables-panel__schema animate-fade-in"
                  >
                    <table className="tables-panel__schema-table" aria-label={`Schema for ${table.tableName}`}>
                      <thead>
                        <tr>
                          <th>Column</th>
                          <th>Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.schema.columns.map((col: { name: string; type: string; nullable?: boolean }) => (
                          <tr key={col.name}>
                            <td className="tables-panel__col-name">
                              {col.name}
                            </td>
                            <td className="tables-panel__col-type">
                              {col.type}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
