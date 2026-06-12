import { describe, it, expect } from "vitest";
import { resolveEmbeds } from "../../src/converter/embed-resolver";
import { WarningCollector } from "../../src/utils/errors";
import { App, Vault, MetadataCache, TFile } from "../mocks/obsidian";

function createMockApp(): App {
  return new App();
}

describe("embed-resolver", () => {
  it("skips image embeds (handled by image-handler)", async () => {
    const app = createMockApp();
    const warnings = new WarningCollector();
    const input = "Before ![[photo.png]] after";
    const result = await resolveEmbeds(input, app as never, warnings);
    // Image embeds should be left untouched
    expect(result).toContain("![[photo.png]]");
  });

  it("warns and removes audio embeds", async () => {
    const app = createMockApp();
    const warnings = new WarningCollector();
    const input = "Before ![[recording.mp3]] after";
    const result = await resolveEmbeds(input, app as never, warnings);
    expect(result).not.toContain("![[recording.mp3]]");
    expect(warnings.hasWarnings()).toBe(true);
    expect(warnings.getWarnings()[0].elementType).toBe("audio");
  });

  it("warns and removes video embeds", async () => {
    const app = createMockApp();
    const warnings = new WarningCollector();
    const input = "Before ![[video.mp4]] after";
    const result = await resolveEmbeds(input, app as never, warnings);
    expect(result).not.toContain("![[video.mp4]]");
    expect(warnings.hasWarnings()).toBe(true);
    expect(warnings.getWarnings()[0].elementType).toBe("video");
  });

  it("warns and removes PDF embeds", async () => {
    const app = createMockApp();
    const warnings = new WarningCollector();
    const input = "Before ![[document.pdf]] after";
    const result = await resolveEmbeds(input, app as never, warnings);
    expect(result).not.toContain("![[document.pdf]]");
    expect(warnings.hasWarnings()).toBe(true);
    expect(warnings.getWarnings()[0].elementType).toBe("pdf");
  });

  it("warns when referenced note is not found", async () => {
    const app = createMockApp();
    const warnings = new WarningCollector();
    const input = "Before ![[missing-note]] after";
    const result = await resolveEmbeds(input, app as never, warnings);
    expect(result).not.toContain("![[missing-note]]");
    expect(warnings.hasWarnings()).toBe(true);
    expect(warnings.getWarnings()[0].reason).toContain("not found");
  });

  it("resolves full note embed", async () => {
    const app = createMockApp();
    const file = new TFile("notes/embedded.md");
    app.vault.addMockFile("notes/embedded.md", "# Embedded\nContent here");
    app.metadataCache.addMockLookup("embedded", file);

    const warnings = new WarningCollector();
    const input = "Before ![[embedded]] after";
    const result = await resolveEmbeds(input, app as never, warnings);
    expect(result).toContain("# Embedded");
    expect(result).toContain("Content here");
    expect(warnings.hasWarnings()).toBe(false);
  });

  it("resolves heading embed", async () => {
    const app = createMockApp();
    const file = new TFile("notes/doc.md");
    app.vault.addMockFile(
      "notes/doc.md",
      "# Top\nIntro\n## Section A\nContent A\n## Section B\nContent B"
    );
    app.metadataCache.addMockLookup("doc", file);

    const warnings = new WarningCollector();
    const input = "![[doc#Section A]]";
    const result = await resolveEmbeds(input, app as never, warnings);
    expect(result).toContain("## Section A");
    expect(result).toContain("Content A");
    expect(result).not.toContain("Section B");
  });

  it("resolves block embed", async () => {
    const app = createMockApp();
    const file = new TFile("notes/blocks.md");
    app.vault.addMockFile(
      "notes/blocks.md",
      "First line\nTarget paragraph ^my-block\nThird line"
    );
    app.metadataCache.addMockLookup("blocks", file);

    const warnings = new WarningCollector();
    const input = "![[blocks#^my-block]]";
    const result = await resolveEmbeds(input, app as never, warnings);
    expect(result).toContain("Target paragraph");
    expect(result).not.toContain("^my-block");
  });

  it("resolves nested embeds recursively (A embeds B embeds C)", async () => {
    const app = createMockApp();
    const fileA = new TFile("a.md");
    const fileB = new TFile("b.md");
    const fileC = new TFile("c.md");
    app.vault.addMockFile("a.md", "A-start ![[b]] A-end");
    app.vault.addMockFile("b.md", "B-start ![[c]] B-end");
    app.vault.addMockFile("c.md", "C-content");
    app.metadataCache.addMockLookup("a", fileA);
    app.metadataCache.addMockLookup("b", fileB);
    app.metadataCache.addMockLookup("c", fileC);

    const warnings = new WarningCollector();
    const result = await resolveEmbeds("![[a]]", app as never, warnings);
    expect(result).toBe("A-start B-start C-content B-end A-end");
    expect(result).not.toContain("![[");
    expect(warnings.hasWarnings()).toBe(false);
  });

  it("detects circular references (A embeds B, B embeds A) without looping", async () => {
    const app = createMockApp();
    const fileA = new TFile("a.md");
    const fileB = new TFile("b.md");
    app.vault.addMockFile("a.md", "A-content ![[b]]");
    app.vault.addMockFile("b.md", "B-content ![[a]]");
    app.metadataCache.addMockLookup("a", fileA);
    app.metadataCache.addMockLookup("b", fileB);

    const warnings = new WarningCollector();
    const result = await resolveEmbeds("![[a]]", app as never, warnings);
    // Both notes are inlined once; the circular back-reference is removed
    expect(result).toContain("A-content");
    expect(result).toContain("B-content");
    expect(result).not.toContain("![[");
    const circular = warnings
      .getWarnings()
      .filter((w) => w.reason === "Circular reference detected");
    expect(circular).toHaveLength(1);
    expect(circular[0].fileName).toBe("a");
  });

  it("resolves pipe-aliased embeds (alias is display-only, like Obsidian)", async () => {
    const app = createMockApp();
    const file = new TFile("note.md");
    app.vault.addMockFile(
      "note.md",
      "# Top\nIntro text\n## Section\nSection content"
    );
    app.metadataCache.addMockLookup("note", file);

    const warnings = new WarningCollector();
    const input = "Before ![[note|alias]] middle ![[note#Section|alias]] after";
    const result = await resolveEmbeds(input, app as never, warnings);
    expect(result).toContain("Intro text");
    expect(result).toContain("Section content");
    expect(result).not.toContain("![[");
    expect(result).not.toContain("alias");
    expect(warnings.hasWarnings()).toBe(false);
  });

  it("warns 'empty' and removes the embed when the heading is not found", async () => {
    const app = createMockApp();
    const file = new TFile("doc.md");
    app.vault.addMockFile("doc.md", "# Top\nIntro\n## Section A\nContent A");
    app.metadataCache.addMockLookup("doc", file);

    const warnings = new WarningCollector();
    const result = await resolveEmbeds(
      "Before ![[doc#Missing Heading]] after",
      app as never,
      warnings
    );
    expect(result).toBe("Before  after");
    expect(warnings.hasWarnings()).toBe(true);
    expect(warnings.getWarnings()[0].elementType).toBe("embed");
    expect(warnings.getWarnings()[0].reason).toContain("empty");
  });

  it("warns 'Failed to resolve' when vault.cachedRead throws", async () => {
    const app = createMockApp();
    // Lookup succeeds but the file content is never registered in the vault,
    // so cachedRead throws "File not found: ghost.md".
    app.metadataCache.addMockLookup("ghost", new TFile("ghost.md"));

    const warnings = new WarningCollector();
    const result = await resolveEmbeds("Before ![[ghost]] after", app as never, warnings);
    expect(result).toBe("Before  after");
    expect(warnings.hasWarnings()).toBe(true);
    expect(warnings.getWarnings()[0].reason).toContain("Failed to resolve");
    expect(warnings.getWarnings()[0].reason).toContain("File not found: ghost.md");
  });

  it("warns and removes the embed when the referenced note is empty", async () => {
    const app = createMockApp();
    const file = new TFile("empty.md");
    app.vault.addMockFile("empty.md", "   \n\t\n");
    app.metadataCache.addMockLookup("empty", file);

    const warnings = new WarningCollector();
    const result = await resolveEmbeds("Before ![[empty]] after", app as never, warnings);
    expect(result).toBe("Before  after");
    expect(warnings.hasWarnings()).toBe(true);
    expect(warnings.getWarnings()[0].reason).toContain("Referenced content is empty");
  });

  it("treats different headings of the same note as distinct embed keys", async () => {
    const app = createMockApp();
    const file = new TFile("doc.md");
    // Section A embeds Section B of the same note. The visited-set keys
    // include the heading, so this is NOT flagged as circular.
    app.vault.addMockFile(
      "doc.md",
      "## Section A\nContent A ![[doc#Section B]]\n## Section B\nContent B"
    );
    app.metadataCache.addMockLookup("doc", file);

    const warnings = new WarningCollector();
    const result = await resolveEmbeds("![[doc#Section A]]", app as never, warnings);
    expect(result).toContain("Content A");
    expect(result).toContain("Content B");
    expect(result).not.toContain("![[");
    expect(warnings.hasWarnings()).toBe(false);
  });

  describe("regressions", () => {
    it("matches block IDs exactly, not as substrings", async () => {
      const app = createMockApp();
      const file = new TFile("notes/blocks.md");
      app.vault.addMockFile(
        "notes/blocks.md",
        "Wrong line ^abcd\nRight line ^abc\nOther ^abc-extra"
      );
      app.metadataCache.addMockLookup("blocks", file);

      const warnings = new WarningCollector();
      const result = await resolveEmbeds("![[blocks#^abc]]", app as never, warnings);
      expect(result).toContain("Right line");
      expect(result).not.toContain("Wrong line");
    });

    it("records a warning when the embed depth limit is reached", async () => {
      const app = createMockApp();
      // Build a 7-deep chain: n0 embeds n1 embeds n2 ... (MAX depth is 5)
      for (let i = 0; i < 7; i++) {
        const file = new TFile(`n${i}.md`);
        app.vault.addMockFile(`n${i}.md`, `Level ${i} ![[n${i + 1}]]`);
        app.metadataCache.addMockLookup(`n${i}`, file);
      }
      const warnings = new WarningCollector();
      await resolveEmbeds("![[n0]]", app as never, warnings);
      expect(
        warnings.getWarnings().some((w) => w.reason.toLowerCase().includes("depth"))
      ).toBe(true);
    });

    it("resolves the same embed appearing twice", async () => {
      const app = createMockApp();
      const file = new TFile("twice.md");
      app.vault.addMockFile("twice.md", "Repeated content");
      app.metadataCache.addMockLookup("twice", file);

      const warnings = new WarningCollector();
      const result = await resolveEmbeds(
        "A ![[twice]] B ![[twice]] C",
        app as never,
        warnings
      );
      expect(result).toBe("A Repeated content B Repeated content C");
    });
  });
});
