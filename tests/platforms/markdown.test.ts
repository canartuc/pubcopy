import { describe, it, expect } from "vitest";
import { MarkdownProfile } from "../../src/platforms/markdown";

describe("MarkdownProfile", () => {
  it("has correct name", () => {
    expect(MarkdownProfile.name).toBe("Markdown");
  });

  it("outputs markdown", () => {
    expect(MarkdownProfile.outputMode).toBe("markdown");
  });

  it("allows all heading levels", () => {
    expect(MarkdownProfile.maxHeadingLevel).toBe(6);
  });

  it("allows unlimited list nesting", () => {
    expect(MarkdownProfile.maxListNestingDepth).toBe(Infinity);
  });
});
