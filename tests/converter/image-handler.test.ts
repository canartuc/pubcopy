import { describe, it, expect } from "vitest";
import { isImageFile, resolveImage } from "../../src/converter/image-handler";
import { WarningCollector } from "../../src/utils/errors";
import { App, TFile } from "../mocks/obsidian";

/** Build an ArrayBuffer from raw byte values. */
function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

/** Build an ArrayBuffer from text content (for SVG validation). */
function textBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/** Register a local image in the mock vault and metadata cache. */
function addVaultImage(app: App, linkpath: string, path: string, data: ArrayBuffer): void {
  const file = new TFile(path);
  app.metadataCache.addMockLookup(linkpath, file);
  app.vault.addMockBinaryFile(path, data);
}

const PNG_BYTES = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

describe("image-handler", () => {
  describe("isImageFile", () => {
    it("recognizes png files", () => {
      expect(isImageFile("photo.png")).toBe(true);
    });

    it("recognizes jpg files", () => {
      expect(isImageFile("photo.jpg")).toBe(true);
    });

    it("recognizes jpeg files", () => {
      expect(isImageFile("photo.jpeg")).toBe(true);
    });

    it("recognizes gif files", () => {
      expect(isImageFile("animation.gif")).toBe(true);
    });

    it("recognizes svg files", () => {
      expect(isImageFile("diagram.svg")).toBe(true);
    });

    it("recognizes webp files", () => {
      expect(isImageFile("photo.webp")).toBe(true);
    });

    it("rejects markdown files", () => {
      expect(isImageFile("notes.md")).toBe(false);
    });

    it("rejects pdf files", () => {
      expect(isImageFile("document.pdf")).toBe(false);
    });

    it("rejects mp3 files", () => {
      expect(isImageFile("audio.mp3")).toBe(false);
    });

    it("rejects files without extension", () => {
      expect(isImageFile("noextension")).toBe(false);
    });
  });

  describe("resolveImage", () => {
    describe("remote URLs", () => {
      it("passes remote URL through in auto mode without warnings", async () => {
        const app = new App();
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "https://example.com/pic.png", "alt text", undefined, "auto", warnings
        );
        expect(result).toBe('<img src="https://example.com/pic.png" alt="alt text">');
        expect(warnings.hasWarnings()).toBe(false);
      });

      it("passes remote URL through in always-url mode without warnings", async () => {
        const app = new App();
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "http://example.com/pic.png", "alt text", undefined, "always-url", warnings
        );
        expect(result).toBe('<img src="http://example.com/pic.png" alt="alt text">');
        expect(warnings.hasWarnings()).toBe(false);
      });

      it("keeps remote URL in always-base64 mode and records a warning", async () => {
        const app = new App();
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "https://example.com/pic.png", "alt text", undefined, "always-base64", warnings
        );
        expect(result).toBe('<img src="https://example.com/pic.png" alt="alt text">');
        expect(warnings.hasWarnings()).toBe(true);
        const warning = warnings.getWarnings()[0];
        expect(warning.elementType).toBe("image");
        expect(warning.fileName).toBe("https://example.com/pic.png");
        expect(warning.reason).toContain("Remote image kept as URL");
      });
    });

    describe("always-url mode with local files", () => {
      it("keeps local file path as URL without reading the vault", async () => {
        const app = new App();
        addVaultImage(app, "photo.png", "images/photo.png", PNG_BYTES);
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "photo.png", "alt text", undefined, "always-url", warnings
        );
        expect(result).toBe('<img src="photo.png" alt="alt text">');
        expect(result).not.toContain("data:");
        expect(warnings.hasWarnings()).toBe(false);
      });
    });

    describe("fallbacks", () => {
      it("falls back to URL with a warning when file is not found in vault", async () => {
        const app = new App();
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "missing.png", "alt text", undefined, "auto", warnings
        );
        expect(result).toBe('<img src="missing.png" alt="alt text">');
        expect(warnings.hasWarnings()).toBe(true);
        expect(warnings.getWarnings()[0].reason).toBe("File not found in vault");
      });

      it("falls back to URL with 'Failed to read' warning when readBinary throws", async () => {
        const app = new App();
        // Lookup resolves but no binary is registered, so the mock vault throws.
        app.metadataCache.addMockLookup("broken.png", new TFile("images/broken.png"));
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "broken.png", "alt text", undefined, "auto", warnings
        );
        expect(result).toBe('<img src="broken.png" alt="alt text">');
        expect(warnings.hasWarnings()).toBe(true);
        const warning = warnings.getWarnings()[0];
        expect(warning.reason).toContain("Failed to read:");
        expect(warning.reason).toContain("Binary file not found: images/broken.png");
      });
    });

    describe("size parsing", () => {
      it("adds a width attribute for a single number", async () => {
        const app = new App();
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "https://example.com/pic.png", "alt", "300", "auto", warnings
        );
        expect(result).toBe('<img src="https://example.com/pic.png" alt="alt" width="300">');
        expect(result).not.toContain("height=");
      });

      it("adds width and height attributes for WxH syntax", async () => {
        const app = new App();
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "https://example.com/pic.png", "alt", "300x200", "auto", warnings
        );
        expect(result).toBe('<img src="https://example.com/pic.png" alt="alt" width="300" height="200">');
      });

      it("ignores a non-numeric size string (callers route it as a caption instead)", async () => {
        const app = new App();
        const warnings = new WarningCollector();
        // html-converter only passes the pipe value as sizeStr when it is numeric;
        // a non-numeric pipe value is passed as caption. If a non-numeric string
        // does reach sizeStr, it produces no size attributes.
        const result = await resolveImage(
          app as never, "https://example.com/pic.png", "alt", "My caption", "auto", warnings
        );
        expect(result).toBe('<img src="https://example.com/pic.png" alt="alt">');
        expect(result).not.toContain("width=");
        expect(result).not.toContain("height=");
      });
    });

    describe("caption wrapping", () => {
      it("renders caption as italic paragraph for Medium", async () => {
        const app = new App();
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "https://example.com/pic.png", "alt", undefined, "auto", warnings,
          "My caption", "Medium"
        );
        expect(result).toBe(
          '<img src="https://example.com/pic.png" alt="My caption">\n<p><em>My caption</em></p>'
        );
        expect(result).not.toContain("<figure>");
      });

      it("renders caption as figure/figcaption for Substack", async () => {
        const app = new App();
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "https://example.com/pic.png", "alt", undefined, "auto", warnings,
          "My caption", "Substack"
        );
        expect(result).toBe(
          '<figure><img src="https://example.com/pic.png" alt="My caption">' +
            "<figcaption>My caption</figcaption></figure>"
        );
      });

      it("renders caption as figure/figcaption when platform is unspecified", async () => {
        const app = new App();
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "https://example.com/pic.png", "alt", undefined, "auto", warnings,
          "My caption"
        );
        expect(result).toContain("<figure>");
        expect(result).toContain("<figcaption>My caption</figcaption>");
      });
    });

    describe("HTML escaping", () => {
      it("escapes quotes and angle brackets in captions", async () => {
        const app = new App();
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "https://example.com/pic.png", "alt", undefined, "auto", warnings,
          'He said "hi" & <b>bold</b>', "Substack"
        );
        const escaped = "He said &quot;hi&quot; &amp; &lt;b&gt;bold&lt;/b&gt;";
        // Caption is used both as alt text and figcaption content
        expect(result).toContain(`alt="${escaped}"`);
        expect(result).toContain(`<figcaption>${escaped}</figcaption>`);
        expect(result).not.toContain("<b>bold</b>");
      });

      it("escapes quotes and angle brackets in alt text", async () => {
        const app = new App();
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "https://example.com/pic.png", '"quote" <tag>', undefined, "auto", warnings
        );
        expect(result).toBe(
          '<img src="https://example.com/pic.png" alt="&quot;quote&quot; &lt;tag&gt;">'
        );
      });
    });

    describe("magic byte validation", () => {
      it("base64-encodes a webp file with valid RIFF/WEBP magic bytes", async () => {
        const app = new App();
        const webp = bytes(
          0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
        );
        addVaultImage(app, "photo.webp", "images/photo.webp", webp);
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "photo.webp", "alt", undefined, "auto", warnings
        );
        expect(result).toContain('src="data:image/webp;base64,');
        expect(warnings.hasWarnings()).toBe(false);
      });

      it("rejects a webp file whose RIFF payload is not WEBP", async () => {
        const app = new App();
        // RIFF header but WAVE payload (an audio file renamed to .webp)
        const wave = bytes(
          0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45
        );
        addVaultImage(app, "fake.webp", "images/fake.webp", wave);
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "fake.webp", "alt", undefined, "auto", warnings
        );
        expect(result).toBe('<img src="fake.webp" alt="alt">');
        expect(warnings.getWarnings()[0].reason).toBe("File content does not match image type");
      });

      it("base64-encodes a bmp file with valid BM magic bytes", async () => {
        const app = new App();
        const bmp = bytes(0x42, 0x4d, 0x76, 0x02);
        addVaultImage(app, "image.bmp", "images/image.bmp", bmp);
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "image.bmp", "alt", undefined, "auto", warnings
        );
        expect(result).toContain('src="data:image/bmp;base64,');
        expect(warnings.hasWarnings()).toBe(false);
      });

      it("rejects a bmp file without BM magic bytes", async () => {
        const app = new App();
        addVaultImage(app, "fake.bmp", "images/fake.bmp", bytes(0x47, 0x49, 0x46, 0x38));
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "fake.bmp", "alt", undefined, "auto", warnings
        );
        expect(result).toBe('<img src="fake.bmp" alt="alt">');
        expect(warnings.getWarnings()[0].reason).toBe("File content does not match image type");
      });

      it("base64-encodes an ico file with valid icon magic bytes", async () => {
        const app = new App();
        const ico = bytes(0x00, 0x00, 0x01, 0x00, 0x01, 0x00);
        addVaultImage(app, "favicon.ico", "images/favicon.ico", ico);
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "favicon.ico", "alt", undefined, "auto", warnings
        );
        expect(result).toContain('src="data:image/x-icon;base64,');
        expect(warnings.hasWarnings()).toBe(false);
      });

      it("rejects an ico file without icon magic bytes", async () => {
        const app = new App();
        addVaultImage(app, "fake.ico", "images/fake.ico", bytes(0x00, 0x00, 0x02, 0x00));
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "fake.ico", "alt", undefined, "auto", warnings
        );
        expect(result).toBe('<img src="fake.ico" alt="alt">');
        expect(warnings.getWarnings()[0].reason).toBe("File content does not match image type");
      });

      it("base64-encodes an svg file starting with an svg root element", async () => {
        const app = new App();
        const svg = textBuffer(
          '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
        );
        addVaultImage(app, "diagram.svg", "images/diagram.svg", svg);
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "diagram.svg", "alt", undefined, "auto", warnings
        );
        expect(result).toContain('src="data:image/svg+xml;base64,');
        expect(warnings.hasWarnings()).toBe(false);
      });

      it("rejects an svg file that does not contain svg markup", async () => {
        const app = new App();
        addVaultImage(app, "fake.svg", "images/fake.svg", textBuffer("plain text, not svg"));
        const warnings = new WarningCollector();
        const result = await resolveImage(
          app as never, "fake.svg", "alt", undefined, "auto", warnings
        );
        expect(result).toBe('<img src="fake.svg" alt="alt">');
        expect(warnings.getWarnings()[0].reason).toBe("File content does not match image type");
      });
    });
  });
});
