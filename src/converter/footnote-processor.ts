/**
 * @module converter/footnote-processor
 *
 * Post-processes footnotes in the converted HTML based on the target platform.
 *
 * Two strategies:
 *
 * **Substack (`native`)**: Passes HTML through unchanged. Substack's editor
 * handles footnote markup natively.
 *
 * **Medium (`superscript-endnotes`)**: Medium has no native footnote support.
 * This processor:
 * 1. Extracts footnote definitions (`[^id]: content`) from the HTML.
 * 2. Replaces footnote references (`[^id]`) with superscript numbers.
 * 3. Handles inline footnotes (`^[text]`) with auto-numbering.
 * 4. Appends a "Notes" section with an ordered list at the end.
 *
 * Security: All footnote content is escaped via {@link escapeHtml} before
 * injection into the output HTML to prevent XSS.
 *
 * ReDoS mitigation: Inline footnote content regex is capped at 500 characters.
 */

import type { PlatformProfile } from "../platforms";
import { escapeHtml } from "../utils/html";

/** Internal representation of a parsed footnote. */
interface Footnote {
  /** Original identifier from the source (e.g., "1", "note-a", "inline-3"). */
  id: string;
  /** Sequential number assigned during processing (1-based). */
  number: number;
  /** The footnote body text, already HTML-escaped. */
  content: string;
}

/**
 * Process footnotes in the converted HTML according to the platform's strategy.
 *
 * @param html - The HTML output from the remark/rehype pipeline.
 * @param profile - The target platform profile (determines footnote strategy).
 * @returns Modified HTML with footnotes processed per platform rules.
 */
export function processFootnotes(
  html: string,
  profile: PlatformProfile
): string {
  if (profile.footnoteStrategy === "native") {
    return html;
  }

  // remark-gfm parses standard [^id] footnotes before this processor runs,
  // so they arrive as anchor-based GFM markup. Convert that first; the
  // legacy regex path below handles inline ^[text] footnotes (which GFM
  // does not parse) and any pre-GFM-style markup.
  let result = convertGfmFootnotes(html);

  const footnotes: Footnote[] = [];
  let counter = 0;

  // Extract footnote definitions: <p>[^id]: content</p>
  result = result.replace(
    /<p>\[\^(\w+)\]:\s*([\s\S]*?)<\/p>/g,
    (_match, id: string, content: string) => {
      counter++;
      footnotes.push({ id, number: counter, content: escapeHtml(content.trim()) });
      return "";
    }
  );

  // Replace footnote references with superscript numbers
  for (const fn of footnotes) {
    const refPattern = new RegExp(
      `\\[\\^${escapeRegex(fn.id)}\\](?!:)`,
      "g"
    );
    result = result.replace(
      refPattern,
      `<sup>${fn.number}</sup>`
    );
  }

  // Handle inline footnotes ^[text] (capped at 500 chars to prevent ReDoS)
  result = result.replace(
    /\^\[([^\]]{1,500})\]/g,
    (_match, content: string) => {
      counter++;
      footnotes.push({ id: `inline-${counter}`, number: counter, content: escapeHtml(content) });
      return `<sup>${counter}</sup>`;
    }
  );

  // Append endnotes section if footnotes were found
  if (footnotes.length > 0) {
    result += "\n<hr>\n<h2>Notes</h2>\n<ol>\n";
    for (const fn of footnotes) {
      result += `<li>${fn.content}</li>\n`;
    }
    result += "</ol>\n";
  }

  return result;
}

/** Escape regex metacharacters in a string for safe use in `new RegExp()`. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert GFM-rendered footnote markup (post-sanitize) into Medium-friendly
 * superscript references and a "Notes" endnotes section.
 *
 * After remark-gfm + rehype-sanitize, standard `[^id]` footnotes look like:
 * - references: `<sup><a href="#user-content-fn-id">N</a></sup>`
 * - section: `<h2>Footnotes</h2><ol><li><p>content
 *   <a href="#user-content-fnref-id">↩</a></p></li>...</ol>`
 *
 * Medium has no anchor support on paste, so the anchors are dead weight:
 * references become plain `<sup>N</sup>`, back-reference arrows are removed,
 * and the heading is renamed to "Notes" behind an `<hr>` separator.
 */
function convertGfmFootnotes(html: string): string {
  let result = html;
  const hasGfmSection = result.includes("<h2>Footnotes</h2>");

  // References -> plain superscript numbers
  result = result.replace(
    /<sup><a href="#user-content-fn-[^"]*">([^<]+)<\/a><\/sup>/g,
    "<sup>$1</sup>"
  );

  // Back-reference arrows (optionally with a counter <sup>N</sup> when a
  // footnote is referenced multiple times), including a leading space
  result = result.replace(
    / ?<a href="#user-content-fnref-[^"]*">↩(?:<sup>\d+<\/sup>)?<\/a>/g,
    ""
  );

  // Rename the endnotes heading to match the legacy format
  if (hasGfmSection) {
    result = result.replace("<h2>Footnotes</h2>", "<hr>\n<h2>Notes</h2>");
  }

  return result;
}

