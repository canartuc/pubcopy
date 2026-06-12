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

  describe("embed preservation (regression)", () => {
    it("preserves plain image embeds when stripping wikilinks", () => {
      const input = "Hello ![[image.png]] world";
      const result = preprocess(input, defaultSettings);
      expect(result).toBe("Hello ![[image.png]] world");
    });

    it("preserves sized image embeds when stripping wikilinks", () => {
      const input = "Hello ![[image.png|300]] world";
      const result = preprocess(input, defaultSettings);
      expect(result).toBe("Hello ![[image.png|300]] world");
    });

    it("preserves captioned image embeds when stripping wikilinks", () => {
      const input = "![[photo.jpg|My caption]]";
      const result = preprocess(input, defaultSettings);
      expect(result).toBe("![[photo.jpg|My caption]]");
    });

    it("preserves heading embeds while converting heading wikilinks", () => {
      const input = "![[Note#Section]] and [[Note#Section]]";
      const result = preprocess(input, defaultSettings);
      expect(result).toBe("![[Note#Section]] and Section");
    });

    it("converts adjacent wikilinks with no separator", () => {
      const input = "[[alpha]][[beta]]";
      const result = preprocess(input, defaultSettings);
      expect(result).toBe("alphabeta");
    });
  });

  describe("code protection (regression)", () => {
    it("protects fence content even when earlier replacements shift offsets", () => {
      const input =
        "%%this is a much longer obsidian comment that shifts offsets considerably%%\n\n" +
        "```\ncode with #insidetag and [[wikilink]]\n```";
      const result = preprocess(input, defaultSettings);
      expect(result).toContain("#insidetag");
      expect(result).toContain("[[wikilink]]");
    });

    it("protects inline code spans from tag stripping", () => {
      const input = "Use `#channel` to join";
      const result = preprocess(input, defaultSettings);
      expect(result).toBe("Use `#channel` to join");
    });

    it("protects inline code spans from wikilink conversion", () => {
      const input = "Type `[[link]]` to create a link";
      const result = preprocess(input, defaultSettings);
      expect(result).toBe("Type `[[link]]` to create a link");
    });

    it("still strips syntax outside inline code on the same line", () => {
      const input = "Real [[Page]] and literal `[[link]]` here #tag";
      const result = preprocess(input, defaultSettings);
      expect(result).toBe("Real Page and literal `[[link]]` here");
    });
  });

  describe("frontmatter edge cases (regression)", () => {
    it("strips CRLF frontmatter", () => {
      const input = "---\r\ntitle: Test\r\n---\r\n# Hello";
      const result = preprocess(input, defaultSettings);
      expect(result).not.toContain("title: Test");
      expect(result).toContain("# Hello");
    });
  });
});
