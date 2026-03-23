import type { App } from "obsidian";
import { WarningCollector } from "../utils/errors";
import { isImageFile } from "./image-handler";

const MAX_EMBED_DEPTH = 5;

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "avi", "mkv"]);
const PDF_EXTENSION = "pdf";

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

interface EmbedRef {
  fullMatch: string;
  fileName: string;
  heading?: string;
  blockId?: string;
}

function parseEmbedRef(match: string): EmbedRef | null {
  // ![[filename#heading]] or ![[filename#^block-id]] or ![[filename]]
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

function extractBlock(content: string, blockId: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.includes(`^${blockId}`)) {
      return line.replace(/ ?\^[\w-]+$/, "").trim();
    }
  }
  return "";
}

export async function resolveEmbeds(
  text: string,
  app: App,
  warnings: WarningCollector,
  depth: number = 0,
  visited: Set<string> = new Set()
): Promise<string> {
  if (depth >= MAX_EMBED_DEPTH) return text;

  // Match ![[...]] embeds (but not image embeds handled separately)
  const embedRegex = /!\[\[([^\]]+)\]\]/g;
  const matches = [...text.matchAll(embedRegex)];

  let result = text;

  for (const match of matches) {
    const fullMatch = match[0];

    // Extract the raw inner content to check for images with pipe values
    const rawInner = match[1];
    const bareFileName = rawInner.split("|")[0].split("#")[0].trim();

    // Skip image embeds entirely (handled by image-handler in html-converter)
    if (isImageFile(bareFileName)) continue;

    const parsed = parseEmbedRef(fullMatch);
    if (!parsed) continue;

    const { fileName } = parsed;

    // Skip audio/video/PDF with warning
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

    // Circular reference check
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

      // Recursively resolve nested embeds
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
