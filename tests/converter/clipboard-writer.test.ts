import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeToClipboard } from "../../src/clipboard/writer";

// Mock ClipboardItem since jsdom doesn't have it
class MockClipboardItem {
  types: string[];
  private data: Record<string, Blob>;

  constructor(data: Record<string, Blob>) {
    this.data = data;
    this.types = Object.keys(data);
  }

  async getType(type: string): Promise<Blob> {
    return this.data[type];
  }
}

describe("clipboard-writer", () => {
  beforeEach(() => {
    // Provide ClipboardItem globally
    (globalThis as Record<string, unknown>).ClipboardItem = MockClipboardItem;

    Object.assign(navigator, {
      clipboard: {
        write: vi.fn().mockResolvedValue(undefined),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("calls navigator.clipboard.write with ClipboardItem", async () => {
    await writeToClipboard("<p>Hello</p>", "Hello");
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
  });

  it("passes both text/html and text/plain blobs", async () => {
    await writeToClipboard("<strong>bold</strong>", "bold");

    const call = (navigator.clipboard.write as ReturnType<typeof vi.fn>).mock.calls[0];
    const items = call[0] as MockClipboardItem[];
    expect(items).toHaveLength(1);

    const item = items[0];
    expect(item.types).toContain("text/html");
    expect(item.types).toContain("text/plain");
  });

  it("throws PubcopyError on clipboard failure", async () => {
    (navigator.clipboard.write as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Permission denied")
    );

    await expect(
      writeToClipboard("<p>test</p>", "test")
    ).rejects.toThrow("Failed to write to clipboard");
  });
});
