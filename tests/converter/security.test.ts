import { describe, it, expect } from "vitest";
import { convert } from "../../src/converter/index";
import { escapeHtml } from "../../src/utils/html";
import { processFootnotes } from "../../src/converter/footnote-processor";
import { MediumProfile } from "../../src/platforms/medium";
import { App, TFile } from "../mocks/obsidian";
import type { PubcopySettings } from "../../src/settings";

const defaultSettings: PubcopySettings = {
  stripFrontmatter: true,
  stripTags: true,
  stripWikilinks: true,
  imageHandling: "auto",
  showNotification: true,
};

describe("security", () => {
  describe("escapeHtml", () => {
    it("escapes ampersands", () => {
      expect(escapeHtml("a & b")).toBe("a &amp; b");
    });

    it("escapes less-than", () => {
      expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    });

    it("escapes greater-than", () => {
      expect(escapeHtml("a > b")).toBe("a &gt; b");
    });

    it("escapes double quotes", () => {
      expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
    });

    it("handles empty string", () => {
      expect(escapeHtml("")).toBe("");
    });

    it("escapes all special chars in combination", () => {
      expect(escapeHtml('<img src="x" onerror="alert(1)">')).toBe(
        "&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;"
      );
    });
  });

  describe("footnote XSS prevention", () => {
    it("escapes HTML in footnote content", () => {
      const html = `<p>Text[^1]</p>\n<p>[^1]: <script>alert("xss")</script></p>`;
      const result = processFootnotes(html, MediumProfile);
      expect(result).not.toContain("<script>");
      expect(result).toContain("&lt;script&gt;");
    });

    it("escapes HTML in inline footnotes", () => {
      const html = `<p>Text^[<img onerror="alert(1)">]</p>`;
      const result = processFootnotes(html, MediumProfile);
      // The raw HTML must be entity-escaped so it renders as text, not executable HTML
      expect(result).toContain("&lt;img");
      expect(result).toContain("&quot;alert(1)&quot;");
      // The original raw tag must not appear unescaped
      expect(result).not.toContain('<img onerror="alert(1)">');
    });
  });

  describe("pipeline XSS prevention", () => {
    it("strips script injection from markdown content", async () => {
      const app = new App();
      const result = await convert(
        '# Title\n\n<script>alert("xss")</script>\n\nParagraph',
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).not.toContain("<script>");
      expect(result.html).toContain("<h1>Title</h1>");
    });

    it("strips nested XSS attempts", async () => {
      const app = new App();
      const result = await convert(
        '<div><script>alert(1)</script></div>',
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).not.toContain("<script>");
    });

    it("strips img onerror XSS", async () => {
      const app = new App();
      const result = await convert(
        '<img src="x" onerror="alert(1)">',
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).not.toContain("onerror");
    });
  });

  describe("input size limits", () => {
    it("rejects input larger than 2MB", async () => {
      const app = new App();
      const hugeInput = "x".repeat(2_000_001);
      await expect(
        convert(hugeInput, MediumProfile, defaultSettings, app as never)
      ).rejects.toThrow("too large");
    });

    it("accepts input under 2MB", async () => {
      const app = new App();
      const input = "# Hello\n\nWorld";
      const result = await convert(input, MediumProfile, defaultSettings, app as never);
      expect(result.html).toBeTruthy();
    });
  });

  describe("replacement pattern injection", () => {
    it("preserves special replacement patterns in embedded content", async () => {
      const app = new App();
      const file = new TFile("notes/special.md");
      // Literal $1 outside math delimiters — would be corrupted if
      // a string replacer were used instead of a function replacer
      (app as App).vault.addMockFile("notes/special.md", "Match group $1 and text");
      (app as App).metadataCache.addMockLookup("special", file);

      const result = await convert(
        "Tip: ![[special]]",
        MediumProfile,
        defaultSettings,
        app as never
      );
      // The literal "$1" must survive without being interpreted
      // as a regex backreference replacement pattern
      expect(result.plainText).toContain("Match group $1 and text");
      expect(result.html).not.toContain("![[special]]");
    });

    it("preserves $& pattern in content without corruption", async () => {
      const app = new App();
      const file = new TFile("notes/regex.md");
      (app as App).vault.addMockFile("notes/regex.md", "Use $& for full match");
      (app as App).metadataCache.addMockLookup("regex", file);

      const result = await convert(
        "Tip: ![[regex]]",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.plainText).toContain("$&");
    });
  });

  describe("ReDoS resistance", () => {
    it("handles pathological highlight patterns without hanging", async () => {
      const app = new App();
      // This would cause catastrophic backtracking on a naive regex
      const input = "==" + "=".repeat(100) + "==";
      const start = Date.now();
      await convert(input, MediumProfile, defaultSettings, app as never);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(5000);
    });

    it("caps inline footnote length at 500 chars", () => {
      const longContent = "a".repeat(501);
      const html = `<p>Text^[${longContent}] end</p>`;
      const result = processFootnotes(html, MediumProfile);
      // Should NOT match because content exceeds 500 chars
      expect(result).toContain(`^[${longContent}]`);
    });
  });
});
