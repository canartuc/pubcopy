import type { App } from "obsidian";
import type { PubcopySettings } from "../settings";
import type { PlatformProfile } from "../platforms";
import { WarningCollector } from "../utils/errors";
import { preprocess } from "./preprocessor";
import { resolveEmbeds } from "./embed-resolver";
import { convertToHtml } from "./html-converter";
import { processFootnotes } from "./footnote-processor";

export interface ConversionResult {
  html: string;
  plainText: string;
  elementCount: number;
  warnings: WarningCollector;
}

export async function convert(
  markdown: string,
  profile: PlatformProfile,
  settings: PubcopySettings,
  app: App
): Promise<ConversionResult> {
  const warnings = new WarningCollector();

  // Step 1: Resolve embeds (before preprocessing, needs raw embed syntax)
  let processed = await resolveEmbeds(markdown, app, warnings);

  // Step 2: Preprocess (strip frontmatter, tags, wikilinks, etc.)
  processed = preprocess(processed, settings);

  // Step 3: Convert markdown to HTML
  const { html, elementCount } = await convertToHtml(
    processed,
    profile,
    settings,
    app,
    warnings
  );

  // Step 4: Process footnotes (platform-specific)
  const finalHtml = processFootnotes(html, profile);

  // Step 5: Generate plain text fallback
  const plainText = stripHtmlTags(finalHtml);

  return {
    html: finalHtml,
    plainText,
    elementCount,
    warnings,
  };
}

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
