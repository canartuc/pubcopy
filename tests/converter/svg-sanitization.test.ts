import { describe, it, expect } from "vitest";
import { resolveImage } from "../../src/converter/image-handler";
import { WarningCollector } from "../../src/utils/errors";
import { App, TFile } from "../mocks/obsidian";

function createSvgBuffer(svgContent: string): ArrayBuffer {
  return new TextEncoder().encode(svgContent).buffer;
}

function createMockAppWithSvg(filename: string, svgContent: string): App {
  const app = new App();
  const file = new TFile(filename);
  app.vault.addMockBinaryFile(filename, createSvgBuffer(svgContent));
  app.metadataCache.addMockLookup(filename, file);
  return app;
}

describe("SVG sanitization", () => {
  it("strips script tags from SVG before base64 encoding", async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script><circle r="50"/></svg>';
    const app = createMockAppWithSvg("test.svg", svgContent);
    const warnings = new WarningCollector();

    const result = await resolveImage(
      app as never, "test.svg", "test", undefined, "auto", warnings
    );

    // Decode the base64 to verify script is stripped
    const base64Match = result.match(/base64,([^"]+)/);
    expect(base64Match).toBeTruthy();
    const decoded = atob(base64Match![1]);
    expect(decoded).not.toContain("<script>");
    expect(decoded).toContain("<circle");
  });

  it("strips event handler attributes from SVG elements", async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="50" onload="alert(1)" onclick="alert(2)"/></svg>';
    const app = createMockAppWithSvg("test.svg", svgContent);
    const warnings = new WarningCollector();

    const result = await resolveImage(
      app as never, "test.svg", "test", undefined, "auto", warnings
    );

    const base64Match = result.match(/base64,([^"]+)/);
    const decoded = atob(base64Match![1]);
    expect(decoded).not.toContain("onload");
    expect(decoded).not.toContain("onclick");
  });

  it("strips foreignObject from SVG", async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>HTML injection</div></foreignObject></svg>';
    const app = createMockAppWithSvg("test.svg", svgContent);
    const warnings = new WarningCollector();

    const result = await resolveImage(
      app as never, "test.svg", "test", undefined, "auto", warnings
    );

    const base64Match = result.match(/base64,([^"]+)/);
    const decoded = atob(base64Match![1]);
    expect(decoded).not.toContain("<foreignObject");
    expect(decoded).not.toContain("HTML injection");
  });

  it("strips javascript: URIs from SVG hrefs", async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>Click</text></a></svg>';
    const app = createMockAppWithSvg("test.svg", svgContent);
    const warnings = new WarningCollector();

    const result = await resolveImage(
      app as never, "test.svg", "test", undefined, "auto", warnings
    );

    const base64Match = result.match(/base64,([^"]+)/);
    const decoded = atob(base64Match![1]);
    expect(decoded).not.toContain("javascript:");
  });

  it("strips xlink:href javascript: URIs", async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="javascript:alert(1)"><text>Click</text></a></svg>';
    const app = createMockAppWithSvg("xlink.svg", svgContent);
    const warnings = new WarningCollector();

    const result = await resolveImage(
      app as never, "xlink.svg", "test", undefined, "auto", warnings
    );

    const base64Match = result.match(/base64,([^"]+)/);
    const decoded = atob(base64Match![1]);
    expect(decoded).not.toContain("javascript:");
  });

  it("strips animate elements that can inject javascript hrefs", async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><a href="#"><animate attributeName="href" to="javascript:alert(1)"/><text>Click</text></a></svg>';
    const app = createMockAppWithSvg("animate.svg", svgContent);
    const warnings = new WarningCollector();

    const result = await resolveImage(
      app as never, "animate.svg", "test", undefined, "auto", warnings
    );

    const base64Match = result.match(/base64,([^"]+)/);
    const decoded = atob(base64Match![1]);
    expect(decoded).not.toContain("<animate");
  });

  it("preserves safe SVG content", async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/><text x="50" y="50">Hello</text></svg>';
    const app = createMockAppWithSvg("safe.svg", svgContent);
    const warnings = new WarningCollector();

    const result = await resolveImage(
      app as never, "safe.svg", "test", undefined, "auto", warnings
    );

    const base64Match = result.match(/base64,([^"]+)/);
    const decoded = atob(base64Match![1]);
    expect(decoded).toContain("<circle");
    expect(decoded).toContain("<text");
    expect(decoded).toContain("Hello");
  });

  it("does not sanitize non-SVG images", async () => {
    const pngContent = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG magic bytes
    const app = new App();
    const file = new TFile("photo.png");
    app.vault.addMockBinaryFile("photo.png", pngContent.buffer);
    app.metadataCache.addMockLookup("photo.png", file);
    const warnings = new WarningCollector();

    const result = await resolveImage(
      app as never, "photo.png", "photo", undefined, "auto", warnings
    );

    expect(result).toContain("data:image/png;base64,");
  });
});

describe("image content-type validation", () => {
  it("rejects a file with wrong magic bytes for PNG", async () => {
    // File named .png but contains JPEG magic bytes
    const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]);
    const app = new App();
    const file = new TFile("fake.png");
    app.vault.addMockBinaryFile("fake.png", jpegBytes.buffer);
    app.metadataCache.addMockLookup("fake.png", file);
    const warnings = new WarningCollector();

    const result = await resolveImage(
      app as never, "fake.png", "fake", undefined, "auto", warnings
    );

    // Should fall back to URL reference, not base64 encode with wrong MIME
    expect(result).not.toContain("data:image/png;base64,");
    expect(warnings.hasWarnings()).toBe(true);
    expect(warnings.getWarnings()[0].reason).toContain("does not match");
  });

  it("accepts valid PNG magic bytes", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const app = new App();
    const file = new TFile("valid.png");
    app.vault.addMockBinaryFile("valid.png", pngBytes.buffer);
    app.metadataCache.addMockLookup("valid.png", file);
    const warnings = new WarningCollector();

    const result = await resolveImage(
      app as never, "valid.png", "valid", undefined, "auto", warnings
    );

    expect(result).toContain("data:image/png;base64,");
    expect(warnings.hasWarnings()).toBe(false);
  });

  it("accepts valid JPEG magic bytes", async () => {
    const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    const app = new App();
    const file = new TFile("photo.jpg");
    app.vault.addMockBinaryFile("photo.jpg", jpegBytes.buffer);
    app.metadataCache.addMockLookup("photo.jpg", file);
    const warnings = new WarningCollector();

    const result = await resolveImage(
      app as never, "photo.jpg", "photo", undefined, "auto", warnings
    );

    expect(result).toContain("data:image/jpeg;base64,");
    expect(warnings.hasWarnings()).toBe(false);
  });

  it("accepts valid GIF magic bytes", async () => {
    const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const app = new App();
    const file = new TFile("anim.gif");
    app.vault.addMockBinaryFile("anim.gif", gifBytes.buffer);
    app.metadataCache.addMockLookup("anim.gif", file);
    const warnings = new WarningCollector();

    const result = await resolveImage(
      app as never, "anim.gif", "anim", undefined, "auto", warnings
    );

    expect(result).toContain("data:image/gif;base64,");
    expect(warnings.hasWarnings()).toBe(false);
  });

  it("rejects files that are too small", async () => {
    const tinyBytes = new Uint8Array([0x00, 0x00]);
    const app = new App();
    const file = new TFile("tiny.png");
    app.vault.addMockBinaryFile("tiny.png", tinyBytes.buffer);
    app.metadataCache.addMockLookup("tiny.png", file);
    const warnings = new WarningCollector();

    const result = await resolveImage(
      app as never, "tiny.png", "tiny", undefined, "auto", warnings
    );

    expect(result).not.toContain("data:image/png;base64,");
    expect(warnings.hasWarnings()).toBe(true);
  });
});
