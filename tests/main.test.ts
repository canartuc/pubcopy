import { describe, it, expect, vi, beforeEach } from "vitest";
import PubcopyPlugin from "../src/main";
import { App, Menu, TFile, MarkdownView } from "./mocks/obsidian";

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
});
