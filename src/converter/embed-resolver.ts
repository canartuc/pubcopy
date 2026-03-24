/**
 * @module converter/embed-resolver
 *
 * Resolves Obsidian embed syntax (`![[note]]`, `![[note#heading]]`, `![[note#^block-id]]`)
 * by reading the referenced content from the vault and inlining it.
 *
 * Processing order in the pipeline:
 * 1. Embed resolver runs FIRST (needs raw `![[...]]` syntax).
 * 2. Preprocessor runs second (strips remaining Obsidian syntax).
 * 3. HTML converter runs third (parses standard markdown).
 *
 * Safety mechanisms:
 * - **Max depth (5)**: Prevents runaway recursion from deeply nested embeds.
 * - **Visited set**: Prevents infinite loops from circular references (A embeds B, B embeds A).
 * - **File type filtering**: Image embeds are skipped (handled by image-handler).
 *   Audio, video, and PDF embeds are removed with a warning.
 */

import type { App } from "obsidian";
import { WarningCollector } from "../utils/errors";
import { isImageFile } from "./image-handler";

/** Maximum recursion depth for nested embeds. */
const MAX_EMBED_DEPTH = 5;

/** Audio file extensions that trigger skip-with-warning behavior. */
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac"]);
/** Video file extensions that trigger skip-with-warning behavior. */
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "avi", "mkv"]);
/** PDF extension for skip-with-warning behavior. */
const PDF_EXTENSION = "pdf";

/** Extract the lowercase file extension from a filename. */
function getExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

function isAudioFile(filename: string): boolean {
  return AUDIO_EXTENSIONS.has(getExtension(filename));
}

function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(getExtension(filename));
}

function isPdfFile(filename: string): boolean {
  return getExtension(filename) === PDF_EXTENSION;
}

/** Parsed representation of an Obsidian embed reference. */
interface EmbedRef {
  fullMatch: string;
  fileName: string;
  /** If the embed targets a specific heading section. */
  heading?: string;
  /** If the embed targets a specific block ID. */
  blockId?: string;
}

/**
 * Parse an embed match string into structured fields.
 *
 * Handles three patterns:
 * - `![[filename]]` (full note)
 * - `![[filename#heading]]` (heading section)
 * - `![[filename#^block-id]]` (specific block)
 *
 * @returns Parsed reference, or null if the syntax doesn't match.
 */
function parseEmbedRef(match: string): EmbedRef | null {
  const refMatch = match.match(/^!\[\[([^\]#|]+)(?:#(\^)?([^\]|]+))?\]\]$/);
  if (!refMatch) return null;

  const fileName = refMatch[1].trim();
  const isBlock = refMatch[2] === "^";
  const ref = refMatch[3]?.trim();

  return {
    fullMatch: match,
    fileName,
    heading: isBlock ? undefined : ref,
    blockId: isBlock ? ref : undefined,
  };
}

/**
 * Extract a heading section from a note's content.
 *
 * Captures everything from the target heading down to the next heading
 * of equal or higher level (or end of file).
 *
 * @param content - Full note content.
 * @param heading - The heading text to search for (without `#` prefix).
 * @returns The extracted section, or empty string if heading not found.
 */
function extractHeadingSection(content: string, heading: string): string {
  const lines = content.split("\n");
  let capturing = false;
  let headingLevel = 0;
  const result: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();

      if (capturing) {
        // Stop at same or higher level heading
        if (level <= headingLevel) break;
        result.push(line);
      } else if (text === heading) {
        capturing = true;
        headingLevel = level;
        result.push(line);
      }
    } else if (capturing) {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Extract a specific block (paragraph with a `^block-id` suffix) from a note.
 *
 * @param content - Full note content.
 * @param blockId - The block identifier (without `^` prefix).
 * @returns The block text with the `^block-id` stripped, or empty string if not found.
 */
function extractBlock(content: string, blockId: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.includes(`^${blockId}`)) {
      return line.replace(/ ?\^[\w-]+$/, "").trim();
    }
  }
  return "";
}

/**
 * Resolve all `![[...]]` embeds in the text by reading referenced content from the vault.
 *
 * Image embeds are left untouched (handled later by image-handler).
 * Audio, video, and PDF embeds are removed with warnings.
 * Note, heading, and block embeds are resolved and their content inlined.
 *
 * @param text - Markdown text potentially containing embed references.
 * @param app - Obsidian App instance for vault and metadata access.
 * @param warnings - Collector for non-fatal issues (missing files, circular refs, etc.).
 * @param depth - Current recursion depth (starts at 0, max {@link MAX_EMBED_DEPTH}).
 * @param visited - Set of embed keys already processed in this chain (circular ref detection).
 * @returns Text with embeds replaced by their resolved content.
 */
export async function resolveEmbeds(
  text: string,
  app: App,
  warnings: WarningCollector,
  depth: number = 0,
  visited: Set<string> = new Set()
): Promise<string> {
  if (depth >= MAX_EMBED_DEPTH) return text;

  const embedRegex = /!\[\[([^\]]+)\]\]/g;
  const matches = [...text.matchAll(embedRegex)];

  let result = text;

  for (const match of matches) {
    const fullMatch = match[0];

    // Extract bare filename (strip pipe values and fragment refs) to check file type
    const rawInner = match[1];
    const bareFileName = rawInner.split("|")[0].split("#")[0].trim();

    // Image embeds are handled by image-handler in the html-converter stage
    if (isImageFile(bareFileName)) continue;

    const parsed = parseEmbedRef(fullMatch);
    if (!parsed) continue;

    const { fileName } = parsed;

    // Skip unsupported media types with warnings
    if (isAudioFile(fileName)) {
      warnings.add("audio", fileName, "Audio embeds not supported");
      result = result.replace(fullMatch, "");
      continue;
    }
    if (isVideoFile(fileName)) {
      warnings.add("video", fileName, "Video embeds not supported");
      result = result.replace(fullMatch, "");
      continue;
    }
    if (isPdfFile(fileName)) {
      warnings.add("pdf", fileName, "PDF embeds not supported");
      result = result.replace(fullMatch, "");
      continue;
    }

    // Circular reference protection
    const embedKey = `${fileName}#${parsed.heading ?? ""}#${parsed.blockId ?? ""}`;
    if (visited.has(embedKey)) {
      warnings.add("embed", fileName, "Circular reference detected");
      result = result.replace(fullMatch, "");
      continue;
    }

    try {
      const file = app.metadataCache.getFirstLinkpathDest(fileName, "");
      if (!file) {
        warnings.add("embed", fileName, "Referenced note not found");
        result = result.replace(fullMatch, "");
        continue;
      }

      let content = await app.vault.read(file);

      // Extract the specific section or block if referenced
      if (parsed.heading) {
        content = extractHeadingSection(content, parsed.heading);
      } else if (parsed.blockId) {
        content = extractBlock(content, parsed.blockId);
      }

      if (!content.trim()) {
        warnings.add("embed", fileName, "Referenced content is empty");
        result = result.replace(fullMatch, "");
        continue;
      }

      // Recursively resolve nested embeds in the inlined content
      const newVisited = new Set(visited);
      newVisited.add(embedKey);
      content = await resolveEmbeds(content, app, warnings, depth + 1, newVisited);

      result = result.replace(fullMatch, content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.add("embed", fileName, `Failed to resolve: ${msg}`);
      result = result.replace(fullMatch, "");
    }
  }

  return result;
}
