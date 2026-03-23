import { describe, it, expect } from "vitest";
import { isImageFile } from "../../src/converter/image-handler";

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
});
