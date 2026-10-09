# Excel AI SQL Assistant

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-61dafb.svg)](https://react.dev/)
[![DuckDB-WASM](https://img.shields.io/badge/DuckDB--WASM-1.29-FFF000.svg)](https://duckdb.org/docs/api/wasm/overview)
[![Office.js](https://img.shields.io/badge/Office.js-Excel-217346.svg)](https://learn.microsoft.com/en-us/office/dev/add-ins/excel/)
[![Deploy: Vercel](https://img.shields.io/badge/Deploy-Vercel-black.svg)](https://vercel.com/)

> **Turn plain-English questions into verified SQL queries, clear explanations, and formatted Excel sheets — entirely inside Excel, with zero raw data sent to external servers.**

An enterprise-ready **Office.js add-in** (React + TypeScript) powered by an in-browser **DuckDB-WASM** analytical engine and Claude AI via a lightweight proxy. Your CSV and sheet data stays 100% on your machine.

---

## Table of Contents

- [Key Highlights](#key-highlights)
- [Architecture & Data Flow](#architecture--data-flow)
- [Implementation Phases Status](#implementation-phases-status)
- [Feature Walkthrough](#feature-walkthrough)
- [Privacy & Security Boundary](#privacy--security-boundary)
- [Evaluation Benchmark Set (Phase 9)](#evaluation-benchmark-set-phase-9)
- [Prerequisites](#prerequisites)
- [Quick Start (Local Development)](#quick-start-local-development)
- [Production Deployment Guide](#production-deployment-guide)
  - [1. Backend Proxy (Cloudflare Worker)](#1-backend-proxy-cloudflare-worker)
  - [2. Frontend Task Pane (Vercel)](#2-frontend-task-pane-vercel)
  - [3. Manifest XML Configuration](#3-manifest-xml-configuration)
  - [4. Sideloading into Excel (Desktop & Web)](#4-sideloading-into-excel-desktop--web)
- [Environment Configuration](#environment-configuration)
- [Testing & Validation](#testing--validation)
- [Troubleshooting & Gotchas](#troubleshooting--gotchas)
- [License](#license)

---

## Key Highlights

- **🔒 Local-First Privacy (Zero Data Leakage)**: CSV rows and Excel cells are processed in WASM memory on your client. Only the sanitized schema (table and column names) and the plain-English question are sent to the AI.
- **⚡ In-Browser DuckDB-WASM**: High-performance analytical SQL engine running directly in the Excel task pane webview. Reads messy CSVs, handles large files, infers types, and executes complex analytical queries in milliseconds.
- **🛡️ SELECT-Only Safety Guard**: AI responses are treated as untrusted input. Multi-stage regex validation strips comments, blocks DDL/DML (`DROP`, `DELETE`, `INSERT`, `UPDATE`), halts multi-statement execution, and denies DuckDB file system functions (`read_csv`, `read_parquet`, `getenv`).
- **↺ Self-Repair Loop**: If a query fails in DuckDB, the error message and SQL are automatically sent back to the AI for self-correction (up to 2 retries) before notifying the user.
- **📊 Type-Aware Excel Results**: Writes results back into new Excel sheets in chunked batches (10,000 rows/batch) formatted as styled Excel Tables with auto-fitted columns, sortable date serials, formatted numbers, and frozen headers.
- **🎯 Traceable & Editable**: Generated SQL is embedded as an Excel cell note on `A1`. Non-technical users get plain-English explanations and assumption notes; advanced users can edit and re-run SQL directly.

---

## Architecture & Data Flow

```
┌───────────────────────── Microsoft Excel (Desktop / Web / Mac) ─────────────────────────┐
│                                                                                         │
│   ┌────────────────────────── Task Pane (React 18 + TypeScript) ─────────────────────┐  │
│   │                                                                                  │  │
│   │   💬 Chat UI  ──►  Orchestrator (App.tsx)                                        │  │
│   │                     │          │           │                                     │  │
│   │                     ▼          ▼           ▼                                     │  │
│   │               Data Layer   SQL Engine   AI Client                                │  │
│   │               (csvLoader,  (DuckDB-     (asks proxy via                          │  │
│   │                workbook     WASM)        fetch)                                  │  │
│   │                Reader)         │           │                                     │  │
│   │                     │          │           │                                     │  │
│   │                     │          ▼           │                                     │  │
│   │                     │    Safety Guard ◄────┘ (Validates AI SQL)                  │  │
│   │                     │          │                                                 │  │
│   │                     │          ▼                                                 │  │
│   │                     │    Query Runner ──► DuckDB Execution                       │  │
│   │                     │                       │                                    │  │
│   │                     ▼                       ▼                                    │  │
│   │               Results Writer (Phase 7: Chunked, formatted)                       │  │
│   │               └─────────────► Writes to active workbook                          │  │
│   └──────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │ HTTPS (Schema + Question ONLY)
                                           ▼
                               ┌─────────────────────────┐
                               │ Cloudflare Worker /     │
                               │ Azure Functions Proxy   │──► Claude 3.5 Sonnet API
                               │ (API key kept secret)   │
                               └─────────────────────────┘
```

---

## Implementation Phases Status

All 10 project phases from the original engineering specification are 100% complete and verified:

| Phase | Description | Status | Key Deliverables |
|:-----:|:------------|:------:|:-----------------|
| **0** | **Feasibility Spike** | ✅ Complete | DuckDB-WASM initialization inside Excel webview, `runQuery`, Office.js `range.values` write back. |
| **1** | **Project Scaffold** | ✅ Complete | React 18, TypeScript strict mode, Vite, design system tokens (`index.css`), ribbon manifest. |
| **2** | **Data Layer** | ✅ Complete | `loadCsvFile` via `read_csv_auto`, table name sanitization, `loadSelectedRange` & `loadExcelTable`. |
| **3** | **SQL Execution & Guard** | ✅ Complete | SELECT-only guard, comment stripping, multi-statement blocking, timeout race, cancel token. |
| **4** | **AI Integration & Self-Repair** | ✅ Complete | Claude API proxy payload builder, conversation memory (last 10 turns), `runWithRepair` loop (max 2 retries). |
| **5** | **Chat UI & Panels** | ✅ Complete | Navigation tabs (`Chat`, `History`, `Settings`), fine-grained loading statuses, cancellation button, suggested starter questions. |
| **6** | **Optional SQL for Non-Tech Users** | ✅ Complete | Plain-English explanations, assumption callouts, editable `SqlViewer` with "Run edited SQL" and "Explain this SQL", query history pin/re-run. |
| **7** | **Excel Integration & Exports** | ✅ Complete | Chunked 10k batch writes, type-aware formatting (Excel date serials, currency), write modes (`new`, `replace`, `append`), TSV clipboard, CSV download, SQL traceability cell note. |
| **8** | **Privacy, Security & Hardening** | ✅ Complete | Sensitive column masking, opt-in sample values collector, proxy bearer auth token, COOP/COEP CSP compliance, privacy-safe zero-leakage telemetry. |
| **9** | **Testing, Eval & Packaging** | ✅ Complete | 40-case text-to-SQL evaluation benchmark suite with 100% guard pass rate, Vitest test suite, manifest icons, `commands.html`. |

---

## Feature Walkthrough

### 1. Dual Data Sources
- **Pick or Drag-and-Drop CSV**: Click **📂 CSV** to select any `.csv`, `.tsv`, or `.txt` file. DuckDB reads the buffer natively with automated delimiter, header, and encoding detection.
- **Excel Ranges & Tables**: Select any tabular range in your worksheet and click **📋 Range** to register it as a DuckDB table.

### 2. Conversational Text-to-SQL & Direct SQL Execution
- **Ask Natural Language Questions**:
  - *"What was our total revenue in Q1 2024?"*
  - *"Show the top 5 customers by order count."*
  - *"Which products have stock below their reorder point?"*
  - Follow-up naturally: *"Now filter that for the East region"* (conversation context preserves prior queries).
- **Run Custom SQL Directly**:
  - Simply type any SQL query starting with `SELECT`, `WITH`, `DESCRIBE`, `EXPLAIN`, or `SHOW` directly in the chat input.
  - The engine recognizes SQL statements automatically, executes them directly in DuckDB-WASM, and presents the formatted results in seconds without passing through the AI.

### 3. AI Providers & Key Configuration (⚙️ Settings Tab)
- **Anthropic Claude (Direct from Browser)**: Enter your Anthropic API key (`sk-ant-...`) in **⚙️ Settings → AI Model & Connection**. The key is stored safely in your local browser (`localStorage`) and never shared.
- **Model Selection**: Switch easily between Claude 3.5 Sonnet (`claude-3-5-sonnet-20241022`), Claude 3.5 Haiku, and Claude 3 Opus.
- **Custom Proxy**: Enterprise deployments can route requests through a Cloudflare Worker or Azure Function proxy.
- **Offline Mock Mode**: Simulate queries without API keys for testing or offline demonstrations.

### 4. Clear Explanations & Assumptions
- Non-technical users see plain-English explanations first: *"Groups orders by region and sums revenue, returning the top 5."*
- Model assumptions are highlighted: *"Treated 'net_sales' as revenue minus discounts."*
- Ambiguous questions prompt clarifications rather than erroneous guesses.

### 5. Interactive SQL Viewer (`SqlViewer.tsx`)
- Syntax-highlighted collapsible SQL code block.
- **Edit Mode**: Modify SQL syntax directly in the task pane.
- **Run Edited SQL**: Executes user-modified queries through the safety guard.
- **Explain This SQL**: Asks the AI to explain pasted or custom SQL in plain English.
- **Copy**: One-click clipboard copy.

### 6. Multi-Mode Results Export (`ExportMenu.tsx`)
- **New Sheet**: Creates a clean, uniquely named worksheet.
- **Replace Existing**: Overwrites the previous query result sheet.
- **Append**: Appends incremental records to an existing sheet.
- **Copy TSV**: Pastes directly into any spreadsheet or document.
- **Download CSV**: Downloads a clean UTF-8 CSV with BOM for universal compatibility.

---

## Privacy & Security Boundary

Enterprise data governance is built into the architecture:

| Security Domain | Implementation |
|:---|:---|
| **Raw Data Privacy** | Row values never leave the client. All SQL execution happens in WASM. |
| **Column Masking** | Columns listed under Settings (e.g. `ssn`, `salary`, `card_number`) are stripped from schemas before AI prompts are constructed. |
| **Sample Values Opt-In** | 3–5 representative sample values per column are only sent if the user explicitly toggles on *"Send sample values to AI"*. |
| **SQL Safety Guard** | Multi-layer regex blocks all `DROP`, `DELETE`, `INSERT`, `UPDATE`, `ALTER`, `TRUNCATE`, `ATTACH`, `LOAD`, `INSTALL`, `PRAGMA`, comments (`--`, `/* */`), and DuckDB file functions (`read_csv`, `read_parquet`, `getenv`). |
| **API Key Protection** | The Claude API key is stored exclusively in the backend proxy secrets, never embedded in the client bundle. |
| **Add-in Isolation** | Strict Content-Security-Policy (CSP) with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers. |
| **Telemetry** | Pure zero-leakage telemetry: tracks event types, latencies, and row-count buckets (`<100`, `100-1k`, `1k-10k`, `10k+`). Never records queries, table names, or data. |

---

## Evaluation Benchmark Set (Phase 9)

Located in [`eval/evalSet.ts`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/eval/evalSet.ts), this benchmark verifies 40 text-to-SQL tasks over 3 sample datasets ([`sales.csv`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/eval/datasets/sales.csv), [`employees.csv`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/eval/datasets/employees.csv), [`inventory.csv`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/eval/datasets/inventory.csv)):

| Category | Test Cases | Description | Guard Pass Rate |
|:---|:---:|:---|:---:|
| **Aggregations** | 10 | `SUM`, `AVG`, `COUNT(*)`, `COUNT(DISTINCT)`, `MIN`, `MAX` | **100%** |
| **Filtering** | 11 | Numerical comparisons, dates, `ILIKE`, compound `AND`/`OR`, `BETWEEN` | **100%** |
| **Grouping & HAVING** | 9 | `GROUP BY`, multi-column aggregates, `HAVING` filters | **100%** |
| **Sorting & Top-N** | 4 | `ORDER BY DESC LIMIT N`, single highest/lowest values | **100%** |
| **Window Functions** | 2 | `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)`, CTE ranking | **100%** |
| **Mathematical Ops** | 4 | Unit cost × stock level, discount arithmetic, string concatenation | **100%** |
| **Total** | **40** | **Comprehensive text-to-SQL benchmark suite** | **100%** |

Run the evaluation suite at any time:
```bash
npm run eval
```

---

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **Microsoft Excel**:
  - Excel for Microsoft 365 (Windows or Mac)
  - Or Excel on the Web (Office 365 account)

---

## Quick Start (Local Development)

### 1. Clone & Install
```bash
git clone https://github.com/yourusername/excel-sql-assistant.git
cd excel-sql-assistant
npm install
```

### 2. Configure Environment
Copy the example configuration:
```bash
cp .env.example .env.local
```
*(By default, `VITE_MOCK_AI=true` runs offline mock mode without needing a Claude API key).*

### 3. Start Development Server
```bash
npm run dev
```
The Vite server starts with COOP/COEP headers enabled at `https://localhost:3000`.

### 4. Sideload into Excel
See [Sideloading into Excel](#4-sideloading-into-excel-desktop--web) below.

---

## Production Deployment Guide

### 1. Backend Proxy (Cloudflare Worker)

The proxy code resides in [`proxy/`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/proxy/).

1. Navigate to the proxy directory:
   ```bash
   cd proxy
   npm install -g wrangler
   ```
2. Configure your secret Anthropic API key:
   ```bash
   wrangler secret put ANTHROPIC_API_KEY
   ```
3. (Optional) Set an authentication bearer token for your organization:
   ```bash
   wrangler secret put PROXY_AUTH_TOKEN
   ```
4. Update `ALLOWED_ORIGINS` in [`proxy/wrangler.toml`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/proxy/wrangler.toml) with your frontend Vercel URL.
5. Deploy:
   ```bash
   wrangler deploy
   ```
   Note your worker URL: `https://excel-sql-proxy.<your-subdomain>.workers.dev`.

### 2. Frontend Task Pane (Vercel)

1. Deploy the frontend repository to Vercel:
   ```bash
   npm install -g vercel
   vercel
   ```
2. In your Vercel Project Settings, add the environment variables:
   - `VITE_PROXY_URL`: `https://excel-sql-proxy.<your-subdomain>.workers.dev`
   - `VITE_PROXY_AUTH_TOKEN`: `<your-secret-proxy-auth-token>` (if enabled)
   - `VITE_MOCK_AI`: `false`
3. [`vercel.json`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/vercel.json) automatically enforces `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on all routes.
4. Deploy production build:
   ```bash
   vercel --prod
   ```

### 3. Manifest XML Configuration

Open [`manifest.xml`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/manifest.xml) and replace `https://excel-sql-assistant.vercel.app` with your deployed Vercel domain across:
- `<AppDomain>`
- `<SourceLocation>`
- `<bt:Url id="Taskpane.Url">`
- `<bt:Url id="Commands.Url">`
- Icon URL references

### 4. Sideloading into Excel (Desktop & Web)

#### Excel on the Web (Recommended for quick testing)
1. Open [Excel Online](https://www.office.com/launch/excel) and create a blank workbook.
2. In the ribbon, select **Insert → Add-ins → My Add-ins**.
3. Click **Upload My Add-in** in the top-right corner.
4. Browse to and select [`manifest.xml`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/manifest.xml).
5. The **SQL Assistant** button will appear under the **Home** tab!

#### Excel for Windows (Desktop)
1. Share a folder containing `manifest.xml` on your local network (e.g. `\\localhost\OfficeAddins`).
2. In Excel, go to **File → Options → Trust Center → Trust Center Settings → Trusted Add-in Catalogs**.
3. Add the network path and check **Show in Menu**.
4. Restart Excel → **Insert → My Add-ins → Shared Folder → SQL Assistant**.

---

## Environment Configuration

| Variable | Description | Default |
|:---|:---|:---:|
| `VITE_PROXY_URL` | Deployed backend proxy endpoint URL | `/api/ask` |
| `VITE_PROXY_AUTH_TOKEN` | Optional secret bearer token for tenant authentication | `undefined` |
| `VITE_MOCK_AI` | When set to `"true"`, uses simulated AI for local offline testing | `"true"` |

---

## Testing & Validation

The codebase includes comprehensive unit and integration tests across data loading, prompt generation, SQL safety guards, results serialization, and evaluation:

```bash
# Run all Vitest unit & integration tests
npm test

# Run TypeScript strict typecheck across all files
npm run typecheck

# Run the 40-case text-to-SQL benchmark evaluation suite
npm run eval

# Build production bundle
npm run build
```

### Test Suite Structure
- [`tests/guard.test.ts`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/tests/guard.test.ts): 20+ hostile attack vectors (SQL injection, DDL, DML, file access, comment obfuscation).
- [`tests/data.test.ts`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/tests/data.test.ts): Table name sanitization, schema generation, and column masking.
- [`tests/prompt.test.ts`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/tests/prompt.test.ts): System prompt compliance, self-repair payloads, compact schemas.
- [`tests/resultsWriter.test.ts`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/tests/resultsWriter.test.ts): Sheet naming, deduplication, column letter calculation, CSV/TSV escaping.
- [`tests/telemetry.test.ts`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/tests/telemetry.test.ts): Event tracking, buffering, and row count bucketing.
- [`tests/eval.test.ts`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/tests/eval.test.ts): 40 benchmark text-to-SQL queries validated against DuckDB safety rules.

---

## Troubleshooting & Gotchas

### 1. `SharedArrayBuffer` / DuckDB-WASM fails to load
- **Cause**: DuckDB-WASM uses WebAssembly threads which require cross-origin isolation.
- **Fix**: Ensure your host serves the following HTTP headers (configured in `vercel.json` and `vite.config.ts`):
  ```http
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```

### 2. Office.js not defined when testing in a standard web browser
- **Fix**: [`src/taskpane/index.tsx`](file:///c:/Users/Admin/Desktop/SQL%20query%20generator/excel-sql-assistant/src/taskpane/index.tsx) includes an automatic fallback check. If `Office.onReady` is absent, the React app mounts immediately so you can test in Chrome/Edge without launching Excel.

### 3. Excel Online Add-in upload error
- **Cause**: Manifest ID conflict or non-HTTPS URLs.
- **Fix**: All URLs in `manifest.xml` must use `https://`. If reloading, generate a new `<Id>` GUID in `manifest.xml`.

---

## License

MIT License. Feel free to use and adapt this project for personal and commercial applications.
