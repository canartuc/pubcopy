/**
 * @module converter
 *
 * Main orchestrator for the Pubcopy conversion pipeline.
 *
 * Pipeline stages (executed in order):
 *
 * ```
 * Raw Markdown
 *   -> 1. resolveEmbeds     (inline ![[note]] content from vault)
 *   -> 2. preprocess         (strip frontmatter, tags, wikilinks, comments)
 *   -> 3. convertToHtml      (remark/rehype pipeline + Obsidian extensions)
 *   -> 4. processFootnotes   (platform-specific footnote rendering)
 *   -> 5. stripHtmlTags      (generate plain-text fallback for clipboard)
 * ```
 *
 * Each stage receives the output of the previous stage. Warnings are
 * accumulated across all stages in a shared {@link WarningCollector}.
 */

import type { App } from "obsidian";
import type { PubcopySettings } from "../settings";
import type { PlatformProfile } from "../platforms";
import { WarningCollector } from "../utils/errors";
import { preprocess } from "./preprocessor";
import { resolveEmbeds } from "./embed-resolver";
import { convertToHtml } from "./html-converter";
import { processFootnotes } from "./footnote-processor";

/** The complete result of converting a markdown note to platform-optimized HTML. */
export interface ConversionResult {
  /** Platform-optimized HTML ready for clipboard. */
  html: string;
  /** Plain-text fallback (HTML tags stripped) for the text/plain clipboard entry. */
  plainText: string;
  /** Approximate count of HTML elements in the output. */
  elementCount: number;
  /** Non-fatal warnings collected during conversion. */
  warnings: WarningCollector;
}

/**
 * Convert an Obsidian markdown note to platform-optimized HTML.
 *
 * This is the main entry point called by the plugin commands. It runs
 * the full 5-stage pipeline and returns both HTML and plain-text output.
 *
 * @param markdown - Raw markdown content (full note or selection).
 * @param profile - Target platform profile (Medium, Substack, or Markdown).
 * @param settings - User's plugin settings.
 * @param app - Obsidian App instance for vault and metadata access.
 * @returns Conversion result with HTML, plain text, element count, and warnings.
 */
export async function convert(
  markdown: string,
  profile: PlatformProfile,
  settings: PubcopySettings,
  app: App
): Promise<ConversionResult> {
  const warnings = new WarningCollector();

  // Stage 1: Resolve embeds (runs before preprocessing because it needs raw ![[]] syntax)
  let processed = await resolveEmbeds(markdown, app, warnings);

  // Stage 2: Preprocess (strip Obsidian-specific syntax)
  processed = preprocess(processed, settings);

  // Markdown output mode: return preprocessed markdown directly, skip HTML conversion
  if (profile.outputMode === "markdown") {
    return {
      html: "",
      plainText: processed,
      elementCount: 0,
      warnings,
    };
  }

  // Stage 3: Convert markdown to HTML (remark/rehype + Obsidian extensions)
  const { html, elementCount } = await convertToHtml(
    processed,
    profile,
    settings,
    app,
    warnings
  );

  // Stage 4: Process footnotes (platform-specific rendering)
  const finalHtml = processFootnotes(html, profile);

  // Stage 5: Generate plain text fallback for clipboard text/plain entry
  const plainText = stripHtmlTags(finalHtml);

  return {
    html: finalHtml,
    plainText,
    elementCount,
    warnings,
  };
}

/**
 * Strip HTML tags and decode entities to produce a plain-text version.
 *
 * Used as the `text/plain` clipboard entry so pasting into plain-text
 * editors produces readable content instead of raw HTML.
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
