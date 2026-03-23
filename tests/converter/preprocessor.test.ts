import { describe, it, expect } from "vitest";
import { preprocess } from "../../src/converter/preprocessor";
import type { PubcopySettings } from "../../src/settings";

const defaultSettings: PubcopySettings = {
  stripFrontmatter: true,
  stripTags: true,
  stripWikilinks: true,
  imageHandling: "auto",
  showNotification: true,
};

describe("preprocessor", () => {
  it("strips YAML frontmatter", () => {
    const input = `---
title: Test
tags: [test]
---

# Hello World`;
    const result = preprocess(input, defaultSettings);
    expect(result).toBe("# Hello World");
  });

  it("keeps frontmatter when setting disabled", () => {
    const input = `---\ntitle: Test\n---\n\n# Hello`;
    const result = preprocess(input, { ...defaultSettings, stripFrontmatter: false });
    expect(result).toContain("title: Test");
  });

  it("strips Obsidian comments %%...%%", () => {
    const input = "Hello %%secret comment%% World";
    const result = preprocess(input, defaultSettings);
    expect(result).toBe("Hello  World");
  });

  it("strips HTML comments", () => {
    const input = "Hello <!-- hidden --> World";
    const result = preprocess(input, defaultSettings);
    expect(result).toBe("Hello  World");
  });

  it("strips block IDs", () => {
    const input = "Some text ^block-id-123";
    const result = preprocess(input, defaultSettings);
    expect(result).toBe("Some text");
  });

  it("strips tags", () => {
    const input = "Hello #tag world #tag/subtag end";
    const result = preprocess(input, defaultSettings);
    expect(result).not.toContain("#tag");
    expect(result).not.toContain("#tag/subtag");
  });

  it("keeps tags when setting disabled", () => {
    const input = "Hello #tag world";
    const result = preprocess(input, { ...defaultSettings, stripTags: false });
    expect(result).toContain("#tag");
  });

  it("converts plain wikilinks to text", () => {
    const input = "See [[My Page]] for details";
    const result = preprocess(input, defaultSettings);
    expect(result).toBe("See My Page for details");
  });

  it("converts aliased wikilinks to display text", () => {
    const input = "See [[My Page|click here]] for details";
    const result = preprocess(input, defaultSettings);
    expect(result).toBe("See click here for details");
  });

  it("converts heading wikilinks to text", () => {
    const input = "See [[My Page#Section]] for details";
    const result = preprocess(input, defaultSettings);
    expect(result).toBe("See Section for details");
  });

  it("converts block wikilinks to text", () => {
    const input = "See [[My Page#^block-id]] for details";
    const result = preprocess(input, defaultSettings);
    expect(result).toBe("See block-id for details");
  });

  it("strips Obsidian URIs", () => {
    const input = "Open [link](obsidian://open?vault=test&file=note) here";
    const result = preprocess(input, defaultSettings);
    expect(result).not.toContain("obsidian://");
  });

  it("preserves content inside code fences", () => {
    const input = "```\n#tag inside code\n[[wikilink]]\n```";
    const result = preprocess(input, defaultSettings);
    expect(result).toContain("#tag inside code");
    expect(result).toContain("[[wikilink]]");
  });

  it("cleans up multiple blank lines", () => {
    const input = "Line 1\n\n\n\n\nLine 2";
    const result = preprocess(input, defaultSettings);
    expect(result).toBe("Line 1\n\nLine 2");
  });
});
