/**
 * @module settings
 *
 * Plugin settings interface, defaults, and the Obsidian settings tab UI.
 *
 * Settings are persisted via Obsidian's `loadData()`/`saveData()` mechanism,
 * which stores them in `<vault>/.obsidian/plugins/pubcopy/data.json`.
 *
 * The tab is declared twice on purpose. `getSettingDefinitions()` is the
 * declarative API added in Obsidian 1.13.0, which makes each setting findable
 * from the settings search box; `display()` renders the same settings
 * imperatively for the older versions still covered by `minAppVersion`.
 * Obsidian skips `display()` whenever `getSettingDefinitions()` returns a
 * non-empty array, so only one of them ever runs.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type PubcopyPlugin from "./main";

/**
 * How to handle images during conversion.
 * - `auto`: Base64-encode local vault images, pass through remote URLs.
 * - `always-base64`: Base64-encode everything (remote images can't be fetched, so they fall back to URL).
 * - `always-url`: Keep all image references as URLs (local images may break outside the vault).
 */
export type ImageHandling = "auto" | "always-base64" | "always-url";

/**
 * How to render tables for platforms that do not support HTML tables (Medium).
 * - `list`: One bullet per row, cells as "**Header:** value" pairs.
 * - `code-block`: Column-aligned monospace table inside a code block.
 */
export type TableHandling = "list" | "code-block";

/** All user-configurable settings for Pubcopy. */
export interface PubcopySettings {
  /** Remove YAML frontmatter block from output. */
  stripFrontmatter: boolean;
  /** Remove Obsidian tags (#tag, #tag/subtag) from output. */
  stripTags: boolean;
  /** Convert [[wikilinks]] to plain text in output. */
  stripWikilinks: boolean;
  /** How to handle local and remote images. */
  imageHandling: ImageHandling;
  /** How to render tables on platforms without table support (Medium). */
  tableHandling: TableHandling;
  /** Show an Obsidian Notice after successful copy. */
  showNotification: boolean;
}

/** Sensible defaults for first-time users. All stripping enabled, auto image mode. */
export const DEFAULT_SETTINGS: PubcopySettings = {
  stripFrontmatter: true,
  stripTags: true,
  stripWikilinks: true,
  imageHandling: "auto",
  tableHandling: "list",
  showNotification: true,
};

/**
 * Settings tab rendered in Obsidian's Settings panel.
 */
export class PubcopySettingTab extends PluginSettingTab {
  plugin: PubcopyPlugin;

  constructor(app: App, plugin: PubcopyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Declarative settings for Obsidian 1.13.0 and later.
   *
   * Values are read and written through `PluginSettingTab`'s default
   * `getControlValue`/`setControlValue`, which operate on
   * `this.plugin.settings` and persist it — the same thing
   * {@link PubcopyPlugin.saveSettings} does.
   *
   * Every key in {@link PubcopySettings} must appear here, or that setting
   * becomes unreachable from settings search. A test enforces this.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Strip frontmatter",
        desc: "Remove YAML frontmatter from output",
        aliases: ["yaml", "properties", "metadata"],
        control: {
          type: "toggle",
          key: "stripFrontmatter",
          defaultValue: DEFAULT_SETTINGS.stripFrontmatter,
        },
      },
      {
        name: "Strip tags",
        desc: "Remove #tag and #tag/subtag from output",
        aliases: ["hashtag"],
        control: {
          type: "toggle",
          key: "stripTags",
          defaultValue: DEFAULT_SETTINGS.stripTags,
        },
      },
      {
        name: "Strip wikilinks",
        desc: "Convert [[links]] to plain text",
        aliases: ["internal links", "backlinks"],
        control: {
          type: "toggle",
          key: "stripWikilinks",
          defaultValue: DEFAULT_SETTINGS.stripWikilinks,
        },
      },
      {
        name: "Image handling",
        desc: "How to handle images in output",
        aliases: ["base64", "attachments", "pictures"],
        control: {
          type: "dropdown",
          key: "imageHandling",
          defaultValue: DEFAULT_SETTINGS.imageHandling,
          options: {
            auto: "Auto (base64 for local, URL for remote)",
            "always-base64": "Always embed as base64",
            "always-url": "Always keep as URL",
          },
        },
      },
      {
        name: "Table handling",
        desc: "How to convert tables for platforms that do not support them",
        aliases: ["medium", "tables", "code block"],
        control: {
          type: "dropdown",
          key: "tableHandling",
          defaultValue: DEFAULT_SETTINGS.tableHandling,
          options: {
            list: "Bulleted list (one bullet per row)",
            "code-block": "Monospace table in a code block",
          },
        },
      },
      {
        name: "Show notification",
        desc: "Display a notice after copying",
        aliases: ["notice", "toast"],
        control: {
          type: "toggle",
          key: "showNotification",
          defaultValue: DEFAULT_SETTINGS.showNotification,
        },
      },
    ];
  }

  /**
   * Imperative fallback for Obsidian versions older than 1.13.0.
   *
   * Obsidian 1.13.0+ never calls this — it renders
   * {@link PubcopySettingTab.getSettingDefinitions} instead — so any setting
   * added here must be added there too.
   */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Strip frontmatter")
      .setDesc("Remove YAML frontmatter from output")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.stripFrontmatter)
          .onChange(async (value) => {
            this.plugin.settings.stripFrontmatter = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Strip tags")
      .setDesc("Remove #tag and #tag/subtag from output")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.stripTags)
          .onChange(async (value) => {
            this.plugin.settings.stripTags = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Strip wikilinks")
      .setDesc("Convert [[links]] to plain text")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.stripWikilinks)
          .onChange(async (value) => {
            this.plugin.settings.stripWikilinks = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Image handling")
      .setDesc("How to handle images in output")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "Auto (base64 for local, URL for remote)")
          .addOption("always-base64", "Always embed as base64")
          .addOption("always-url", "Always keep as URL")
          .setValue(this.plugin.settings.imageHandling)
          .onChange(async (value) => {
            this.plugin.settings.imageHandling = value as ImageHandling;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Table handling")
      .setDesc("How to convert tables for platforms that do not support them")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("list", "Bulleted list (one bullet per row)")
          .addOption("code-block", "Monospace table in a code block")
          .setValue(this.plugin.settings.tableHandling)
          .onChange(async (value) => {
            this.plugin.settings.tableHandling = value as TableHandling;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show notification")
      .setDesc("Display a notice after copying")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showNotification)
          .onChange(async (value) => {
            this.plugin.settings.showNotification = value;
            await this.plugin.saveSettings();
          })
      );

  }
}
