import { describe, it, expect, vi, beforeEach } from "vitest";
import { escapeHtml } from "../../src/utils/html";
import { showSuccess, showWarnings } from "../../src/utils/notifications";
import { PubcopyError, WarningCollector } from "../../src/utils/errors";
import type { ConversionWarning } from "../../src/utils/errors";

// Capture every Notice construction so we can assert on notification behavior.
// vi.mock is hoisted, so the spy must be created via vi.hoisted.
const noticeSpy = vi.hoisted(() => vi.fn());
vi.mock("obsidian", () => ({
  Notice: class {
    message: string;
    timeout?: number;
    constructor(message: string, timeout?: number) {
      this.message = message;
      this.timeout = timeout;
      noticeSpy(message, timeout);
    }
  },
}));

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("fish & chips")).toBe("fish &amp; chips");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("escapes all special characters together", () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;"
    );
  });

  it("does NOT escape single quotes", () => {
    // Intentional: attributes in generated HTML always use double quotes,
    // so single quotes never break out of an attribute value.
    expect(escapeHtml("it's o'clock")).toBe("it's o'clock");
  });

  it("re-escapes already-escaped input (not idempotent)", () => {
    // The leading "&" of an entity is escaped again; callers must only
    // escape raw strings once.
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("returns plain strings and empty strings unchanged", () => {
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
    expect(escapeHtml("")).toBe("");
  });
});

describe("showSuccess", () => {
  beforeEach(() => {
    noticeSpy.mockClear();
  });

  it("constructs a Notice with the platform name when enabled", () => {
    const result = showSuccess("Medium", true);
    expect(result).toBeUndefined();
    expect(noticeSpy).toHaveBeenCalledTimes(1);
    expect(noticeSpy).toHaveBeenCalledWith("Copied for Medium.", undefined);
  });

  it("interpolates other platform names", () => {
    showSuccess("Substack", true);
    expect(noticeSpy).toHaveBeenCalledWith("Copied for Substack.", undefined);
  });

  it("constructs no Notice when disabled", () => {
    const result = showSuccess("Medium", false);
    expect(result).toBeUndefined();
    expect(noticeSpy).not.toHaveBeenCalled();
  });
});

describe("showWarnings", () => {
  beforeEach(() => {
    noticeSpy.mockClear();
  });

  const warnings: ConversionWarning[] = [
    { elementType: "audio", fileName: "podcast.mp3", reason: "Not supported" },
    { elementType: "mermaid", fileName: "note.md", reason: "Skipped" },
  ];

  it("is a no-op: never throws and shows nothing with warnings present", () => {
    expect(() => showWarnings(warnings, true)).not.toThrow();
    expect(showWarnings(warnings, true)).toBeUndefined();
    expect(noticeSpy).not.toHaveBeenCalled();
  });

  it("is a no-op with warnings absent, regardless of the enabled flag", () => {
    expect(() => showWarnings([], true)).not.toThrow();
    expect(() => showWarnings([], false)).not.toThrow();
    expect(() => showWarnings(warnings, false)).not.toThrow();
    expect(noticeSpy).not.toHaveBeenCalled();
  });
});

describe("PubcopyError", () => {
  it("exposes structured fields", () => {
    const err = new PubcopyError("clipboard", "system", "Permission denied");
    expect(err.elementType).toBe("clipboard");
    expect(err.filePath).toBe("system");
    expect(err.reason).toBe("Permission denied");
    expect(err.name).toBe("PubcopyError");
  });

  it("formats the message as [Pubcopy] <elementType> in <filePath>: <reason>", () => {
    const err = new PubcopyError("image", "photo.png", "File not found");
    expect(err.message).toBe("[Pubcopy] image in photo.png: File not found");
  });

  it("is an Error and a PubcopyError", () => {
    const err = new PubcopyError("embed", "clip.mp4", "Unsupported");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PubcopyError);
  });
});

describe("WarningCollector defensive copy", () => {
  it("mutating the array returned by getWarnings does not affect the collector", () => {
    const collector = new WarningCollector();
    collector.add("audio", "song.mp3", "Not supported");

    const snapshot = collector.getWarnings();
    snapshot.push({ elementType: "fake", fileName: "x", reason: "injected" });
    snapshot.splice(0, 1);

    expect(collector.getWarnings()).toHaveLength(1);
    expect(collector.getWarnings()).toEqual([
      { elementType: "audio", fileName: "song.mp3", reason: "Not supported" },
    ]);
    expect(collector.hasWarnings()).toBe(true);
  });

  it("emptying the returned array does not clear the collector", () => {
    const collector = new WarningCollector();
    collector.add("video", "clip.mp4", "Not supported");

    const snapshot = collector.getWarnings();
    snapshot.length = 0;

    expect(collector.hasWarnings()).toBe(true);
    expect(collector.getWarnings()).toHaveLength(1);
  });
});
