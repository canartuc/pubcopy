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
  tableHandling: "list",
  showNotification: true,
  lastRunVersion: "",
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

  describe("table degradation cannot promote attribute text to markup", () => {
    // A serializer leaves literal < and > alone inside attribute values, so
    // markup-looking text in an alt or title must never be treated as a tag
    // boundary. Parsing the output is the only honest check: a substring
    // search cannot tell an inert attribute value from a live element.
    const codeBlockSettings: PubcopySettings = { ...defaultSettings, tableHandling: "code-block" };

    /**
     * Parse the output and report anything a browser would execute.
     * jsdom parses without running scripts, so this only inspects structure —
     * and unlike a substring search it distinguishes a live element from
     * identical text sitting inertly inside an attribute value.
     */
    function liveThreats(html: string): string[] {
      const found: string[] = [];
      const walk = (element: Element): void => {
        const tag = element.tagName.toLowerCase();
        if (["script", "iframe", "object", "embed"].includes(tag)) found.push(`<${tag}>`);
        for (const attr of Array.from(element.attributes)) {
          if (attr.name.startsWith("on")) found.push(`${tag}[${attr.name}]`);
          if (/^\s*javascript:/i.test(attr.value)) found.push(`${tag}[${attr.name}]=javascript:`);
        }
        for (const child of Array.from(element.children)) walk(child);
      };
      const container = document.createElement("div");
      container.innerHTML = html;
      for (const child of Array.from(container.children)) walk(child);
      return found;
    }

    const vectors: [string, string][] = [
      ["script tag inside an image alt", '| H |\n| --- |\n| ![</table><script>alert(1)</script>](http://e.com/a.png) |'],
      ["onerror image inside a link title", '| H |\n| --- |\n| [x](http://e.com "</table><img src=y onerror=alert(1)>") |'],
      ["javascript: URI split across two attributes", '<a href="javascript<table>" title="</table>:alert(1)">click</a>'],
      ["event handler on a raw table cell", '<table><tr><td onclick="alert(1)">x</td></tr></table>'],
      ["payload inside a nested raw table", '<table><tr><td><a href="javascript:alert(1)">x</a><table><tr><td onmouseover="alert(2)">y</td></tr></table></td></tr></table>'],
      ["closing tags as literal cell text", "| H |\n| --- |\n| a </table></td></tr> b |"],
    ];

    for (const [name, markdown] of vectors) {
      it(`emits nothing executable for ${name} (list mode)`, async () => {
        const app = new App();
        const result = await convert(markdown, MediumProfile, defaultSettings, app as never);
        expect(liveThreats(result.html)).toEqual([]);
      });

      it(`emits nothing executable for ${name} (code-block mode)`, async () => {
        const app = new App();
        const result = await convert(markdown, MediumProfile, codeBlockSettings, app as never);
        expect(liveThreats(result.html)).toEqual([]);
      });
    }

    it("keeps content whose cell carries a very long style attribute", async () => {
      const app = new App();
      const style = "font-family:Calibri;".repeat(15);
      const markdown = `<table><tr><th>H1</th><th>H2</th></tr><tr><td style="${style}">first</td><td>second</td></tr></table>`;
      const result = await convert(markdown, MediumProfile, defaultSettings, app as never);
      expect(result.html).toContain("<strong>H1:</strong> first");
      expect(result.html).toContain("<strong>H2:</strong> second");
    });

    it("keeps rows far larger than any regex bound", async () => {
      const app = new App();
      const bigCell = "X".repeat(12000);
      const markdown = `| A |\n| --- |\n| small1 |\n| ${bigCell} |\n| small2 |`;
      const result = await convert(markdown, MediumProfile, defaultSettings, app as never);
      expect(result.html).toContain(bigCell);
      expect(result.html).toContain("small1");
      expect(result.html).toContain("small2");
    });

    it("does not warn about tables when a link title merely mentions one", async () => {
      const app = new App();
      const result = await convert('Some [l](https://x.com "a <table> b") text.', MediumProfile, defaultSettings, app as never);
      expect(result.warnings.getWarnings().some((w) => w.elementType === "table")).toBe(false);
    });
  });
});
