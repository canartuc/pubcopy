import { describe, it, expect } from "vitest";
import { SubstackProfile } from "../../src/platforms/substack";

describe("SubstackProfile", () => {
  it("has correct name", () => {
    expect(SubstackProfile.name).toBe("Substack");
  });

  it("outputs html", () => {
    expect(SubstackProfile.outputMode).toBe("html");
  });

  it("allows all heading levels", () => {
    expect(SubstackProfile.maxHeadingLevel).toBe(6);
  });

  it("allows unlimited list nesting", () => {
    expect(SubstackProfile.maxListNestingDepth).toBe(Infinity);
  });

  it("uses pre-only wrapper", () => {
    expect(SubstackProfile.codeBlockWrapper).toBe("pre-only");
  });

  it("uses native footnotes", () => {
    expect(SubstackProfile.footnoteStrategy).toBe("native");
  });
});
