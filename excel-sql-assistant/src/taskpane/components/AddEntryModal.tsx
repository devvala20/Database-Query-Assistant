/**
 * AddEntryModal.tsx — Add a new record / entry to a table
 *
 * Provides a clean form interface for inserting new entries into any loaded table,
 * automatically generates valid typed SQL, preserves a 7-day safety snapshot,
 * and updates the table row count.
 */

import { useState } from "react";
import { getConnection } from "../../sql/engine";
import { createTableSnapshot } from "../../data/backupManager";
import "./AddEntryModal.css";

interface Props {
  tableName: string;
  columns: Array<{ name: string; type: string }>;
  onClose: () => void;
  onSuccess: (newRowCount: number, sql: string) => void;
}

export default function AddEntryModal({
  tableName,
  columns,
  onClose,
  onSuccess,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(colName: string, val: string) {
    setValues((prev) => ({ ...prev, [colName]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const conn = getConnection();
      if (!conn) throw new Error("DuckDB engine is not initialised.");

      // Filter columns that have non-empty values (or include all if empty values are NULL)
      const colsToInsert: string[] = [];
      const valsToInsert: string[] = [];

      for (const col of columns) {
        const val = values[col.name]?.trim();
        if (val !== undefined && val !== "") {
          colsToInsert.push(`"${col.name}"`);
          const t = col.type.toUpperCase();
          if (
            t.includes("INT") ||
            t.includes("DOUBLE") ||
            t.includes("FLOAT") ||
            t.includes("DECIMAL") ||
            t.includes("NUMERIC")
          ) {
            // numeric
            valsToInsert.push(isNaN(Number(val)) ? `'${val.replace(/'/g, "''")}'` : val);
          } else if (t.includes("BOOL")) {
            valsToInsert.push(val.toLowerCase() === "true" || val === "1" ? "true" : "false");
          } else {
            // string / date
            valsToInsert.push(`'${val.replace(/'/g, "''")}'`);
          }
        }
      }

      if (colsToInsert.length === 0) {
        throw new Error("Please enter a value for at least one column.");
      }

      const sql = `INSERT INTO "${tableName}" (${colsToInsert.join(", ")}) VALUES (${valsToInsert.join(", ")})`;

      // 1. Preserve 7-day safety backup prior to inserting
      await createTableSnapshot(tableName, "INSERT", sql);

      // 2. Execute insertion
      await conn.query(sql);

      // 3. Query new row count
      const countRes = await conn.query(`SELECT COUNT(*) AS n FROM "${tableName}"`);
      const newRowCount = Number(countRes.toArray()[0].n);

      onSuccess(newRowCount, sql);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="add-entry-overlay" role="dialog" aria-modal="true" aria-labelledby="add-entry-title">
      <div className="add-entry-modal animate-scale-in">
        <div className="add-entry-modal__header">
          <span className="add-entry-modal__icon" aria-hidden="true">➕</span>
          <div className="add-entry-modal__title-group">
            <h2 id="add-entry-title" className="add-entry-modal__title">
              Add New Entry to "{tableName}"
            </h2>
            <span className="add-entry-modal__subtitle">
              Enter values for the table columns below
            </span>
          </div>
          <button
            className="add-entry-modal__close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="add-entry-modal__form">
          <div className="add-entry-modal__fields">
            {columns.map((col) => (
              <div key={col.name} className="add-entry-modal__field">
                <label className="add-entry-modal__label" htmlFor={`col-${col.name}`}>
                  <span className="add-entry-modal__col-name">{col.name}</span>
                  <span className="add-entry-modal__col-type">{col.type}</span>
                </label>
                <input
                  id={`col-${col.name}`}
                  type="text"
                  className="add-entry-modal__input"
                  placeholder={`Enter ${col.name}…`}
                  value={values[col.name] || ""}
                  onChange={(e) => handleChange(col.name, e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            ))}
          </div>

          <div className="add-entry-modal__notice">
            <span className="add-entry-modal__notice-icon" aria-hidden="true">🛡️</span>
            <span>
              A safety snapshot of <strong>"{tableName}"</strong> will be preserved in your Recycle Bin for 7 days before saving.
            </span>
          </div>

          {error && (
            <div className="add-entry-modal__error" role="alert">
              ⚠️ {error}
            </div>
          )}

          <div className="add-entry-modal__actions">
            <button
              type="button"
              className="add-entry-modal__btn add-entry-modal__btn--cancel"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="add-entry-modal__btn add-entry-modal__btn--submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Adding Entry…" : "Add Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
