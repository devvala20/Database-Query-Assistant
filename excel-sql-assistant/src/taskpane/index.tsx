/**
 * index.tsx — Task pane entry point
 *
 * Waits for Office.js to signal readiness, then mounts the React app.
 * Gracefully mounts in standalone browser environments (e.g. Vite dev / preview).
 */

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

function mount(): void {
  const container = document.getElementById("root");
  if (!container) throw new Error("Root element not found");
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// Office.js fires Office.onReady when the host application is ready.
// In standalone browser mode, mount immediately.
if (typeof Office !== "undefined" && typeof Office.onReady === "function") {
  Office.onReady(() => {
    mount();
  });
} else {
  mount();
}
