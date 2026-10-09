/**
 * SettingsPanel.tsx — Phase 5, 6 & 8: User settings
 *
 * Configures:
 *   - 🤖 AI Connection: Provider (Anthropic Claude / Proxy / Mock), API Key, Model
 *   - 🔒 Privacy: "Send sample values to AI" (opt-in), Masked columns
 *   - ⚙️ Query: Preview limit, Query timeout, Sheet write mode
 *   - 🗑️ Clear chat & query history
 */

import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useStore, type AppSettings } from "../state/useStore";
import "./SettingsPanel.css";

export default function SettingsPanel() {
  const { state, dispatch } = useStore();
  const { settings } = state;
  const [maskInput, setMaskInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  function updateSetting<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
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

      {/* ── 1. AI Connection section ────────────────────────────────────────── */}
      <section className="settings-panel__section">
        <h3 className="settings-panel__section-title">🤖 AI Model & Connection</h3>

        <div className="settings-panel__field">
          <label className="settings-panel__label" htmlFor="ai-provider-select">
            AI Provider
          </label>
          <select
            id="ai-provider-select"
            className="settings-panel__select"
            value={settings.aiProvider}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              updateSetting("aiProvider", e.target.value as AppSettings["aiProvider"])
            }
          >
            <option value="anthropic">Anthropic Claude (Direct from Browser)</option>
            <option value="proxy">Custom Backend Proxy (Cloudflare / Azure)</option>
            <option value="mock">Offline Mock Mode (Simulation)</option>
          </select>
          <span className="settings-panel__hint">
            {settings.aiProvider === "anthropic"
              ? "Calls Claude directly from your browser using your Anthropic API key."
              : settings.aiProvider === "proxy"
              ? "Routes requests through a secure proxy server."
              : "Generates offline simulated queries without calling any external API."}
          </span>
        </div>

        {settings.aiProvider === "anthropic" && (
          <>
            <div className="settings-panel__field">
              <label className="settings-panel__label" htmlFor="anthropic-key-input">
                Anthropic API Key
              </label>
              <div className="settings-panel__mask-input-row">
                <input
                  id="anthropic-key-input"
                  type={showApiKey ? "text" : "password"}
                  className="settings-panel__text-input"
                  value={settings.apiKey}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    updateSetting("apiKey", e.target.value.trim())
                  }
                  placeholder="sk-ant-api03-..."
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="settings-panel__toggle-key-btn"
                  onClick={() => setShowApiKey(!showApiKey)}
                  title={showApiKey ? "Hide API key" : "Show API key"}
                  aria-label={showApiKey ? "Hide API key" : "Show API key"}
                >
                  {showApiKey ? "🙈" : "👁️"}
                </button>
              </div>
              <span className="settings-panel__hint">
                🔒 Key is stored locally in your browser (localStorage) and only sent directly to api.anthropic.com.
              </span>
            </div>

            <div className="settings-panel__field">
              <label className="settings-panel__label" htmlFor="anthropic-model-select">
                Claude Model
              </label>
              <select
                id="anthropic-model-select"
                className="settings-panel__select"
                value={settings.modelName}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  updateSetting("modelName", e.target.value)
                }
              >
                <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet (Recommended - highest SQL accuracy)</option>
                <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku (Fast & low latency)</option>
                <option value="claude-3-opus-20240229">Claude 3 Opus (Deep reasoning)</option>
              </select>
            </div>
          </>
        )}

        {settings.aiProvider === "proxy" && (
          <>
            <div className="settings-panel__field">
              <label className="settings-panel__label" htmlFor="proxy-url-input">
                Proxy Endpoint URL
              </label>
              <input
                id="proxy-url-input"
                type="url"
                className="settings-panel__text-input"
                value={settings.proxyUrl}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  updateSetting("proxyUrl", e.target.value.trim())
                }
                placeholder="https://sql-proxy.workers.dev/query"
                spellCheck={false}
              />
              <span className="settings-panel__hint">
                URL of your deployed Cloudflare Worker or Azure Function.
              </span>
            </div>

            <div className="settings-panel__field">
              <label className="settings-panel__label" htmlFor="proxy-token-input">
                Proxy Authorization Token (Optional)
              </label>
              <input
                id="proxy-token-input"
                type="password"
                className="settings-panel__text-input"
                value={settings.proxyToken}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  updateSetting("proxyToken", e.target.value.trim())
                }
                placeholder="Bearer token (optional)"
                spellCheck={false}
              />
            </div>
          </>
        )}

        {/* Live status badge */}
        <div
          className={`settings-panel__status-badge settings-panel__status-badge--${
            settings.aiProvider === "mock"
              ? "mock"
              : settings.aiProvider === "anthropic"
              ? settings.apiKey ? "ready" : "warning"
              : settings.proxyUrl ? "ready" : "warning"
          }`}
          role="status"
        >
          {settings.aiProvider === "mock" && (
            <span>⚪ <strong>Mock Mode Active:</strong> Returning canned offline queries without calling external APIs.</span>
          )}
          {settings.aiProvider === "anthropic" && settings.apiKey && (
            <span>🟢 <strong>Ready:</strong> Live Claude calls configured with model <em>{settings.modelName}</em>.</span>
          )}
          {settings.aiProvider === "anthropic" && !settings.apiKey && (
            <span>🟡 <strong>API Key Needed:</strong> Enter your Anthropic key above. Until configured, mock fallback is used.</span>
          )}
          {settings.aiProvider === "proxy" && settings.proxyUrl && (
            <span>🟢 <strong>Ready:</strong> Requests routed to <em>{settings.proxyUrl}</em>.</span>
          )}
          {settings.aiProvider === "proxy" && !settings.proxyUrl && (
            <span>🟡 <strong>Proxy URL Needed:</strong> Enter your proxy URL above.</span>
          )}
        </div>
      </section>

      {/* ── 2. Privacy section ─────────────────────────────────────────────── */}
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

      {/* ── 3. Query & Excel settings ──────────────────────────────────────── */}
      <section className="settings-panel__section">
        <h3 className="settings-panel__section-title">⚙️ Query & Excel Export</h3>

        <div className="settings-panel__field">
          <label className="settings-panel__label" htmlFor="write-mode-select">
            Default Excel Write Mode
          </label>
          <select
            id="write-mode-select"
            className="settings-panel__select"
            value={settings.defaultWriteMode}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              updateSetting("defaultWriteMode", e.target.value as AppSettings["defaultWriteMode"])
            }
          >
            <option value="new">Create new sheet per query (Default)</option>
            <option value="replace">Replace last result sheet</option>
            <option value="append">Append rows to active sheet</option>
          </select>
        </div>

        <div className="settings-panel__field">
          <label className="settings-panel__label" htmlFor="preview-limit-input">
            Preview row limit
          </label>
          <span className="settings-panel__hint">
            Max rows shown in chat preview. Full results are always written to Excel.
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

      {/* ── 4. Clear data section ─────────────────────────────────────────── */}
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

      {/* ── 5. Privacy disclosure ─────────────────────────────────────────── */}
      <section className="settings-panel__section settings-panel__disclosure">
        <h3 className="settings-panel__section-title">ℹ️ What is sent to AI</h3>
        <ul className="settings-panel__disclosure-list">
          <li>✅ Table names and column names / types (schema)</li>
          <li>✅ Your question text or query prompt</li>
          <li>✅ Sample values per column <em>(only if opted in above)</em></li>
          <li>❌ Row data is <strong>never</strong> sent — queries execute locally in DuckDB-WASM</li>
          <li>❌ Masked columns are excluded even from the schema</li>
          <li>🔒 API keys are stored only in your local browser storage</li>
        </ul>
      </section>
    </div>
  );
}
