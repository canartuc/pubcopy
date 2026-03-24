/**
 * @module clipboard/writer
 *
 * Writes converted HTML to the system clipboard using the
 * [Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write).
 *
 * The clipboard item contains two MIME types:
 * - `text/html`: Rich HTML that Medium/Substack editors interpret on paste.
 * - `text/plain`: Stripped-text fallback for plain-text editors.
 *
 * Obsidian runs on Electron (Chromium), so `navigator.clipboard.write()`
 * is fully supported. Mobile Obsidian may have clipboard restrictions,
 * but the Clipboard API is the most reliable cross-platform approach.
 */

import { PubcopyError } from "../utils/errors";

/**
 * Write both HTML and plain-text representations to the system clipboard.
 *
 * @param html - The platform-optimized HTML string.
 * @param plainText - A plain-text fallback (HTML tags stripped).
 * @throws {PubcopyError} If the clipboard write fails (e.g., permission denied).
 */
export async function writeToClipboard(
  html: string,
  plainText: string
): Promise<void> {
  try {
    const htmlBlob = new Blob([html], { type: "text/html" });
    const textBlob = new Blob([plainText], { type: "text/plain" });

    const clipboardItem = new ClipboardItem({
      "text/html": htmlBlob,
      "text/plain": textBlob,
    });

    await navigator.clipboard.write([clipboardItem]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PubcopyError(
      "clipboard",
      "system",
      `Failed to write to clipboard: ${msg}`
    );
  }
}
