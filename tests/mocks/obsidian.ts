// Mock Obsidian API for testing
export class Notice {
  constructor(public message: string, public timeout?: number) {}
}

export class Plugin {}
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
  addItem(cb: (item: MenuItem) => void) {
    cb(new MenuItem());
    return this;
  }
}

export class MenuItem {
  setTitle(_title: string) { return this; }
  setIcon(_icon: string) { return this; }
  onClick(_cb: () => void) { return this; }
  setSubmenu() { return new Menu(); }
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

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    const data = this.binaryFiles.get(file.path);
    if (!data) throw new Error(`Binary file not found: ${file.path}`);
    return data;
  }
}

export class Workspace {
  on(_event: string, _callback: (...args: unknown[]) => void) {
    return { event: _event };
  }
  getActiveViewOfType(_type: unknown) { return null; }
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
    getValue: () => "",
    getSelection: () => "",
  };
}

export type Editor = {
  getValue: () => string;
  getSelection: () => string;
};
