/**
 * ChatMessage.tsx — Phase 5 & 6 upgrade
 *
 * Uses SqlViewer for collapsible/editable SQL.
 * Shows truncation warnings, retry count, and assumption callouts.
 */

import type { Key } from "react";
import type { Message } from "../state/useStore";
import SqlViewer from "./SqlViewer";
import ExportMenu from "./ExportMenu";
import "./ChatMessage.css";

interface Props {
  key?: Key | string | number;
  message: Message;
  onRunSql?: (sql: string) => void;
  onExplainSql?: (sql: string) => void;
}

export default function ChatMessage({ message, onRunSql, onExplainSql }: Props) {
  const isUser = message.role === "user";
  const isError = message.role === "error";
  const isSystem = message.role === "system";
  const isClarification = message.role === "clarification";

  const avatar = isUser
    ? "👤"
    : isError
    ? "⚠️"
    : isSystem
    ? "⚙️"
    : isClarification
    ? "❓"
    : "🤖";

  return (
    <div
      className={`chat-message chat-message--${message.role} animate-fade-in`}
      role={isError ? "alert" : undefined}
    >
      <div className="chat-message__avatar" aria-hidden="true">
        {avatar}
      </div>

      <div className="chat-message__body">
        {/* Main explanation text */}
        <p className="chat-message__text">{message.text}</p>

        {message.payload && (
          <div className="chat-message__payload">
            {/* Assumptions (Phase 6) */}
            {message.payload.assumptions.length > 0 && (
              <div className="chat-message__assumptions">
                <span className="chat-message__assumptions-label">Assumptions:</span>
                <ul>
                  {message.payload.assumptions.map((a, i) => (
                    <li key={i} className="chat-message__assumption">
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Result summary badge + export menu */}
            {message.payload.resultSheetName && (
              <div className="chat-message__result-badge">
                <span className="chat-message__result-icon">✅</span>
                <div className="chat-message__result-info">
                  <span>
                    Written to sheet{" "}
                    <strong>{message.payload.resultSheetName}</strong>
                  </span>
                  <div className="chat-message__result-meta">
                    {message.payload.rowCount !== undefined && (
                      <span>
                        {message.payload.rowCount.toLocaleString()} rows
                        {message.payload.truncated && (
                          <span className="chat-message__truncation-warning">
                            {" "}(preview limited —{" "}
                            {message.payload.fullRowCount?.toLocaleString()} total)
                          </span>
                        )}
                      </span>
                    )}
                    {message.payload.elapsedMs !== undefined && (
                      <span>{message.payload.elapsedMs}ms</span>
                    )}
                    {message.payload.attemptsUsed !== undefined &&
                      message.payload.attemptsUsed > 1 && (
                        <span className="chat-message__repair-badge">
                          ↺ Fixed in {message.payload.attemptsUsed} attempts
                        </span>
                      )}
                  </div>
                </div>

                {/* Phase 7: Export menu */}
                {message.payload.resultData && (
                  <ExportMenu
                    result={message.payload.resultData}
                    sql={message.payload.sql}
                    question={message.text}
                    currentSheetName={message.payload.resultSheetName ?? ""}
                  />
                )}
              </div>
            )}

            {/* SQL Viewer (Phase 6) */}
            {message.payload.sql && (
              <SqlViewer
                sql={message.payload.sql}
                onRunSql={onRunSql}
                onExplainSql={onExplainSql}
              />
            )}
          </div>
        )}

        <span className="chat-message__time">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}
