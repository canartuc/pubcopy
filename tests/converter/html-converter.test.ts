import { describe, it, expect } from "vitest";
import { convertToHtml } from "../../src/converter/html-converter";
import { WarningCollector } from "../../src/utils/errors";
import { MediumProfile } from "../../src/platforms/medium";
import { SubstackProfile } from "../../src/platforms/substack";
import { App } from "../mocks/obsidian";
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

function createMockApp(): App {
  return new App();
}

/** Compute the maximum <ul>/<ol> nesting depth present in an HTML string. */
function maxListDepth(html: string): number {
  let depth = 0;
  let max = 0;
  for (const m of html.matchAll(/<(\/?)[ou]l\b/g)) {
    if (m[1]) {
      depth--;
    } else {
      depth++;
      max = Math.max(max, depth);
    }
  }
  return max;
}

describe("html-converter", () => {
  describe("basic conversion", () => {
    it("converts simple markdown to HTML", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml("# Hello\n\nWorld", MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).toContain("<h1>Hello</h1>");
      expect(result.html).toContain("<p>World</p>");
    });

    it("converts bold and italic", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml("**bold** and *italic*", MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).toContain("<strong>bold</strong>");
      expect(result.html).toContain("<em>italic</em>");
    });
  });

  describe("XSS prevention", () => {
    it("strips script tags from raw HTML in markdown", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        '<script>alert("xss")</script>\n\nSafe text',
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("<script>");
      expect(result.html).not.toContain("alert");
    });

    it("strips iframe tags", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        '<iframe src="https://evil.com"></iframe>\n\nSafe text',
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("<iframe");
    });

    it("strips style tags", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        '<style>body { background: red; }</style>\n\nSafe text',
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("<style>");
    });

    it("strips form elements", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        '<form action="https://evil.com"><input type="text"><button>Submit</button></form>',
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("<form");
      expect(result.html).not.toContain("<input");
      expect(result.html).not.toContain("<button");
    });

    it("strips object and embed tags", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        '<object data="evil.swf"></object><embed src="evil.swf">',
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("<object");
      expect(result.html).not.toContain("<embed");
    });

    it("strips event handler attributes from allowed elements", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        '<a href="https://example.com" onclick="alert(1)">link</a>',
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("onclick");
    });

    it("strips user-authored data:image/svg+xml URIs", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=" alt="xss">',
        MediumProfile, defaultSettings, app as never, warnings
      );
      // data: URIs from user-authored content must be stripped by sanitizer
      expect(result.html).not.toContain("data:image/svg+xml");
    });

    it("strips javascript: protocol from hrefs", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        '<a href="javascript:alert(1)">link</a>',
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("javascript:");
    });

    it("neutralizes script tags injected inside highlights", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        '==<script>alert("xss")</script>==',
        MediumProfile, defaultSettings, app as never, warnings
      );
      // Raw <script> must not appear — it should be entity-encoded or stripped
      expect(result.html).not.toContain("<script>");
      // The content is wrapped in <strong> from the highlight conversion
      expect(result.html).toContain("<strong>");
    });
  });

  describe("callout conversion", () => {
    it("converts callout syntax to blockquote with bold label", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "> [!note] This is important\n> More content here",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("<strong>Note:</strong>");
      expect(result.html).toContain("blockquote");
    });

    it("handles foldable callout markers", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "> [!warning]+ Be careful",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("<strong>Warning:</strong>");
    });
  });

  describe("highlight conversion", () => {
    it("converts ==text== to <strong> for Medium (no mark support)", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "Some ==highlighted== text",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("<strong>highlighted</strong>");
      expect(result.html).not.toContain("==highlighted==");
    });

    it("converts ==text== to <strong> for Substack (no mark support)", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "Some ==highlighted== text",
        SubstackProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("<strong>highlighted</strong>");
      expect(result.html).not.toContain("==highlighted==");
    });
  });

  describe("task list conversion", () => {
    it("converts unchecked tasks to unicode", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "- [ ] Unchecked task",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("\u2610");
    });

    it("converts checked tasks to unicode", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "- [x] Checked task",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("\u2611");
    });
  });

  describe("mermaid handling", () => {
    it("strips mermaid blocks and adds warning", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "Before\n\n```mermaid\ngraph TD\nA --> B\n```\n\nAfter",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("mermaid");
      expect(result.html).not.toContain("graph TD");
      expect(warnings.hasWarnings()).toBe(true);
    });
  });

  describe("heading capping", () => {
    it("caps headings at H4 for Medium", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "##### Heading 5\n###### Heading 6",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("<h5>");
      expect(result.html).not.toContain("<h6>");
      expect(result.html).toContain("<h4>");
    });

    it("preserves all headings for Substack", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "##### Heading 5",
        SubstackProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("<h5>");
    });
  });

  describe("code block wrapper", () => {
    it("keeps pre-code wrapper for Medium", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "```js\nconsole.log('hi')\n```",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("<pre><code");
    });

    it("removes inner code wrapper for Substack", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "```js\nconsole.log('hi')\n```",
        SubstackProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("<pre><code");
      expect(result.html).toContain("<pre");
    });
  });

  describe("code protection in pre-pass (regression)", () => {
    it("does not render inline math inside code fences", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "```bash\necho $HOME costs $5\n```",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("katex");
      expect(result.html).toContain("$HOME costs $5");
    });

    it("does not render block math inside code fences", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "```\n$$x^2$$\n```",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("katex");
      expect(result.html).toContain("$$x^2$$");
    });

    it("does not convert highlights inside code fences", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "```\n==not a highlight==\n```",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("==not a highlight==");
      expect(result.html).not.toContain("<strong>not a highlight</strong>");
    });

    it("does not convert task lists inside code fences", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "```\n- [ ] todo item\n```",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("- [ ] todo item");
      expect(result.html).not.toContain("☐");
    });

    it("does not convert callouts inside code fences", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "```\n> [!note] literal callout\n```",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("[!note]");
      expect(result.html).not.toContain("<strong>Note:</strong>");
    });

    it("does not resolve image embeds inside code fences", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "```\n![[image.png]]\n```",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("![[image.png]]");
      expect(result.html).not.toContain("<img");
    });

    it("does not render math inside inline code spans", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "Use `$a$ and $b$` syntax",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("katex");
      expect(result.html).toContain("<code>$a$ and $b$</code>");
    });

    it("still renders math outside code", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "Inline $x+1$ math\n\n```\n$y$ stays\n```",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("katex");
      expect(result.html).toContain("$y$ stays");
    });
  });

  describe("inline-code adjacency (regression)", () => {
    it("converts highlights immediately after an inline code span", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "Run `npm test`==now== always",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("<strong>now</strong>");
      expect(result.html).not.toContain("==now==");
    });

    it("renders inline math immediately after an inline code span", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "See `f`$x+1$ here",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("katex");
    });
  });

  describe("mermaid edge cases (regression)", () => {
    it("keeps documented mermaid blocks nested inside an outer fence", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "````markdown\n```mermaid\ngraph TD;\n```\n````",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("graph TD;");
      expect(warnings.getWarnings().some((w) => w.elementType === "mermaid")).toBe(false);
    });

    it("strips mermaid blocks in CRLF documents", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "Before\r\n\r\n```mermaid\r\ngraph TD;\r\n```\r\n\r\nAfter",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("graph TD;");
      expect(warnings.getWarnings().some((w) => w.elementType === "mermaid")).toBe(true);
    });
  });

  describe("image captions (regression)", () => {
    it("wraps duplicate captioned remote images exactly once each (Medium)", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const md = "![A nice pic](https://example.com/pic.png)\n\n![A nice pic](https://example.com/pic.png)";
      const result = await convertToHtml(md, MediumProfile, defaultSettings, app as never, warnings);
      const imgs = result.html.match(/<img /g) ?? [];
      // Each image must be immediately followed by exactly one caption
      const wrapped = result.html.match(/<img [^>]*>\n<p><em>A nice pic<\/em><\/p>(?!\n<p><em>)/g) ?? [];
      expect(imgs.length).toBe(2);
      expect(wrapped.length).toBe(2);
    });

    it("never nests figure elements for duplicate captioned images (Substack)", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const md = "![A nice pic](https://example.com/pic.png)\n\n![A nice pic](https://example.com/pic.png)";
      const result = await convertToHtml(md, SubstackProfile, defaultSettings, app as never, warnings);
      expect(result.html).not.toContain("<figure><figure>");
      const captions = result.html.match(/<figcaption>A nice pic<\/figcaption>/g) ?? [];
      expect(captions.length).toBe(2);
    });
  });

  describe("consecutive callouts (regression)", () => {
    it("renders two consecutive callouts as separate blockquotes", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const md = "> [!note] First note\n> [!warning] Second warning";
      const result = await convertToHtml(md, MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).toContain("<strong>Note:</strong>");
      expect(result.html).toContain("<strong>Warning:</strong>");
      expect(result.html).not.toContain("[!warning]");
    });
  });

  describe("GFM tables", () => {
    const tableMd = "| Name | Value |\n| :--- | ----: |\n| foo | 1 |\n| bar | 2 |";

    it("degrades tables to a bulleted list for Medium (no table paste support)", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(tableMd, MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).not.toContain("<table>");
      expect(result.html).not.toContain("<td");
      expect(result.html).toContain("<li><strong>Name:</strong> foo<br><strong>Value:</strong> 1</li>");
      expect(result.html).toContain("<strong>Name:</strong> bar");
      expect(warnings.getWarnings().some((w) => w.elementType === "table")).toBe(true);
    });

    it("renders full table structure with alignment for Substack", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(tableMd, SubstackProfile, defaultSettings, app as never, warnings);
      expect(result.html).toContain("<table>");
      expect(result.html).toContain("<thead>");
      expect(result.html).toContain("<tbody>");
      expect(result.html).toContain("<tr>");
      expect(result.html).toContain('<th align="left">Name</th>');
      expect(result.html).toContain('<th align="right">Value</th>');
      expect(result.html).toContain('<td align="left">bar</td>');
      expect(result.html).toContain('<td align="right">1</td>');
      expect(result.html).toContain("</table>");
      expect(warnings.getWarnings().some((w) => w.elementType === "table")).toBe(false);
    });
  });

  describe("table degradation", () => {
    const codeBlockSettings: PubcopySettings = { ...defaultSettings, tableHandling: "code-block" };
    const cveTable = [
      "| Identifier | What the advisory claimed | What the source code showed |",
      "|---|---|---|",
      "| CVE-2026-51296 | Use-after-free at lines 3555 and 3575 of json.c in version 3.41.0 | That file is 2,706 lines long |",
      "| CVE-2026-51302 | Use-after-free in exprComputeOperands() in version 3.41.0 | The function did not exist until mid-2025 |",
      '| CVE-2026-51303 | Use-after-free already patched in version 3.51.3 | The diff to 3.51.3 shows "absolutely no changes to src/expr.c" |',
    ].join("\n");

    it("converts the CVE advisory table to one bullet per row (regression)", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(cveTable, MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).not.toContain("<table>");
      expect(result.html).not.toContain("IdentifierWhat the advisory claimed");
      expect(result.html.match(/<li>/g)).toHaveLength(3);
      expect(result.html).toContain("<strong>Identifier:</strong> CVE-2026-51296");
      expect(result.html).toContain("<strong>What the advisory claimed:</strong> Use-after-free in exprComputeOperands() in version 3.41.0");
      expect(result.html).toContain("<strong>What the source code showed:</strong> That file is 2,706 lines long");
    });

    it("converts tables to an aligned monospace code block in code-block mode", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const tableMd = "| Name | Value |\n| :--- | ----: |\n| foo | 1 |\n| bar | 2 |";
      const result = await convertToHtml(tableMd, MediumProfile, codeBlockSettings, app as never, warnings);
      expect(result.html).not.toContain("<table>");
      expect(result.html).toContain("<pre><code>");
      expect(result.html).toContain("| Name | Value |");
      expect(result.html).toContain("| :--- | ----: |");
      expect(result.html).toContain("| foo  |     1 |");
      expect(result.html).toContain("| bar  |     2 |");
    });

    it("uses an em dash placeholder for empty cells in list mode", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const md = "| A | B |\n| --- | --- |\n| 1 |  |";
      const result = await convertToHtml(md, MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).toContain("<li><strong>A:</strong> 1<br><strong>B:</strong> —</li>");
    });

    it("keeps escaped pipes as literal pipes in cell text", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const md = "| A | B |\n| --- | --- |\n| a\\|b | c |";
      const result = await convertToHtml(md, MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).toContain("<strong>A:</strong> a|b");
    });

    it("preserves inline markup in cells for list mode, strips it in code-block mode", async () => {
      const app = createMockApp();
      const md = "| A | B |\n| --- | --- |\n| **b** | [l](https://x.com) |";
      const listResult = await convertToHtml(md, MediumProfile, defaultSettings, app as never, new WarningCollector());
      expect(listResult.html).toContain("<strong>A:</strong> <strong>b</strong>");
      expect(listResult.html).toContain('<a href="https://x.com">l</a>');
      const codeResult = await convertToHtml(md, MediumProfile, codeBlockSettings, app as never, new WarningCollector());
      // The exact padded line: asserting the rendered row catches a cell that
      // stops being flattened, which a "no <strong> here" check cannot.
      expect(codeResult.html).toContain("| b   | l   |");
      expect(codeResult.html).not.toContain("&#x3C;strong>");
    });

    it("centers cells and emits :-: separators for centered columns", async () => {
      const app = createMockApp();
      const md = "| Wide col | B |\n| :---: | :-: |\n| z | y |";
      const result = await convertToHtml(md, MediumProfile, codeBlockSettings, app as never, new WarningCollector());
      expect(result.html).toContain("| :------: | :-: |");
      expect(result.html).toContain("|    z     |  y  |");
    });

    it("takes alignment from the first body row for a headerless table", async () => {
      const app = createMockApp();
      const md = '<table><tr><td align="right">7</td><td>left</td></tr></table>';
      const result = await convertToHtml(md, MediumProfile, codeBlockSettings, app as never, new WarningCollector());
      expect(result.html).toContain("| --: | ---- |");
      expect(result.html).toContain("|   7 | left |");
    });

    it("renders a header-only table as header plus separator in code-block mode", async () => {
      const app = createMockApp();
      const md = "| A | B |\n| --- | --- |";
      const result = await convertToHtml(md, MediumProfile, codeBlockSettings, app as never, new WarningCollector());
      expect(result.html).toContain("| A   | B   |\n| --- | --- |");
    });

    it("removes a table that has no cells and warns", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "<table><tbody></tbody></table>",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("<table>");
      expect(result.html).not.toContain("<ul>");
      expect(warnings.getWarnings().some((w) => w.reason === "Empty table removed")).toBe(true);
    });

    it("keeps a literal pipe in a cell and still aligns the columns", async () => {
      const app = createMockApp();
      const md = "| A | B |\n| --- | --- |\n| c\\|d | x |";
      const result = await convertToHtml(md, MediumProfile, codeBlockSettings, app as never, new WarningCollector());
      const block = /<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(result.html)?.[1] ?? "";
      const lines = block.split("\n");
      // Written as authored (no "\|" escape leaking into what the reader sees)
      expect(lines[2]).toBe("| c|d | x   |");
      // Widths are measured on the printed text, so every row stays flush
      expect(new Set(lines.map((l) => l.length)).size).toBe(1);
    });

    it("keeps image alt text and footnote markers in code-block mode", async () => {
      const app = createMockApp();
      const md = "| A | B |\n|---|---|\n| ![cap](https://example.com/i.png) | x[^1] |\n\n[^1]: note";
      const result = await convertToHtml(md, MediumProfile, codeBlockSettings, app as never, new WarningCollector());
      expect(result.html).toContain("cap");
      expect(result.html).toContain("[^1]");
    });

    it("degrades every table when a document has several", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const md = "| A |\n| --- |\n| 1 |\n\nBetween.\n\n| B |\n| --- |\n| 2 |";
      const result = await convertToHtml(md, MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).not.toContain("<table>");
      expect(result.html.match(/<ul>/g)).toHaveLength(2);
      expect(result.html).toContain("<p>Between.</p>");
    });

    it("renders a header-only table as a single bold line", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const md = "| A | B |\n| --- | --- |";
      const result = await convertToHtml(md, MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).not.toContain("<table>");
      expect(result.html).toContain("<p><strong>A | B</strong></p>");
    });

    it("degrades a headerless raw HTML table without inventing labels", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const md = "<table><tr><td>one</td><td>two</td></tr></table>";
      const result = await convertToHtml(md, MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).not.toContain("<table>");
      expect(result.html).toContain("<li>one<br>two</li>");
    });

    it("degrades nested raw HTML tables level by level", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const md = "<table><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table>";
      const result = await convertToHtml(md, MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).not.toContain("<table>");
      expect(result.html).toContain("inner");
      expect(result.html).toContain("outer");
      expect(warnings.getWarnings().filter((w) => w.elementType === "table")).toHaveLength(2);
    });

    it("leaves table examples inside code fences untouched", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const md = "```html\n<table><tr><td>x</td></tr></table>\n```";
      const result = await convertToHtml(md, MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).toContain("&#x3C;table>");
      expect(warnings.getWarnings().some((w) => w.elementType === "table")).toBe(false);
    });

    it("leaves blocks after a table intact", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const md = "| A |\n| --- |\n| 1 |\n\nAfter the table.";
      const result = await convertToHtml(md, MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).not.toContain("<table>");
      expect(result.html).toContain("<p>After the table.</p>");
    });

    it("keeps remote images in cells for the later image pass (list mode)", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const md = "| A |\n| --- |\n| ![](https://example.com/pic.png) |";
      const result = await convertToHtml(md, MediumProfile, defaultSettings, app as never, warnings);
      expect(result.html).not.toContain("<table>");
      expect(result.html).toContain('<img src="https://example.com/pic.png"');
    });
  });

  describe("list nesting flattening", () => {
    const deepList = "- level1\n  - level2\n    - level3\n      - level4";

    it("flattens lists beyond depth 2 for Medium while keeping all items", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(deepList, MediumProfile, defaultSettings, app as never, warnings);
      expect(maxListDepth(result.html)).toBe(2);
      // Every item survives even though deeper <ul> wrappers are removed
      expect(result.html).toContain("level1");
      expect(result.html).toContain("level2");
      expect(result.html).toContain("<li>level3");
      expect(result.html).toContain("<li>level4</li>");
    });

    it("preserves full list nesting for Substack", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(deepList, SubstackProfile, defaultSettings, app as never, warnings);
      expect(maxListDepth(result.html)).toBe(4);
      expect(result.html).toContain("<li>level4</li>");
    });
  });

  describe("heading capping with attributes", () => {
    it("caps raw HTML H5/H6 headings carrying attributes to H4 for Medium", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        '<h5 id="custom" class="fancy">Anchored</h5>\n\n###### Six',
        MediumProfile, defaultSettings, app as never, warnings
      );
      // Sanitizer strips the attributes, so the bare <h5> is then capped to <h4>
      expect(result.html).toContain("<h4>Anchored</h4>");
      expect(result.html).toContain("<h4>Six</h4>");
      expect(result.html).not.toContain("<h5");
      expect(result.html).not.toContain("<h6");
      expect(result.html).not.toContain('id="custom"');
    });
  });

  describe("math ordering and escapes", () => {
    it("block math containing an escaped dollar does not break ($$..\\$..$$)", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "$$a = \\$5 + b$$",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain('class="katex"');
      expect(result.html).toContain('class="math-block"');
      expect(result.html).not.toContain("$$");
      expect(warnings.hasWarnings()).toBe(false);
    });

    it("consumes block math before inline math so both render independently", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "$$x^2$$\n\nInline $z+1$ after",
        MediumProfile, defaultSettings, app as never, warnings
      );
      const katexRoots = result.html.match(/<span class="katex">/g) ?? [];
      expect(katexRoots.length).toBe(2);
      // Block math gets display-mode wrapper; inline does not duplicate it
      const displays = result.html.match(/<span class="katex-display">/g) ?? [];
      expect(displays.length).toBe(1);
      expect(result.html).not.toContain("$$");
      expect(result.html).not.toContain("$z+1$");
      expect(warnings.hasWarnings()).toBe(false);
    });

    it("does not treat escaped \\$ as math delimiters", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "It costs \\$5 and \\$10 today",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).not.toContain("katex");
      // remark unescapes \$ to a literal dollar sign
      expect(result.html).toContain("$5 and $10");
      expect(warnings.hasWarnings()).toBe(false);
    });

    it("does not treat spaced currency dollars as inline math ($100 ... $100)", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "A connector costs $100 a year now. If it really costs $100 a year, models fall apart.",
        MediumProfile, defaultSettings, app as never, warnings
      );
      // The two dollar amounts must survive as literal text, not collapse into math.
      expect(result.html).not.toContain("katex");
      expect(result.html).toContain("$100 a year now");
      expect(result.html).toContain("really costs $100 a year");
      expect(warnings.hasWarnings()).toBe(false);
    });

    it("renders inline math end-to-end with katex markup and no warnings", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "Euler: $e^{i\\pi} + 1 = 0$",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain('class="katex"');
      expect(result.html).not.toContain("katex-display");
      expect(warnings.hasWarnings()).toBe(false);
    });

    it("renders block math end-to-end inside a math-block div with no warnings", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "$$\\frac{a}{b}$$",
        SubstackProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain('<div class="math-block">');
      expect(result.html).toContain('class="katex-display"');
      expect(warnings.hasWarnings()).toBe(false);
    });
  });

  describe("mermaid warning details", () => {
    it("records a mermaid warning and keeps surrounding content intact", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "Intro\n\n```mermaid\nflowchart LR\nX --> Y\n```\n\nOutro",
        MediumProfile, defaultSettings, app as never, warnings
      );
      const collected = warnings.getWarnings();
      expect(collected.length).toBe(1);
      expect(collected[0].elementType).toBe("mermaid");
      expect(collected[0].reason).toContain("not supported");
      expect(result.html).toContain("<p>Intro</p>");
      expect(result.html).toContain("<p>Outro</p>");
      expect(result.html).not.toContain("flowchart");
    });
  });

  describe("callout edge cases", () => {
    it("flushes a callout with content at end of file", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "> [!note] Final thought\n> spanning lines",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("<blockquote>");
      expect(result.html).toContain("<strong>Note:</strong>");
      expect(result.html).toContain("Final thought");
      expect(result.html).toContain("spanning lines");
      expect(result.html).not.toContain("[!note]");
    });

    it("ends the callout when a code fence immediately follows", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "> [!tip] Use this\n```js\nconst x = 1;\n```",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("<strong>Tip:</strong>");
      expect(result.html).toContain("<pre><code");
      expect(result.html).toContain("const x = 1;");
      // Code block renders after the blockquote closes, not inside it
      expect(result.html.indexOf("</blockquote>")).toBeLessThan(result.html.indexOf("<pre><code"));
      expect(result.html).not.toContain("[!tip]");
    });

    it("keeps all lines of multi-line callout content inside the blockquote", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "> [!warning] Title here\n> line one\n> line two\n> line three\n\nAfter paragraph",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("<strong>Warning:</strong>");
      const blockquoteEnd = result.html.indexOf("</blockquote>");
      expect(result.html.indexOf("line one")).toBeLessThan(blockquoteEnd);
      expect(result.html.indexOf("line two")).toBeLessThan(blockquoteEnd);
      expect(result.html.indexOf("line three")).toBeLessThan(blockquoteEnd);
      // Trailing paragraph stays outside the blockquote
      expect(result.html.indexOf("After paragraph")).toBeGreaterThan(blockquoteEnd);
    });

    it("strips the foldable [!tip]+ marker and keeps title and body", async () => {
      const app = createMockApp();
      const warnings = new WarningCollector();
      const result = await convertToHtml(
        "> [!tip]+ Folded open\n> details",
        MediumProfile, defaultSettings, app as never, warnings
      );
      expect(result.html).toContain("<strong>Tip:</strong> Folded open");
      expect(result.html).toContain("details");
      expect(result.html).not.toContain("]+");
      expect(result.html).not.toContain("+ Folded");
    });
  });
});
