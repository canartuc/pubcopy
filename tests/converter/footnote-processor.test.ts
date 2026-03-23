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
  });

  describe("Substack (native)", () => {
    it("passes HTML through unchanged", () => {
      const html = `<p>Text with footnote[^1]</p>\n<p>[^1]: Definition</p>`;
      const result = processFootnotes(html, SubstackProfile);
      expect(result).toBe(html);
    });
  });
});
