import type { PlatformProfile } from "../platforms";

interface Footnote {
  id: string;
  number: number;
  content: string;
}

export function processFootnotes(
  html: string,
  profile: PlatformProfile
): string {
  if (profile.footnoteStrategy === "native") {
    return html;
  }

  // For superscript-endnotes strategy (Medium)
  const footnotes: Footnote[] = [];
  let counter = 0;

  // Extract footnote definitions from the HTML
  let result = html.replace(
    /<p>\[\^(\w+)\]:\s*([\s\S]*?)<\/p>/g,
    (_match, id: string, content: string) => {
      counter++;
      footnotes.push({ id, number: counter, content: escapeHtml(content.trim()) });
      return "";
    }
  );

  // Replace footnote references with superscript numbers
  for (const fn of footnotes) {
    const refPattern = new RegExp(
      `\\[\\^${escapeRegex(fn.id)}\\](?!:)`,
      "g"
    );
    result = result.replace(
      refPattern,
      `<sup>${fn.number}</sup>`
    );
  }

  // Handle inline footnotes ^[text] (cap content length to prevent ReDoS)
  result = result.replace(
    /\^\[([^\]]{1,500})\]/g,
    (_match, content: string) => {
      counter++;
      footnotes.push({ id: `inline-${counter}`, number: counter, content: escapeHtml(content) });
      return `<sup>${counter}</sup>`;
    }
  );

  // Append endnotes section if there are footnotes
  if (footnotes.length > 0) {
    result += "\n<hr>\n<h2>Notes</h2>\n<ol>\n";
    for (const fn of footnotes) {
      result += `<li>${fn.content}</li>\n`;
    }
    result += "</ol>\n";
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
