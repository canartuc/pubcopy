/**
 * @module platforms/markdown
 *
 * Platform profile for clean Markdown output.
 *
 * Unlike Medium and Substack profiles, this profile triggers an early return
 * in the conversion pipeline. When detected, the converter skips HTML
 * conversion entirely and returns preprocessed markdown (frontmatter, tags,
 * wikilinks, comments stripped; embeds resolved).
 *
 * Profile field values are unused but required by the PlatformProfile interface.
 */

import type { PlatformProfile } from "./index";

export const MarkdownProfile: PlatformProfile = {
  name: "Markdown",
  outputMode: "markdown",
  maxHeadingLevel: 6,
  maxListNestingDepth: Infinity,
  codeBlockWrapper: "pre-code",
  footnoteStrategy: "native",
  supportsHighlight: true,
  supportsTaskLists: true,
  supportsTableHtml: true,
};
