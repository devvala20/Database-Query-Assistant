/**
 * ChatInput.tsx — Message input box at the bottom of the task pane
 */

import { useState, useRef, type KeyboardEvent, type ChangeEvent } from "react";
import "./ChatInput.css";

interface Props {
  onSend: (question: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function ChatInput({ onSend, disabled, placeholder }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  return (
    <div className="chat-input">
      <textarea
        id="chat-input-textarea"
        ref={textareaRef}
        className="chat-input__textarea"
        value={value}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder={placeholder ?? "Ask a question about your data…"}
        disabled={disabled}
        rows={1}
        aria-label="Type your question"
        aria-multiline="true"
      />
      <button
        id="chat-send-btn"
        className="chat-input__send"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        aria-label="Send question"
        title="Send (Enter)"
      >
        {disabled ? (
          <span className="animate-spin" aria-hidden="true">⟳</span>
        ) : (
          <span aria-hidden="true">↑</span>
        )}
      </button>
    </div>
  );
}
