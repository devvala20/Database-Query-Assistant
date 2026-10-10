/**
 * App.tsx — Task pane orchestrator (Phases 0–6)
 *
 * Wires together all phases:
 *   Phase 0: DuckDB-WASM init + write to Excel
 *   Phase 1: React chat shell + ribbon manifest
 *   Phase 2: CSV / workbook data loading
 *   Phase 3: safeRunQuery with timeout, cancel, row limit
 *   Phase 4: AI with repair loop + conversation memory
 *   Phase 5: History panel, settings panel, cancel button, suggested questions
 *   Phase 6: Editable SQL, Explain-this-SQL, assumptions, truncation warnings
 */

import { useState, useEffect, useRef, useCallback, type ChangeEvent } from "react";
import {
  StoreProvider,
  useStore,
  createMessage,
  createHistoryEntry,
} from "./state/useStore";
import ChatMessage from "./components/ChatMessage";
import ChatInput from "./components/ChatInput";
import TablesPanel from "./components/TablesPanel";
import HistoryPanel from "./components/HistoryPanel";
import SettingsPanel from "./components/SettingsPanel";
import ConfirmationModal from "./components/ConfirmationModal";
import BackupsModal from "./components/BackupsModal";
import { initEngine } from "../sql/engine";
import { safeRunQuery, CancelToken, QueryGuardError, QueryTimeoutError, QueryCancelledError } from "../sql/runner";
import { isMutationQuery } from "../sql/guard";
import { createTableSnapshot } from "../data/backupManager";
import { loadCsvFile } from "../data/csvLoader";
import { loadSelectedRange } from "../data/workbookReader";
import { filterMaskedColumns, collectSampleValues } from "../data/schema";
import { runWithRepair, MaxRepairAttemptsError } from "../ai/repairLoop";
import { writeResultsToSheet } from "../excel/resultsWriter";
import { telemetry } from "../telemetry/telemetry";
import type { ConversationTurn } from "../ai/prompt";
import "./App.css";

// ─── Inner component ──────────────────────────────────────────────────────────

function TaskPane() {
  const { state, dispatch } = useStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Conversation history for AI follow-up support (Phase 4)
  const conversationHistory = useRef<ConversationTurn[]>([]);

  // Confirmation & Backups modal states
  const [pendingConfirm, setPendingConfirm] = useState<{
    sql: string;
    operationType: string;
    targetTable?: string;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  const [showBackupsModal, setShowBackupsModal] = useState(false);

  const confirmMutation = useCallback(
    (sql: string, operationType: string, targetTable?: string): Promise<boolean> => {
      return new Promise((resolve) => {
        setPendingConfirm({
          sql,
          operationType,
          targetTable,
          resolve,
        });
      });
    },
    []
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  // ── DuckDB engine init (silent unless error) ───────────────────────────────
  useEffect(() => {
    async function init() {
      dispatch({ type: "SET_ENGINE_STATUS", status: "initialising" });
      try {
        await initEngine();
        dispatch({ type: "SET_ENGINE_STATUS", status: "ready" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: "SET_ENGINE_STATUS", status: "error", error: msg });
      }
    }
    void init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── CSV loading ────────────────────────────────────────────────────────────
  async function handleCsvFilePicked(file: File) {
    dispatch({ type: "SET_LOADING", loading: true, message: `Loading ${file.name}…` });
    try {
      const loadedTable = await loadCsvFile(file);
      dispatch({ type: "ADD_CSV_TABLE", table: loadedTable });
      telemetry.track({
        type: "csv_loaded",
        rowCountBucket: telemetry.toBucket(loadedTable.rowCount),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({
        type: "ADD_MESSAGE",
        message: createMessage("error", `Failed to load CSV: ${msg}`),
      });
    } finally {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function onFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleCsvFilePicked(file);
    e.target.value = "";
  }

  // ── Workbook range loading ─────────────────────────────────────────────────
  async function handleLoadWorkbookRange() {
    dispatch({ type: "SET_LOADING", loading: true, message: "Reading Excel range…" });
    try {
      const info = await loadSelectedRange();
      dispatch({ type: "ADD_WORKBOOK_TABLE", table: info });
      telemetry.track({
        type: "range_loaded",
        rowCountBucket: telemetry.toBucket(info.rowCount),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({
        type: "ADD_MESSAGE",
        message: createMessage(
          "error",
          `Failed to load range: ${msg}\n\nTip: select a range with a header row first.`
        ),
      });
    } finally {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  // ── Cancel running query ───────────────────────────────────────────────────
  function handleCancel() {
    state.activeCancelToken?.cancel();
    dispatch({ type: "SET_CANCEL_TOKEN", token: null });
    dispatch({ type: "SET_LOADING", loading: false });
  }

  // ── Run SQL directly (from editor or history) with Mutation Safeguard ──────
  const handleRunSqlDirectly = useCallback(
    async (sql: string) => {
      if (state.isLoading || state.engineStatus !== "ready") return;

      const mutation = isMutationQuery(sql);
      if (mutation.isMutation) {
        const confirmed = await confirmMutation(
          sql,
          mutation.type || "MODIFICATION",
          mutation.targetTable
        );
        if (!confirmed) {
          return;
        }
        if (mutation.targetTable) {
          await createTableSnapshot(mutation.targetTable, mutation.type || "MUTATION", sql);
        }
      }

      dispatch({ type: "SET_LOADING", loading: true, message: "Running SQL…" });
      dispatch({
        type: "ADD_MESSAGE",
        message: createMessage("user", sql),
      });

      const cancelToken = new CancelToken();
      dispatch({ type: "SET_CANCEL_TOKEN", token: cancelToken });

      try {
        const result = await safeRunQuery(sql, {
          previewLimit: state.settings.previewLimit,
          timeoutMs: state.settings.timeoutMs,
          cancelToken,
        });
        const writeResult = await writeResultsToSheet(result, sql, {
          mode: state.settings.defaultWriteMode,
          sql,
          writeSqlNote: true,
          onProgress: (written, total) => {
            dispatch({
              type: "SET_LOADING",
              loading: true,
              message: `Writing to Excel… ${Math.round((written / total) * 100)}%`,
            });
          },
        });
        const sheetName = writeResult.sheetName;

        const explanation = mutation.isMutation
          ? `Executed ${mutation.type || "operation"} successfully on ${mutation.targetTable ? `"${mutation.targetTable}"` : "table"}. A safety snapshot is preserved in the Recycle Bin for 7 days.`
          : "Direct SQL execution.";

        dispatch({
          type: "ADD_MESSAGE",
          message: createMessage(
            "assistant",
            explanation,
            {
              sql,
              explanation,
              assumptions: mutation.isMutation && mutation.targetTable
                ? [`Safety backup created for "${mutation.targetTable}" (retained in Recycle Bin for 7 days)`]
                : [],
              resultSheetName: sheetName,
              rowCount: result.rowCount,
              fullRowCount: result.fullRowCount,
              elapsedMs: writeResult.elapsedMs,
              truncated: result.truncated,
              resultData: {
                columns: result.columns,
                rows: result.rows as (string | number | boolean | null)[][],
                rowCount: result.rowCount,
                elapsedMs: result.elapsedMs,
              },
            }
          ),
        });

        // Add to query history
        dispatch({
          type: "ADD_HISTORY",
          entry: createHistoryEntry("Custom SQL", sql, explanation, sheetName),
        });
      } catch (err) {
        const msg =
          err instanceof QueryGuardError
            ? `⛔ Guard blocked: ${err.reason}`
            : err instanceof QueryCancelledError
            ? "⛔ Query was cancelled."
            : err instanceof QueryTimeoutError
            ? `⏱ Query timed out after ${err.timeoutMs / 1000}s.`
            : err instanceof Error
            ? err.message
            : String(err);
        dispatch({
          type: "ADD_MESSAGE",
          message: createMessage("error", msg),
        });
      } finally {
        dispatch({ type: "SET_LOADING", loading: false });
        dispatch({ type: "SET_CANCEL_TOKEN", token: null });
      }
    },
    [state, dispatch, confirmMutation]
  );

  // ── Phase 6: "Explain this SQL" ────────────────────────────────────────────
  const handleExplainSql = useCallback(
    (sql: string) => {
      void handleQuestion(`Explain this SQL in plain English:\n\`\`\`sql\n${sql}\n\`\`\``);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state]
  );

  // ── Phase 4+5: Main question → AI → execute → write loop ──────────────────
  const handleQuestion = useCallback(
    async (question: string) => {
      if (state.isLoading || state.engineStatus !== "ready") return;

      const trimmed = question.trim();
      // If the user typed a raw SQL query (e.g. SELECT ..., WITH ..., DESCRIBE ...), execute it directly
      if (/^\s*(SELECT|WITH|DESCRIBE|SHOW|PRAGMA|EXPLAIN\s+(QUERY\s+PLAN|ANALYZE|SELECT))\b/i.test(trimmed)) {
        void handleRunSqlDirectly(trimmed);
        return;
      }

      dispatch({
        type: "ADD_MESSAGE",
        message: createMessage("user", question),
      });
      dispatch({ type: "SET_LOADING", loading: true, message: "Thinking…" });
      dispatch({ type: "SET_ACTIVE_PANEL", panel: "chat" });

      const allSchemas = [
        ...state.csvTables.map((t) => t.schema),
        ...state.workbookTables.map((t) => t.schema),
      ];

      // Phase 8: Privacy-first column masking
      const schemasForAi = allSchemas.map((s) =>
        filterMaskedColumns(s, state.settings.maskedColumns)
      );

      // Phase 8: Opt-in sample values collection
      let sampleValues: Record<string, string[]> | undefined = undefined;
      if (state.settings.sendSampleValues) {
        sampleValues = {};
        for (const s of schemasForAi) {
          const samples = await collectSampleValues(s.tableName, s);
          Object.assign(sampleValues, samples);
        }
      }

      const cancelToken = new CancelToken();
      dispatch({ type: "SET_CANCEL_TOKEN", token: cancelToken });

      try {
        // Phase 4: repair loop (AI + self-repair on DuckDB errors)
        dispatch({ type: "SET_LOADING", loading: true, message: "Asking AI…" });

        const { response, result, attemptsUsed } = await runWithRepair(
          {
            question,
            schemas: schemasForAi,
            history: conversationHistory.current,
            sampleValues,
            apiKey: state.settings.apiKey,
            proxyUrl: state.settings.proxyUrl,
            proxyToken: state.settings.proxyToken,
            aiProvider: state.settings.aiProvider,
            modelName: state.settings.modelName,
          },
          (attempt, _sql) => {
            if (attempt > 1) {
              dispatch({ type: "SET_LOADING", loading: true, message: `Repairing SQL (attempt ${attempt})…` });
            }
          },
          confirmMutation
        );

        // Model asked for clarification
        if (response.clarification) {
          dispatch({
            type: "ADD_MESSAGE",
            message: createMessage("clarification", response.clarification),
          });
          // Add clarification to history so context is preserved
          conversationHistory.current.push(
            { role: "user", content: question },
            { role: "assistant", content: response.clarification }
          );
          return;
        }

        // Write results to Excel (Phase 7 — chunked, type-aware)
        dispatch({ type: "SET_LOADING", loading: true, message: "Writing to Excel…" });
        const writeResult = await writeResultsToSheet(result, question, {
          mode: state.settings.defaultWriteMode,
          sql: response.sql,
          writeSqlNote: true,
          onProgress: (written, total) => {
            dispatch({
              type: "SET_LOADING",
              loading: true,
              message: `Writing to Excel… ${Math.round((written / total) * 100)}%`,
            });
          },
        });
        const sheetName = writeResult.sheetName;

        // Add assistant message with cached resultData for re-export (Phase 7)
        dispatch({
          type: "ADD_MESSAGE",
          message: createMessage("assistant", response.explanation, {
            sql: response.sql,
            explanation: response.explanation,
            assumptions: response.assumptions,
            resultSheetName: sheetName,
            rowCount: result.rowCount,
            fullRowCount: result.fullRowCount,
            elapsedMs: writeResult.elapsedMs,
            truncated: result.truncated,
            attemptsUsed,
            resultData: {
              columns: result.columns,
              rows: result.rows as (string | number | boolean | null)[][],
              rowCount: result.rowCount,
              elapsedMs: result.elapsedMs,
            },
          }),
        });

        // Update conversation history for follow-ups (Phase 4)
        conversationHistory.current.push(
          { role: "user", content: question },
          { role: "assistant", content: response.explanation, sql: response.sql }
        );
        // Keep history to last 10 turns to avoid huge prompts
        if (conversationHistory.current.length > 10) {
          conversationHistory.current = conversationHistory.current.slice(-10);
        }

        // Add to query history (Phase 5 & 6)
        dispatch({
          type: "ADD_HISTORY",
          entry: createHistoryEntry(question, response.sql, response.explanation, sheetName),
        });

        // Phase 8: Safe telemetry (zero content leakage)
        telemetry.track({
          type: attemptsUsed > 1 ? "query_repaired" : "query_executed",
          elapsedMs: writeResult.elapsedMs,
          rowCountBucket: telemetry.toBucket(result.rowCount),
          repairAttempts: attemptsUsed,
          writeMode: state.settings.defaultWriteMode,
        });
      } catch (err) {
        let msg: string;
        let errorCategory: "guard" | "timeout" | "repair_exhausted" | "unknown" = "unknown";

        if (err instanceof QueryGuardError) {
          errorCategory = "guard";
          msg = `⛔ Query blocked by safety guard: ${err.reason}`;
        } else if (err instanceof QueryCancelledError) {
          msg = "⛔ Query was cancelled.";
        } else if (err instanceof QueryTimeoutError) {
          errorCategory = "timeout";
          msg = `⏱ Query timed out after ${err.timeoutMs / 1000}s. Try a simpler question or increase the timeout in Settings.`;
        } else if (err instanceof MaxRepairAttemptsError) {
          errorCategory = "repair_exhausted";
          msg = `❌ Could not fix the query after ${err.attempts} attempt(s).\nLast error: ${err.lastError}\nTry rephrasing your question.`;
        } else {
          msg = err instanceof Error ? err.message : String(err);
        }

        telemetry.track({
          type: "query_error",
          errorCategory,
        });

        dispatch({
          type: "ADD_MESSAGE",
          message: createMessage("error", msg),
        });
      } finally {
        dispatch({ type: "SET_LOADING", loading: false });
        dispatch({ type: "SET_CANCEL_TOKEN", token: null });
      }
    },
    [state, dispatch]
  );

  // ── Phase 5: Suggested questions from schema ──────────────────────────────
  const suggestedQuestions = _buildSuggestions(
    state.csvTables.map((t) => t.tableName),
    state.workbookTables.map((t) => t.tableName)
  );

  const hasNoTables =
    state.csvTables.length === 0 && state.workbookTables.length === 0;

  const engineBanner =
    state.engineStatus === "initialising" ? (
      <div className="app__engine-banner app__engine-banner--loading" role="status">
        <span className="animate-pulse">⟳</span> Loading DuckDB-WASM…
      </div>
    ) : state.engineStatus === "error" ? (
      <div className="app__engine-banner app__engine-banner--error" role="alert">
        ⚠️ {state.engineError}
      </div>
    ) : null;

  return (
    <div className="app" role="main">
      {/* Header */}
      <header className="app__header">
        <div className="app__logo" aria-hidden="true">⚡</div>
        <div className="app__title-group">
          <h1 className="app__title">SQL Assistant</h1>
          <span className="app__subtitle">Ask questions in plain English</span>
        </div>
        <div className="app__header-right">
          <div
            className={`app__engine-dot app__engine-dot--${state.engineStatus}`}
            title={`Engine: ${state.engineStatus}`}
            aria-label={`DuckDB engine: ${state.engineStatus}`}
          />
        </div>
      </header>

      {engineBanner}

      {/* Navigation tabs (Phase 5) */}
      <nav className="app__nav" aria-label="Panels">
        {(["chat", "history", "settings"] as const).map((panel) => (
          <button
            key={panel}
            id={`nav-${panel}`}
            className={`app__nav-btn ${state.activePanel === panel ? "app__nav-btn--active" : ""}`}
            onClick={() => dispatch({ type: "SET_ACTIVE_PANEL", panel })}
            aria-selected={state.activePanel === panel}
            role="tab"
          >
            {panel === "chat" ? "💬 Chat" : panel === "history" ? "📜 History" : "⚙️ Settings"}
          </button>
        ))}
      </nav>

      {/* Tables panel (always shown above chat) */}
      {state.activePanel === "chat" && (
        <TablesPanel
          onLoadCsv={openFilePicker}
          onLoadWorkbookRange={handleLoadWorkbookRange}
          onOpenBackups={() => setShowBackupsModal(true)}
        />
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        id="csv-file-input"
        type="file"
        accept=".csv,.tsv,.txt"
        onChange={onFileInputChange}
        className="sr-only"
        aria-label="Select CSV file"
      />

      {/* Panel content */}
      {state.activePanel === "chat" && (
        <>
          <div className="app__messages" role="log" aria-live="polite" aria-label="Conversation">
            {state.messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                onRunSql={handleRunSqlDirectly}
                onExplainSql={handleExplainSql}
              />
            ))}

            {/* Typing / loading indicator with fine-grained message */}
            {state.isLoading && (
              <div className="app__loading-row" role="status" aria-label={state.loadingMessage || "Loading"}>
                <div className="app__typing-indicator" aria-hidden="true">
                  <span /><span /><span />
                </div>
                {state.loadingMessage && (
                  <span className="app__loading-msg">{state.loadingMessage}</span>
                )}
                <button
                  className="app__cancel-btn"
                  onClick={handleCancel}
                  aria-label="Cancel query"
                  title="Cancel"
                >
                  ✕ Cancel
                </button>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggested questions (Phase 5) */}
          {!hasNoTables && !state.isLoading && suggestedQuestions.length > 0 && (
            <div className="app__suggestions">
              <p className="app__suggestions-label">Try asking:</p>
              <ul className="app__suggestions-list">
                {suggestedQuestions.map((s) => (
                  <li key={s}>
                    <button
                      className="app__suggestion-chip"
                      onClick={() => void handleQuestion(s)}
                      disabled={state.isLoading}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Empty-state suggestions when no tables loaded */}
          {hasNoTables && state.engineStatus === "ready" && (
            <div className="app__empty-state">
              <span className="app__empty-icon">📊</span>
              <p>Load a CSV or Excel range to get started.</p>
              <div className="app__empty-actions">
                <button className="app__empty-btn" onClick={openFilePicker}>
                  📂 Load CSV
                </button>
                <button className="app__empty-btn" onClick={handleLoadWorkbookRange}>
                  📋 Load Range
                </button>
              </div>
            </div>
          )}

          <ChatInput
            onSend={(q) => void handleQuestion(q)}
            disabled={state.isLoading || state.engineStatus !== "ready"}
            placeholder={
              state.engineStatus !== "ready"
                ? "Waiting for engine…"
                : hasNoTables
                ? "Load a CSV first, then ask questions or run SQL…"
                : "Ask in English or type SQL (SELECT…)"
            }
          />
        </>
      )}

      {state.activePanel === "history" && (
        <HistoryPanel
          onRerun={(entry) => void handleQuestion(entry.question)}
          onRunSql={(sql) => void handleRunSqlDirectly(sql)}
        />
      )}

      {state.activePanel === "settings" && <SettingsPanel />}

      {/* Confirmation Modal for DML/DDL mutations */}
      {pendingConfirm && (
        <ConfirmationModal
          sql={pendingConfirm.sql}
          operationType={pendingConfirm.operationType}
          targetTable={pendingConfirm.targetTable}
          onConfirm={() => {
            const resolver = pendingConfirm.resolve;
            setPendingConfirm(null);
            resolver(true);
          }}
          onCancel={() => {
            const resolver = pendingConfirm.resolve;
            setPendingConfirm(null);
            resolver(false);
          }}
        />
      )}

      {/* 7-Day Safety Backups / Recycle Bin Modal */}
      {showBackupsModal && (
        <BackupsModal
          onClose={() => setShowBackupsModal(false)}
          onRestored={(tableName, rowCount) => {
            dispatch({
              type: "ADD_MESSAGE",
              message: createMessage("assistant", `Restored table "${tableName}" (${rowCount} rows) from safety backup.`),
            });
          }}
        />
      )}
    </div>
  );
}

// ─── Suggested questions builder (Phase 5) ────────────────────────────────────

function _buildSuggestions(csvNames: string[], workbookNames: string[]): string[] {
  const allNames = [...csvNames, ...workbookNames];
  if (allNames.length === 0) return [];

  const first = allNames[0];
  return [
    `How many rows are in ${first}?`,
    `Show the first 10 rows of ${first}`,
    `What columns does ${first} have?`,
    `Show me totals grouped by category in ${first}`,
  ].slice(0, 4);
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <StoreProvider>
      <TaskPane />
    </StoreProvider>
  );
}
