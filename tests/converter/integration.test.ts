import { describe, it, expect } from "vitest";
import { convert, stripHtmlTags } from "../../src/converter/index";
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

  describe("image embeds through the full pipeline (regression)", () => {
    // A valid 1x1 PNG (correct magic bytes) as binary fixture
    const PNG_BYTES = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0)
    ).buffer;

    function appWithImage(): App {
      const app = createMockApp();
      const file = new TFile("pic.png");
      app.vault.addMockBinaryFile("pic.png", PNG_BYTES);
      app.metadataCache.addMockLookup("pic.png", file);
      return app;
    }

    it("embeds ![[image]] as a base64 data URI surviving sanitization", async () => {
      const app = appWithImage();
      const result = await convert("Before ![[pic.png]] after", MediumProfile, defaultSettings, app as never);
      expect(result.html).toContain("data:image/png;base64,");
      expect(result.html).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="pic.png">/);
    });

    it("keeps width/height for sized embeds ![[image|300]] and ![[image|300x200]]", async () => {
      const app = appWithImage();
      const result = await convert("![[pic.png|300]]\n\n![[pic.png|300x200]]", MediumProfile, defaultSettings, app as never);
      expect(result.html).toContain('width="300"');
      expect(result.html).toContain('height="200"');
      expect(result.html).toContain("data:image/png;base64,");
    });

    it("renders captioned embeds ![[image|caption]] with caption and data URI", async () => {
      const app = appWithImage();
      const medium = await convert("![[pic.png|A red dot]]", MediumProfile, defaultSettings, app as never);
      expect(medium.html).toContain("data:image/png;base64,");
      expect(medium.html).toContain("<p><em>A red dot</em></p>");

      const substack = await convert("![[pic.png|A red dot]]", SubstackProfile, defaultSettings, app as never);
      expect(substack.html).toContain("data:image/png;base64,");
      expect(substack.html).toContain("<figcaption>A red dot</figcaption>");
    });

    it("still strips user-authored data: URIs (sanitizer stays strict)", async () => {
      const app = appWithImage();
      const result = await convert(
        '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=" alt="xss">',
        MediumProfile, defaultSettings, app as never
      );
      expect(result.html).not.toContain("data:image/svg+xml");
    });

    it("resolves image filenames containing & to base64 (attr entity decode)", async () => {
      const app = createMockApp();
      const file = new TFile("Q&A.png");
      app.vault.addMockBinaryFile("Q&A.png", PNG_BYTES);
      app.metadataCache.addMockLookup("Q&A.png", file);

      const result = await convert("![[Q&A.png]]", MediumProfile, defaultSettings, app as never);
      expect(result.html).toContain("data:image/png;base64,");
      expect(result.warnings.getWarnings()).toEqual([]);
    });

    it("renders captions containing & and quotes without entity corruption", async () => {
      const app = appWithImage();
      const result = await convert(
        '![[pic.png|Fish & Chips "fresh"]]',
        SubstackProfile, defaultSettings, app as never
      );
      expect(result.html).toContain("<figcaption>Fish &amp; Chips &quot;fresh&quot;</figcaption>");
      expect(result.html).not.toContain("#x26;");
      expect(result.html).not.toContain("#x22;");
    });

    it("converts CRLF notes end-to-end (frontmatter, content, mermaid)", async () => {
      const app = createMockApp();
      const result = await convert(
        "---\r\ntitle: x\r\n---\r\n# Hi\r\n\r\n```mermaid\r\ngraph TD;\r\n```\r\n\r\nDone",
        MediumProfile, defaultSettings, app as never
      );
      expect(result.html).toContain("<h1>Hi</h1>");
      expect(result.html).toContain("Done");
      expect(result.html).not.toContain("title: x");
      expect(result.html).not.toContain("graph TD;");
    });

    it("falls back to a URL reference when the image is missing from the vault", async () => {
      const app = createMockApp();
      const result = await convert("![[missing.png]]", MediumProfile, defaultSettings, app as never);
      expect(result.html).toContain('<img src="missing.png"');
      expect(result.warnings.getWarnings().some((w) => w.elementType === "image")).toBe(true);
    });
  });

  describe("entity decoding (regression)", () => {
    it("does not double-decode entity-of-an-entity sequences", () => {
      // &#x26;lt; means the literal text "&lt;" — it must NOT become "<"
      expect(stripHtmlTags("<p>&#x26;lt;</p>")).toBe("&lt;");
      expect(stripHtmlTags("<p>&amp;lt;</p>")).toBe("&lt;");
      expect(stripHtmlTags("<p>&amp;amp;</p>")).toBe("&amp;");
    });

    it("decodes astral-plane numeric entities correctly", () => {
      expect(stripHtmlTags("<p>&#128512;</p>")).toBe("😀");
      expect(stripHtmlTags("<p>&#x1F600;</p>")).toBe("😀");
    });

    it("decodes basic named entities", () => {
      expect(stripHtmlTags("<p>A &amp; B &lt;tag&gt; &quot;q&quot; &apos;a&apos;</p>"))
        .toBe("A & B <tag> \"q\" 'a'");
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
