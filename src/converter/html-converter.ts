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
import {
  findProtectedRanges,
  isProtected,
  replaceOutsideProtected,
  replaceAsyncOutsideProtected,
} from "./protected-ranges";

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
  // Every transformation skips code fences and inline code spans so code
  // examples containing Obsidian-like syntax survive intact. Helpers from
  // protected-ranges recompute ranges per pass, so chained length-changing
  // replacements stay correct.

  // 1. Mermaid: strip code blocks (not supported by Medium or Substack).
  //    Runs first because it intentionally targets whole code fences.
  const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
  let processed = markdown.replace(mermaidRegex, () => {
    warnings.add("mermaid", "diagram", "Mermaid diagrams not supported, skipped");
    return "";
  });

  // 2. Callouts: convert > [!type] to styled blockquotes with bold label
  processed = convertCallouts(processed);

  // 3. Highlights: ==text== -> <strong> (escaped to prevent XSS)
  processed = replaceOutsideProtected(
    processed,
    /==((?:[^=]|=[^=])+)==/g,
    (_match, content: string) => {
      elementCount++;
      const safe = escapeHtml(content);
      return profile.supportsHighlight
        ? `<mark>${safe}</mark>`
        : `<strong>${safe}</strong>`;
    }
  );

  // 4. Task lists: convert checkbox syntax to unicode characters
  //    (neither Medium nor Substack supports interactive checkboxes)
  processed = replaceOutsideProtected(
    processed,
    /^(\s*)- \[([ xX])\] (.+)$/gm,
    (_match, indent: string, check: string, text: string) => {
      elementCount++;
      const checkbox = check.trim() ? "\u2611" : "\u2610";
      return `${indent}- ${checkbox} ${text}`;
    }
  );

  // 5. Image embeds: ![[image.png]], ![[image.png|300]], ![[image.png|My caption]]
  //    Pipe value is size if numeric, caption otherwise
  const imageEmbedRegex = /!\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;
  processed = await replaceAsyncOutsideProtected(
    processed,
    imageEmbedRegex,
    async (match) => {
      const fileName = match[1].trim();
      if (!isImageFile(fileName)) return match[0];

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

      return resolveImage(
        app,
        fileName,
        fileName,
        sizeStr,
        settings.imageHandling,
        warnings,
        caption,
        profile.name
      );
    }
  );

  // 6. Block math: $$...$$ (must run before inline math to avoid false matches)
  processed = await replaceAsyncOutsideProtected(
    processed,
    /\$\$([\s\S]*?)\$\$/g,
    async (match) => {
      elementCount++;
      return renderBlockMath(match[1].trim(), warnings);
    }
  );

  // 7. Inline math: $...$ (single dollar, no newlines, not preceded by \ or $)
  //    Uses a capture group instead of lookbehind for iOS < 16.4 compatibility.
  processed = await replaceAsyncOutsideProtected(
    processed,
    /(^|[^\\$])\$([^$\n]+?)\$(?!\$)/g,
    async (match) => {
      elementCount++;
      const rendered = await renderInlineMath(match[2].trim(), warnings);
      return match[1] + rendered;
    }
  );

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

  // Resolve local image paths and add captions for standard markdown images.
  // Offset-based rebuilding wraps each occurrence exactly once, even when
  // identical captioned images repeat (no protected ranges apply to HTML).
  const mdImageRegex = /<img src="([^"]+)" alt="([^"]*)"([^>]*)>/g;
  html = await replaceAsyncOutsideProtected(
    html,
    mdImageRegex,
    async (match) => {
      const src = match[1];
      const alt = match[2];
      const isLocal = !src.startsWith("data:") && !src.startsWith("http:") && !src.startsWith("https:");
      // Use alt text as caption only if it's meaningful (not just the filename)
      const caption = (alt && alt !== src && !isImageFile(alt)) ? alt : undefined;

      if (isLocal) {
        elementCount++;
        return resolveImage(
          app,
          src,
          alt,
          undefined,
          settings.imageHandling,
          warnings,
          caption,
          profile.name
        );
      }
      if (caption) {
        if (profile.name === "Medium") {
          return `${match[0]}\n<p><em>${escapeHtml(caption)}</em></p>`;
        }
        return `<figure>${match[0]}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
      }
      return match[0];
    },
    []
  );

  return { html, elementCount };
}

/**
 * Convert Obsidian callout syntax to styled blockquotes.
 *
 * Transforms `> [!type] content` into `> **Type:** content`.
 * Handles foldable markers (`+`/`-`) by stripping them (content always visible).
 * Regular blockquotes (without `[!type]`) pass through unchanged.
 * Lines inside code fences pass through unchanged, and a callout line
 * directly following another callout starts a new block instead of leaking
 * its `[!type]` marker into the previous one.
 *
 * @param text - Markdown text potentially containing callout syntax.
 * @returns Markdown with callouts converted to styled blockquotes.
 */
function convertCallouts(text: string): string {
  const ranges = findProtectedRanges(text);
  const lines = text.split("\n");
  const result: string[] = [];
  let inCallout = false;
  let calloutType = "";
  let calloutContent: string[] = [];
  let offset = 0;

  const flushCallout = (): void => {
    const content = calloutContent.join("\n").trim();
    result.push(`> **${calloutType}:** ${content}`);
    result.push("");
    inCallout = false;
    calloutType = "";
    calloutContent = [];
  };

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    const protectedLine = isProtected(lineStart, ranges);

    const calloutMatch = protectedLine
      ? null
      : line.match(/^(>{1,})\s*\[!(\w+)\][+-]?\s*(.*)?$/);

    if (calloutMatch) {
      if (inCallout) {
        // A new callout starts directly after the previous one
        flushCallout();
      }
      inCallout = true;
      calloutType = calloutMatch[2].charAt(0).toUpperCase() + calloutMatch[2].slice(1);
      const firstLine = calloutMatch[3]?.trim() ?? "";
      if (firstLine) {
        calloutContent.push(firstLine);
      }
      continue;
    }

    if (inCallout) {
      const continuationMatch = protectedLine ? null : line.match(/^>{1,}\s?(.*)$/);
      if (continuationMatch) {
        calloutContent.push(continuationMatch[1]);
      } else {
        flushCallout();
        result.push(line);
      }
      continue;
    }

    result.push(line);
  }

  // Flush any remaining callout at end of file
  if (inCallout && calloutContent.length > 0) {
    flushCallout();
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
