/**
 * @module main
 *
 * Pubcopy plugin entry point for Obsidian.
 *
 * Registers commands ("Copy for medium", "Copy for substack", "Copy as Markdown") accessible via:
 * - Command Palette (Cmd/Ctrl+P)
 * - Editor right-click context menu (grouped "Pubcopy" submenu)
 * - Three-dot "more options" menu (top-right of note)
 * - File explorer right-click menu (works without opening the note)
 *
 * The submenu uses Obsidian's undocumented `MenuItem.setSubmenu()` API
 * (used by community plugins like meta-bind and css-inserter). If that API
 * is removed in a future Obsidian version, the plugin falls back to flat
 * "Copy for medium" / "Copy for substack" menu items.
 *
 * Selection behavior:
 * - Editor right-click: copies selected text if there's a selection, otherwise full note.
 * - File menus and Command Palette: always copy the full note. File menus
 *   read the clicked file directly from the vault, so the copied content is
 *   always the file the user clicked — not whichever note happens to be active.
 */

import { Editor, Menu, MenuItem, Notice, Plugin, TFile } from "obsidian";
import {
  PubcopySettings,
  PubcopySettingTab,
  DEFAULT_SETTINGS,
} from "./settings";
import { MediumProfile, SubstackProfile, MarkdownProfile } from "./platforms";
import type { PlatformProfile } from "./platforms";
import { convert } from "./converter";
import { writeToClipboard } from "./clipboard/writer";
import {
  showSuccess,
  showWarnings,
  showUpdateRestartNotice,
} from "./utils/notifications";
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
      name: "Copy as Markdown",
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

    // File menu: three-dot "more options" menu AND file explorer right-click.
    // The clicked file is captured so the copy always targets it, even when
    // it is not the active note (or no note is open at all).
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        this.addFileMenuSubmenu(menu, file);
      })
    );

    // Runs last, and swallows its own failures: nothing about the update
    // check may cost the user their commands, menus, or settings tab.
    await this.warnIfUpdatedInPlace();
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
            .setTitle("Copy as Markdown")
            .setIcon("copy")
            .onClick(() => this.copyForPlatform(editor, MarkdownProfile));
        });
      });
    } catch {
      // Fallback: flat menu items if setSubmenu() is not available
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Copy for medium")
          .setIcon("file-text")
          .onClick(() => this.copyForPlatform(editor, MediumProfile));
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Copy for substack")
          .setIcon("mail")
          .onClick(() => this.copyForPlatform(editor, SubstackProfile));
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Copy as Markdown")
          .setIcon("copy")
          .onClick(() => this.copyForPlatform(editor, MarkdownProfile));
      });
    }
  }

  /**
   * Add a grouped "Pubcopy" submenu to the file menu (three-dot menu or
   * file explorer right-click). Copies the clicked file's full content.
   */
  private addFileMenuSubmenu(menu: Menu, file: TFile): void {
    try {
      menu.addItem((item: MenuItem) => {
        item.setTitle("Pubcopy").setIcon("clipboard-copy");
        const submenu = (item as MenuItem & { setSubmenu: () => Menu }).setSubmenu();
        submenu.addItem((sub: MenuItem) => {
          sub
            .setTitle("Copy for medium")
            .setIcon("file-text")
            .onClick(() => this.copyFileForPlatform(file, MediumProfile));
        });
        submenu.addItem((sub: MenuItem) => {
          sub
            .setTitle("Copy for substack")
            .setIcon("mail")
            .onClick(() => this.copyFileForPlatform(file, SubstackProfile));
        });
        submenu.addItem((sub: MenuItem) => {
          sub
            .setTitle("Copy as Markdown")
            .setIcon("copy")
            .onClick(() => this.copyFileForPlatform(file, MarkdownProfile));
        });
      });
    } catch {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Copy for medium")
          .setIcon("file-text")
          .onClick(() => this.copyFileForPlatform(file, MediumProfile));
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Copy for substack")
          .setIcon("mail")
          .onClick(() => this.copyFileForPlatform(file, SubstackProfile));
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Copy as Markdown")
          .setIcon("copy")
          .onClick(() => this.copyFileForPlatform(file, MarkdownProfile));
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
   * Copy a specific file's full content, read directly from the vault.
   * Used by the file menu (three-dot and file explorer), so it works even
   * when the file is not the active note.
   */
  private async copyFileForPlatform(
    file: TFile,
    profile: PlatformProfile
  ): Promise<void> {
    let markdown: string;
    try {
      markdown = await this.app.vault.cachedRead(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Could not read "${file.name}": ${msg}`);
      return;
    }
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
        new Notice(`Error: ${err.message}`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`Unexpected error: ${msg}`);
      }
    }
  }

  /** Load settings from disk, merging with defaults for any missing keys. */
  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<PubcopySettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...data };
  }

  /** Persist current settings to disk. */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Tell the user to restart when the plugin's files were replaced under a
   * running Obsidian.
   *
   * Updating in place leaves the previous build partly live: menus and
   * commands still register, but a copy can silently do nothing, which looks
   * like a broken release rather than a stale process.
   *
   * The notice is owed only when the swap happened mid-session. `layoutReady`
   * is false while Obsidian starts up and true once a plugin is enabled or
   * reloaded afterwards, which separates the stale case from a cold start
   * that just read the new build off disk. Nothing is stale then, so telling
   * the user to restart the app they only just opened would be wrong.
   *
   * Never fires on a first install, where there is no previous build.
   */
  private async warnIfUpdatedInPlace(): Promise<void> {
    const current = this.manifest.version;
    const previous = this.settings.lastRunVersion;
    if (previous === current) return;

    if (previous && this.app.workspace.layoutReady) {
      showUpdateRestartNotice(previous, current);
    }

    this.settings.lastRunVersion = current;
    try {
      await this.saveSettings();
    } catch {
      // A vault that cannot be written to — read-only media, a full disk, a
      // sync client holding data.json open — must not cost the user the whole
      // plugin. The marker is simply retried on the next load.
    }
  }
}
