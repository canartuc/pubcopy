/**
 * @module converter/preprocessor
 *
 * First stage of the conversion pipeline. Runs regex-based transformations
 * on raw markdown BEFORE it reaches the remark parser.
 *
 * Responsibilities:
 * - Strip YAML frontmatter
 * - Strip Obsidian comments (`%%...%%`)
 * - Strip HTML comments (`<!-- -->`)
 * - Strip block IDs (`^block-id`)
 * - Strip tags (`#tag`, `#tag/subtag`)
 * - Convert wikilinks to plain text (`[[page]]` -> `page`, `[[page|alias]]` -> `alias`)
 * - Strip Obsidian URI links (`obsidian://...`)
 * - Normalize excessive blank lines
 *
 * All transformations skip content inside code fences to avoid breaking
 * code examples that contain Obsidian-like syntax.
 */

import type { PubcopySettings } from "../settings";

/** Represents a character range in the source text that's inside a code fence. */
interface CodeFenceRange {
  start: number;
  end: number;
}

/**
 * Scan the text for fenced code blocks (``` or ~~~) and return their positions.
 *
 * Used to protect code block content from being modified by preprocessing regexes.
 * Handles variable-length fence markers and ensures opening/closing markers match
 * (same character, closing fence at least as long as opening).
 */
function findCodeFences(text: string): CodeFenceRange[] {
  const ranges: CodeFenceRange[] = [];
  const regex = /^(`{3,}|~{3,}).*$/gm;
  let openFence: { marker: string; start: number } | null = null;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const marker = match[1];
    if (openFence === null) {
      openFence = { marker, start: match.index };
    } else if (marker[0] === openFence.marker[0] && marker.length >= openFence.marker.length) {
      ranges.push({ start: openFence.start, end: match.index + match[0].length });
      openFence = null;
    }
  }
  return ranges;
}

/** Check whether a character position falls inside any known code fence. */
function isInsideCodeFence(pos: number, ranges: CodeFenceRange[]): boolean {
  return ranges.some((r) => pos >= r.start && pos <= r.end);
}

/**
 * Run a regex replacement but skip matches that fall inside code fences.
 *
 * Uses the match offset (second-to-last argument in the replacer) to check
 * whether the match is protected. If inside a fence, returns the original match.
 */
function replaceOutsideCodeFences(
  text: string,
  pattern: RegExp,
  replacement: string | ((match: string, ...args: string[]) => string),
  codeFences: CodeFenceRange[]
): string {
  return text.replace(pattern, (match, ...args) => {
    const offset = args[args.length - 2] as number;
    if (isInsideCodeFence(offset, codeFences)) {
      return match;
    }
    if (typeof replacement === "function") {
      return replacement(match, ...args);
    }
    return replacement;
  });
}

/**
 * Preprocess raw Obsidian markdown into clean standard markdown.
 *
 * This is the first step in the conversion pipeline. The output is standard
 * markdown that the remark parser can handle without Obsidian-specific extensions.
 *
 * @param text - Raw markdown content from the Obsidian note.
 * @param settings - User settings controlling which elements to strip.
 * @returns Cleaned markdown ready for remark parsing.
 */
export function preprocess(text: string, settings: PubcopySettings): string {
  let result = text;
  const codeFences = findCodeFences(result);

  // Strip YAML frontmatter (must be at very start of file)
  if (settings.stripFrontmatter) {
    result = result.replace(/^---\n[\s\S]*?\n---\n?/, "");
  }

  // Strip Obsidian comments %%...%%
  result = replaceOutsideCodeFences(
    result,
    /%%[\s\S]*?%%/g,
    "",
    codeFences
  );

  // Strip HTML comments
  result = replaceOutsideCodeFences(
    result,
    /<!--[\s\S]*?-->/g,
    "",
    codeFences
  );

  // Strip block IDs ^block-id (at end of line or paragraph)
  result = replaceOutsideCodeFences(
    result,
    / ?\^[\w-]+$/gm,
    "",
    codeFences
  );

  // Strip tags #tag and #tag/subtag
  if (settings.stripTags) {
    result = replaceOutsideCodeFences(
      result,
      /(?<=\s|^)#[a-zA-Z][\w/]*/gm,
      "",
      codeFences
    );
  }

  // Convert wikilinks to plain text (order matters: most specific patterns first)
  if (settings.stripWikilinks) {
    // Aliased: [[page|display]] -> display
    result = replaceOutsideCodeFences(
      result,
      /\[\[([^\]|]+)\|([^\]]+)\]\]/g,
      (_match: string, _page: string, display: string) => display,
      codeFences
    );

    // Heading/block reference: [[page#heading]] or [[page#^block-id]] -> ref text
    result = replaceOutsideCodeFences(
      result,
      /\[\[([^\]#]+)#\^?([^\]]+)\]\]/g,
      (_match: string, _page: string, ref: string) => ref,
      codeFences
    );

    // Plain: [[page]] -> page
    result = replaceOutsideCodeFences(
      result,
      /\[\[([^\]]+)\]\]/g,
      (_match: string, page: string) => page,
      codeFences
    );
  }

  // Strip Obsidian URI links entirely (they're meaningless outside Obsidian)
  result = replaceOutsideCodeFences(
    result,
    /\[([^\]]*)\]\(obsidian:\/\/[^)]+\)/g,
    "",
    codeFences
  );

  // Normalize excessive blank lines (3+ -> 2)
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}
