/**
 * @module converter/protected-ranges
 *
 * Shared detection of "protected" character ranges in markdown text:
 * fenced code blocks (``` or ~~~) and inline code spans (`...`).
 *
 * Transformations that strip or rewrite Obsidian syntax must skip these
 * ranges so code examples containing Obsidian-like syntax survive intact.
 *
 * Every replace helper here recomputes ranges on its own input, so callers
 * can chain length-changing replacements without stale-offset bugs.
 */

/** A character range [start, end] in the source text that must not be modified. */
export interface ProtectedRange {
  start: number;
  end: number;
}

/** Matches a code fence marker line (``` or ~~~, possibly longer). */
const FENCE_LINE = /^(`{3,}|~{3,}).*$/gm;

/**
 * Matches an inline code span on a single line. The content must not start
 * or end with a backtick (per CommonMark), and the closing run must match
 * the opening run's length.
 */
const INLINE_CODE = /(`+)([^`\n](?:[^\n]*?[^`\n])?)\1(?!`)/g;

/**
 * Scan the text for fenced code blocks and inline code spans.
 *
 * Fences: opening/closing markers must use the same character and the
 * closing fence must be at least as long as the opening one. An unclosed
 * fence extends to the end of the text (matching Obsidian's behavior).
 *
 * Inline code spans are only collected outside fence ranges.
 */
export function findProtectedRanges(text: string): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];

  const fenceRegex = new RegExp(FENCE_LINE.source, "gm");
  let openFence: { marker: string; start: number } | null = null;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    const marker = match[1];
    if (openFence === null) {
      openFence = { marker, start: match.index };
    } else if (
      marker[0] === openFence.marker[0] &&
      marker.length >= openFence.marker.length
    ) {
      ranges.push({ start: openFence.start, end: match.index + match[0].length });
      openFence = null;
    }
  }
  if (openFence !== null) {
    ranges.push({ start: openFence.start, end: text.length });
  }

  const inlineRegex = new RegExp(INLINE_CODE.source, "g");
  while ((match = inlineRegex.exec(text)) !== null) {
    const start = match.index;
    if (!isProtected(start, ranges)) {
      ranges.push({ start, end: start + match[0].length });
    }
  }

  return ranges;
}

/** Check whether a character position falls inside any protected range. */
export function isProtected(pos: number, ranges: ProtectedRange[]): boolean {
  return ranges.some((r) => pos >= r.start && pos <= r.end);
}

/**
 * Run a regex replacement but skip matches inside protected ranges.
 *
 * Ranges are computed fresh from `text` on every call, so chained
 * length-changing replacements stay correct.
 *
 * The match offset is located by type (first numeric replacer argument)
 * rather than position, which stays correct with named groups.
 */
export function replaceOutsideProtected(
  text: string,
  pattern: RegExp,
  replacement: string | ((match: string, ...args: string[]) => string)
): string {
  const ranges = findProtectedRanges(text);
  return text.replace(pattern, (match: string, ...args: unknown[]) => {
    const offsetIndex = args.findIndex((a): a is number => typeof a === "number");
    const offset = args[offsetIndex] as number;
    if (isProtected(offset, ranges)) {
      return match;
    }
    if (typeof replacement === "function") {
      const captures = args.slice(0, offsetIndex) as string[];
      return replacement(match, ...captures);
    }
    return replacement;
  });
}

/**
 * Replace all matches outside protected ranges using an async replacer,
 * rebuilding the string from slices in a single pass.
 *
 * Offset-based rebuilding (rather than repeated `String.replace`) means
 * duplicate matches are each replaced exactly once, and replacement output
 * containing the original pattern is never re-matched.
 *
 * @param text - Input text.
 * @param pattern - Global regex to match.
 * @param replacer - Async (or sync) function receiving the full match array.
 * @param ranges - Optional precomputed ranges for `text`; computed if omitted.
 */
export async function replaceAsyncOutsideProtected(
  text: string,
  pattern: RegExp,
  replacer: (match: RegExpMatchArray) => Promise<string> | string,
  ranges?: ProtectedRange[]
): Promise<string> {
  const protectedRanges = ranges ?? findProtectedRanges(text);
  let result = "";
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (isProtected(index, protectedRanges)) continue;
    result += text.slice(last, index) + (await replacer(match));
    last = index + match[0].length;
  }
  return result + text.slice(last);
}
