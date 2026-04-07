/**
 * @module converter/html-converter
 *
 * Core markdown-to-HTML conversion using the unified/remark/rehype pipeline.
 *
 * This module handles two categories of work:
 *
 * **Pre-pass transformations** (before remark parsing):
 * Obsidian-specific syntax that remark can't parse is converted to standard
 * HTML or markdown before entering the pipeline. This includes callouts,
 * highlights, task lists, image embeds, mermaid blocks, and math expressions.
 *
 * **Post-pass transformations** (after rehype serialization):
 * Platform-specific adjustments applied to the HTML output: heading level
 * capping, list nesting flattening, code block wrapper changes, and
 * local image resolution.
 *
 * **Security**: The pipeline uses `rehype-sanitize` with a strict allowlist
 * to strip `<script>`, `<style>`, `<iframe>`, and other dangerous elements.
 * Content injected during the pre-pass (highlights, callouts) is escaped
 * before interpolation.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import type { App } from "obsidian";
import type { PubcopySettings } from "../settings";
import type { PlatformProfile } from "../platforms";
import { WarningCollector } from "../utils/errors";
import { escapeHtml } from "../utils/html";
import { resolveImage, isImageFile } from "./image-handler";
import { renderInlineMath, renderBlockMath } from "./math-renderer";

/**
 * Sanitization schema for rehype-sanitize.
 *
 * Allowlists safe HTML elements and attributes that the converter
 * intentionally produces. Strips dangerous elements like `<script>`,
 * `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, and form controls.
 *
 * This is a defense-in-depth measure. The converter also escapes user
 * content at injection points, but the sanitizer catches anything that
 * slips through (e.g., raw HTML in the source markdown).
 */
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
    src: ["http", "https"],
  },
  strip: ["script", "style", "iframe", "object", "embed", "form", "input", "textarea", "button"],
};

/** Return type for the HTML conversion step. */
interface ConvertResult {
  /** The converted HTML string. */
  html: string;
  /** Approximate count of HTML elements produced. */
  elementCount: number;
}

/**
 * Convert preprocessed markdown to platform-optimized HTML.
 *
 * Runs the full conversion pipeline:
 * 1. Pre-pass: Transform Obsidian extensions (callouts, highlights, tasks, images, mermaid, math).
 * 2. Parse: unified/remark-parse/remark-gfm for standard markdown.
 * 3. Sanitize: rehype-sanitize strips dangerous HTML.
 * 4. Serialize: rehype-stringify produces HTML string.
 * 5. Post-pass: Apply platform-specific transformations (heading cap, list flatten, code wrapper).
 *
 * @param markdown - Preprocessed markdown (Obsidian syntax already stripped by preprocessor).
 * @param profile - Target platform profile.
 * @param settings - User's plugin settings.
 * @param app - Obsidian App instance for vault access (image resolution).
 * @param warnings - Shared warning collector.
 * @returns HTML string and element count.
 */
export async function convertToHtml(
  markdown: string,
  profile: PlatformProfile,
  settings: PubcopySettings,
  app: App,
  warnings: WarningCollector
): Promise<ConvertResult> {
  let elementCount = 0;

  // === PRE-PASS: Handle Obsidian-specific elements before remark parsing ===

  // 1. Callouts: convert > [!type] to styled blockquotes with bold label
  let processed = convertCallouts(markdown);

  // 2. Highlights: ==text== -> <strong> (escaped to prevent XSS)
  processed = processed.replace(
    /==((?:[^=]|=[^=])+)==/g,
    (_match, content: string) => {
      elementCount++;
      const safe = escapeHtml(content);
      return profile.supportsHighlight
        ? `<mark>${safe}</mark>`
        : `<strong>${safe}</strong>`;
    }
  );

  // 3. Task lists: convert checkbox syntax to unicode characters
  //    (neither Medium nor Substack supports interactive checkboxes)
  processed = processed.replace(
    /^(\s*)- \[([ xX])\] (.+)$/gm,
    (_match, indent: string, check: string, text: string) => {
      elementCount++;
      const checkbox = check.trim() ? "\u2611" : "\u2610";
      return `${indent}- ${checkbox} ${text}`;
    }
  );

  // 4. Image embeds: ![[image.png]], ![[image.png|300]], ![[image.png|My caption]]
  //    Pipe value is size if numeric, caption otherwise
  const imageEmbedRegex = /!\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;
  const imageMatches = [...processed.matchAll(imageEmbedRegex)];
  for (const match of imageMatches) {
    const fileName = match[1].trim();
    if (!isImageFile(fileName)) continue;

    elementCount++;
    const pipeValue = match[2]?.trim();

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
    processed = processed.replace(match[0], () => imgTag);
  }

  // 5. Mermaid: strip code blocks (not supported by Medium or Substack)
  const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
  processed = processed.replace(mermaidRegex, (_match) => {
    warnings.add("mermaid", "diagram", "Mermaid diagrams not supported, skipped");
    return "";
  });

  // 6. Block math: $$...$$ (must run before inline math to avoid false matches)
  const blockMathRegex = /\$\$([\s\S]*?)\$\$/g;
  const blockMathMatches = [...processed.matchAll(blockMathRegex)];
  for (const match of blockMathMatches) {
    elementCount++;
    const rendered = await renderBlockMath(match[1].trim(), warnings);
    processed = processed.replace(match[0], () => rendered);
  }

  // 7. Inline math: $...$ (single dollar, no newlines, not preceded by \ or $)
  //    Uses a capture group instead of lookbehind for iOS < 16.4 compatibility.
  const inlineMathRegex = /(^|[^\\$])\$([^$\n]+?)\$(?!\$)/g;
  const inlineMathMatches = [...processed.matchAll(inlineMathRegex)];
  for (const match of inlineMathMatches) {
    elementCount++;
    const rendered = await renderInlineMath(match[2].trim(), warnings);
    const prefix = match[1];
    processed = processed.replace(match[0], () => prefix + rendered);
  }

  // === PARSE: Run the remark/rehype pipeline ===
  // allowDangerousHtml is required because our pre-pass injects HTML tags.
  // rehype-raw parses those raw HTML strings into proper hast elements so
  // rehype-sanitize can inspect and allowlist them correctly.
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, SANITIZE_SCHEMA)
    .use(rehypeStringify);

  const file = await processor.process(processed);
  let html = String(file);

  const tagCounts = countHtmlElements(html);
  elementCount += tagCounts;

  // === POST-PASS: Apply platform-specific transformations ===

  // Heading level capping (Medium maxes at H4)
  if (profile.maxHeadingLevel < 6) {
    for (let level = 6; level > profile.maxHeadingLevel; level--) {
      const openTag = new RegExp(`<h${level}>`, "g");
      const closeTag = new RegExp(`<\\/h${level}>`, "g");
      html = html.replace(openTag, `<h${profile.maxHeadingLevel}>`);
      html = html.replace(closeTag, `</h${profile.maxHeadingLevel}>`);
    }
  }

  // List nesting depth limit (Medium allows max 2 levels)
  if (profile.maxListNestingDepth < Infinity) {
    html = flattenNestedLists(html, profile.maxListNestingDepth);
  }

  // Code block wrapper style (Substack prefers <pre> without inner <code>)
  if (profile.codeBlockWrapper === "pre-only") {
    html = html.replace(/<pre><code([^>]*)>/g, "<pre$1>");
    html = html.replace(/<\/code><\/pre>/g, "</pre>");
  }

  // Resolve local image paths and add captions for standard markdown images
  const mdImageRegex = /<img src="([^"]+)" alt="([^"]*)"([^>]*)>/g;
  const mdImageMatches = [...html.matchAll(mdImageRegex)];
  for (const match of mdImageMatches) {
    const src = match[1];
    const alt = match[2];
    const isLocal = !src.startsWith("data:") && !src.startsWith("http:") && !src.startsWith("https:");
    // Use alt text as caption only if it's meaningful (not just the filename)
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
        caption,
        profile.name
      );
      html = html.replace(match[0], () => imgTag);
    } else if (caption) {
      let captionHtml: string;
      if (profile.name === "Medium") {
        captionHtml = `${match[0]}\n<p><em>${escapeHtml(caption)}</em></p>`;
      } else {
        captionHtml = `<figure>${match[0]}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
      }
      html = html.replace(match[0], () => captionHtml);
    }
  }

  return { html, elementCount };
}

/**
 * Convert Obsidian callout syntax to styled blockquotes.
 *
 * Transforms `> [!type] content` into `> **Type:** content`.
 * Handles foldable markers (`+`/`-`) by stripping them (content always visible).
 * Regular blockquotes (without `[!type]`) pass through unchanged.
 *
 * @param text - Markdown text potentially containing callout syntax.
 * @returns Markdown with callouts converted to styled blockquotes.
 */
function convertCallouts(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inCallout = false;
  let calloutType = "";
  let calloutContent: string[] = [];

  for (const line of lines) {
    const calloutMatch = line.match(
      /^(>{1,})\s*\[!(\w+)\][+-]?\s*(.*)?$/
    );

    if (calloutMatch && !inCallout) {
      inCallout = true;
      calloutType = calloutMatch[2].charAt(0).toUpperCase() + calloutMatch[2].slice(1);
      const firstLine = calloutMatch[3]?.trim() ?? "";
      if (firstLine) {
        calloutContent.push(firstLine);
      }
      continue;
    }

    if (inCallout) {
      const continuationMatch = line.match(/^>{1,}\s?(.*)$/);
      if (continuationMatch) {
        calloutContent.push(continuationMatch[1]);
      } else {
        // End of callout block
        const content = calloutContent.join("\n").trim();
        result.push(`> **${calloutType}:** ${content}`);
        result.push("");
        inCallout = false;
        calloutType = "";
        calloutContent = [];
        result.push(line);
      }
      continue;
    }

    result.push(line);
  }

  // Flush any remaining callout at end of file
  if (inCallout && calloutContent.length > 0) {
    const content = calloutContent.join("\n").trim();
    result.push(`> **${calloutType}:** ${content}`);
  }

  return result.join("\n");
}

/**
 * Flatten nested lists beyond the specified maximum depth.
 *
 * Removes `<ul>`/`<ol>` tags for nesting levels that exceed the platform's
 * limit. List items at deeper levels still appear, just without additional
 * indentation. Used for Medium (max 2 levels).
 */
function flattenNestedLists(html: string, maxDepth: number): string {
  let depth = 0;
  return html.replace(/<(\/?)([ou]l)([^>]*)>/g, (match, closing) => {
    if (!closing) {
      depth++;
      if (depth > maxDepth) {
        return "";
      }
    } else {
      if (depth > maxDepth) {
        depth--;
        return "";
      }
      depth--;
    }
    return match;
  });
}

/**
 * Count the approximate number of significant HTML elements in the output.
 * Used for the success notification ("Copied for Medium: N elements").
 */
function countHtmlElements(html: string): number {
  const tagPattern = /<(h[1-6]|p|strong|em|s|code|pre|blockquote|hr|ul|ol|li|table|tr|th|td|a|img|br|sup)\b/g;
  const matches = html.match(tagPattern);
  return matches ? matches.length : 0;
}
