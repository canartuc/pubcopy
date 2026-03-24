/**
 * @module utils/html
 *
 * Shared HTML utility functions used across converter modules.
 */

/**
 * Escape HTML special characters to prevent XSS.
 *
 * Replaces `&`, `<`, `>`, and `"` with their HTML entity equivalents.
 * Used at every point where user-controlled content is injected into HTML output.
 *
 * @param str - Raw string to escape.
 * @returns HTML-safe string.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
