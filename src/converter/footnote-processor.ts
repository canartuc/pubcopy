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

  const footnotes: Footnote[] = [];
  let counter = 0;

  // Extract footnote definitions: <p>[^id]: content</p>
  let result = html.replace(
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

