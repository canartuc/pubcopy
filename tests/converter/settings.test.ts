import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/settings";

describe("settings", () => {
  it("has correct default for stripFrontmatter", () => {
    expect(DEFAULT_SETTINGS.stripFrontmatter).toBe(true);
  });

  it("has correct default for stripTags", () => {
    expect(DEFAULT_SETTINGS.stripTags).toBe(true);
  });

  it("has correct default for stripWikilinks", () => {
    expect(DEFAULT_SETTINGS.stripWikilinks).toBe(true);
  });

  it("has correct default for imageHandling", () => {
    expect(DEFAULT_SETTINGS.imageHandling).toBe("auto");
  });

  it("has correct default for showNotification", () => {
    expect(DEFAULT_SETTINGS.showNotification).toBe(true);
  });
});
