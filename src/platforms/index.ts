/**
 * @module platforms
 *
 * Platform profile system for Pubcopy.
 *
 * Each target platform (Medium, Substack) has different HTML capabilities
 * and quirks. A {@link PlatformProfile} captures these differences as
 * configuration rather than conditional logic scattered across the converter.
 *
 * To add a new platform (e.g., Ghost, Dev.to):
 * 1. Create a new file (e.g., `ghost.ts`) exporting a `PlatformProfile`.
 * 2. Import and register it in `main.ts`.
 * No changes to the converter pipeline are needed.
 */

/** How to wrap fenced code blocks in the output HTML. */
export type CodeBlockWrapper = "pre-code" | "pre-only";

/**
 * How to render footnotes.
 * - `superscript-endnotes`: Convert references to superscript numbers, append a "Notes" section (Medium).
 * - `native`: Pass footnote HTML through for the platform's native handling (Substack).
 */
export type FootnoteStrategy = "superscript-endnotes" | "native";

/**
 * Configuration describing a target platform's HTML capabilities and constraints.
 *
 * The converter reads these values to adjust its output without platform-specific
 * if/else branches in the conversion logic itself.
 */
export interface PlatformProfile {
  /** Display name shown in notifications (e.g., "Medium", "Substack"). */
  name: string;
  /** Maximum heading level the platform supports. H5/H6 are flattened to this level. */
  maxHeadingLevel: number;
  /** Maximum nesting depth for lists. Deeper levels are flattened. Use Infinity for unlimited. */
  maxListNestingDepth: number;
  /** Whether to wrap code in `<pre><code>` or just `<pre>`. */
  codeBlockWrapper: CodeBlockWrapper;
  /** How footnotes should be rendered for this platform. */
  footnoteStrategy: FootnoteStrategy;
  /** Whether the platform supports `<mark>` for highlights. If false, falls back to `<strong>`. */
  supportsHighlight: boolean;
  /** Whether the platform supports interactive task list checkboxes. If false, uses unicode characters. */
  supportsTaskLists: boolean;
  /** Whether the platform supports HTML `<table>` elements on paste. */
  supportsTableHtml: boolean;
}

export { MediumProfile } from "./medium";
export { SubstackProfile } from "./substack";
export { MarkdownProfile } from "./markdown";
