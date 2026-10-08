# Excel AI SQL Assistant — implementation plan

An Excel add-in where you open a CSV (or use data already in the workbook), type a question in plain English into a chat box, and get a SQL query, a plain-English explanation of it, and the results — written back into Excel.

## 1. Scope

**In scope**

- Chat pop-up (task pane) that turns plain-English questions into SQL
- Load CSV files directly and query them with real SQL
- Also query sheets/tables already in the open workbook
- AI integration for text-to-SQL, query explanation, and error repair
- Results written to a new sheet, with the SQL kept visible and editable

**Out of scope for v1**

- Writing back to the original CSV file on disk
- Multi-user/collaboration features
- Databases other than the loaded CSV/workbook data

## 2. The five requirements, and how each is met

| # | Requirement | How |
| --- | --- | --- |
| 1 | SQL query generator | LLM generates SQL from the question + table schema |
| 2 | Works on CSV files directly | In-browser SQL engine (DuckDB-WASM) reads the CSV straight from a file picker, no import step |
| 3 | No SQL knowledge needed | Plain-English in, plain-English explanation out, results shown immediately; SQL is optional to view |
| 4 | AI integration | Claude API via a thin backend proxy (keeps the API key off the client) |
| 5 | Pop-up chat box | Office.js task pane chat UI (optionally a detachable dialog) |

## 3. Key decisions (and why)

| Decision | Choice | Reason |
| --- | --- | --- |
| Add-in type | **Office.js add-in** (TypeScript + React) | Works on Excel for Windows, Mac, and web. VSTO/COM would be Windows-only. |
| SQL engine | **DuckDB-WASM** | Reads CSV natively with type inference, handles large files, runs fully in the browser so data stays local. Fallback: sql.js or AlaSQL if WASM is a problem inside Excel's webview. |
| CSV access | `<input type="file">` in the task pane | Office.js add-ins are sandboxed and cannot open arbitrary disk paths, so the user picks the file (drag-and-drop works too). |
| AI | Claude API through a backend proxy | API key never ships to the client; lets you add rate limits and logging. |
| What goes to the AI | **Schema only** by default (table names, column names/types) | Privacy: row data stays on the user's machine. Sample rows are an opt-in setting. |
| Safety | **SELECT-only** execution | Generated SQL is validated before running. |

## 4. Architecture

```
┌──────────────────────── Excel (desktop / web / Mac) ────────────────────────┐
│                                                                              │
│   ┌────────────── Task pane (React + TypeScript) ──────────────┐            │
│   │  Chat UI  ──►  Orchestrator                                │            │
│   │                 │        │          │                       │            │
│   │                 ▼        ▼          ▼                       │            │
│   │          Data layer   SQL engine   AI client                │            │
│   │          (CSV picker, (DuckDB-WASM) (calls proxy)           │            │
│   │           workbook                      │                   │            │
│   │           reader)                       │                   │            │
│   │                 ▲                       │                   │            │
│   │                 └── Results writer ◄────┘                   │            │
│   │                     (Office.js → new sheet)                 │            │
│   └─────────────────────────────────────────────────────────────┘            │
└──────────────────────────────────────────┬───────────────────────────────────┘
                                           │ HTTPS (schema + question only)
                                           ▼
                                ┌─────────────────────┐
                                │ Backend proxy        │──► Claude API
                                │ (Azure Functions /   │
                                │  Cloudflare Worker)  │
                                └─────────────────────┘
```

**The core loop:** question → proxy → SQL + explanation → validate → run in DuckDB locally → preview → write to a sheet. If SQL errors, send the error back to the model once or twice to repair it.

## 5. Tech stack

- **Add-in:** Office.js, TypeScript, React, scaffolded with the Office Add-in generator (`yo office`)
- **SQL engine:** `@duckdb/duckdb-wasm`
- **SQL parsing/validation:** `node-sql-parser` (or run `EXPLAIN` in DuckDB to validate)
- **Backend proxy:** Azure Functions or a Cloudflare Worker (a few dozen lines)
- **AI:** Claude API, structured JSON output (`sql`, `explanation`, `assumptions`)
- **Testing:** Vitest (unit), Playwright (UI), manual sideload testing in Excel
- **Hosting:** the add-in's web assets on any HTTPS static host (Azure Static Web Apps, Netlify, Vercel)

## 6. Phased plan

### Phase 0 — Feasibility spike (2–3 days) — do this first

The riskiest assumption is that DuckDB-WASM runs inside Excel's embedded browser. Prove it before building anything else.

- [ ] Scaffold a bare Office add-in and sideload it into Excel (desktop *and* Excel on the web)
- [ ] Load DuckDB-WASM in the task pane, pick a CSV, run `SELECT count(*)`
- [ ] Write a query result into a new worksheet with `range.values`
- [ ] **Decision gate:** if DuckDB-WASM fails on a platform, switch to sql.js/AlaSQL (note: these handle smaller files)

### Phase 1 — Project scaffold (2–3 days)

- [ ] Repo structure (see section 11), TypeScript strict mode, ESLint/Prettier
- [ ] Task pane shell with React, a message list, and an input box
- [ ] Manifest configured with a ribbon button that opens the task pane
- [ ] CI: lint + unit tests on every push

### Phase 2 — Data layer (1 week)

- [ ] CSV loader: file picker + drag-and-drop, register the file with DuckDB (`registerFileText` or `registerFileBuffer`), create a table via `read_csv_auto`
- [ ] Schema extractor: `DESCRIBE <table>` → `{ table, columns: [{name, type}] }`
- [ ] Workbook reader: read a selected range/table via Office.js, register it in DuckDB as another table
- [ ] Multi-table support (e.g., two CSVs) with sanitized table names (`sales_2024.csv` → `sales_2024`)
- [ ] Handle messy CSVs: encoding, delimiters (comma/semicolon/tab), header detection, quoted newlines
- [ ] Size guard: warn above a threshold (e.g., 200 MB) and show load progress

### Phase 3 — SQL execution and validation (4–5 days)

- [ ] `runQuery(sql)` wrapper returning `{ columns, rows, rowCount, elapsedMs }`
- [ ] **SELECT-only guard:** parse the statement; reject anything that isn't a single `SELECT`/`WITH ... SELECT` (blocks `DROP`, `COPY`, `INSTALL`, `ATTACH`, file-reading functions on paths, multi-statements)
- [ ] Row limit on preview (e.g., 1,000 rows displayed; full result available on export)
- [ ] Query timeout / cancel button
- [ ] Unit tests for the guard with hostile inputs

### Phase 4 — AI integration (1 week)

- [ ] Backend proxy: accepts `{ question, schema, history, options }`, adds the system prompt, calls Claude, returns JSON; per-user rate limiting; never logs row data
- [ ] Prompt builder (see section 7)
- [ ] Structured response parsing with schema validation (reject malformed output and retry once)
- [ ] **Self-repair loop:** if DuckDB returns an error, send `{sql, error}` back for a corrected query (max 2 attempts)
- [ ] Conversation memory: follow-ups like "now only for 2024" or "sort that by revenue" reuse the previous SQL as context
- [ ] Clarifying questions: if the question is ambiguous (e.g., "revenue" matches two columns), the model asks instead of guessing

### Phase 5 — Chat UI (1 week)

- [ ] Message types: user question, assistant answer (explanation + collapsible SQL + result preview), error, clarification
- [ ] Loaded-tables panel showing file name, row count, columns with types
- [ ] Suggested starter questions generated from the schema ("Top 10 customers by total spend?")
- [ ] Streaming-style loading states, cancel, and retry
- [ ] Optional detach into a larger dialog via `Office.context.ui.displayDialogAsync` for people who want a bigger chat window
- [ ] Accessibility: keyboard navigation, screen-reader labels, high contrast

### Phase 6 — Making SQL optional for non-technical users (3–4 days)

- [ ] Plain-English explanation of every query ("Grouped orders by customer, summed the amount, kept the top 10")
- [ ] "Assumptions" line when the model made a choice ("Treated 'revenue' as `unit_price × quantity`")
- [ ] Editable SQL box for advanced users, with "Run edited SQL"
- [ ] "Explain this SQL" button for pasted/edited queries
- [ ] Query history with re-run and pin

### Phase 7 — Results and Excel integration (4–5 days)

- [ ] Write results to a new worksheet (named from the question, deduplicated), formatted as an Excel Table
- [ ] **Chunked writes** (e.g., 10k rows per batch) — Office.js limits payload size per call
- [ ] Type-aware formatting (dates, numbers, currency) so results are not all text
- [ ] Options: replace the last result sheet / append / copy to clipboard / download as CSV
- [ ] Optional: write the generated SQL into a cell note on the result sheet for traceability

### Phase 8 — Privacy, security, hardening (1 week)

- [ ] Settings: "Send sample values to AI" (default off), "Mask columns" (never send those column names)
- [ ] Clear in-UI disclosure of exactly what is sent to the AI
- [ ] Proxy: auth token per user/tenant, rate limit, request size cap, no persistent logging of content
- [ ] CSP review for the add-in; no API key anywhere in client code
- [ ] Prompt-injection check: text inside CSV cells is never sent to the model by default, and model output is only ever treated as a SELECT to be validated, never as instructions
- [ ] Error telemetry without data content

### Phase 9 — Testing and packaging (1 week)

- [ ] Test matrix: Excel for Windows, Mac, and web
- [ ] Text-to-SQL evaluation set (see section 9)
- [ ] Performance check: 1M-row CSV load time and query latency
- [ ] Deploy static assets over HTTPS; update manifest URLs
- [ ] Distribution: sideload for dev → shared network folder / Microsoft 365 admin center for teams → Microsoft AppSource for public release (AppSource has a validation process; budget extra time)

## 7. Text-to-SQL prompt design

**System prompt (skeleton)**

```
You translate questions into DuckDB SQL for the tables described below.
Rules:
- Output JSON only: {"sql": string, "explanation": string, "assumptions": string[], "clarification": string | null}
- Only write a single SELECT (or WITH ... SELECT). Never modify data.
- Use only tables and columns listed in the schema. Quote identifiers that contain spaces.
- If the question is ambiguous, set "clarification" and leave "sql" empty.
- "explanation" must be plain English for someone who does not know SQL.
```

**Per-request context:** the schema (tables, columns, types), optionally 3–5 sample values per column if the user opted in, the last few conversation turns, and (on retry) the failed SQL plus the DuckDB error message.

**Tips**

- Include DuckDB-specific hints (e.g., `strftime`, `date_trunc`, `ILIKE`) since models default to other dialects.
- Column names are often messy (`Cust Name`, `Rev $`) — pass them exactly and instruct the model to quote them.
- Keep the schema compact for wide CSVs (hundreds of columns): send only relevant columns, selected by a cheap name-matching step against the question.

## 8. Security and privacy summary

- Row data is processed **locally** in the browser; only the schema and the question go to the proxy by default
- API key lives only on the proxy
- All executed SQL passes the SELECT-only guard — AI output is untrusted input
- File-reading functions and extension loading are blocked in the guard
- Users can see exactly what was sent to the AI

## 9. Testing strategy

- **Unit:** SQL guard (hostile inputs), schema extraction, table-name sanitizing, chunked writer
- **Text-to-SQL evaluation set:** 40–60 questions over 3–4 sample CSVs with known-correct result sets. Score by **comparing result sets**, not SQL strings (many valid queries exist). Track accuracy per release so prompt changes can be measured.
- **CSV edge cases:** BOM, semicolon delimiters, ragged rows, duplicate headers, 1M rows, non-English characters
- **Integration:** full loop from question to rows written in a real workbook on each platform
- **Manual:** sideload on a clean machine, run through a first-time-user session

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| DuckDB-WASM doesn't run in some Excel webviews | Phase 0 spike on every platform; sql.js/AlaSQL fallback |
| Wrong SQL that looks plausible | Show the explanation + assumptions + preview; evaluation set; clarifying questions |
| Large results overwhelm Excel | Chunked writes, row cap with clear messaging |
| Users worry about data leaving their machine | Schema-only default, visible disclosure, optional masking |
| AI cost/latency | Compact schema, response caching for identical questions, rate limits on the proxy |
| AppSource rejection or delays | Start with sideload/admin deployment; treat AppSource as a later milestone |

## 11. Suggested repo structure

```
excel-sql-assistant/
├── manifest.xml                 # add-in manifest (or unified JSON manifest)
├── src/
│   ├── taskpane/
│   │   ├── App.tsx
│   │   ├── components/          # ChatMessage, ResultPreview, TablesPanel, SqlViewer
│   │   └── state/               # conversation + loaded tables
│   ├── data/
│   │   ├── csvLoader.ts
│   │   ├── workbookReader.ts
│   │   └── schema.ts
│   ├── sql/
│   │   ├── engine.ts            # DuckDB-WASM init + runQuery
│   │   └── guard.ts             # SELECT-only validation
│   ├── ai/
│   │   ├── client.ts            # calls the proxy
│   │   ├── prompt.ts
│   │   └── repairLoop.ts
│   └── excel/
│       └── resultsWriter.ts     # chunked writes, formatting
├── proxy/                       # Azure Function / Worker
├── eval/                        # sample CSVs + question/answer set + scorer
└── tests/
```

## 12. Timeline (solo, part-time)

| Weeks | Work |
| --- | --- |
| 1 | Phase 0 spike + Phase 1 scaffold |
| 2–3 | Phase 2 data layer + Phase 3 execution/guard |
| 3–4 | Phase 4 AI integration |
| 4–5 | Phase 5 chat UI + Phase 6 non-SQL-user features |
| 6 | Phase 7 Excel results + Phase 8 hardening |
| 7 | Phase 9 testing, packaging, deployment |
| 8 | Buffer, demo video, README |

## 13. Stretch goals

- Charts: "show this as a bar chart" → create an Excel chart from the result
- Saved/reusable queries and named parameters
- Joins across files with the model suggesting join keys
- Natural-language data cleaning suggestions (duplicates, nulls, type problems) based on column profiles
- Offline mode using a small local model for SQL generation
- Export the SQL as a Power Query / formula equivalent

## 14. Portfolio checklist

- [ ] Public repo with a README and an architecture diagram
- [ ] A 2-minute demo video: load a CSV, ask three questions, show the explanation and the result sheet
- [ ] Evaluation accuracy number from your question set in the README
- [ ] A short write-up of the trade-offs (local-first processing vs. server-side, WASM engine choice, SELECT-only guard)