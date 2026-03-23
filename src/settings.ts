import { App, PluginSettingTab, Setting } from "obsidian";
import type PubcopyPlugin from "./main";

export type MermaidFormat = "svg" | "png";
export type ImageHandling = "auto" | "always-base64" | "always-url";

export interface PubcopySettings {
  stripFrontmatter: boolean;
  stripTags: boolean;
  stripWikilinks: boolean;
  mermaidFormat: MermaidFormat;
  imageHandling: ImageHandling;
  showNotification: boolean;
}

export const DEFAULT_SETTINGS: PubcopySettings = {
  stripFrontmatter: true,
  stripTags: true,
  stripWikilinks: true,
  mermaidFormat: "svg",
  imageHandling: "auto",
  showNotification: true,
};

export class PubcopySettingTab extends PluginSettingTab {
  plugin: PubcopyPlugin;

  constructor(app: App, plugin: PubcopyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Pubcopy Settings" });

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
      .setName("Mermaid rendering format")
      .setDesc("Output format for Mermaid diagrams")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("svg", "SVG")
          .addOption("png", "PNG")
          .setValue(this.plugin.settings.mermaidFormat)
          .onChange(async (value) => {
            this.plugin.settings.mermaidFormat = value as MermaidFormat;
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
  }
}
