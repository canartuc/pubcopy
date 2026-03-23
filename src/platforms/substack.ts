/**
 * @module platforms/substack
 *
 * Platform profile for Substack (substack.com).
 *
 * Substack's editor is more capable than Medium's:
 * - Full H1-H6 heading support.
 * - Unlimited list nesting depth.
 * - Code blocks work best with plain `<pre>` (no inner `<code>` wrapper).
 * - Native footnote support via HTML.
 * - `<figure>/<figcaption>` for image captions works natively.
 * - No native highlight (`<mark>`) support.
 * - No native task list checkbox support.
 */

import type { PlatformProfile } from "./index";

export const SubstackProfile: PlatformProfile = {
  name: "Substack",
  maxHeadingLevel: 6,
  maxListNestingDepth: Infinity,
  codeBlockWrapper: "pre-only",
  footnoteStrategy: "native",
  supportsHighlight: false,
  supportsTaskLists: false,
  supportsTableHtml: true,
};
