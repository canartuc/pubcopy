import { Notice } from "obsidian";
import type { ConversionWarning } from "./errors";

export function showSuccess(
  platform: string,
  enabled: boolean
): void {
  if (!enabled) return;
  new Notice(`Pubcopy: Copied for ${platform}`);
}

export function showWarnings(
  _warnings: ConversionWarning[],
  _enabled: boolean
): void {
  // Intentionally silent. Warnings are collected but not displayed.
}
