/**
 * repairLoop.ts — Phase 4: Self-repair loop
 *
 * If DuckDB returns an error, send the failed SQL + error back to the model
 * to get a corrected query. Max 2 attempts (configurable).
 *
 * The orchestrator in App.tsx calls this instead of askAi() directly.
 */

import { askAi, type AiRequest, type AiResponse } from "./client";
import { safeRunQuery, type SafeQueryResult, QueryGuardError, QueryCancelledError } from "../sql/runner";
import { isMutationQuery } from "../sql/guard";
import { createTableSnapshot } from "../data/backupManager";

export const MAX_REPAIR_ATTEMPTS = 2;

export interface RepairLoopResult {
  response: AiResponse;
  result: SafeQueryResult;
  attemptsUsed: number;
}

export class MaxRepairAttemptsError extends Error {
  constructor(
    public lastSql: string,
    public lastError: string,
    public attempts: number
  ) {
    super(
      `Query could not be fixed after ${attempts} attempt(s). Last error: ${lastError}`
    );
    this.name = "MaxRepairAttemptsError";
  }
}

/**
 * Run the AI → guard → execute loop with automatic self-repair on SQL errors.
 * Prompts user confirmation and preserves safety snapshots if mutation is detected.
 */
export async function runWithRepair(
  request: AiRequest,
  onAttempt?: (attempt: number, sql: string) => void,
  onConfirmMutation?: (sql: string, mutationType: string, targetTable?: string) => Promise<boolean>
): Promise<RepairLoopResult> {
  // Initial AI call
  let response = await askAi(request);
  let attemptsUsed = 0;

  // If the model asked a clarifying question, return immediately
  if (response.clarification || !response.sql) {
    // Return a dummy result — caller must check response.clarification
    return {
      response,
      result: _emptyResult(),
      attemptsUsed: 0,
    };
  }

  // Attempt loop
  let lastSql = response.sql;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS + 1; attempt++) {
    attemptsUsed = attempt;
    onAttempt?.(attempt, lastSql);

    // If mutation, ask confirmation and snapshot table before execution
    const mutation = isMutationQuery(lastSql);
    if (mutation.isMutation) {
      if (onConfirmMutation) {
        const confirmed = await onConfirmMutation(
          lastSql,
          mutation.type || "MODIFICATION",
          mutation.targetTable
        );
        if (!confirmed) {
          throw new QueryCancelledError();
        }
      }
      if (mutation.targetTable) {
        await createTableSnapshot(mutation.targetTable, mutation.type || "MUTATION", lastSql);
      }
    }

    try {
      const result = await safeRunQuery(lastSql);
      return { response, result, attemptsUsed };
    } catch (err) {
      // Guard errors are not retried — the AI generated fundamentally unsafe SQL
      if (err instanceof QueryGuardError) {
        throw err;
      }

      const errorMessage = err instanceof Error ? err.message : String(err);
      lastError = errorMessage;

      // No more repair attempts left
      if (attempt > MAX_REPAIR_ATTEMPTS) {
        throw new MaxRepairAttemptsError(lastSql, errorMessage, attemptsUsed);
      }

      // Ask the AI to repair the query
      const repairRequest: AiRequest = {
        ...request,
        previousSql: lastSql,
        errorMessage,
      };
      response = await askAi(repairRequest);

      if (!response.sql || response.clarification) {
        // AI gave up and asked for clarification instead
        return { response, result: _emptyResult(), attemptsUsed };
      }

      lastSql = response.sql;
    }
  }

  // Should never reach here due to the loop structure above
  throw new MaxRepairAttemptsError(lastSql, lastError, attemptsUsed);
}

function _emptyResult(): SafeQueryResult {
  return {
    columns: [],
    rows: [],
    rowCount: 0,
    fullRowCount: 0,
    elapsedMs: 0,
    truncated: false,
  };
}
