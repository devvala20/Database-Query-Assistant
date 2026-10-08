/**
 * SqlViewer.tsx — Phase 6: Editable SQL box with run and explain
 *
 * Shown in each assistant message. Features:
 *   - Syntax-highlighted read-only view (no dep needed — uses CSS + <pre>)
 *   - "Edit SQL" mode — user can modify the query
 *   - "Run edited SQL" — executes the modified query directly
 *   - "Explain this SQL" — asks AI to explain a pasted/edited query
 *   - Copy to clipboard
 */

import { useState, useRef, type ChangeEvent } from "react";
import "./SqlViewer.css";

interface Props {
  sql: string;
  /** Called when user runs the edited SQL */
  onRunSql?: (sql: string) => void;
  /** Called when user wants the AI to explain the (possibly edited) SQL */
  onExplainSql?: (sql: string) => void;
  /** Show the viewer expanded by default */
  defaultExpanded?: boolean;
}

export default function SqlViewer({
  sql,
  onRunSql,
  onExplainSql,
  defaultExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [editMode, setEditMode] = useState(false);
  const [editedSql, setEditedSql] = useState(sql);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleCopy() {
    navigator.clipboard.writeText(editMode ? editedSql : sql).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleEnterEdit() {
    setEditedSql(sql);
    setEditMode(true);
    setExpanded(true);
    // Focus textarea on next tick
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function handleCancelEdit() {
    setEditMode(false);
    setEditedSql(sql);
  }

  function handleRunEdited() {
    if (onRunSql && editedSql.trim()) {
      onRunSql(editedSql.trim());
      setEditMode(false);
    }
  }

  function handleExplain() {
    const target = editMode ? editedSql : sql;
    if (onExplainSql && target.trim()) {
      onExplainSql(target.trim());
    }
  }

  return (
    <div className="sql-viewer">
      {/* Header row */}
      <div className="sql-viewer__header">
        <button
          className="sql-viewer__toggle"
          onClick={() => setExpanded((v: boolean) => !v)}
          aria-expanded={expanded}
          aria-controls="sql-viewer-body"
        >
          <span className="sql-viewer__icon" aria-hidden="true">〈/〉</span>
          <span>{expanded ? "Hide SQL" : "View SQL"}</span>
          <span className="sql-viewer__chevron" aria-hidden="true">
            {expanded ? "▲" : "▼"}
          </span>
        </button>

        <div className="sql-viewer__actions">
          <button
            className="sql-viewer__action-btn"
            onClick={handleCopy}
            title="Copy SQL to clipboard"
            aria-label="Copy SQL"
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>

          {!editMode && (
            <button
              className="sql-viewer__action-btn"
              onClick={handleEnterEdit}
              title="Edit the SQL query"
              aria-label="Edit SQL"
            >
              Edit
            </button>
          )}

          {onExplainSql && (
            <button
              className="sql-viewer__action-btn sql-viewer__action-btn--primary"
              onClick={handleExplain}
              title="Ask AI to explain this SQL"
              aria-label="Explain SQL"
            >
              Explain
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div id="sql-viewer-body" className="sql-viewer__body animate-fade-in">
          {editMode ? (
            <>
              <textarea
                ref={textareaRef}
                id="sql-editor-textarea"
                className="sql-viewer__editor"
                value={editedSql}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEditedSql(e.target.value)}
                spellCheck={false}
                aria-label="Edit SQL query"
                rows={Math.min(20, editedSql.split("\n").length + 2)}
              />
              <div className="sql-viewer__edit-actions">
                <button
                  id="run-edited-sql-btn"
                  className="sql-viewer__run-btn"
                  onClick={handleRunEdited}
                  disabled={!editedSql.trim()}
                  aria-label="Run edited SQL"
                >
                  ▶ Run edited SQL
                </button>
                <button
                  className="sql-viewer__cancel-btn"
                  onClick={handleCancelEdit}
                  aria-label="Cancel editing"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <pre className="sql-viewer__code">
              <code>{_highlightSql(sql)}</code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Very lightweight SQL keyword highlighting ─────────────────────────────────
// No external dep needed — just wraps known DuckDB keywords in <span> elements.
// A future upgrade could use prism.js or shiki.

const KEYWORDS = [
  "SELECT","FROM","WHERE","GROUP BY","ORDER BY","HAVING","LIMIT","OFFSET",
  "JOIN","LEFT JOIN","RIGHT JOIN","INNER JOIN","OUTER JOIN","CROSS JOIN","ON",
  "AS","DISTINCT","WITH","UNION","UNION ALL","INTERSECT","EXCEPT",
  "AND","OR","NOT","IN","LIKE","ILIKE","BETWEEN","IS","NULL","IS NOT","IS NULL",
  "IS NOT NULL","CASE","WHEN","THEN","ELSE","END","EXISTS","ANY","ALL",
  "COUNT","SUM","AVG","MIN","MAX","ROW_NUMBER","RANK","NTILE","OVER","PARTITION BY",
  "DATE_TRUNC","DATE_DIFF","STRFTIME","COALESCE","NULLIF","CAST","TRY_CAST",
  "ASC","DESC","TRUE","FALSE",
];

function _highlightSql(sql: string): React.ReactNode {
  // Simple tokenisation — split on keyword boundaries
  // Returns a mix of plain strings and <span> elements
  const parts: React.ReactNode[] = [];
  let remaining = sql;
  let key = 0;

  // Sort by length descending so "GROUP BY" matches before "GROUP"
  const sorted = [...KEYWORDS].sort((a, b) => b.length - a.length);

  while (remaining.length > 0) {
    let matched = false;
    for (const kw of sorted) {
      const pattern = new RegExp(`^(${kw})\\b`, "i");
      const m = remaining.match(pattern);
      if (m) {
        parts.push(
          <span key={key++} className="sql-kw">
            {m[1]}
          </span>
        );
        remaining = remaining.slice(m[1].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Check for string literal
      if (remaining[0] === "'" || remaining[0] === '"') {
        const quote = remaining[0];
        const end = remaining.indexOf(quote, 1);
        const literal = end === -1 ? remaining : remaining.slice(0, end + 1);
        parts.push(
          <span key={key++} className="sql-str">
            {literal}
          </span>
        );
        remaining = remaining.slice(literal.length);
      } else {
        // Plain character
        parts.push(remaining[0]);
        remaining = remaining.slice(1);
      }
    }
  }

  return <>{parts}</>;
}
