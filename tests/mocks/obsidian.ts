// Mock Obsidian API for testing
export class Notice {
  /** Every notice raised since the last reset, so tests can assert on them. */
  static instances: Notice[] = [];
  static reset(): void {
    Notice.instances = [];
  }
  constructor(public message: string, public timeout?: number) {
    Notice.instances.push(this);
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

export class Plugin {
  app: App;
  manifest: { id: string; version: string; fundingUrl?: string | Record<string, string> } = {
    id: "pubcopy",
    version: "0.0.0",
  };
  private data: unknown = null;

  constructor(app?: App) {
    this.app = app ?? new App();
  }

  addCommand(_command: unknown): void {}
  addSettingTab(_tab: unknown): void {}
  registerEvent(_eventRef: unknown): void {}

  async loadData(): Promise<unknown> {
    return this.data;
  }

  async saveData(data: unknown): Promise<void> {
    this.data = data;
  }
}
export class PluginSettingTab {
  containerEl = {
    empty: () => {},
    createEl: (_tag: string, _opts: Record<string, string>) => document.createElement("div"),
  };
  constructor(_app: App, _plugin: Plugin) {}
  display() {}
}

export class Setting {
  constructor(_containerEl: HTMLElement) {}
  setName(_name: string) { return this; }
  setDesc(_desc: string) { return this; }
  addToggle(_cb: (toggle: Toggle) => void) { return this; }
  addDropdown(_cb: (dropdown: Dropdown) => void) { return this; }
}

export class Toggle {
  setValue(_value: boolean) { return this; }
  onChange(_cb: (value: boolean) => void) { return this; }
}

export class Dropdown {
  addOption(_value: string, _display: string) { return this; }
  setValue(_value: string) { return this; }
  onChange(_cb: (value: string) => void) { return this; }
}

export class Menu {
  items: MenuItem[] = [];

  addItem(cb: (item: MenuItem) => void) {
    const item = new MenuItem();
    this.items.push(item);
    cb(item);
    return this;
  }

  /** Test helper: find a menu item by its title. */
  findItem(title: string): MenuItem | undefined {
    return this.items.find((i) => i.title === title);
  }
}

export class MenuItem {
  title = "";
  icon = "";
  clickHandler: (() => unknown) | null = null;
  submenu: Menu | null = null;

  setTitle(title: string) { this.title = title; return this; }
  setIcon(icon: string) { this.icon = icon; return this; }
  onClick(cb: () => unknown) { this.clickHandler = cb; return this; }
  setSubmenu() {
    this.submenu = new Menu();
    return this.submenu;
  }

  /** Test helper: invoke the click handler and await any returned promise. */
  async click(): Promise<void> {
    if (!this.clickHandler) throw new Error(`No click handler on "${this.title}"`);
    await this.clickHandler();
  }
}

export class App {
  vault = new Vault();
  workspace = new Workspace();
  metadataCache = new MetadataCache();
}

export class Vault {
  private files: Map<string, string> = new Map();
  private binaryFiles: Map<string, ArrayBuffer> = new Map();

  addMockFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  addMockBinaryFile(path: string, data: ArrayBuffer): void {
    this.binaryFiles.set(path, data);
  }

  async read(file: TFile): Promise<string> {
    const content = this.files.get(file.path);
    if (content === undefined) throw new Error(`File not found: ${file.path}`);
    return content;
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    const data = this.binaryFiles.get(file.path);
    if (!data) throw new Error(`Binary file not found: ${file.path}`);
    return data;
  }
}

export class Workspace {
  private handlers: Map<string, Array<(...args: unknown[]) => void>> = new Map();
  /** Test helper: set the view returned by getActiveViewOfType. */
  activeView: MarkdownView | null = null;
  /**
   * False while Obsidian is starting up, true once a plugin is enabled or
   * reloaded mid-session. Defaults to true because that is the state most
   * tests exercise; set false to simulate a cold start.
   */
  layoutReady = true;

  on(event: string, callback: (...args: unknown[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(callback);
    this.handlers.set(event, list);
    return { event };
  }

  /** Test helper: fire a workspace event to registered handlers. */
  trigger(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }

  getActiveViewOfType(_type: unknown): MarkdownView | null {
    return this.activeView;
  }
}

export class MetadataCache {
  private fileLookup: Map<string, TFile> = new Map();

  addMockLookup(linkpath: string, file: TFile): void {
    this.fileLookup.set(linkpath, file);
  }

  getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
    return this.fileLookup.get(linkpath) ?? null;
  }
}

export class TFile {
  path: string;
  name: string;
  extension: string;

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
    this.extension = this.name.split(".").pop() ?? "";
  }
}

export class MarkdownView {
  editor = {
    content: "",
    selection: "",
    getValue(): string { return this.content; },
    getSelection(): string { return this.selection; },
  };
}

export type Editor = {
  getValue: () => string;
  getSelection: () => string;
};
