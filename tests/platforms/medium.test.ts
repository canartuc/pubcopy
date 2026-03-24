import { describe, it, expect } from "vitest";
import { MediumProfile } from "../../src/platforms/medium";

describe("MediumProfile", () => {
  it("has correct name", () => {
    expect(MediumProfile.name).toBe("Medium");
  });

  it("outputs html", () => {
    expect(MediumProfile.outputMode).toBe("html");
  });

  it("caps heading level at 4", () => {
    expect(MediumProfile.maxHeadingLevel).toBe(4);
  });

  it("caps list nesting at 2", () => {
    expect(MediumProfile.maxListNestingDepth).toBe(2);
  });

  it("uses pre-code wrapper", () => {
    expect(MediumProfile.codeBlockWrapper).toBe("pre-code");
  });

  it("uses superscript-endnotes for footnotes", () => {
    expect(MediumProfile.footnoteStrategy).toBe("superscript-endnotes");
  });

  it("does not support highlights", () => {
    expect(MediumProfile.supportsHighlight).toBe(false);
  });

  it("does not support task lists", () => {
    expect(MediumProfile.supportsTaskLists).toBe(false);
  });
});
