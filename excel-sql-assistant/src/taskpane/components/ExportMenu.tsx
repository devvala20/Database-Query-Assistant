/**
 * ExportMenu.tsx — Phase 7: Export options for a query result
 *
 * Shown in each assistant message that has a result sheet.
 * Options:
 *   - Copy as TSV (clipboard)
 *   - Download as CSV
 *   - Replace last result sheet
 *   - Append to existing sheet
 */

import { useState } from "react";
import type { QueryResult } from "../../sql/engine";
import {
  copyResultToClipboard,
  downloadResultAsCsv,
  writeResultsToSheet,
  type WriteMode,
} from "../../excel/resultsWriter";
import "./ExportMenu.css";

interface Props {
  result: QueryResult;
  sql: string;
  question: string;
  currentSheetName: string;
  onSheetWritten?: (sheetName: string) => void;
}

export default function ExportMenu({
  result,
  sql,
  question,
  currentSheetName,
  onSheetWritten,
}: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleWriteMode(mode: WriteMode) {
    setOpen(false);
    setStatus("Writing…");
    try {
      const writeResult = await writeResultsToSheet(result, question, {
        mode,
        sql,
        writeSqlNote: true,
      });
      setStatus(`✅ Written to "${writeResult.sheetName}"`);
      onSheetWritten?.(writeResult.sheetName);
    } catch (err) {
      setStatus(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTimeout(() => setStatus(null), 3000);
    }
  }

  async function handleCopyClipboard() {
    setOpen(false);
    try {
      await copyResultToClipboard(result);
      setStatus("✅ Copied to clipboard (TSV)");
    } catch {
      setStatus("❌ Clipboard write failed");
    } finally {
      setTimeout(() => setStatus(null), 2500);
    }
  }

  function handleDownloadCsv() {
    setOpen(false);
    downloadResultAsCsv(
      result,
      `${currentSheetName.replace(/[^a-zA-Z0-9_-]/g, "_")}.csv`
    );
    setStatus("✅ CSV downloaded");
    setTimeout(() => setStatus(null), 2500);
  }

  return (
    <div className="export-menu">
      <button
        id="export-menu-btn"
        className="export-menu__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Export options"
      >
        Export ▾
      </button>

      {open && (
        <div className="export-menu__dropdown animate-fade-in" role="menu">
          <button
            role="menuitem"
            className="export-menu__item"
            onClick={() => void handleWriteMode("new")}
          >
            <span className="export-menu__icon">📄</span>
            New sheet
          </button>
          <button
            role="menuitem"
            className="export-menu__item"
            onClick={() => void handleWriteMode("replace")}
          >
            <span className="export-menu__icon">🔄</span>
            Replace existing sheet
          </button>
          <button
            role="menuitem"
            className="export-menu__item"
            onClick={() => void handleWriteMode("append")}
          >
            <span className="export-menu__icon">➕</span>
            Append to sheet
          </button>
          <div className="export-menu__divider" role="separator" />
          <button
            role="menuitem"
            className="export-menu__item"
            onClick={() => void handleCopyClipboard()}
          >
            <span className="export-menu__icon">📋</span>
            Copy as TSV
          </button>
          <button
            role="menuitem"
            className="export-menu__item"
            onClick={handleDownloadCsv}
          >
            <span className="export-menu__icon">⬇️</span>
            Download as CSV
          </button>
        </div>
      )}

      {status && (
        <span className="export-menu__status animate-fade-in">{status}</span>
      )}
    </div>
  );
}
