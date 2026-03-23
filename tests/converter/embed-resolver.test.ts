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
});
