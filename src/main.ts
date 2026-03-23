import { Editor, MarkdownView, Menu, MenuItem, Notice, Plugin } from "obsidian";
import {
  PubcopySettings,
  PubcopySettingTab,
  DEFAULT_SETTINGS,
} from "./settings";
import { MediumProfile, SubstackProfile } from "./platforms";
import type { PlatformProfile } from "./platforms";
import { convert } from "./converter";
import { writeToClipboard } from "./clipboard/writer";
import { showSuccess, showWarnings } from "./utils/notifications";
import { PubcopyError } from "./utils/errors";

export default class PubcopyPlugin extends Plugin {
  settings: PubcopySettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new PubcopySettingTab(this.app, this));

    // Register commands
    this.addCommand({
      id: "copy-for-medium",
      name: "Copy for Medium",
      editorCallback: (editor: Editor) => {
        this.copyForPlatform(editor, MediumProfile);
      },
    });

    this.addCommand({
      id: "copy-for-substack",
      name: "Copy for Substack",
      editorCallback: (editor: Editor) => {
        this.copyForPlatform(editor, SubstackProfile);
      },
    });

    // Register editor context menu (right-click)
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
        this.addPubcopySubmenu(menu, editor);
      })
    );

    // Register file menu (three-dot menu)
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (!file || !("extension" in file) || file.extension !== "md") return;

        this.addFileMenuSubmenu(menu);
      })
    );
  }

  private addPubcopySubmenu(menu: Menu, editor: Editor): void {
    // Try to use submenu (undocumented API)
    try {
      menu.addItem((item: MenuItem) => {
        item.setTitle("Pubcopy").setIcon("clipboard-copy");
        const submenu = (item as MenuItem & { setSubmenu: () => Menu }).setSubmenu();
        submenu.addItem((sub: MenuItem) => {
          sub
            .setTitle("Copy for Medium")
            .setIcon("file-text")
            .onClick(() => this.copyForPlatform(editor, MediumProfile));
        });
        submenu.addItem((sub: MenuItem) => {
          sub
            .setTitle("Copy for Substack")
            .setIcon("mail")
            .onClick(() => this.copyForPlatform(editor, SubstackProfile));
        });
      });
    } catch {
      // Fallback: flat menu items if setSubmenu is not available
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Pubcopy: Copy for Medium")
          .setIcon("file-text")
          .onClick(() => this.copyForPlatform(editor, MediumProfile));
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Pubcopy: Copy for Substack")
          .setIcon("mail")
          .onClick(() => this.copyForPlatform(editor, SubstackProfile));
      });
    }
  }

  private addFileMenuSubmenu(menu: Menu): void {
    try {
      menu.addItem((item: MenuItem) => {
        item.setTitle("Pubcopy").setIcon("clipboard-copy");
        const submenu = (item as MenuItem & { setSubmenu: () => Menu }).setSubmenu();
        submenu.addItem((sub: MenuItem) => {
          sub
            .setTitle("Copy for Medium")
            .setIcon("file-text")
            .onClick(() => this.copyFullNoteForPlatform(MediumProfile));
        });
        submenu.addItem((sub: MenuItem) => {
          sub
            .setTitle("Copy for Substack")
            .setIcon("mail")
            .onClick(() => this.copyFullNoteForPlatform(SubstackProfile));
        });
      });
    } catch {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Pubcopy: Copy for Medium")
          .setIcon("file-text")
          .onClick(() => this.copyFullNoteForPlatform(MediumProfile));
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Pubcopy: Copy for Substack")
          .setIcon("mail")
          .onClick(() => this.copyFullNoteForPlatform(SubstackProfile));
      });
    }
  }

  private async copyForPlatform(
    editor: Editor,
    profile: PlatformProfile
  ): Promise<void> {
    const selection = editor.getSelection();
    const markdown = selection || editor.getValue();

    await this.runConversion(markdown, profile);
  }

  private async copyFullNoteForPlatform(
    profile: PlatformProfile
  ): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Pubcopy: No active markdown file");
      return;
    }

    const markdown = view.editor.getValue();
    await this.runConversion(markdown, profile);
  }

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

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
