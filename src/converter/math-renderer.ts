import { WarningCollector } from "../utils/errors";

let katexModule: typeof import("katex") | null = null;

async function loadKatex(): Promise<typeof import("katex")> {
  if (!katexModule) {
    katexModule = await import("katex");
  }
  return katexModule;
}

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
