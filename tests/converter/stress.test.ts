import { describe, it, expect } from "vitest";
import { convert } from "../../src/converter/index";
import { MediumProfile } from "../../src/platforms/medium";
import { SubstackProfile } from "../../src/platforms/substack";
import { MarkdownProfile } from "../../src/platforms/markdown";
import { PubcopyError } from "../../src/utils/errors";
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

/** Build a varied markdown document of at least `targetLength` characters. */
function buildLargeDoc(targetLength: number): string {
  const parts: string[] = [];
  let length = 0;
  let i = 0;
  while (length < targetLength) {
    i++;
    const block =
      `## Section ${i}\n\n` +
      `Paragraph **bold ${i}** and *italic* with a [link](https://example.com/${i}) inside. ` +
      `Some more filler prose ${i} to grow the note steadily.\n\n` +
      `- item a${i}\n- item b${i}\n  - nested ${i}\n\n` +
      `> quote ${i}\n\n` +
      "```js\n" + `const v${i} = ${i};\n` + "```\n\n" +
      `| H1 | H2 |\n| --- | --- |\n| a${i} | b${i} |\n\n` +
      `==hl ${i}==\n\n- [x] done ${i}\n\n`;
    parts.push(block);
    length += block.length;
  }
  return parts.join("");
}

describe("convert() stress and extreme inputs", () => {
  describe("size limits", () => {
    it("converts a ~1.5MB varied note without throwing in under 30 seconds", async () => {
      const app = createMockApp();
      const doc = buildLargeDoc(1_500_000);
      expect(doc.length).toBeGreaterThanOrEqual(1_500_000);
      expect(doc.length).toBeLessThan(2_000_000);

      const start = performance.now();
      const result = await convert(doc, MediumProfile, defaultSettings, app as never);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(30_000);
      expect(result.html.length).toBeGreaterThan(0);
      expect(result.html).toContain("<h2>Section 1</h2>");
      expect(result.html).toContain("<strong>hl 1</strong>");
      expect(result.plainText.length).toBeGreaterThan(0);
    }, 30_000);

    it("rejects input over 2,000,000 chars with a PubcopyError mentioning 'too large'", async () => {
      const app = createMockApp();
      const huge = "x".repeat(2_000_001);

      let err: unknown;
      try {
        await convert(huge, MediumProfile, defaultSettings, app as never);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(PubcopyError);
      expect((err as Error).message).toContain("too large");
    });

    it("rejects a small note whose embeds expand past 2MB ('too large after resolving embeds')", async () => {
      const app = createMockApp();
      const bigContent = "y".repeat(700_000);
      app.vault.addMockFile("notes/big.md", bigContent);
      app.metadataCache.addMockLookup("big", new TFile("notes/big.md"));

      const note = "Start\n\n![[big]]\n\n![[big]]\n\n![[big]]\n\nEnd";
      expect(note.length).toBeLessThan(100); // the note itself is tiny

      let err: unknown;
      try {
        await convert(note, MediumProfile, defaultSettings, app as never);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(PubcopyError);
      expect((err as Error).message).toContain("too large after resolving embeds");
    });
  });

  describe("high-volume elements", () => {
    it("renders all 500 GFM footnotes as Medium endnotes with no anchor leftovers", async () => {
      const app = createMockApp();
      const refs = Array.from(
        { length: 500 },
        (_, i) => `Sentence number ${i + 1}.[^${i + 1}]`
      ).join("\n\n");
      const defs = Array.from(
        { length: 500 },
        (_, i) => `[^${i + 1}]: Endnote body ${i + 1}.`
      ).join("\n");

      const result = await convert(
        `${refs}\n\n${defs}\n`,
        MediumProfile,
        defaultSettings,
        app as never
      );

      // All 500 references became plain superscript numbers
      expect((result.html.match(/<sup>\d+<\/sup>/g) ?? []).length).toBe(500);
      expect(result.html).toContain("<sup>1</sup>");
      expect(result.html).toContain("<sup>500</sup>");

      // Endnotes section with all 500 definitions
      expect(result.html).toContain("<h2>Notes</h2>");
      expect((result.html.match(/<li>/g) ?? []).length).toBe(500);
      expect(result.html).toContain("Endnote body 1.");
      expect(result.html).toContain("Endnote body 500.");

      // No GFM anchor/user-content leftovers
      expect(result.html).not.toContain("user-content");
      expect(result.html).not.toContain('href="#');
      expect(result.html).not.toContain("↩"); // back-reference arrow
      expect(result.html).not.toContain("[^");
    }, 15_000);

    it("converts 1000 ==highlights== correctly", async () => {
      const app = createMockApp();
      const doc = Array.from(
        { length: 1000 },
        (_, i) => `Row ${i + 1} has ==mark ${i + 1}== inside.`
      ).join("\n\n");

      const result = await convert(doc, MediumProfile, defaultSettings, app as never);

      // Medium does not support <mark>, so highlights become <strong>
      expect((result.html.match(/<strong>mark \d+<\/strong>/g) ?? []).length).toBe(1000);
      expect(result.html).toContain("<strong>mark 1</strong>");
      expect(result.html).toContain("<strong>mark 1000</strong>");
      expect(result.html).not.toContain("==");
    }, 15_000);

    it("renders 200 math expressions via KaTeX in reasonable time", async () => {
      const app = createMockApp();
      const lines: string[] = [];
      for (let i = 1; i <= 150; i++) {
        lines.push(`Expression ${i}: $a_{${i}} + b^{2} = c_{${i}}$`);
      }
      for (let i = 1; i <= 50; i++) {
        lines.push(`$$\\frac{${i}}{n} + x_{${i}}$$`);
      }

      const start = performance.now();
      const result = await convert(
        lines.join("\n\n"),
        MediumProfile,
        defaultSettings,
        app as never
      );
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(10_000);
      expect((result.html.match(/<span class="katex">/g) ?? []).length).toBe(200);
      expect((result.html.match(/<div class="math-block">/g) ?? []).length).toBe(50);
      expect(result.warnings.getWarnings().filter((w) => w.elementType === "math")).toEqual([]);
    }, 15_000);
  });

  describe("malformed and hostile structure", () => {
    it("handles 50 levels of nested blockquotes", async () => {
      const app = createMockApp();
      const result = await convert(
        ">".repeat(50) + " deep value",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect((result.html.match(/<blockquote>/g) ?? []).length).toBe(50);
      expect((result.html.match(/<\/blockquote>/g) ?? []).length).toBe(50);
      expect(result.html).toContain("deep value");
    }, 15_000);

    it("handles unbalanced brackets without throwing", async () => {
      const app = createMockApp();
      const result = await convert(
        "a [[ b ![[ c [ d ]]]]] e [[[ f ] g ![[",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).toContain("<p>");
      expect(result.html).toContain("f");
      // The resolvable-looking embed was removed/inlined; raw embed syntax is gone
      expect(result.html).not.toContain("![[ c");
    });

    it("handles an unterminated code fence (code runs to end of input)", async () => {
      const app = createMockApp();
      const result = await convert(
        "Before text.\n\n```python\nx = 1\nprint(x)",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).toContain("Before text.");
      expect(result.html).toContain("<pre><code");
      expect(result.html).toContain("language-python");
      expect(result.html).toContain("print(x)");
    });

    it("leaves lone $ and $$ as literal text (no math rendering)", async () => {
      const app = createMockApp();
      const result = await convert(
        "Cost is $ and that is all. Also $$ here.",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).toContain("Cost is $ and that is all. Also $$ here.");
      expect(result.html).not.toContain("katex");
    });
  });

  describe("pathological repetition (ReDoS probes)", () => {
    it("handles 50k chars of '=' in under 5 seconds", async () => {
      const app = createMockApp();
      const start = performance.now();
      const result = await convert(
        "=".repeat(50_000),
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(performance.now() - start).toBeLessThan(5_000);
      expect(result.html).toContain("=====");
    }, 15_000);

    // Regression: the wikilink-stripping regexes used to backtrack
    // quadratically on unclosed "[[" runs (~5.4s for 50k chars; hours at the
    // 2MB cap). Inner quantifiers are now bounded, making this linear.
    it("handles 50k chars of '[[' in under 5 seconds", async () => {
      const app = createMockApp();
      const start = performance.now();
      const result = await convert(
        "[[".repeat(25_000),
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(performance.now() - start).toBeLessThan(5_000);
      expect(result.html.length).toBeGreaterThan(0);
    }, 60_000);

    it("handles ~50k chars of '![[' in under 5 seconds", async () => {
      const app = createMockApp();
      const start = performance.now();
      const result = await convert(
        "![[".repeat(16_667),
        MediumProfile,
        defaultSettings,
        app as never
      );
      // Same quadratic preprocessor cost as the '[[' case above, but this run
      // stays under the budget (~4.0s measured locally).
      expect(performance.now() - start).toBeLessThan(5_000);
      expect(result.html.length).toBeGreaterThan(0);
    }, 60_000);

    it("handles 50k chars of '$' in under 5 seconds", async () => {
      const app = createMockApp();
      const start = performance.now();
      const result = await convert(
        "$".repeat(50_000),
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(performance.now() - start).toBeLessThan(5_000);
      expect(result.html.length).toBeGreaterThan(0);
    }, 15_000);
  });

  describe("kitchen sink", () => {
    const PNG_BYTES = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03,
    ]);

    function createKitchenSinkApp(): App {
      const app = createMockApp();
      app.vault.addMockFile(
        "notes/snippet.md",
        "Embedded snippet content with **snippet bold**."
      );
      app.metadataCache.addMockLookup("snippet", new TFile("notes/snippet.md"));
      app.vault.addMockBinaryFile("assets/photo.png", PNG_BYTES.buffer);
      app.metadataCache.addMockLookup("photo.png", new TFile("assets/photo.png"));
      return app;
    }

    const kitchenSink = [
      "---",
      "title: Kitchen Sink",
      "tags: [stress, demo]",
      "---",
      "",
      "# Kitchen Sink #inbox",
      "",
      "Intro with [[Other Note|a friendly alias]] and a #project/alpha tag.",
      "",
      "![[snippet]]",
      "",
      "![A nice photo](photo.png)",
      "",
      "![[photo.png]]",
      "",
      "> [!warning] Watch out",
      "> Callout body line.",
      "",
      "##### Deep heading",
      "",
      "| Col A | Col B |",
      "| ----- | ----- |",
      "| one   | two   |",
      "",
      "Inline $E = mc^2$ math and a block:",
      "",
      "$$\\int_0^1 x \\, dx$$",
      "",
      "A claim that needs a source.[^src]",
      "",
      "Some ==team== highlight here.",
      "",
      "- [x] shipped",
      "- [ ] pending",
      "",
      "```js",
      "const price = $100; // ==not a highlight== and $not math$",
      "```",
      "",
      "[^src]: The source of truth.",
    ].join("\n");

    it("converts the kitchen sink for Medium", async () => {
      const app = createKitchenSinkApp();
      const result = await convert(kitchenSink, MediumProfile, defaultSettings, app as never);

      // Frontmatter, tags, and raw Obsidian syntax are gone
      expect(result.html).not.toContain("title: Kitchen Sink");
      expect(result.html).not.toContain("#inbox");
      expect(result.html).not.toContain("![[");
      expect(result.html).toContain("a friendly alias");

      // Note embed inlined and converted
      expect(result.html).toContain("Embedded snippet content");
      expect(result.html).toContain("<strong>snippet bold</strong>");

      // Standard markdown image becomes a base64 data URI of the mock PNG,
      // with a Medium-style italic caption paragraph
      expect(result.html).toContain('src="data:image/png;base64,iVBORw0KGgo');
      expect(result.html).toContain("<p><em>A nice photo</em></p>");

      // Callout -> bold-labelled blockquote
      expect(result.html).toContain("<blockquote>");
      expect(result.html).toContain("<strong>Warning:</strong>");
      expect(result.html).toContain("Callout body line.");

      // Medium caps headings at H4
      expect(result.html).toContain("<h4>Deep heading</h4>");
      expect(result.html).not.toContain("<h5>");

      // Table survives
      expect(result.html).toContain("<table>");
      expect(result.html).toContain("two");

      // Math rendered by KaTeX (1 inline + 1 block)
      expect((result.html.match(/<span class="katex">/g) ?? []).length).toBe(2);
      expect(result.html).toContain('<div class="math-block">');

      // Footnotes become a Notes endnotes section with plain superscripts
      expect(result.html).toContain("<sup>1</sup>");
      expect(result.html).toContain("<h2>Notes</h2>");
      expect(result.html).toContain("The source of truth.");
      expect(result.html).not.toContain("user-content");
      expect(result.html).not.toContain("<h2>Footnotes</h2>");

      // Highlight falls back to <strong> (Medium has no <mark>)
      expect(result.html).toContain("<strong>team</strong>");

      // Task lists become unicode checkboxes
      expect(result.html).toContain("☑ shipped");
      expect(result.html).toContain("☐ pending");

      // Code fence content is untouched: no highlight/math conversion inside
      expect(result.html).toContain("<pre><code");
      expect(result.html).toContain("const price = $100; // ==not a highlight== and $not math$");
      expect(result.html).not.toContain("<strong>not a highlight</strong>");
    }, 15_000);

    it("converts the kitchen sink for Substack", async () => {
      const app = createKitchenSinkApp();
      const result = await convert(kitchenSink, SubstackProfile, defaultSettings, app as never);

      // Substack keeps H5 headings
      expect(result.html).toContain("<h5>Deep heading</h5>");

      // Code blocks use <pre> without inner <code>, content intact
      expect(result.html).not.toContain("<pre><code");
      expect(result.html).toContain("<pre");
      expect(result.html).toContain("const price = $100; // ==not a highlight== and $not math$");

      // Footnotes pass through natively (GFM markup retained)
      expect(result.html).toContain("<h2>Footnotes</h2>");
      expect(result.html).toContain('href="#user-content-fn-');
      expect(result.html).not.toContain("<h2>Notes</h2>");

      // Standard markdown image: data URI wrapped in figure/figcaption
      expect(result.html).toContain('src="data:image/png;base64,iVBORw0KGgo');
      expect(result.html).toContain("<figure>");
      expect(result.html).toContain("<figcaption>A nice photo</figcaption>");

      // Substack also lacks <mark>: highlight falls back to <strong>
      expect(result.html).toContain("<strong>team</strong>");

      // Shared behavior still holds
      expect(result.html).toContain("Embedded snippet content");
      expect(result.html).toContain("<strong>Warning:</strong>");
      expect(result.html).toContain("<table>");
      expect((result.html.match(/<span class="katex">/g) ?? []).length).toBe(2);
      expect(result.html).toContain("☑ shipped");
    }, 15_000);

    it("converts the kitchen sink for Markdown (preprocessed markdown only)", async () => {
      const app = createKitchenSinkApp();
      const result = await convert(kitchenSink, MarkdownProfile, defaultSettings, app as never);

      // Markdown mode: no HTML output
      expect(result.html).toBe("");
      expect(result.elementCount).toBe(0);

      const md = result.plainText;
      // Frontmatter and tags stripped
      expect(md).not.toContain("title: Kitchen Sink");
      expect(md).not.toContain("#inbox");
      expect(md).toContain("# Kitchen Sink");

      // Wikilink converted to alias text, note embed inlined
      expect(md).toContain("a friendly alias");
      expect(md).toContain("Embedded snippet content with **snippet bold**.");

      // Image syntax preserved as-is (markdown mode does no image resolution)
      expect(md).toContain("![A nice photo](photo.png)");
      expect(md).toContain("![[photo.png]]");

      // Obsidian/markdown features left raw
      expect(md).toContain("> [!warning]");
      expect(md).toContain("$E = mc^2$");
      expect(md).toContain("==team==");
      expect(md).toContain("- [x] shipped");
      expect(md).toContain("const price = $100; // ==not a highlight== and $not math$");
      expect(md).toContain("[^src]: The source of truth.");
    });

    // Regression test: before commit cb7428d, wikilink image embeds lost their
    // src entirely — the pre-pass injected <img src="data:..."> BEFORE
    // rehype-sanitize, whose protocols.src allowlist (http/https) stripped the
    // data: URI, yielding <img alt="photo.png"> with no warning. The pre-pass
    // now emits a relative <img> that the post-pass resolves AFTER sanitization.
    it("base64-encodes wikilink image embeds as data: URIs", async () => {
      const app = createKitchenSinkApp();
      const result = await convert(
        "Before ![[photo.png]] after",
        MediumProfile,
        defaultSettings,
        app as never
      );
      expect(result.html).toContain('src="data:image/png;base64,iVBORw0KGgo');
    });
  });
});
