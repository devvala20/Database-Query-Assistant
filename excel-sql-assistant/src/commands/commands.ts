/**
 * commands.ts — Office ribbon function file entry point
 *
 * Handles ribbon button actions defined in manifest.xml.
 */

/* global Office */

if (typeof Office !== "undefined" && typeof Office.onReady === "function") {
  Office.onReady(() => {
    console.log("[Commands] Office ribbon commands initialized");
  });
}

/**
 * Shows the task pane when the ribbon command button is clicked.
 */
export function action(event: Office.AddinCommands.Event): void {
  // Office handles showing the task pane via <Action xsi:type="ShowTaskpane">
  // but if executed as an executeFunction, complete the event.
  event.completed();
}

// Associate named function with Office
if (typeof Office !== "undefined" && (Office as any).actions) {
  (Office as any).actions.associate("action", action);
}
