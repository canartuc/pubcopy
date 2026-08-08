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
  new Notice(`Copied for ${platform}.`);
}

/**
 * Warn that Obsidian should be restarted after the plugin was updated.
 *
 * Replacing a plugin's files in place does not always retire the build that
 * is already running. A half-swapped plugin can register its menus and report
 * success while copying nothing, which is indistinguishable from a broken
 * release. This notice fires once per version change and stays up long enough
 * to read.
 *
 * @param previous - Version that was running before this load.
 * @param current - Version now on disk.
 */
export function showUpdateRestartNotice(previous: string, current: string): void {
  new Notice(
    `Pubcopy updated from ${previous} to ${current}. Restart Obsidian, or disable and re-enable the plugin, before copying. Until then copying may do nothing.`,
    15000
  );
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
