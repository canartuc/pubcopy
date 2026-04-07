/**
 * @module settings
 *
 * Plugin settings interface, defaults, and the Obsidian settings tab UI.
 *
 * Settings are persisted via Obsidian's `loadData()`/`saveData()` mechanism,
 * which stores them in `<vault>/.obsidian/plugins/pubcopy/data.json`.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type PubcopyPlugin from "./main";

/**
 * How to handle images during conversion.
 * - `auto`: Base64-encode local vault images, pass through remote URLs.
 * - `always-base64`: Base64-encode everything (remote images can't be fetched, so they fall back to URL).
 * - `always-url`: Keep all image references as URLs (local images may break outside the vault).
 */
export type ImageHandling = "auto" | "always-base64" | "always-url";

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
  /** Show an Obsidian Notice after successful copy. */
  showNotification: boolean;
}

/** Sensible defaults for first-time users. All stripping enabled, auto image mode. */
export const DEFAULT_SETTINGS: PubcopySettings = {
  stripFrontmatter: true,
  stripTags: true,
  stripWikilinks: true,
  imageHandling: "auto",
  showNotification: true,
};

/**
 * Settings tab rendered in Obsidian's Settings panel.
 *
 * Includes all configurable options and a support/donation button
 * at the bottom of the page.
 */
export class PubcopySettingTab extends PluginSettingTab {
  plugin: PubcopyPlugin;

  constructor(app: App, plugin: PubcopyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("General").setHeading();

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

    // Donation section
    containerEl.createEl("hr");

    const donationDiv = containerEl.createDiv({ cls: "pubcopy-donation" });
    donationDiv.createEl("p", {
      text: "If this plugin saves you time, consider supporting its development:",
    });

    const link = donationDiv.createEl("a", {
      href: "https://www.canartuc.com/#/portal/support",
      text: "Buy me a coffee",
    });
    link.setAttr("target", "_blank");
    link.setAttr("style", "display:inline-block;padding:8px 16px;background:#6e5494;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;");
  }
}
