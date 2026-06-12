/**
 * Pubcopy conversion benchmark harness.
 *
 * Bundles the real converter pipeline (obsidian aliased to the test mock),
 * runs each scenario several times, and reports min/median/max wall-clock ms.
 *
 * Usage:
 *   node bench/bench.mjs [scenario-filter]
 */

import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ITERATIONS = 5;

// ---------- bundle the pipeline ----------

const workDir = mkdtempSync(path.join(tmpdir(), "pubcopy-bench-"));
const outfile = path.join(workDir, "pipeline.mjs");

await build({
  stdin: {
    contents: `
      export { convert } from "./src/converter/index";
      export { preprocess } from "./src/converter/preprocessor";
      export { convertToHtml } from "./src/converter/html-converter";
      export { WarningCollector } from "./src/utils/errors";
      export { MediumProfile } from "./src/platforms/medium";
      export { SubstackProfile } from "./src/platforms/substack";
      export { App, TFile } from "./tests/mocks/obsidian";
    `,
    resolveDir: ROOT,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  alias: { obsidian: path.resolve(ROOT, "tests/mocks/obsidian.ts") },
  outfile,
  logLevel: "silent",
});

const {
  convert,
  preprocess,
  WarningCollector,
  MediumProfile,
  App,
} = await import(pathToFileURL(outfile).href);

const SETTINGS = {
  stripFrontmatter: true,
  stripTags: true,
  stripWikilinks: true,
  imageHandling: "auto",
  showNotification: true,
};

// ---------- scenarios ----------

function typicalPost() {
  const section = [
    "## Section heading",
    "",
    "A paragraph with **bold**, *italic*, ==highlight==, a [link](https://example.com),",
    "a [[Wiki Link]] and a #tag plus inline math $a^2+b^2=c^2$.",
    "",
    "- item one",
    "- item two",
    "  - nested item",
    "- [ ] a task",
    "",
    "> [!note] A callout",
    "> with two lines",
    "",
    "```python",
    "def hello():",
    '    print("$HOME is not math")',
    "```",
    "",
    "| Col A | Col B |",
    "|-------|-------|",
    "| 1     | 2     |",
    "",
    "A footnote reference[^1].",
    "",
    "[^1]: The footnote text.",
    "",
  ].join("\n");
  return "---\ntitle: Bench\n---\n\n# Typical post\n\n" + section.repeat(20); // ~10KB
}

function largeNote() {
  const para =
    "Lorem ipsum dolor sit amet, **consectetur** adipiscing elit, sed do " +
    "eiusmod tempor ==incididunt== ut labore et dolore magna aliqua. " +
    "[[Some Link]] #tag\n\n";
  return "# Large note\n\n" + para.repeat(Math.ceil(1_500_000 / para.length));
}

const SCENARIOS = {
  "typical-post-10k": { input: typicalPost(), iterations: ITERATIONS },
  "large-note-1.5MB": { input: largeNote(), iterations: 3 },
  "unclosed-wikilinks-50k": { input: "[[".repeat(25_000), iterations: 3 },
  "unclosed-embeds-50k": { input: "![[".repeat(16_667), iterations: 3 },
  "highlights-1000": {
    input: Array.from({ length: 1000 }, (_, i) => `==hl ${i}== text`).join(" "),
    iterations: ITERATIONS,
  },
  "footnotes-500": {
    input:
      Array.from({ length: 500 }, (_, i) => `Ref[^${i}]`).join(" ") +
      "\n\n" +
      Array.from({ length: 500 }, (_, i) => `[^${i}]: Note ${i}`).join("\n"),
    iterations: ITERATIONS,
  },
  "math-200": {
    input: Array.from({ length: 200 }, (_, i) => `$x_{${i}}^2$ and`).join(" "),
    iterations: 3,
  },
  "fences-200": {
    input: Array.from(
      { length: 200 },
      (_, i) => "```bash\necho $HOME ==x== [[y]] block " + i + "\n```\n\ntext\n"
    ).join("\n"),
    iterations: ITERATIONS,
  },
};

// ---------- run ----------

const filter = process.argv[2];
const stageOnly = process.argv.includes("--preprocess-only");

async function timeOnce(name, input) {
  const app = new App();
  const start = performance.now();
  if (stageOnly) {
    preprocess(input, SETTINGS);
  } else {
    await convert(input, MediumProfile, SETTINGS, app);
  }
  return performance.now() - start;
}

const results = [];
for (const [name, { input, iterations }] of Object.entries(SCENARIOS)) {
  if (filter && !name.includes(filter) && filter !== "--preprocess-only") continue;
  const times = [];
  for (let i = 0; i < iterations; i++) {
    times.push(await timeOnce(name, input));
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  results.push({
    scenario: name,
    "size(KB)": Math.round(input.length / 1024),
    "min(ms)": Math.round(times[0] * 10) / 10,
    "median(ms)": Math.round(median * 10) / 10,
    "max(ms)": Math.round(times[times.length - 1] * 10) / 10,
  });
}

console.table(results);
rmSync(workDir, { recursive: true, force: true });
