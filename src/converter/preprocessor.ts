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
 *   while PRESERVING embeds (`![[...]]`), which later pipeline stages resolve
 * - Strip Obsidian URI links (`obsidian://...`)
 * - Normalize excessive blank lines
 *
 * All transformations skip content inside code fences and inline code spans
 * (see {@link replaceOutsideProtected}) to avoid breaking code examples that
 * contain Obsidian-like syntax.
 */

import type { PubcopySettings } from "../settings";
import { replaceOutsideProtected } from "./protected-ranges";

/**
 * Preprocess raw Obsidian markdown into clean standard markdown.
 *
 * This is the first step in the conversion pipeline. The output is standard
 * markdown that the remark parser can handle without Obsidian-specific extensions.
 *
 * Embeds (`![[...]]`) are intentionally left untouched: note embeds are
 * resolved by the embed resolver BEFORE this stage, and image embeds are
 * handled by the HTML converter AFTER this stage.
 *
 * @param text - Raw markdown content from the Obsidian note.
 * @param settings - User settings controlling which elements to strip.
 * @returns Cleaned markdown ready for remark parsing.
 */
export function preprocess(text: string, settings: PubcopySettings): string {
  let result = text;

  // Strip YAML frontmatter (must be at very start of file; LF or CRLF)
  if (settings.stripFrontmatter) {
    result = result.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  }

  // Strip Obsidian comments %%...%%
  result = replaceOutsideProtected(result, /%%[\s\S]*?%%/g, "");

  // Strip HTML comments
  result = replaceOutsideProtected(result, /<!--[\s\S]*?-->/g, "");

  // Strip block IDs ^block-id (at end of line or paragraph)
  result = replaceOutsideProtected(result, / ?\^[\w-]+$/gm, "");

  // Strip tags #tag and #tag/subtag
  if (settings.stripTags) {
    result = replaceOutsideProtected(
      result,
      /(^|\s)#[a-zA-Z][\w/]*/gm,
      (_match: string, prefix: string) => prefix
    );
  }

  // Convert wikilinks to plain text (order matters: most specific patterns first).
  // Each pattern captures an optional leading `!` so embeds pass through unchanged.
  if (settings.stripWikilinks) {
    // Aliased: [[page|display]] -> display
    result = replaceOutsideProtected(
      result,
      /(!?)\[\[([^\]|]+)\|([^\]]+)\]\]/g,
      (match: string, bang: string, _page: string, display: string) =>
        bang ? match : display
    );

    // Heading/block reference: [[page#heading]] or [[page#^block-id]] -> ref text
    result = replaceOutsideProtected(
      result,
      /(!?)\[\[([^\]#]+)#\^?([^\]]+)\]\]/g,
      (match: string, bang: string, _page: string, ref: string) =>
        bang ? match : ref
    );

    // Plain: [[page]] -> page
    result = replaceOutsideProtected(
      result,
      /(!?)\[\[([^\]]+)\]\]/g,
      (match: string, bang: string, page: string) => (bang ? match : page)
    );
  }

  // Strip Obsidian URI links entirely (they're meaningless outside Obsidian)
  result = replaceOutsideProtected(
    result,
    /\[([^\]]*)\]\(obsidian:\/\/[^)]+\)/g,
    ""
  );

  // Normalize excessive blank lines (3+ -> 2) outside code
  result = replaceOutsideProtected(result, /\n{3,}/g, "\n\n");

  return result.trim();
}
