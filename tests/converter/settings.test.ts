import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, PubcopySettingTab } from "../../src/settings";
import PubcopyPlugin from "../../src/main";
import { App } from "../mocks/obsidian";

function createPlugin(): { plugin: PubcopyPlugin; app: App } {
  const app = new App();
  const plugin = new PubcopyPlugin(app as never, { id: "pubcopy" } as never);
  return { plugin, app };
}

/**
 * Minimal element stub for the donation section, which uses Obsidian's
 * DOM helpers (createDiv, setAttr) that the shared mock containerEl lacks.
 */
type StubEl = {
  tag: string;
  opts: Record<string, unknown> | undefined;
  children: StubEl[];
  attrs: Record<string, string>;
  empty: () => void;
  createEl: (tag: string, opts?: Record<string, unknown>) => StubEl;
  createDiv: (opts?: Record<string, unknown>) => StubEl;
  setAttr: (name: string, value: string) => void;
};

function makeStubEl(tag: string, opts?: Record<string, unknown>): StubEl {
  const el: StubEl = {
    tag,
    opts,
    children: [],
    attrs: {},
    empty: () => {
      el.children = [];
    },
    createEl: (childTag, childOpts) => {
      const child = makeStubEl(childTag, childOpts);
      el.children.push(child);
      return child;
    },
    createDiv: (childOpts) => {
      const child = makeStubEl("div", childOpts);
      el.children.push(child);
      return child;
    },
    setAttr: (name, value) => {
      el.attrs[name] = value;
    },
  };
  return el;
}

describe("settings", () => {
  it("has correct default for stripFrontmatter", () => {
    expect(DEFAULT_SETTINGS.stripFrontmatter).toBe(true);
  });

  it("has correct default for stripTags", () => {
    expect(DEFAULT_SETTINGS.stripTags).toBe(true);
  });

  it("has correct default for stripWikilinks", () => {
    expect(DEFAULT_SETTINGS.stripWikilinks).toBe(true);
  });

  it("has correct default for imageHandling", () => {
    expect(DEFAULT_SETTINGS.imageHandling).toBe("auto");
  });

  it("has correct default for showNotification", () => {
    expect(DEFAULT_SETTINGS.showNotification).toBe(true);
  });

  it("has correct default for tableHandling", () => {
    expect(DEFAULT_SETTINGS.tableHandling).toBe("list");
  });

  it("has exactly the 6 documented keys with current defaults (drift guard)", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      stripFrontmatter: true,
      stripTags: true,
      stripWikilinks: true,
      imageHandling: "auto",
      tableHandling: "list",
      showNotification: true,
    });
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([
      "imageHandling",
      "showNotification",
      "stripFrontmatter",
      "stripTags",
      "stripWikilinks",
      "tableHandling",
    ]);
  });
});

describe("loadSettings / saveSettings", () => {
  it("falls back to DEFAULT_SETTINGS when there is no data.json (loadData null)", async () => {
    const { plugin } = createPlugin();
    await plugin.loadSettings();
    expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    // A fresh copy is made, so later mutations don't corrupt the shared defaults
    expect(plugin.settings).not.toBe(DEFAULT_SETTINGS);
  });

  it("merges partial saved data with defaults", async () => {
    const { plugin } = createPlugin();
    await plugin.saveData({ stripTags: false });
    await plugin.loadSettings();
    expect(plugin.settings).toEqual({ ...DEFAULT_SETTINGS, stripTags: false });
  });

  it("preserves unknown extra keys without crashing", async () => {
    const { plugin } = createPlugin();
    await plugin.saveData({ stripTags: false, futureSetting: "experimental" });
    await plugin.loadSettings();
    const settings = plugin.settings as Record<string, unknown>;
    expect(settings.futureSetting).toBe("experimental");
    expect(settings.stripTags).toBe(false);
    expect(settings.stripFrontmatter).toBe(true);
    expect(settings.imageHandling).toBe("auto");
    expect(settings.showNotification).toBe(true);
  });

  it("round-trips settings through saveSettings then loadSettings", async () => {
    const { plugin } = createPlugin();
    await plugin.loadSettings();
    plugin.settings.imageHandling = "always-url";
    plugin.settings.showNotification = false;
    await plugin.saveSettings();

    // Reset in-memory state to prove loadSettings restores the saved values
    plugin.settings = { ...DEFAULT_SETTINGS };
    await plugin.loadSettings();
    expect(plugin.settings).toEqual({
      ...DEFAULT_SETTINGS,
      imageHandling: "always-url",
      showNotification: false,
    });
  });
});

describe("getSettingDefinitions (Obsidian 1.13+ declarative settings)", () => {
  /** Control-bearing definitions, which is all this tab returns. */
  function definitions(tab: PubcopySettingTab) {
    return tab.getSettingDefinitions() as {
      name: string;
      desc?: string;
      aliases?: string[];
      control: { type: string; key: string; defaultValue?: unknown; options?: Record<string, string> };
    }[];
  }

  async function createTab(): Promise<PubcopySettingTab> {
    const { plugin, app } = createPlugin();
    await plugin.loadSettings();
    return new PubcopySettingTab(app as never, plugin);
  }

  it("exposes every persisted setting, so none is missing from settings search", async () => {
    const defs = definitions(await createTab());
    const declared = defs.map((d) => d.control.key).sort();
    expect(declared).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it("gives every definition a name and a description", async () => {
    for (const def of definitions(await createTab())) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.desc?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("declares a control type matching each setting's stored type", async () => {
    const settings = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    for (const def of definitions(await createTab())) {
      const expected = typeof settings[def.control.key] === "boolean" ? "toggle" : "dropdown";
      expect(def.control.type).toBe(expected);
    }
  });

  it("offers dropdown options covering the stored default", async () => {
    const settings = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    for (const def of definitions(await createTab())) {
      if (def.control.type !== "dropdown") continue;
      expect(Object.keys(def.control.options ?? {})).toContain(settings[def.control.key]);
    }
  });

  it("uses the shipped defaults as each control's fallback value", async () => {
    const settings = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    for (const def of definitions(await createTab())) {
      expect(def.control.defaultValue).toBe(settings[def.control.key]);
    }
  });

  it("returns a non-empty array, so Obsidian 1.13+ skips the display() fallback", async () => {
    expect(definitions(await createTab()).length).toBeGreaterThan(0);
  });
});

describe("PubcopySettingTab", () => {
  it("display() runs without throwing using the mock containerEl", async () => {
    const { plugin, app } = createPlugin();
    await plugin.loadSettings();
    const tab = new PubcopySettingTab(app as never, plugin);
    expect(() => tab.display()).not.toThrow();
  });

  it("display() never renders a donation section, even with a manifest fundingUrl", async () => {
    const { plugin, app } = createPlugin();
    await plugin.loadSettings();
    plugin.manifest.fundingUrl = "https://example.com/coffee";

    const tab = new PubcopySettingTab(app as never, plugin);
    const root = makeStubEl("container");
    (tab as unknown as { containerEl: StubEl }).containerEl = root;
    tab.display();

    expect(root.children).toEqual([]);
    expect(
      root.children.find((c) => c.opts?.cls === "pubcopy-donation")
    ).toBeUndefined();
  });
});
