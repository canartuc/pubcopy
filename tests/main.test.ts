import { describe, it, expect, vi, beforeEach } from "vitest";
import PubcopyPlugin from "../src/main";
import { App, Menu, Notice, TFile, MarkdownView } from "./mocks/obsidian";

// Mock ClipboardItem since jsdom doesn't have it
class MockClipboardItem {
  types: string[];
  private data: Record<string, Blob>;

  constructor(data: Record<string, Blob>) {
    this.data = data;
    this.types = Object.keys(data);
  }

  async getType(type: string): Promise<Blob> {
    return this.data[type];
  }
}

let written: MockClipboardItem[] = [];

async function clipboardHtml(): Promise<string> {
  expect(written.length).toBeGreaterThan(0);
  const blob = await written[0].getType("text/html");
  return blob.text();
}

function createPlugin(): { plugin: PubcopyPlugin; app: App } {
  const app = new App();
  const plugin = new PubcopyPlugin(app as never, { id: "pubcopy" } as never);
  return { plugin, app };
}

async function clickPubcopyItem(menu: Menu, title: string): Promise<void> {
  const root = menu.findItem("Pubcopy");
  expect(root, "Pubcopy submenu root item should exist").toBeTruthy();
  expect(root?.submenu, "Pubcopy item should have a submenu").toBeTruthy();
  const item = root?.submenu?.findItem(title);
  expect(item, `Submenu item "${title}" should exist`).toBeTruthy();
  await item?.click();
}

describe("PubcopyPlugin menus", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ClipboardItem = MockClipboardItem;
    written = [];
    Object.assign(navigator, {
      clipboard: {
        write: vi.fn().mockImplementation((items: MockClipboardItem[]) => {
          written = items;
          return Promise.resolve();
        }),
      },
    });
  });

  describe("file-menu (file explorer / three-dot menu)", () => {
    it("copies the clicked file, not the active view (regression)", async () => {
      const { plugin, app } = createPlugin();
      await plugin.onload();

      // A different note is open and active
      const active = new MarkdownView();
      active.editor.content = "# Active note";
      app.workspace.activeView = active;

      // The user right-clicks another file in the explorer
      const clicked = new TFile("folder/clicked.md");
      app.vault.addMockFile("folder/clicked.md", "# Clicked note");

      const menu = new Menu();
      app.workspace.trigger("file-menu", menu, clicked);
      await clickPubcopyItem(menu, "Copy for medium");

      const html = await clipboardHtml();
      expect(html).toContain("Clicked note");
      expect(html).not.toContain("Active note");
    });

    it("copies a file even when no note is open (regression)", async () => {
      const { plugin, app } = createPlugin();
      await plugin.onload();
      app.workspace.activeView = null;

      const clicked = new TFile("note.md");
      app.vault.addMockFile("note.md", "Some **bold** content");

      const menu = new Menu();
      app.workspace.trigger("file-menu", menu, clicked);
      await clickPubcopyItem(menu, "Copy for substack");

      const html = await clipboardHtml();
      expect(html).toContain("<strong>bold</strong>");
    });

    it("offers all three commands in the submenu", async () => {
      const { plugin, app } = createPlugin();
      await plugin.onload();

      const menu = new Menu();
      app.workspace.trigger("file-menu", menu, new TFile("note.md"));

      const root = menu.findItem("Pubcopy");
      const titles = root?.submenu?.items.map((i) => i.title) ?? [];
      expect(titles).toEqual([
        "Copy for medium",
        "Copy for substack",
        "Copy as Markdown",
      ]);
    });

    it("ignores non-markdown files", async () => {
      const { plugin, app } = createPlugin();
      await plugin.onload();

      const menu = new Menu();
      app.workspace.trigger("file-menu", menu, new TFile("image.png"));
      expect(menu.items).toHaveLength(0);
    });

    it("ignores folders (no extension property)", async () => {
      const { plugin, app } = createPlugin();
      await plugin.onload();

      const menu = new Menu();
      app.workspace.trigger("file-menu", menu, { path: "some-folder", name: "some-folder" });
      expect(menu.items).toHaveLength(0);
    });

    it("copies markdown output via the file menu", async () => {
      const { plugin, app } = createPlugin();
      await plugin.onload();

      const clicked = new TFile("md-note.md");
      app.vault.addMockFile("md-note.md", "# Title\n\nWith [[Wiki Link]] text");

      const menu = new Menu();
      app.workspace.trigger("file-menu", menu, clicked);
      await clickPubcopyItem(menu, "Copy as Markdown");

      const blob = await written[0].getType("text/plain");
      const plain = await blob.text();
      expect(plain).toContain("# Title");
      expect(plain).toContain("Wiki Link");
      expect(plain).not.toContain("[[Wiki Link]]");
    });
  });

  describe("editor-menu (right-click in editor)", () => {
    it("copies the selection when one exists", async () => {
      const { plugin, app } = createPlugin();
      await plugin.onload();

      const editor = {
        getSelection: () => "selected **bold** text",
        getValue: () => "# Full note\n\nselected **bold** text and more",
      };

      const menu = new Menu();
      app.workspace.trigger("editor-menu", menu, editor);
      await clickPubcopyItem(menu, "Copy for medium");

      const html = await clipboardHtml();
      expect(html).toContain("<strong>bold</strong>");
      expect(html).not.toContain("Full note");
    });

    it("copies the full note when there is no selection", async () => {
      const { plugin, app } = createPlugin();
      await plugin.onload();

      const editor = {
        getSelection: () => "",
        getValue: () => "# Full note",
      };

      const menu = new Menu();
      app.workspace.trigger("editor-menu", menu, editor);
      await clickPubcopyItem(menu, "Copy for medium");

      const html = await clipboardHtml();
      expect(html).toContain("Full note");
    });
  });

  describe("restart notice after an in-place update", () => {
    /** Load a plugin whose manifest reports `version`, with data.json seeded. */
    async function loadAt(
      version: string,
      saved?: Record<string, unknown>
    ): Promise<PubcopyPlugin> {
      const app = new App();
      const plugin = new PubcopyPlugin(app as never, { id: "pubcopy" } as never);
      plugin.manifest.version = version;
      if (saved) await plugin.saveData(saved);
      Notice.reset();
      await plugin.onload();
      return plugin;
    }

    function restartNotices(): Notice[] {
      return Notice.instances.filter((n) => /restart/i.test(n.message));
    }

    it("warns when the version on disk differs from the last run", async () => {
      await loadAt("1.7.0", { lastRunVersion: "1.6.1" });
      const notices = restartNotices();
      expect(notices).toHaveLength(1);
      expect(notices[0].message).toContain("1.6.1");
      expect(notices[0].message).toContain("1.7.0");
    });

    it("stays quiet on a first install, where nothing stale can exist", async () => {
      await loadAt("1.7.0");
      expect(restartNotices()).toHaveLength(0);
    });

    it("stays quiet when the version is unchanged", async () => {
      await loadAt("1.7.0", { lastRunVersion: "1.7.0" });
      expect(restartNotices()).toHaveLength(0);
    });

    it("records the running version so the next load is quiet", async () => {
      const plugin = await loadAt("1.7.0", { lastRunVersion: "1.6.1" });
      expect(plugin.settings.lastRunVersion).toBe("1.7.0");
      expect(await plugin.loadData()).toMatchObject({ lastRunVersion: "1.7.0" });
    });

    it("warns only once, not on every load after the update", async () => {
      const first = await loadAt("1.7.0", { lastRunVersion: "1.6.1" });
      expect(restartNotices()).toHaveLength(1);

      Notice.reset();
      const app = new App();
      const second = new PubcopyPlugin(app as never, { id: "pubcopy" } as never);
      second.manifest.version = "1.7.0";
      await second.saveData(first.settings as unknown as Record<string, unknown>);
      await second.onload();
      expect(restartNotices()).toHaveLength(0);
    });

    it("keeps the user's settings when it records the version", async () => {
      const plugin = await loadAt("1.7.0", {
        lastRunVersion: "1.6.1",
        tableHandling: "code-block",
        showNotification: false,
      });
      expect(plugin.settings.tableHandling).toBe("code-block");
      expect(plugin.settings.showNotification).toBe(false);
    });

    it("stays quiet on a cold start, where the new build was just read from disk", async () => {
      // Updating with Obsidian closed is the README's own manual-install path.
      // Nothing is stale, so telling the user to restart would be wrong.
      const app = new App();
      const plugin = new PubcopyPlugin(app as never, { id: "pubcopy" } as never);
      plugin.manifest.version = "1.7.0";
      app.workspace.layoutReady = false;
      await plugin.saveData({ lastRunVersion: "1.6.1" });
      Notice.reset();
      await plugin.onload();

      expect(restartNotices()).toHaveLength(0);
      // The marker still advances, so the next mid-session update is detected
      expect(plugin.settings.lastRunVersion).toBe("1.7.0");
    });

    it("survives a vault it cannot write to, keeping commands and menus", async () => {
      // A read-only vault or a sync client holding data.json must never cost
      // the user the whole plugin — that is worse than the bug being fixed.
      const app = new App();
      const plugin = new PubcopyPlugin(app as never, { id: "pubcopy" } as never);
      plugin.manifest.version = "1.7.0";
      await plugin.saveData({ lastRunVersion: "1.6.1" });
      plugin.saveData = () => Promise.reject(new Error("EACCES: read-only file system"));
      Notice.reset();

      await expect(plugin.onload()).resolves.toBeUndefined();

      const file = new TFile("note.md");
      app.vault.addMockFile("note.md", "# Heading\n\nBody text.");
      const menu = new Menu();
      app.workspace.trigger("file-menu", menu, file);
      await clickPubcopyItem(menu, "Copy for medium");
      expect(await clipboardHtml()).toContain("Body text.");
    });

    it("registers everything even on a first install that cannot persist", async () => {
      const app = new App();
      const plugin = new PubcopyPlugin(app as never, { id: "pubcopy" } as never);
      plugin.manifest.version = "1.7.0";
      plugin.saveData = () => Promise.reject(new Error("ENOSPC: no space left"));
      Notice.reset();

      await expect(plugin.onload()).resolves.toBeUndefined();

      const file = new TFile("note.md");
      app.vault.addMockFile("note.md", "# Heading\n\nBody text.");
      const menu = new Menu();
      app.workspace.trigger("file-menu", menu, file);
      await clickPubcopyItem(menu, "Copy for medium");
      expect(await clipboardHtml()).toContain("Body text.");
    });

    it("still registers commands and copies after warning", async () => {
      const plugin = await loadAt("1.7.0", { lastRunVersion: "1.6.1" });
      const app = plugin.app as unknown as App;
      const file = new TFile("note.md");
      app.vault.addMockFile("note.md", "# Heading\n\nBody text.");
      const menu = new Menu();
      app.workspace.trigger("file-menu", menu, file);
      await clickPubcopyItem(menu, "Copy for medium");
      expect(await clipboardHtml()).toContain("Body text.");
    });
  });
});
