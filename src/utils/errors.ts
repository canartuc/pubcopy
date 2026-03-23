/**
 * @module errors
 *
 * Error handling primitives for the Pubcopy conversion pipeline.
 *
 * Two classes serve different purposes:
 * - {@link PubcopyError}: Fatal errors that abort the conversion (e.g., clipboard write failure).
 * - {@link WarningCollector}: Non-fatal issues collected during conversion (e.g., missing image,
 *   unsupported embed type). Warnings don't stop the pipeline; they're gathered and optionally
 *   surfaced after the copy completes.
 */

/**
 * Fatal error thrown when a conversion step cannot recover.
 *
 * Carries structured context so the UI can show a meaningful message
 * instead of a generic stack trace.
 *
 * @example
 * ```ts
 * throw new PubcopyError("clipboard", "system", "Permission denied");
 * // Message: "[Pubcopy] clipboard in system: Permission denied"
 * ```
 */
export class PubcopyError extends Error {
  /** The type of element that caused the failure (e.g., "image", "clipboard", "embed"). */
  elementType: string;
  /** The file or resource path involved (e.g., "photo.png", "system"). */
  filePath: string;
  /** Human-readable explanation of what went wrong. */
  reason: string;

  constructor(elementType: string, filePath: string, reason: string) {
    super(`[Pubcopy] ${elementType} in ${filePath}: ${reason}`);
    this.name = "PubcopyError";
    this.elementType = elementType;
    this.filePath = filePath;
    this.reason = reason;
  }
}

/**
 * A single non-fatal warning produced during conversion.
 *
 * Warnings represent elements that were skipped or degraded
 * (e.g., an audio embed removed, a missing image replaced with a URL fallback).
 */
export interface ConversionWarning {
  /** Category of the skipped element (e.g., "audio", "video", "pdf", "image", "mermaid"). */
  elementType: string;
  /** The specific file or resource that triggered the warning. */
  fileName: string;
  /** Human-readable explanation. */
  reason: string;
}

/**
 * Accumulates non-fatal warnings during a single conversion run.
 *
 * Each call to {@link convert} creates a fresh collector. Converter modules
 * call {@link add} when they skip or degrade an element. After conversion,
 * the collected warnings can be inspected or displayed.
 *
 * @example
 * ```ts
 * const warnings = new WarningCollector();
 * warnings.add("audio", "podcast.mp3", "Audio embeds not supported");
 * warnings.hasWarnings(); // true
 * warnings.getWarnings(); // [{ elementType: "audio", fileName: "podcast.mp3", ... }]
 * ```
 */
export class WarningCollector {
  private warnings: ConversionWarning[] = [];

  /** Record a non-fatal warning. Does not throw or interrupt processing. */
  add(elementType: string, fileName: string, reason: string): void {
    this.warnings.push({ elementType, fileName, reason });
  }

  /** Return a shallow copy of all collected warnings. */
  getWarnings(): ConversionWarning[] {
    return [...this.warnings];
  }

  /** Check whether any warnings were recorded. */
  hasWarnings(): boolean {
    return this.warnings.length > 0;
  }

  /** Discard all collected warnings. */
  clear(): void {
    this.warnings = [];
  }
}
