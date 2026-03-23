import type { App, TFile } from "obsidian";
import type { ImageHandling } from "../settings";
import { WarningCollector } from "../utils/errors";

interface ImageInfo {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico",
]);

function isRemoteUrl(src: string): boolean {
  return src.startsWith("http://") || src.startsWith("https://");
}

function parseImageSize(sizeStr: string): { width?: number; height?: number } {
  if (!sizeStr) return {};

  const match = sizeStr.match(/^(\d+)(?:x(\d+))?$/);
  if (!match) return {};

  const width = parseInt(match[1], 10);
  const height = match[2] ? parseInt(match[2], 10) : undefined;
  return { width, height };
}

function getExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

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

export function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filename));
}

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

function wrapWithCaption(imgTag: string, caption?: string, platformName?: string): string {
  if (!caption) return imgTag;
  if (platformName === "Medium") {
    return `${imgTag}\n<p><em>${escapeHtml(caption)}</em></p>`;
  }
  return `<figure>${imgTag}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

function buildSizeAttrs(width?: number, height?: number): string {
  let attrs = "";
  if (width) attrs += ` width="${width}"`;
  if (height) attrs += ` height="${height}"`;
  return attrs;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
