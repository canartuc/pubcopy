import { PubcopyError } from "../utils/errors";

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
