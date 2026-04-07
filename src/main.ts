/**
 * @module main
 *
 * Pubcopy plugin entry point for Obsidian.
 *
 * Registers two commands ("Copy for medium", "Copy for substack") accessible via:
 * - Command Palette (Cmd/Ctrl+P)
 * - Editor right-click context menu (grouped "Pubcopy" submenu)
 * - Three-dot "more options" menu (top-right of note)
 *
 * The submenu uses Obsidian's undocumented `MenuItem.setSubmenu()` API
 * (used by community plugins like meta-bind and css-inserter). If that API
 * is removed in a future Obsidian version, the plugin falls back to flat
 * "Pubcopy: Copy for medium" / "Pubcopy: Copy for substack" menu items.
 *
 * Selection behavior:
 * - Editor right-click: copies selected text if there's a selection, otherwise full note.
 * - Three-dot menu and Command Palette: always copy the full note.
 */

import { Editor, MarkdownView, Menu, MenuItem, Notice, Plugin } from "obsidian";
import {
  PubcopySettings,
  PubcopySettingTab,
  DEFAULT_SETTINGS,
} from "./settings";
import { MediumProfile, SubstackProfile, MarkdownProfile } from "./platforms";
import type { PlatformProfile } from "./platforms";
import { convert } from "./converter";
import { writeToClipboard } from "./clipboard/writer";
import { showSuccess, showWarnings } from "./utils/notifications";
import { PubcopyError } from "./utils/errors";

/**
 * Main plugin class. Extends Obsidian's Plugin base class.
 *
 * Lifecycle:
 * - `onload()`: Called when Obsidian loads the plugin. Registers commands,
 *   menus, settings tab, and event handlers.
 * - `onunload()`: Called when the plugin is disabled. Obsidian handles
 *   cleanup of registered events and commands automatically.
 */
export default class PubcopyPlugin extends Plugin {
  settings: PubcopySettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new PubcopySettingTab(this.app, this));

    // Command Palette commands (also enables hotkey assignment in Settings > Hotkeys)
    this.addCommand({
      id: "copy-for-medium",
      name: "Copy for medium",
      editorCallback: (editor: Editor) => {
        void this.copyForPlatform(editor, MediumProfile);
      },
    });

    this.addCommand({
      id: "copy-for-substack",
      name: "Copy for substack",
      editorCallback: (editor: Editor) => {
        void this.copyForPlatform(editor, SubstackProfile);
      },
    });

    this.addCommand({
      id: "copy-as-markdown",
      name: "Copy as markdown",
      editorCallback: (editor: Editor) => {
        void this.copyForPlatform(editor, MarkdownProfile);
      },
    });

    // Editor context menu (right-click in editor area)
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
        this.addPubcopySubmenu(menu, editor);
      })
    );

    // File menu (three-dot "more options" menu at top-right of note)
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (!file || !("extension" in file) || file.extension !== "md") return;
        this.addFileMenuSubmenu(menu);
      })
    );
  }

  /**
   * Add a grouped "Pubcopy" submenu to the editor right-click context menu.
   *
   * Uses the undocumented `setSubmenu()` API. Falls back to flat items
   * if the API is unavailable.
   */
  private addPubcopySubmenu(menu: Menu, editor: Editor): void {
    try {
      menu.addItem((item: MenuItem) => {
        item.setTitle("Pubcopy").setIcon("clipboard-copy");
        const submenu = (item as MenuItem & { setSubmenu: () => Menu }).setSubmenu();
        submenu.addItem((sub: MenuItem) => {
          sub
            .setTitle("Copy for medium")
            .setIcon("file-text")
            .onClick(() => this.copyForPlatform(editor, MediumProfile));
        });
        submenu.addItem((sub: MenuItem) => {
          sub
            .setTitle("Copy for substack")
            .setIcon("mail")
            .onClick(() => this.copyForPlatform(editor, SubstackProfile));
        });
        submenu.addItem((sub: MenuItem) => {
          sub
            .setTitle("Copy as markdown")
            .setIcon("copy")
            .onClick(() => this.copyForPlatform(editor, MarkdownProfile));
        });
      });
    } catch {
      // Fallback: flat menu items if setSubmenu() is not available
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Pubcopy: Copy for medium")
          .setIcon("file-text")
          .onClick(() => this.copyForPlatform(editor, MediumProfile));
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Pubcopy: Copy for substack")
          .setIcon("mail")
          .onClick(() => this.copyForPlatform(editor, SubstackProfile));
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Pubcopy: Copy as markdown")
          .setIcon("copy")
          .onClick(() => this.copyForPlatform(editor, MarkdownProfile));
      });
    }
  }

  /**
   * Add a grouped "Pubcopy" submenu to the three-dot file menu.
   * Always copies the full note (no selection concept in this menu).
   */
  private addFileMenuSubmenu(menu: Menu): void {
    try {
      menu.addItem((item: MenuItem) => {
        item.setTitle("Pubcopy").setIcon("clipboard-copy");
        const submenu = (item as MenuItem & { setSubmenu: () => Menu }).setSubmenu();
        submenu.addItem((sub: MenuItem) => {
          sub
            .setTitle("Copy for medium")
            .setIcon("file-text")
            .onClick(() => this.copyFullNoteForPlatform(MediumProfile));
        });
        submenu.addItem((sub: MenuItem) => {
          sub
            .setTitle("Copy for substack")
            .setIcon("mail")
            .onClick(() => this.copyFullNoteForPlatform(SubstackProfile));
        });
        submenu.addItem((sub: MenuItem) => {
          sub
            .setTitle("Copy as markdown")
            .setIcon("copy")
            .onClick(() => this.copyFullNoteForPlatform(MarkdownProfile));
        });
      });
    } catch {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Pubcopy: Copy for medium")
          .setIcon("file-text")
          .onClick(() => this.copyFullNoteForPlatform(MediumProfile));
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Pubcopy: Copy for substack")
          .setIcon("mail")
          .onClick(() => this.copyFullNoteForPlatform(SubstackProfile));
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Pubcopy: Copy as markdown")
          .setIcon("copy")
          .onClick(() => this.copyFullNoteForPlatform(MarkdownProfile));
      });
    }
  }

  /**
   * Copy from editor context. Uses selection if present, otherwise full note.
   */
  private async copyForPlatform(
    editor: Editor,
    profile: PlatformProfile
  ): Promise<void> {
    const selection = editor.getSelection();
    const markdown = selection || editor.getValue();
    await this.runConversion(markdown, profile);
  }

  /**
   * Copy the full note content. Used by three-dot menu and as fallback.
   */
  private async copyFullNoteForPlatform(
    profile: PlatformProfile
  ): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Pubcopy: No active markdown file.");
      return;
    }
    const markdown = view.editor.getValue();
    await this.runConversion(markdown, profile);
  }

  /**
   * Run the full conversion pipeline and write the result to clipboard.
   *
   * Catches both expected errors ({@link PubcopyError}) and unexpected
   * errors, showing appropriate notices to the user.
   */
  private async runConversion(
    markdown: string,
    profile: PlatformProfile
  ): Promise<void> {
    try {
      const result = await convert(
        markdown,
        profile,
        this.settings,
        this.app
      );

      await writeToClipboard(result.html, result.plainText);

      showSuccess(
        profile.name,
        this.settings.showNotification
      );

      showWarnings(
        result.warnings.getWarnings(),
        this.settings.showNotification
      );
    } catch (err) {
      if (err instanceof PubcopyError) {
        new Notice(`Pubcopy error: ${err.message}`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`Pubcopy: Unexpected error: ${msg}`);
      }
    }
  }

  /** Load settings from disk, merging with defaults for any missing keys. */
  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  /** Persist current settings to disk. */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
