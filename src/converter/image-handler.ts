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
import { escapeHtml } from "../utils/html";

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
 * Validate that a binary buffer matches the expected image type by checking magic bytes.
 * Returns true if the content appears valid for the given extension, or if the format
 * cannot be validated (SVG, ICO). Returns false if magic bytes contradict the extension.
 */
function validateImageContent(buffer: ArrayBuffer, ext: string): boolean {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4) return false;

  switch (ext) {
    case "png":
      return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    case "jpg":
    case "jpeg":
      return bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
    case "gif":
      return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
    case "webp":
      return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    case "bmp":
      return bytes[0] === 0x42 && bytes[1] === 0x4D;
    case "svg": {
      const text = new TextDecoder().decode(bytes).trimStart();
      return /^(?:<\?xml[\s\S]*?\?>\s*)?<svg\b/i.test(text);
    }
    case "ico":
      return bytes[0] === 0x00 && bytes[1] === 0x00
        && bytes[2] === 0x01 && bytes[3] === 0x00;
    default:
      return false;
  }
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
        if (!validateImageContent(binary, ext)) {
          warnings.add("image", src, "File content does not match image type");
          imgTag = `<img src="${escapeHtml(src)}" alt="${escapeHtml(altText)}"${sizeAttrs}>`;
        } else {
          const mime = getMimeType(ext);
          const base64 = arrayBufferToBase64(binary, ext);
          imgTag = `<img src="data:${mime};base64,${base64}" alt="${escapeHtml(altText)}"${sizeAttrs}>`;
        }
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

/**
 * Sanitize SVG content by removing dangerous elements and attributes.
 *
 * SVG files can contain `<script>`, `<foreignObject>`, event handlers
 * (`onload`, `onerror`), and other executable content. When base64-encoded
 * into data URIs, this content bypasses rehype-sanitize. This function
 * strips known dangerous patterns before encoding.
 */
function sanitizeSvg(svgContent: string): string {
  let sanitized = svgContent;
  // Remove script elements and their content
  sanitized = sanitized.replace(/<script[\s\S]*?<\/script\s*>/gi, "");
  // Remove self-closing script tags
  sanitized = sanitized.replace(/<script[^>]*\/>/gi, "");
  // Remove foreignObject elements (can embed arbitrary HTML)
  sanitized = sanitized.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "");
  // Remove event handler attributes (on*)
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
  // Remove animate/set elements that can dynamically inject javascript: hrefs
  sanitized = sanitized.replace(/<animate[\s\S]*?(?:<\/animate\s*>|\/>)/gi, "");
  sanitized = sanitized.replace(/<set[\s\S]*?(?:<\/set\s*>|\/>)/gi, "");
  // Remove javascript: URIs in href/xlink:href attributes
  sanitized = sanitized.replace(/((?:xlink:)?href\s*=\s*["'])javascript:[^"']*(["'])/gi, "$1#$2");
  // Remove data: URIs in href/xlink:href attributes (can embed scripts)
  sanitized = sanitized.replace(/((?:xlink:)?href\s*=\s*["'])data:[^"']*(["'])/gi, "$1#$2");
  return sanitized;
}

/** Convert an ArrayBuffer to a base64-encoded string, with SVG sanitization. */
function arrayBufferToBase64(buffer: ArrayBuffer, ext: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  // Sanitize SVG content before encoding to prevent script injection via data URIs
  if (ext === "svg") {
    const text = new TextDecoder().decode(bytes);
    const sanitized = sanitizeSvg(text);
    const sanitizedBytes = new TextEncoder().encode(sanitized);
    let sanitizedBinary = "";
    for (let i = 0; i < sanitizedBytes.byteLength; i++) {
      sanitizedBinary += String.fromCharCode(sanitizedBytes[i]);
    }
    return btoa(sanitizedBinary);
  }

  return btoa(binary);
}

