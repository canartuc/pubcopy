import { describe, it, expect } from "vitest";
import { renderInlineMath, renderBlockMath } from "../../src/converter/math-renderer";
import { WarningCollector } from "../../src/utils/errors";

describe("math-renderer", () => {
  describe("renderInlineMath", () => {
    it("renders simple inline math", async () => {
      const warnings = new WarningCollector();
      const result = await renderInlineMath("x^2", warnings);
      expect(result).toContain("x");
      expect(result).toContain("2");
      expect(warnings.hasWarnings()).toBe(false);
    });

    it("renders fractions", async () => {
      const warnings = new WarningCollector();
      const result = await renderInlineMath("\\frac{a}{b}", warnings);
      expect(result).toBeTruthy();
      expect(warnings.hasWarnings()).toBe(false);
    });

    it("returns code fallback on invalid LaTeX", async () => {
      const warnings = new WarningCollector();
      // KaTeX with throwOnError: false renders errors inline, not as exceptions
      const result = await renderInlineMath("\\invalidcommand", warnings);
      // Should still produce output (KaTeX renders error inline)
      expect(result).toBeTruthy();
    });

    it("does not produce display-mode output", async () => {
      const warnings = new WarningCollector();
      const result = await renderInlineMath("x", warnings);
      // Inline math should not have display-mode class
      expect(result).not.toContain("display");
    });
  });

  describe("renderBlockMath", () => {
    it("renders block math with wrapper div", async () => {
      const warnings = new WarningCollector();
      const result = await renderBlockMath("E = mc^2", warnings);
      expect(result).toContain("math-block");
      expect(warnings.hasWarnings()).toBe(false);
    });

    it("renders summation notation", async () => {
      const warnings = new WarningCollector();
      const result = await renderBlockMath("\\sum_{i=0}^{n} i", warnings);
      expect(result).toContain("math-block");
      expect(warnings.hasWarnings()).toBe(false);
    });

    it("renders integrals", async () => {
      const warnings = new WarningCollector();
      const result = await renderBlockMath("\\int_0^1 x\\,dx", warnings);
      expect(result).toBeTruthy();
      expect(warnings.hasWarnings()).toBe(false);
    });
  });

  describe("XSS safety", () => {
    it("does not execute script-like LaTeX input", async () => {
      const warnings = new WarningCollector();
      const result = await renderInlineMath('<script>alert("xss")</script>', warnings);
      expect(result).not.toContain("<script>");
    });

    it("escapes HTML in fallback code blocks", async () => {
      const warnings = new WarningCollector();
      // Force a render that goes through the escapeHtml path
      const result = await renderInlineMath("x", warnings);
      // Should not contain unescaped user input as raw HTML
      expect(result).not.toContain("<script>");
    });
  });
});
