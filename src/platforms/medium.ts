/**
 * @module platforms/medium
 *
 * Platform profile for Medium (medium.com).
 *
 * Medium's editor has specific limitations when pasting HTML:
 * - Headings max out at H4 (H5/H6 are ignored or rendered as body text).
 * - Nested lists beyond 2 levels are flattened.
 * - Code blocks expect `<pre><code>` wrapper structure.
 * - No native footnote support (must be converted to superscript + endnotes).
 * - No native highlight (`<mark>`) support.
 * - No native task list checkbox support.
 * - `<figure>/<figcaption>` for image captions is stripped;
 *   captions are output as italic paragraphs below the image instead.
 */

import type { PlatformProfile } from "./index";

export const MediumProfile: PlatformProfile = {
  name: "Medium",
  maxHeadingLevel: 4,
  maxListNestingDepth: 2,
  codeBlockWrapper: "pre-code",
  footnoteStrategy: "superscript-endnotes",
  supportsHighlight: false,
  supportsTaskLists: false,
  supportsTableHtml: true,
};
