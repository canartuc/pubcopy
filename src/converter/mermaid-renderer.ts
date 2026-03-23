import type { MermaidFormat } from "../settings";
import { WarningCollector } from "../utils/errors";

const MERMAID_INK_BASE = "https://mermaid.ink";

export async function renderMermaid(
  code: string,
  format: MermaidFormat,
  warnings: WarningCollector
): Promise<string> {
  try {
    const encoded = btoa(unescape(encodeURIComponent(code)));
    const path = format === "svg" ? "svg" : "img";
    const url = `${MERMAID_INK_BASE}/${path}/base64:${encoded}`;

    return `<img src="${url}" alt="Mermaid diagram">`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.add("mermaid", "diagram", `Failed to encode diagram: ${msg}`);
    return `<pre><code class="language-mermaid">${escapeHtml(code)}</code></pre>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
