/**
 * useStore.ts — Global state (upgraded for Phases 5 & 6)
 *
 * Adds:
 *   - queryHistory: pinnable, re-runnable past queries
 *   - cancelToken: active cancel token for in-flight queries
 *   - settings: user preferences (sample values opt-in, masked columns)
 *   - loadingMessage: fine-grained loading status text
 */

import {
  createContext,
  useContext,
  useReducer,
  createElement,
  type ReactNode,
  type Dispatch,
} from "react";
import type { LoadedTable } from "../../data/csvLoader";
import type { WorkbookTableInfo } from "../../data/workbookReader";
import type { CancelToken } from "../../sql/runner";
import type { QueryResult } from "../../sql/engine";

// ─── Message types ────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "error" | "system" | "clarification";

export interface AssistantPayload {
  sql: string;
  explanation: string;
  assumptions: string[];
  resultSheetName?: string;
  rowCount?: number;
  fullRowCount?: number;
  elapsedMs?: number;
  truncated?: boolean;
  attemptsUsed?: number;
  /** Cached full result for re-export (Phase 7). */
  resultData?: QueryResult;
}

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  timestamp: number;
  payload?: AssistantPayload;
}

// ─── Query history entry ──────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  question: string;
  sql: string;
  explanation: string;
  timestamp: number;
  pinned: boolean;
  sheetName?: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  /** Send sample values to AI (privacy opt-in) */
  sendSampleValues: boolean;
  /** Column names to never send to AI */
  maskedColumns: string[];
  /** Query result preview limit */
  previewLimit: number;
  /** Query timeout in ms */
  timeoutMs: number;
  /** Default write mode for result sheets */
  defaultWriteMode: "new" | "replace" | "append";
  /** AI Provider / mode */
  aiProvider: "anthropic" | "proxy" | "mock";
  /** Anthropic Claude API Key (sk-ant-...) */
  apiKey: string;
  /** Custom proxy URL (e.g. Cloudflare Worker or Azure Function) */
  proxyUrl: string;
  /** Optional proxy bearer token */
  proxyToken: string;
  /** Claude model name */
  modelName: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  sendSampleValues: false,
  maskedColumns: [],
  previewLimit: 1000,
  timeoutMs: 30_000,
  defaultWriteMode: "new",
  aiProvider: "anthropic",
  apiKey: "",
  proxyUrl: "",
  proxyToken: "",
  modelName: "claude-3-5-sonnet-20241022",
};

function loadSavedSettings(): AppSettings {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("excel_sql_settings") : null;
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

// ─── State shape ──────────────────────────────────────────────────────────────

export interface AppState {
  messages: Message[];
  csvTables: LoadedTable[];
  workbookTables: WorkbookTableInfo[];
  isLoading: boolean;
  /** Fine-grained loading status for UI */
  loadingMessage: string;
  engineStatus: "idle" | "initialising" | "ready" | "error";
  engineError?: string;
  queryHistory: HistoryEntry[];
  /** Currently active cancel token (set when a query is running) */
  activeCancelToken: CancelToken | null;
  settings: AppSettings;
  /** Currently active panel: chat | history | settings */
  activePanel: "chat" | "history" | "settings";
}

const initialState: AppState = {
  messages: [],
  csvTables: [],
  workbookTables: [],
  isLoading: false,
  loadingMessage: "",
  engineStatus: "idle",
  queryHistory: [],
  activeCancelToken: null,
  settings: loadSavedSettings(),
  activePanel: "chat",
};

// ─── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | { type: "ADD_MESSAGE"; message: Message }
  | { type: "SET_LOADING"; loading: boolean; message?: string }
  | { type: "SET_ENGINE_STATUS"; status: AppState["engineStatus"]; error?: string }
  | { type: "ADD_CSV_TABLE"; table: LoadedTable }
  | { type: "REMOVE_CSV_TABLE"; tableName: string }
  | { type: "ADD_WORKBOOK_TABLE"; table: WorkbookTableInfo }
  | { type: "REMOVE_WORKBOOK_TABLE"; tableName: string }
  | { type: "ADD_HISTORY"; entry: HistoryEntry }
  | { type: "PIN_HISTORY"; id: string }
  | { type: "REMOVE_HISTORY"; id: string }
  | { type: "SET_CANCEL_TOKEN"; token: CancelToken | null }
  | { type: "UPDATE_SETTINGS"; settings: Partial<AppSettings> }
  | { type: "SET_ACTIVE_PANEL"; panel: AppState["activePanel"] }
  | { type: "CLEAR_MESSAGES" };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };
    case "CLEAR_MESSAGES":
      return { ...state, messages: [] };
    case "SET_LOADING":
      return {
        ...state,
        isLoading: action.loading,
        loadingMessage: action.message ?? "",
      };
    case "SET_ENGINE_STATUS":
      return {
        ...state,
        engineStatus: action.status,
        engineError: action.error,
      };
    case "ADD_CSV_TABLE":
      return { ...state, csvTables: [...state.csvTables, action.table] };
    case "REMOVE_CSV_TABLE":
      return {
        ...state,
        csvTables: state.csvTables.filter((t) => t.tableName !== action.tableName),
      };
    case "ADD_WORKBOOK_TABLE":
      return { ...state, workbookTables: [...state.workbookTables, action.table] };
    case "REMOVE_WORKBOOK_TABLE":
      return {
        ...state,
        workbookTables: state.workbookTables.filter(
          (t) => t.tableName !== action.tableName
        ),
      };
    case "ADD_HISTORY": {
      // Keep max 50 history entries (pinned ones are never removed)
      const existing = state.queryHistory.filter((e) => e.pinned);
      const unpinned = state.queryHistory
        .filter((e) => !e.pinned)
        .slice(0, 49 - existing.length);
      return {
        ...state,
        queryHistory: [action.entry, ...existing, ...unpinned],
      };
    }
    case "PIN_HISTORY":
      return {
        ...state,
        queryHistory: state.queryHistory.map((e) =>
          e.id === action.id ? { ...e, pinned: !e.pinned } : e
        ),
      };
    case "REMOVE_HISTORY":
      return {
        ...state,
        queryHistory: state.queryHistory.filter((e) => e.id !== action.id),
      };
    case "SET_CANCEL_TOKEN":
      return { ...state, activeCancelToken: action.token };
    case "UPDATE_SETTINGS": {
      const nextSettings = { ...state.settings, ...action.settings };
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("excel_sql_settings", JSON.stringify(nextSettings));
        }
      } catch {}
      return { ...state, settings: nextSettings };
    }
    case "SET_ACTIVE_PANEL":
      return { ...state, activePanel: action.panel };
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface StoreContextValue {
  state: AppState;
  dispatch: Dispatch<Action>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return createElement(
    StoreContext.Provider,
    { value: { state, dispatch } },
    children
  );
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}

// ─── Action creators ──────────────────────────────────────────────────────────

let _msgId = 0;
export function createMessage(
  role: MessageRole,
  text: string,
  payload?: AssistantPayload
): Message {
  return { id: `msg-${++_msgId}`, role, text, timestamp: Date.now(), payload };
}

let _histId = 0;
export function createHistoryEntry(
  question: string,
  sql: string,
  explanation: string,
  sheetName?: string
): HistoryEntry {
  return {
    id: `hist-${++_histId}`,
    question,
    sql,
    explanation,
    timestamp: Date.now(),
    pinned: false,
    sheetName,
  };
}
