import { describe, it, expect } from "vitest";
import { processFootnotes } from "../../src/converter/footnote-processor";
import { MediumProfile } from "../../src/platforms/medium";
import { SubstackProfile } from "../../src/platforms/substack";

describe("footnote-processor", () => {
  describe("Medium (superscript-endnotes)", () => {
    it("converts footnote definitions to endnotes section", () => {
      const html = `<p>Some text[^1] and more[^2]</p>
<p>[^1]: First note</p>
<p>[^2]: Second note</p>`;

      const result = processFootnotes(html, MediumProfile);
      expect(result).toContain("<sup>1</sup>");
      expect(result).toContain("<sup>2</sup>");
      expect(result).toContain("<h2>Notes</h2>");
      expect(result).toContain("<li>First note</li>");
      expect(result).toContain("<li>Second note</li>");
    });

    it("removes footnote definition paragraphs", () => {
      const html = `<p>Text[^1]</p>\n<p>[^1]: Definition</p>`;
      const result = processFootnotes(html, MediumProfile);
      expect(result).not.toContain("[^1]: Definition");
    });

    it("handles inline footnotes", () => {
      const html = `<p>Some text^[inline note here] end</p>`;
      const result = processFootnotes(html, MediumProfile);
      expect(result).toContain("<sup>");
      expect(result).toContain("<li>inline note here</li>");
    });

    it("produces no endnotes section when no footnotes exist", () => {
      const html = "<p>No footnotes here</p>";
      const result = processFootnotes(html, MediumProfile);
      expect(result).not.toContain("<h2>Notes</h2>");
      expect(result).not.toContain("<ol>");
    });

    describe("GFM-rendered footnotes (regression)", () => {
      // remark-gfm parses [^1] footnotes BEFORE this processor runs, so the
      // input here is GFM's anchor-based markup (post-sanitize), not raw [^1].
      const gfmHtml = [
        '<p>Note<sup><a href="#user-content-fn-1">1</a></sup> and' +
          ' more<sup><a href="#user-content-fn-long">2</a></sup>.</p>',
        "<h2>Footnotes</h2>",
        "<ol>",
        "<li>",
        '<p>First content <a href="#user-content-fnref-1">↩</a></p>',
        "</li>",
        "<li>",
        '<p>Second <em>fancy</em> content <a href="#user-content-fnref-long">↩</a></p>',
        "</li>",
        "</ol>",
      ].join("\n");

      it("converts GFM footnote refs to plain superscripts", () => {
        const result = processFootnotes(gfmHtml, MediumProfile);
        expect(result).toContain("<sup>1</sup>");
        expect(result).toContain("<sup>2</sup>");
        expect(result).not.toContain('href="#user-content-fn');
      });

      it("removes useless back-reference anchors", () => {
        const result = processFootnotes(gfmHtml, MediumProfile);
        expect(result).not.toContain("↩");
        expect(result).not.toContain("fnref");
      });

      it("renames the GFM Footnotes heading to Notes with separator", () => {
        const result = processFootnotes(gfmHtml, MediumProfile);
        expect(result).toContain("<h2>Notes</h2>");
        expect(result).not.toContain("<h2>Footnotes</h2>");
        expect(result).toContain("<hr>");
      });

      it("keeps footnote content intact", () => {
        const result = processFootnotes(gfmHtml, MediumProfile);
        expect(result).toContain("First content");
        expect(result).toContain("Second <em>fancy</em> content");
      });

      it("removes multi-reference back-links (↩ with counter sup)", () => {
        const html =
          '<p>A<sup><a href="#user-content-fn-1">1</a></sup>' +
          'B<sup><a href="#user-content-fn-1-2">1</a></sup></p>\n' +
          "<h2>Footnotes</h2>\n<ol>\n<li>\n" +
          '<p>Content <a href="#user-content-fnref-1">↩</a> <a href="#user-content-fnref-1-2">↩<sup>2</sup></a></p>\n' +
          "</li>\n</ol>";
        const result = processFootnotes(html, MediumProfile);
        expect(result).not.toContain("↩");
        expect(result).toContain("<p>Content</p>");
      });
    });
  });

  describe("Substack (native)", () => {
    it("passes HTML through unchanged", () => {
      const html = `<p>Text with footnote[^1]</p>\n<p>[^1]: Definition</p>`;
      const result = processFootnotes(html, SubstackProfile);
      expect(result).toBe(html);
    });
  });
});
