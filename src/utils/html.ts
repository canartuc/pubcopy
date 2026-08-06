/**
 * @module utils/html
 *
 * Shared HTML utility functions used across converter modules.
 */

/**
 * Escape HTML special characters to prevent XSS.
 *
 * Replaces `&`, `<`, `>`, and `"` with their HTML entity equivalents.
 * Used at every point where user-controlled content is injected into HTML output.
 *
 * @param str - Raw string to escape.
 * @returns HTML-safe string.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Named HTML entities decoded in plain-text output. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decode HTML character references in a single pass. */
function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos|nbsp));/g,
    (_m, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
      return NAMED_ENTITIES[named ?? ""] ?? _m;
    }
  );
}

/**
 * Skip past one tag starting at `start` (which points at "<"), returning the
 * index just after its ">".
 *
 * Quoted attribute values are skipped wholesale, because a serializer only
 * escapes quotes and ampersands there — an attribute may legitimately hold a
 * literal ">" that does not end the tag.
 */
function endOfTag(html: string, start: number): number {
  let quote = "";
  for (let i = start + 1; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i + 1;
    }
  }
  return html.length;
}

/**
 * Strip HTML tags and decode entities to produce a plain-text version.
 *
 * Used as the `text/plain` clipboard entry so pasting into plain-text
 * editors produces readable content instead of raw HTML.
 *
 * Inside a table, cells are joined with " | " and rows end with a newline;
 * breaks within a cell (`<br>`, paragraph and list-item ends) collapse to a
 * space so a row always stays on one line, and the whitespace that authored
 * HTML puts between table tags is discarded.
 *
 * This scans tag by tag rather than running a chain of replacements: tags
 * must be recognized with their quoted attribute values skipped, so markup
 * inside an attribute (an `alt` of `</table>`, say) is never mistaken for
 * structure. Entities are decoded in a SINGLE pass at the end so sequences
 * like `&amp;lt;` (the literal text "&lt;") are never double-decoded, and
 * numeric references use `String.fromCodePoint` so astral-plane characters
 * (e.g. emoji) survive intact.
 */
export function stripHtmlTags(html: string): string {
  let out = "";
  let tableDepth = 0;
  let inCell = false;
  // Set once a cell closes, so the NEXT cell in the same row is separated
  // (and the last cell of a row is left without a trailing separator).
  let cellPending = false;
  let index = 0;

  // Cell content often ends with a collapsed break; drop it so separators and
  // line ends sit flush against the text.
  const trimTrailingSpaces = (): void => {
    out = out.replace(/[^\S\n]+$/, "");
  };

  while (index < html.length) {
    const next = html.indexOf("<", index);
    if (next === -1) {
      out += html.slice(index);
      break;
    }

    const text = html.slice(index, next);
    // Whitespace between table tags is layout, not content
    if (text && !(tableDepth > 0 && !inCell && !text.trim())) out += text;

    const tagEnd = endOfTag(html, next);
    const tag = html.slice(next, tagEnd);
    const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(tag);
    index = tagEnd;
    if (!match) {
      // Not a tag (stray "<", comment, doctype): keep comments out of output
      if (!tag.startsWith("<!")) out += tag;
      continue;
    }

    const closing = match[1] === "/";
    const name = match[2].toLowerCase();

    if (name === "table") {
      if (closing) {
        tableDepth = Math.max(0, tableDepth - 1);
        cellPending = false;
        trimTrailingSpaces();
        out += "\n";
      } else {
        tableDepth++;
      }
      continue;
    }

    if (name === "th" || name === "td") {
      if (closing) {
        inCell = false;
        cellPending = true;
      } else {
        inCell = true;
        if (cellPending) {
          trimTrailingSpaces();
          out += " | ";
          cellPending = false;
        }
      }
      continue;
    }

    if (name === "tr") {
      if (closing) {
        cellPending = false;
        trimTrailingSpaces();
        out += "\n";
      }
      continue;
    }

    // Cell content must stay on one line, so breaks collapse to a space there
    const inTable = tableDepth > 0;
    if (name === "br") out += inTable ? " " : "\n";
    else if (name === "hr") out += inTable ? " " : "\n---\n";
    else if (closing && (name === "p" || /^h[1-6]$/.test(name))) out += inTable ? " " : "\n\n";
    else if (closing && name === "li") out += inTable ? " " : "\n";
  }

  return decodeEntities(out)
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
