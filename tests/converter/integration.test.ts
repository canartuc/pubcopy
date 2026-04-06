import { describe, it, expect } from "vitest";
import { convert } from "../../src/converter/index";
import { MediumProfile } from "../../src/platforms/medium";
import { SubstackProfile } from "../../src/platforms/substack";
import { MarkdownProfile } from "../../src/platforms/markdown";
import { App, TFile } from "../mocks/obsidian";
import type { PubcopySettings } from "../../src/settings";

const defaultSettings: PubcopySettings = {
  stripFrontmatter: true,
  stripTags: true,
  stripWikilinks: true,
  imageHandling: "auto",
  showNotification: true,
};

function createMockApp(): App {
  return new App();
}

describe("convert() integration", () => {
  describe("full pipeline", () => {
    it("converts markdown to HTML with both html and plainText", async () => {
      const app = createMockApp();
      const result = await convert(
        "# Hello\n\n**Bold** and *italic* text.",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).toContain("<h1>Hello</h1>");
      expect(result.html).toContain("<strong>Bold</strong>");
      expect(result.html).toContain("<em>italic</em>");
      expect(result.plainText).toContain("Hello");
      expect(result.plainText).toContain("Bold");
      expect(result.plainText).not.toContain("<h1>");
    });

    it("strips frontmatter before conversion", async () => {
      const app = createMockApp();
      const result = await convert(
        "---\ntitle: Test\ntags: [a, b]\n---\n\n# Content",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).not.toContain("title: Test");
      expect(result.html).toContain("<h1>Content</h1>");
    });

    it("strips tags and wikilinks", async () => {
      const app = createMockApp();
      const result = await convert(
        "Hello #tag world [[My Page|click here]] end",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).not.toContain("#tag");
      expect(result.html).not.toContain("[[");
      expect(result.html).toContain("click here");
    });

    it("generates element count", async () => {
      const app = createMockApp();
      const result = await convert(
        "# Title\n\nParagraph\n\n- Item 1\n- Item 2",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.elementCount).toBeGreaterThan(0);
    });

    it("collects warnings without failing", async () => {
      const app = createMockApp();
      const result = await convert(
        "Before ![[recording.mp3]] after",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.warnings.hasWarnings()).toBe(true);
      expect(result.html).not.toContain("recording.mp3");
    });
  });

  describe("markdown output mode", () => {
    it("returns preprocessed markdown without HTML conversion", async () => {
      const app = createMockApp();
      const result = await convert(
        "---\ntitle: Test\n---\n\n# Hello\n\n**Bold** #tag",
        MarkdownProfile,
        defaultSettings,
        app as never
      );
      // html should be empty in markdown mode
      expect(result.html).toBe("");
      // plainText contains the preprocessed markdown
      expect(result.plainText).toContain("# Hello");
      expect(result.plainText).toContain("**Bold**");
      expect(result.plainText).not.toContain("title: Test");
      expect(result.plainText).not.toContain("#tag");
      expect(result.elementCount).toBe(0);
    });
  });

  describe("platform differences", () => {
    it("caps headings at H4 for Medium", async () => {
      const app = createMockApp();
      const result = await convert(
        "##### Heading 5\n\n###### Heading 6",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).not.toContain("<h5>");
      expect(result.html).not.toContain("<h6>");
      expect(result.html).toContain("<h4>");
    });

    it("preserves H5/H6 for Substack", async () => {
      const app = createMockApp();
      const result = await convert(
        "##### Heading 5",
        SubstackProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).toContain("<h5>");
    });

    it("removes inner <code> wrapper for Substack", async () => {
      const app = createMockApp();
      const result = await convert(
        "```js\nconst x = 1;\n```",
        SubstackProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).not.toContain("<pre><code");
      expect(result.html).toContain("<pre");
    });
  });

  describe("plainText generation", () => {
    it("converts <br> to newlines", async () => {
      const app = createMockApp();
      const result = await convert(
        "Line 1  \nLine 2",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.plainText).toContain("Line 1");
      expect(result.plainText).toContain("Line 2");
    });

    it("strips all HTML tags from plainText", async () => {
      const app = createMockApp();
      const result = await convert(
        "# Title\n\n**bold** [link](https://example.com)",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.plainText).not.toMatch(/<[^>]+>/);
    });

    it("decodes HTML entities in plainText", async () => {
      const app = createMockApp();
      const result = await convert(
        "A & B < C > D",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.plainText).toContain("A & B");
    });
  });

  describe("embed resolution", () => {
    it("inlines embedded note content", async () => {
      const app = createMockApp();
      const file = new TFile("notes/embedded.md");
      app.vault.addMockFile("notes/embedded.md", "Embedded content here");
      app.metadataCache.addMockLookup("embedded", file);

      const result = await convert(
        "Before ![[embedded]] after",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).toContain("Embedded content here");
    });

    it("handles missing embeds gracefully", async () => {
      const app = createMockApp();
      const result = await convert(
        "Before ![[nonexistent]] after",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.warnings.hasWarnings()).toBe(true);
      expect(result.html).not.toContain("![[nonexistent]]");
    });
  });
});
