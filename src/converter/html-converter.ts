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
 * **Tree transformations** (after sanitization, before serialization):
 * Tables are degraded to lists or code blocks for platforms whose editors
 * drop `<table>` on paste. This happens on the hast tree because attribute
 * values may contain literal `<` and `>`, which no string scanner can tell
 * apart from markup.
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
import type { Plugin } from "unified";
import type { Element, ElementContent, Root, RootContent } from "hast";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import type { App } from "obsidian";
import type { PubcopySettings, TableHandling } from "../settings";
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
    td: ["style", "align"],
    th: ["style", "align"],
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
 * 4. Degrade: Rewrite tables for platforms without table support, then serialize.
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
  //    Runs first because it intentionally targets whole code fences — but
  //    only TOP-LEVEL ones (a ```mermaid example nested inside a longer
  //    ````fence is documentation and must survive as code).
  const mermaidRegex = /```mermaid\r?\n([\s\S]*?)```/g;
  const fenceRanges = findProtectedRanges(markdown);
  let processed = markdown.replace(
    mermaidRegex,
    (match: string, _content: string, offset: number) => {
      if (!fenceRanges.some((r) => r.start === offset)) return match;
      warnings.add("mermaid", "diagram", "Mermaid diagrams not supported, skipped");
      return "";
    }
  );

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
  //    Pipe value is size if numeric, caption otherwise.
  //    Converted to a plain RELATIVE <img> tag here; the post-pass (after
  //    sanitization) resolves it to a base64 data URI. Injecting data: URIs
  //    before rehype-sanitize would get them stripped, since the sanitizer
  //    intentionally rejects data: sources in user-authored content.
  // Bounded quantifiers keep unclosed "![[" runs linear (no quadratic backtracking)
  const imageEmbedRegex = /!\[\[([^\]|]{1,1000}?)(?:\|([^\]]{1,1000}))?\]\]/g;
  processed = replaceOutsideProtected(
    processed,
    imageEmbedRegex,
    (match: string, fileNameRaw: string, pipeRaw?: string) => {
      const fileName = fileNameRaw.trim();
      if (!isImageFile(fileName)) return match;

      elementCount++;
      const pipeValue = pipeRaw?.trim();

      let sizeAttrs = "";
      let alt = fileName;
      if (pipeValue) {
        const sizeMatch = pipeValue.match(/^(\d+)(?:x(\d+))?$/);
        if (sizeMatch) {
          sizeAttrs = ` width="${sizeMatch[1]}"`;
          if (sizeMatch[2]) sizeAttrs += ` height="${sizeMatch[2]}"`;
        } else {
          // Caption: carried via alt; the post-pass wraps it per platform
          alt = pipeValue;
        }
      }

      return `<img src="${escapeHtml(fileName)}" alt="${escapeHtml(alt)}"${sizeAttrs}>`;
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
  //    Protection is anchored at the opening $ (past the one-char context
  //    prefix), so math directly after an inline code span still renders.
  //    The content must not begin or end with whitespace (Obsidian/pandoc rule):
  //    this keeps spaced currency like "$100 a year ... costs $100" from being
  //    paired as a math span, which would strip the interior whitespace.
  processed = await replaceAsyncOutsideProtected(
    processed,
    /(^|[^\\$])\$([^\s$\n](?:[^$\n]*?[^\s$\n])?)\$(?!\$)/g,
    async (match) => {
      elementCount++;
      const rendered = await renderInlineMath(match[2].trim(), warnings);
      return match[1] + rendered;
    },
    undefined,
    (match) => (match.index ?? 0) + match[1].length
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
    // Table degradation runs on the sanitized tree, before serialization:
    // see rehypeDegradeTables for why this cannot be done on the HTML string.
    .use(rehypeDegradeTables, {
      enabled: !profile.supportsTableHtml,
      mode: settings.tableHandling,
      warnings,
    })
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
      // rehype-stringify entity-encodes attribute values (& -> &#x26;,
      // " -> &#x22;); decode them before vault lookups and re-escaping
      const src = decodeAttr(match[1]);
      const alt = decodeAttr(match[2]);
      const attrs = match[3] ?? "";
      const isLocal = !src.startsWith("data:") && !src.startsWith("http:") && !src.startsWith("https:");
      // Use alt text as caption only if it's meaningful (not just the filename)
      const caption = (alt && alt !== src && !isImageFile(alt)) ? alt : undefined;

      if (isLocal) {
        elementCount++;
        // Preserve size attributes emitted by the image-embed pre-pass
        const width = attrs.match(/width="(\d+)"/)?.[1];
        const height = attrs.match(/height="(\d+)"/)?.[1];
        const sizeStr = width ? (height ? `${width}x${height}` : width) : undefined;
        return resolveImage(
          app,
          src,
          alt,
          sizeStr,
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

/** Column alignment of a table column. */
type TableAlign = "left" | "center" | "right" | null;

/** Structured content of one hast `<table>` element. */
interface ParsedTable {
  /** Children of each `<th>` in the header row; empty for headerless tables. */
  headers: ElementContent[][];
  /** Per-column alignment (header row wins, else first body row). */
  aligns: TableAlign[];
  /** Children of each body cell, row-major. */
  rows: ElementContent[][][];
}

/** Options for the table degradation plugin. */
interface DegradeTablesOptions {
  /** False for platforms that render `<table>` natively (Substack). */
  enabled: boolean;
  /** Which replacement representation to build. */
  mode: TableHandling;
  /** Shared warning collector. */
  warnings: WarningCollector;
}

/**
 * Rewrite every `<table>` into a representation the target platform accepts
 * (bulleted list or monospace code block).
 *
 * This runs on the hast tree rather than on serialized HTML: attribute values
 * may legally contain literal `<` and `>` (hast-util-to-html only escapes
 * quotes and ampersands there), so text such as an image alt of `</table>`
 * would be indistinguishable from real markup to a string scanner. Working on
 * the tree also removes the need for size limits and a nesting loop.
 *
 * Placed after rehype-sanitize so cell contents are already allowlisted, and
 * before rehype-stringify so serialization escapes everything it emits.
 */
const rehypeDegradeTables: Plugin<[DegradeTablesOptions], Root> =
  (options) => (tree: Root) => {
    if (!options.enabled) return;
    degradeNodes(tree.children, options);
  };

/**
 * Replace `<table>` elements in `nodes` (depth first, so nested tables
 * degrade before the table containing them). Iterates in reverse so removing
 * an empty table does not skip its predecessor.
 */
function degradeNodes(
  nodes: Array<RootContent | ElementContent>,
  options: DegradeTablesOptions
): void {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.type !== "element") continue;
    degradeNodes(node.children, options);
    if (node.tagName !== "table") continue;

    const parsed = parseTable(node);
    if (!parsed) {
      options.warnings.add("table", "table", "Empty table removed");
      nodes.splice(i, 1);
      continue;
    }
    options.warnings.add(
      "table",
      "table",
      options.mode === "list"
        ? "Tables are not supported on this platform; converted to a list"
        : "Tables are not supported on this platform; converted to a code block"
    );
    nodes[i] =
      options.mode === "list" ? tableToList(parsed) : tableToCodeBlock(parsed);
  }
}

/** Build a hast element. */
function el(tagName: string, children: ElementContent[]): Element {
  return { type: "element", tagName, properties: {}, children };
}

/** Build a hast text node. */
function textNode(value: string): ElementContent {
  return { type: "text", value };
}

/** Collect `<tr>` elements of a table, descending through thead/tbody/tfoot. */
function collectRows(table: Element): Element[] {
  const rows: Element[] = [];
  const walk = (nodes: ElementContent[]): void => {
    for (const node of nodes) {
      if (node.type !== "element") continue;
      if (node.tagName === "tr") rows.push(node);
      else if (["thead", "tbody", "tfoot"].includes(node.tagName)) walk(node.children);
    }
  };
  walk(table.children);
  return rows;
}

/**
 * Split a table into headers, per-column alignment, and body rows.
 * Returns null when the table contains no cells at all.
 */
function parseTable(table: Element): ParsedTable | null {
  const headers: ElementContent[][] = [];
  let aligns: TableAlign[] = [];
  const rows: ElementContent[][][] = [];

  for (const row of collectRows(table)) {
    const cells = row.children.filter(
      (c): c is Element =>
        c.type === "element" && (c.tagName === "th" || c.tagName === "td")
    );
    if (cells.length === 0) continue;
    const cellAligns = cells.map(cellAlign);
    if (headers.length === 0 && rows.length === 0 && cells.every((c) => c.tagName === "th")) {
      headers.push(...cells.map((c) => c.children));
      aligns = cellAligns;
    } else {
      rows.push(cells.map((c) => c.children));
      // Headerless tables take alignment from the first body row
      if (aligns.length === 0) aligns = cellAligns;
    }
  }

  if (headers.length === 0 && rows.length === 0) return null;
  return { headers, aligns, rows };
}

/** Read the `align` attribute of a cell. */
function cellAlign(cell: Element): TableAlign {
  const value = cell.properties?.align;
  return value === "left" || value === "center" || value === "right" ? value : null;
}

/**
 * Flatten a cell to plain text for the code-block representation.
 *
 * Images contribute their alt text and footnote references keep their `[^n]`
 * marker, so neither disappears silently the way tag stripping would drop them.
 */
function nodeText(nodes: ElementContent[]): string {
  let text = "";
  for (const node of nodes) {
    if (node.type === "text") {
      text += node.value;
    } else if (node.type === "element") {
      if (node.tagName === "br") text += " ";
      else if (node.tagName === "img") text += imageAlt(node);
      else if (node.tagName === "sup" && isFootnoteRef(node)) text += `[^${nodeText(node.children)}]`;
      else text += nodeText(node.children);
    }
  }
  return text;
}

/** Alt text of an image, or a placeholder when it has none. */
function imageAlt(node: Element): string {
  const alt = node.properties?.alt;
  return typeof alt === "string" && alt.trim() ? alt : "[image]";
}

/** Whether a `<sup>` wraps a GFM footnote reference link. */
function isFootnoteRef(node: Element): boolean {
  return node.children.some(
    (c) =>
      c.type === "element" &&
      c.tagName === "a" &&
      typeof c.properties?.href === "string" &&
      c.properties.href.startsWith("#user-content-fn")
  );
}

/** Deep-copy cell content so header nodes are not shared between rows. */
function cloneNodes(nodes: ElementContent[]): ElementContent[] {
  return nodes.map((node) => structuredClone(node));
}

/**
 * Render a parsed table as a bulleted list, one item per body row, with
 * cells as "<strong>Header:</strong> value" pairs.
 *
 * Cell nodes are reused as-is: they are already-sanitized hast, and
 * rehype-stringify escapes their text on the way out.
 *
 * If Medium's paste handler is ever found to drop <br> inside <li>, switch
 * the row serializer to one <p> per row; only this function changes.
 */
function tableToList(t: ParsedTable): Element {
  if (t.rows.length === 0) {
    // Header-only table: a single bold line
    const children: ElementContent[] = [];
    t.headers.forEach((header, i) => {
      if (i > 0) children.push(textNode(" | "));
      children.push(...header);
    });
    return el("p", [el("strong", children)]);
  }

  const items = t.rows.map((row) => {
    const parts: ElementContent[][] = [];
    row.forEach((cell, i) => {
      const header = t.headers[i];
      const hasLabel = header !== undefined && nodeText(header).trim() !== "";
      const hasValue = nodeText(cell).trim() !== "";
      if (hasLabel) {
        const label = el("strong", [...cloneNodes(header), textNode(":")]);
        parts.push(hasValue ? [label, textNode(" "), ...cell] : [label, textNode(" \u2014")]);
      } else if (hasValue) {
        parts.push([...cell]);
      }
    });

    const children: ElementContent[] = [];
    parts.forEach((part, i) => {
      if (i > 0) children.push(el("br", []));
      children.push(...part);
    });
    return el("li", children);
  });

  return el("ul", items);
}

/**
 * Render a parsed table as a column-aligned monospace table inside a code
 * block. Headed tables come out as valid GFM; headerless ones start with the
 * delimiter row, which GFM does not accept but which reads correctly as text.
 * Emits `<pre><code>` and lets the later code-wrapper pass rewrite it for
 * pre-only platforms.
 */
function tableToCodeBlock(t: ParsedTable): Element {
  const toPlain = (nodes: ElementContent[]): string =>
    nodeText(nodes).replace(/\s{1,1000}/g, " ").trim();

  const headerTexts = t.headers.map(toPlain);
  const rowTexts = t.rows.map((r) => r.map(toPlain));
  const colCount = Math.max(headerTexts.length, ...rowTexts.map((r) => r.length), 1);

  const widths: number[] = [];
  for (let i = 0; i < colCount; i++) {
    // Floor of 3 keeps the "---" delimiter (and ":-:" centered form) valid
    let w = 3;
    if (headerTexts[i]) w = Math.max(w, headerTexts[i].length);
    for (const r of rowTexts) if (r[i]) w = Math.max(w, r[i].length);
    widths.push(w);
  }

  const pad = (text: string, i: number): string => {
    const width = widths[i];
    const align = t.aligns[i] ?? null;
    if (align === "right") return text.padStart(width);
    if (align === "center") {
      const total = width - text.length;
      const left = Math.floor(total / 2);
      return " ".repeat(left) + text + " ".repeat(total - left);
    }
    return text.padEnd(width);
  };

  const line = (cells: string[]): string => {
    const padded: string[] = [];
    for (let i = 0; i < colCount; i++) padded.push(pad(cells[i] ?? "", i));
    return `| ${padded.join(" | ")} |`;
  };

  const separator = widths
    .map((w, i) => {
      const align = t.aligns[i] ?? null;
      if (align === "right") return `${"-".repeat(w - 1)}:`;
      if (align === "center") return `:${"-".repeat(w - 2)}:`;
      if (align === "left") return `:${"-".repeat(w - 1)}`;
      return "-".repeat(w);
    })
    .join(" | ");

  const lines: string[] = [];
  if (headerTexts.length > 0) lines.push(line(headerTexts));
  lines.push(`| ${separator} |`);
  for (const r of rowTexts) lines.push(line(r));

  return el("pre", [el("code", [textNode(lines.join("\n"))])]);
}

/** Named entities decoded from serialized HTML attribute values. */
const ATTR_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * Decode HTML character references from a serialized attribute value in a
 * single pass (so `&amp;#x26;` decodes to the literal text `&#x26;`, never
 * double-decodes). rehype-stringify emits hex references for special
 * characters in attributes.
 */
function decodeAttr(value: string): string {
  return value.replace(
    /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g,
    (m, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
      return ATTR_ENTITIES[named ?? ""] ?? m;
    }
  );
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
