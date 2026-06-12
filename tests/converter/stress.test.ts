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

describe("probe scaling", () => {
  it("measures preprocess scaling on unclosed [[ runs", () => {
    for (const reps of [6_250, 12_500, 25_000]) {
      const input = "[[".repeat(reps);
      const t0 = performance.now();
      preprocess(input, defaultSettings);
      console.log(`reps=${reps} chars=${input.length} ms=${Math.round(performance.now() - t0)}`);
    }
    expect(true).toBe(true);
  }, 120000);
});
