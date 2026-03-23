import { describe, it, expect } from "vitest";
import { PubcopyError, WarningCollector } from "../../src/utils/errors";

describe("PubcopyError", () => {
  it("formats error message with context", () => {
    const err = new PubcopyError("image", "photo.png", "File not found");
    expect(err.message).toBe("[Pubcopy] image in photo.png: File not found");
    expect(err.elementType).toBe("image");
    expect(err.filePath).toBe("photo.png");
    expect(err.reason).toBe("File not found");
  });

  it("is an instance of Error", () => {
    const err = new PubcopyError("test", "file", "reason");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("WarningCollector", () => {
  it("starts empty", () => {
    const collector = new WarningCollector();
    expect(collector.hasWarnings()).toBe(false);
    expect(collector.getWarnings()).toEqual([]);
  });

  it("collects warnings", () => {
    const collector = new WarningCollector();
    collector.add("audio", "song.mp3", "Not supported");
    expect(collector.hasWarnings()).toBe(true);
    expect(collector.getWarnings()).toHaveLength(1);
  });

  it("collects multiple warnings", () => {
    const collector = new WarningCollector();
    collector.add("audio", "song.mp3", "Not supported");
    collector.add("video", "clip.mp4", "Not supported");
    expect(collector.getWarnings()).toHaveLength(2);
  });

  it("clears warnings", () => {
    const collector = new WarningCollector();
    collector.add("test", "file", "reason");
    collector.clear();
    expect(collector.hasWarnings()).toBe(false);
  });

  it("returns copies of warnings array", () => {
    const collector = new WarningCollector();
    collector.add("test", "file", "reason");
    const w1 = collector.getWarnings();
    const w2 = collector.getWarnings();
    expect(w1).not.toBe(w2);
    expect(w1).toEqual(w2);
  });
});
