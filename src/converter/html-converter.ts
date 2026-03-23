import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import type { App } from "obsidian";
import type { PubcopySettings } from "../settings";
import type { PlatformProfile } from "../platforms";
import { WarningCollector } from "../utils/errors";
import { resolveImage, isImageFile } from "./image-handler";
import { renderInlineMath, renderBlockMath } from "./math-renderer";

const SANITIZE_SCHEMA = {
  tagNames: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "strong", "em", "s", "code", "pre", "mark",
    "blockquote",
    "ul", "ol", "li",
    "a",
    "img",
    "table", "thead", "tbody", "tr", "th", "td",
    "figure", "figcaption",
    "div", "span", "sup", "sub", "kbd",
  ],
  attributes: {
    a: ["href", "title"],
    img: ["src", "alt", "width", "height"],
    code: ["className"],
    pre: ["className"],
    td: ["style"],
    th: ["style"],
    div: ["className"],
    span: ["className", "style"],
    "*": [],
  },
  protocols: {
    href: ["http", "https", "mailto"],
    src: ["http", "https", "data"],
  },
  strip: ["script", "style", "iframe", "object", "embed", "form", "input", "textarea", "button"],
};

interface ConvertResult {
  html: string;
  elementCount: number;
}

export async function convertToHtml(
  markdown: string,
  profile: PlatformProfile,
  settings: PubcopySettings,
  app: App,
  warnings: WarningCollector
): Promise<ConvertResult> {
  let elementCount = 0;

  // Pre-pass: handle Obsidian-specific elements before remark parsing

  // 1. Handle callouts: convert > [!type] to styled blockquotes
  let processed = convertCallouts(markdown);

  // 2. Handle highlight syntax ==text== -> <mark> or <strong>
  processed = processed.replace(
    /==((?:[^=]|=[^=])+)==/g,
    (_match, content: string) => {
      elementCount++;
      const safe = escapeHtmlCaption(content);
      return profile.supportsHighlight
        ? `<mark>${safe}</mark>`
        : `<strong>${safe}</strong>`;
    }
  );

  // 3. Handle task lists: - [ ] and - [x]
  processed = processed.replace(
    /^(\s*)- \[([ xX])\] (.+)$/gm,
    (_match, indent: string, check: string, text: string) => {
      elementCount++;
      const checkbox = check.trim() ? "☑" : "☐";
      return `${indent}- ${checkbox} ${text}`;
    }
  );

  // 4. Handle image embeds: ![[image.png]], ![[image.png|300]], ![[image.png|My caption]]
  const imageEmbedRegex = /!\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;
  const imageMatches = [...processed.matchAll(imageEmbedRegex)];
  for (const match of imageMatches) {
    const fileName = match[1].trim();
    if (!isImageFile(fileName)) continue;

    elementCount++;
    const pipeValue = match[2]?.trim();

    // Determine if pipe value is a size (digits, or digitsxdigits) or a caption
    let sizeStr: string | undefined;
    let caption: string | undefined;
    if (pipeValue) {
      if (/^\d+(?:x\d+)?$/.test(pipeValue)) {
        sizeStr = pipeValue;
      } else {
        caption = pipeValue;
      }
    }

    const imgTag = await resolveImage(
      app,
      fileName,
      fileName,
      sizeStr,
      settings.imageHandling,
      warnings,
      caption,
      profile.name
    );
    processed = processed.replace(match[0], imgTag);
  }

  // 5. Strip mermaid code blocks (not supported by Medium or Substack)
  const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
  processed = processed.replace(mermaidRegex, (_match) => {
    warnings.add("mermaid", "diagram", "Mermaid diagrams not supported, skipped");
    return "";
  });

  // 6. Handle block math $$...$$ (before inline math)
  const blockMathRegex = /\$\$([\s\S]*?)\$\$/g;
  const blockMathMatches = [...processed.matchAll(blockMathRegex)];
  for (const match of blockMathMatches) {
    elementCount++;
    const rendered = await renderBlockMath(match[1].trim(), warnings);
    processed = processed.replace(match[0], rendered);
  }

  // 7. Handle inline math $...$
  const inlineMathRegex = /(?<![\\$])\$([^\$\n]+?)\$(?!\$)/g;
  const inlineMathMatches = [...processed.matchAll(inlineMathRegex)];
  for (const match of inlineMathMatches) {
    elementCount++;
    const rendered = await renderInlineMath(match[1].trim(), warnings);
    processed = processed.replace(match[0], rendered);
  }

  // Parse with remark/rehype pipeline (sanitize strips script/style/iframe/etc.)
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSanitize, SANITIZE_SCHEMA)
    .use(rehypeStringify);

  const file = await processor.process(processed);
  let html = String(file);

  // Count elements from the HTML output
  const tagCounts = countHtmlElements(html);
  elementCount += tagCounts;

  // Post-processing: apply platform-specific transformations

  // Heading level capping
  if (profile.maxHeadingLevel < 6) {
    for (let level = 6; level > profile.maxHeadingLevel; level--) {
      const openTag = new RegExp(`<h${level}>`, "g");
      const closeTag = new RegExp(`<\\/h${level}>`, "g");
      html = html.replace(openTag, `<h${profile.maxHeadingLevel}>`);
      html = html.replace(closeTag, `</h${profile.maxHeadingLevel}>`);
    }
  }

  // List nesting flattening for Medium
  if (profile.maxListNestingDepth < Infinity) {
    html = flattenNestedLists(html, profile.maxListNestingDepth);
  }

  // Code block wrapper adjustment
  if (profile.codeBlockWrapper === "pre-only") {
    html = html.replace(/<pre><code([^>]*)>/g, "<pre$1>");
    html = html.replace(/<\/code><\/pre>/g, "</pre>");
  }

  // Handle markdown images: add captions from alt text + resolve local paths
  const mdImageRegex = /<img src="([^"]+)" alt="([^"]*)"([^>]*)>/g;
  const mdImageMatches = [...html.matchAll(mdImageRegex)];
  for (const match of mdImageMatches) {
    const src = match[1];
    const alt = match[2];
    const isLocal = !src.startsWith("data:") && !src.startsWith("http:") && !src.startsWith("https:");
    // Use alt text as caption if it's not just the filename
    const caption = (alt && alt !== src && !isImageFile(alt)) ? alt : undefined;

    if (isLocal) {
      elementCount++;
      const imgTag = await resolveImage(
        app,
        src,
        alt,
        undefined,
        settings.imageHandling,
        warnings,
        caption
      );
      html = html.replace(match[0], imgTag);
    } else if (caption) {
      let captionHtml: string;
      if (profile.name === "Medium") {
        captionHtml = `${match[0]}\n<p><em>${escapeHtmlCaption(caption)}</em></p>`;
      } else {
        captionHtml = `<figure>${match[0]}<figcaption>${escapeHtmlCaption(caption)}</figcaption></figure>`;
      }
      html = html.replace(match[0], captionHtml);
    }
  }

  return { html, elementCount };
}

function convertCallouts(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inCallout = false;
  let calloutType = "";
  let calloutContent: string[] = [];
  let calloutDepth = 0;

  for (const line of lines) {
    // Detect callout start: > [!type] or > [!type]+ or > [!type]-
    const calloutMatch = line.match(
      /^(>{1,})\s*\[!(\w+)\][+-]?\s*(.*)?$/
    );

    if (calloutMatch && !inCallout) {
      inCallout = true;
      calloutDepth = calloutMatch[1].length;
      calloutType = calloutMatch[2].charAt(0).toUpperCase() + calloutMatch[2].slice(1);
      const firstLine = calloutMatch[3]?.trim() ?? "";
      if (firstLine) {
        calloutContent.push(firstLine);
      }
      continue;
    }

    if (inCallout) {
      // Check if line continues the callout (starts with >)
      const continuationMatch = line.match(/^>{1,}\s?(.*)$/);
      if (continuationMatch) {
        calloutContent.push(continuationMatch[1]);
      } else {
        // End of callout
        const content = calloutContent.join("\n").trim();
        result.push(`> **${calloutType}:** ${content}`);
        result.push("");
        inCallout = false;
        calloutType = "";
        calloutContent = [];
        calloutDepth = 0;
        result.push(line);
      }
      continue;
    }

    result.push(line);
  }

  // Flush remaining callout
  if (inCallout && calloutContent.length > 0) {
    const content = calloutContent.join("\n").trim();
    result.push(`> **${calloutType}:** ${content}`);
  }

  return result.join("\n");
}

function flattenNestedLists(html: string, maxDepth: number): string {
  // Simple approach: remove nesting beyond maxDepth by counting nested <ul>/<ol> tags
  let depth = 0;
  return html.replace(/<(\/?)([ou]l)([^>]*)>/g, (match, closing, tag) => {
    if (!closing) {
      depth++;
      if (depth > maxDepth) {
        return ""; // Remove opening tag for deep nesting
      }
    } else {
      if (depth > maxDepth) {
        depth--;
        return ""; // Remove closing tag for deep nesting
      }
      depth--;
    }
    return match;
  });
}

function escapeHtmlCaption(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function countHtmlElements(html: string): number {
  const tagPattern = /<(h[1-6]|p|strong|em|s|code|pre|blockquote|hr|ul|ol|li|table|tr|th|td|a|img|br|sup)\b/g;
  const matches = html.match(tagPattern);
  return matches ? matches.length : 0;
}
