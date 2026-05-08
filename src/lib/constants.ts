/**
 * Shared UI / timing constants for ClaudeTerminal.
 *
 * Magic numbers that were previously scattered across components and store
 * modules belong here. Add a brief comment explaining the unit and rationale
 * for each constant so future readers don't have to guess.
 *
 * Migration status (Issue #72 / Issue #65):
 *   - terminalStore.ts   — PENDING (deferred to follow-up, see Issue #65)
 *   - App.tsx            — PENDING (deferred to follow-up, see Issue #65)
 *   - CommandPalette.tsx — PENDING (deferred to follow-up, see Issue #65)
 *
 * Once those files are updated to import from here, remove the corresponding
 * inline literals and this migration note.
 */

// ── Terminal output buffer ───────────────────────────────────────────────────

/** Maximum number of lines retained in the in-memory scrollback context buffer.
 *  768 lines keeps recent context for summarisation without exceeding typical
 *  LLM prompt-size budgets. */
export const CONTEXT_BUF_SIZE = 768;

// ── Timing ───────────────────────────────────────────────────────────────────

/** Five minutes in milliseconds — used as the heartbeat / idle-check interval. */
export const FIVE_MIN_MS = 5 * 60 * 1_000;

/** Auto-save interval in milliseconds (30 seconds). */
export const AUTO_SAVE_INTERVAL_MS = 30_000;

// ── List caps ────────────────────────────────────────────────────────────────

/** Maximum number of recent sessions shown in the session picker. */
export const RECENT_SESSIONS_CAP = 10;
