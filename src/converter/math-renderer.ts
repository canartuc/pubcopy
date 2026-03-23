/**
 * @module converter/math-renderer
 *
 * Renders LaTeX math expressions to HTML using KaTeX.
 *
 * KaTeX is lazy-loaded via dynamic `import()` to avoid adding ~1MB to the
 * initial plugin load. Most notes don't contain math, so this cost is only
 * paid when needed.
 *
 * Two rendering modes:
 * - Inline math (`$...$`): Rendered inline within text, no display-mode centering.
 * - Block math (`$$...$$`): Rendered as a centered block wrapped in a `<div>`.
 *
 * On render failure, falls back to a `<code>` block showing the raw LaTeX
 * and adds a warning to the collector.
 */

import { WarningCollector } from "../utils/errors";

/** Cached KaTeX module. Loaded once on first use, reused for subsequent renders. */
let katexModule: typeof import("katex") | null = null;

/**
 * Lazy-load the KaTeX library. Only called when a note actually contains math.
 * @returns The KaTeX module.
 */
async function loadKatex(): Promise<typeof import("katex")> {
  if (!katexModule) {
    katexModule = await import("katex");
  }
  return katexModule;
}

/**
 * Render an inline math expression (`$...$`) to HTML.
 *
 * @param latex - The raw LaTeX string (without `$` delimiters).
 * @param warnings - Collector for non-fatal render failures.
 * @returns HTML string, either rendered math or a `<code>` fallback.
 */
export async function renderInlineMath(
  latex: string,
  warnings: WarningCollector
): Promise<string> {
  try {
    const katex = await loadKatex();
    return katex.default.renderToString(latex, {
      displayMode: false,
      throwOnError: false,
      output: "html",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.add("math", "inline", `Render failed: ${msg}`);
    return `<code>${escapeHtml(latex)}</code>`;
  }
}

/**
 * Render a block math expression (`$$...$$`) to HTML.
 *
 * @param latex - The raw LaTeX string (without `$$` delimiters).
 * @param warnings - Collector for non-fatal render failures.
 * @returns HTML string wrapped in `<div class="math-block">`, or a `<pre>` fallback.
 */
export async function renderBlockMath(
  latex: string,
  warnings: WarningCollector
): Promise<string> {
  try {
    const katex = await loadKatex();
    const rendered = katex.default.renderToString(latex, {
      displayMode: true,
      throwOnError: false,
      output: "html",
    });
    return `<div class="math-block">${rendered}</div>`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.add("math", "block", `Render failed: ${msg}`);
    return `<pre><code>${escapeHtml(latex)}</code></pre>`;
  }
}

/** Escape HTML special characters to prevent injection in fallback output. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
