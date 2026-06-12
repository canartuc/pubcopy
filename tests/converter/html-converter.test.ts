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
  showNotification: true,
};

function createMockApp(): App {
  return new App();
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
});
