/**
 * SettingsPanel.tsx — Phase 5 & 8: User settings
 *
 * Privacy-first settings:
 *   - "Send sample values to AI" — default OFF
 *   - Masked columns — column names never sent to AI
 *   - Preview row limit
 *   - Query timeout
 *   - Clear chat / clear history
 */

import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useStore } from "../state/useStore";
import "./SettingsPanel.css";

export default function SettingsPanel() {
  const { state, dispatch } = useStore();
  const { settings } = state;
  const [maskInput, setMaskInput] = useState("");

  function updateSetting<K extends keyof typeof settings>(
    key: K,
    value: (typeof settings)[K]
  ) {
    dispatch({ type: "UPDATE_SETTINGS", settings: { [key]: value } });
  }

  function addMaskedColumn() {
    const col = maskInput.trim();
    if (col && !settings.maskedColumns.includes(col)) {
      updateSetting("maskedColumns", [...settings.maskedColumns, col]);
    }
    setMaskInput("");
  }

  function removeMaskedColumn(col: string) {
    updateSetting(
      "maskedColumns",
      settings.maskedColumns.filter((c) => c !== col)
    );
  }

  function handleClearChat() {
    dispatch({ type: "CLEAR_MESSAGES" });
  }

  function handleClearHistory() {
    state.queryHistory.forEach((e) =>
      dispatch({ type: "REMOVE_HISTORY", id: e.id })
    );
  }

  return (
    <div className="settings-panel">
      <h2 className="settings-panel__title">Settings</h2>

      {/* Privacy section */}
      <section className="settings-panel__section">
        <h3 className="settings-panel__section-title">🔒 Privacy</h3>

        <label className="settings-panel__toggle-row">
          <div className="settings-panel__toggle-text">
            <span className="settings-panel__label">Send sample values to AI</span>
            <span className="settings-panel__hint">
              Sends 3–5 example values per column to improve SQL accuracy. Off by default.
            </span>
          </div>
          <input
            id="setting-sample-values"
            type="checkbox"
            className="settings-panel__checkbox"
            checked={settings.sendSampleValues}
            onChange={(e: ChangeEvent<HTMLInputElement>) => updateSetting("sendSampleValues", e.target.checked)}
            aria-describedby="sample-values-hint"
          />
        </label>

        <div className="settings-panel__field">
          <label className="settings-panel__label" htmlFor="mask-col-input">
            Masked columns (never sent to AI)
          </label>
          <span className="settings-panel__hint" id="mask-col-hint">
            Column names listed here are excluded from AI requests.
          </span>
          <div className="settings-panel__mask-input-row">
            <input
              id="mask-col-input"
              type="text"
              className="settings-panel__text-input"
              value={maskInput}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setMaskInput(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && addMaskedColumn()}
              placeholder="e.g. ssn, credit_card"
              aria-describedby="mask-col-hint"
            />
            <button
              className="settings-panel__add-btn"
              onClick={addMaskedColumn}
              disabled={!maskInput.trim()}
              aria-label="Add masked column"
            >
              Add
            </button>
          </div>
          {settings.maskedColumns.length > 0 && (
            <ul className="settings-panel__masked-list" role="list">
              {settings.maskedColumns.map((col) => (
                <li key={col} className="settings-panel__masked-chip">
                  <span>{col}</span>
                  <button
                    className="settings-panel__masked-remove"
                    onClick={() => removeMaskedColumn(col)}
                    aria-label={`Remove ${col} from masked columns`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Query settings */}
      <section className="settings-panel__section">
        <h3 className="settings-panel__section-title">⚙️ Query</h3>

        <div className="settings-panel__field">
          <label className="settings-panel__label" htmlFor="preview-limit-input">
            Preview row limit
          </label>
          <span className="settings-panel__hint">
            Max rows shown in results preview. Full results are always written to Excel.
          </span>
          <input
            id="preview-limit-input"
            type="number"
            min={10}
            max={10000}
            step={100}
            className="settings-panel__number-input"
            value={settings.previewLimit}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateSetting("previewLimit", Math.max(10, parseInt(e.target.value, 10) || 1000))
            }
            aria-label="Preview row limit"
          />
        </div>

        <div className="settings-panel__field">
          <label className="settings-panel__label" htmlFor="timeout-input">
            Query timeout (seconds)
          </label>
          <input
            id="timeout-input"
            type="number"
            min={5}
            max={300}
            step={5}
            className="settings-panel__number-input"
            value={Math.round(settings.timeoutMs / 1000)}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateSetting(
                "timeoutMs",
                Math.max(5000, parseInt(e.target.value, 10) * 1000 || 30000)
              )
            }
            aria-label="Query timeout in seconds"
          />
        </div>
      </section>

      {/* Data section */}
      <section className="settings-panel__section">
        <h3 className="settings-panel__section-title">🗑️ Clear Data</h3>

        <div className="settings-panel__button-row">
          <button
            className="settings-panel__danger-btn"
            onClick={handleClearChat}
            aria-label="Clear chat messages"
          >
            Clear chat messages
          </button>
          <button
            className="settings-panel__danger-btn"
            onClick={handleClearHistory}
            aria-label="Clear query history"
          >
            Clear query history
          </button>
        </div>
      </section>

      {/* What is sent to AI — disclosure */}
      <section className="settings-panel__section settings-panel__disclosure">
        <h3 className="settings-panel__section-title">ℹ️ What is sent to AI</h3>
        <ul className="settings-panel__disclosure-list">
          <li>✅ Table names and column names / types (schema)</li>
          <li>✅ Your question text</li>
          <li>✅ Sample values per column <em>(if opted in above)</em></li>
          <li>❌ Row data is <strong>never</strong> sent — it stays in your browser</li>
          <li>❌ Masked columns are excluded even from the schema</li>
        </ul>
      </section>
    </div>
  );
}
