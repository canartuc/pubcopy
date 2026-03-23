/**
 * @module notifications
 *
 * Thin wrappers around Obsidian's {@link Notice} API for user-facing feedback.
 *
 * Design decisions:
 * - Success notification is short and dismisses automatically.
 * - Warning notifications are intentionally silent. Users reported that
 *   listing skipped elements (mermaid, audio, etc.) felt like debug output.
 *   Warnings are still collected in {@link WarningCollector} for programmatic access.
 */

import { Notice } from "obsidian";
import type { ConversionWarning } from "./errors";

/**
 * Show a brief success notice after a successful copy.
 *
 * @param platform - The target platform name ("Medium" or "Substack").
 * @param enabled - Whether the notification setting is turned on. If false, does nothing.
 */
export function showSuccess(
  platform: string,
  enabled: boolean
): void {
  if (!enabled) return;
  new Notice(`Pubcopy: Copied for ${platform}`);
}

/**
 * Placeholder for warning display. Currently intentionally silent.
 *
 * Warnings are collected during conversion but not shown to the user
 * to avoid intrusive debug-like popups. This function exists so the
 * call site in main.ts stays consistent if we add optional verbose
 * logging in the future.
 *
 * @param _warnings - Collected warnings (unused).
 * @param _enabled - Notification setting (unused).
 */
export function showWarnings(
  _warnings: ConversionWarning[],
  _enabled: boolean
): void {
  // Intentionally silent. Warnings are collected but not displayed.
}
