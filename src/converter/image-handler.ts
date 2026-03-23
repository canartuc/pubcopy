/**
 * @module converter/image-handler
 *
 * Resolves image references to HTML `<img>` tags with appropriate sources.
 *
 * Three image handling modes (configured in settings):
 * - `auto`: Local vault images are base64-encoded, remote URLs pass through.
 * - `always-base64`: Attempts base64 for everything (remote falls back to URL).
 * - `always-url`: Keeps all references as URLs (local images may break outside vault).
 *
 * Also handles:
 * - Obsidian image size syntax (`![[image.png|300]]` or `![[image.png|300x200]]`).
 * - Image captions: wraps in `<figure>/<figcaption>` for Substack,
 *   or italic paragraph below for Medium (which strips figcaption on paste).
 */

import type { App } from "obsidian";
import type { ImageHandling } from "../settings";
import { WarningCollector } from "../utils/errors";

/** Supported image file extensions. Used to distinguish image embeds from note embeds. */
const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico",
]);

/** Check whether a URL points to a remote resource (http/https). */
function isRemoteUrl(src: string): boolean {
  return src.startsWith("http://") || src.startsWith("https://");
}

/**
 * Parse Obsidian image size syntax.
 *
 * @param sizeStr - The pipe value (e.g., "300", "300x200", or empty string).
 * @returns Parsed width and optional height, or empty object if not a size.
 */
function parseImageSize(sizeStr: string): { width?: number; height?: number } {
  if (!sizeStr) return {};

  const match = sizeStr.match(/^(\d+)(?:x(\d+))?$/);
  if (!match) return {};

  const width = parseInt(match[1], 10);
  const height = match[2] ? parseInt(match[2], 10) : undefined;
  return { width, height };
}

/** Extract the lowercase file extension from a filename. */
function getExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/** Map file extensions to MIME types for base64 data URIs. */
function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    bmp: "image/bmp",
    ico: "image/x-icon",
  };
  return mimeMap[ext] ?? "image/png";
}

/**
 * Check whether a filename has a recognized image extension.
 * Used by the embed resolver to distinguish `![[photo.png]]` from `![[note]]`.
 */
export function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filename));
}

/**
 * Resolve an image reference to a complete HTML `<img>` tag.
 *
 * For local images, reads the binary file from the vault and base64-encodes it.
 * For remote images, passes the URL through.
 * Wraps in `<figure>/<figcaption>` (Substack) or italic paragraph (Medium) when
 * a caption is provided.
 *
 * @param app - Obsidian App instance for vault access.
 * @param src - Image source (filename for local, URL for remote).
 * @param alt - Alt text for the image.
 * @param sizeStr - Optional size string ("300" or "300x200").
 * @param mode - Image handling mode from settings.
 * @param warnings - Collector for non-fatal issues (missing files, etc.).
 * @param caption - Optional caption text to display below the image.
 * @param platformName - Target platform name (affects caption rendering).
 * @returns Complete HTML string for the image, potentially wrapped in a figure.
 */
export async function resolveImage(
  app: App,
  src: string,
  alt: string,
  sizeStr: string | undefined,
  mode: ImageHandling,
  warnings: WarningCollector,
  caption?: string,
  platformName?: string
): Promise<string> {
  const { width, height } = parseImageSize(sizeStr ?? "");
  const sizeAttrs = buildSizeAttrs(width, height);
  const altText = caption || alt;

  let imgTag: string;

  if (isRemoteUrl(src)) {
    if (mode === "always-base64") {
      warnings.add("image", src, "Remote image kept as URL (cannot fetch in plugin)");
    }
    imgTag = `<img src="${escapeHtml(src)}" alt="${escapeHtml(altText)}"${sizeAttrs}>`;
  } else if (mode === "always-url") {
    imgTag = `<img src="${escapeHtml(src)}" alt="${escapeHtml(altText)}"${sizeAttrs}>`;
  } else {
    try {
      const file = app.metadataCache.getFirstLinkpathDest(src, "");
      if (!file) {
        warnings.add("image", src, "File not found in vault");
        imgTag = `<img src="${escapeHtml(src)}" alt="${escapeHtml(altText)}"${sizeAttrs}>`;
      } else {
        const binary = await app.vault.readBinary(file);
        const ext = getExtension(file.name);
        const mime = getMimeType(ext);
        const base64 = arrayBufferToBase64(binary);
        imgTag = `<img src="data:${mime};base64,${base64}" alt="${escapeHtml(altText)}"${sizeAttrs}>`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.add("image", src, `Failed to read: ${msg}`);
      imgTag = `<img src="${escapeHtml(src)}" alt="${escapeHtml(altText)}"${sizeAttrs}>`;
    }
  }

  return wrapWithCaption(imgTag, caption, platformName);
}

/**
 * Wrap an `<img>` tag with a caption, using the appropriate format for the platform.
 *
 * - Medium: `<img>` followed by `<p><em>caption</em></p>` (Medium strips figcaption).
 * - Substack/others: `<figure><img><figcaption>caption</figcaption></figure>`.
 * - No caption: returns the bare `<img>` tag.
 */
function wrapWithCaption(imgTag: string, caption?: string, platformName?: string): string {
  if (!caption) return imgTag;
  if (platformName === "Medium") {
    return `${imgTag}\n<p><em>${escapeHtml(caption)}</em></p>`;
  }
  return `<figure>${imgTag}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

/** Build HTML width/height attributes string from optional dimensions. */
function buildSizeAttrs(width?: number, height?: number): string {
  let attrs = "";
  if (width) attrs += ` width="${width}"`;
  if (height) attrs += ` height="${height}"`;
  return attrs;
}

/** Convert an ArrayBuffer to a base64-encoded string. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Escape HTML special characters to prevent injection in attribute values. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
