# Pubcopy

Obsidian plugin that copies your notes as platform-optimized HTML to clipboard for pasting into Medium and Substack without formatting loss.

## Install

### From Obsidian (recommended)

Settings > Community plugins > Browse > Search "Pubcopy" > Install > Enable

### Manual

1. Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/canartuc/pubcopy/releases/latest)
2. Create folder: `<your-vault>/.obsidian/plugins/pubcopy/`
3. Copy the 3 files into that folder
4. Restart Obsidian
5. Settings > Community plugins > Enable "Pubcopy"

## Usage

Three ways to trigger:

| Method | Behavior |
|--------|----------|
| **Command Palette** (`Cmd/Ctrl+P`) > "Pubcopy" | Copies entire note |
| **Right-click** in editor > Pubcopy submenu | Copies selected text (or entire note if no selection) |
| **Three-dot menu** (top-right of note) > Pubcopy submenu | Copies entire note |

Each method offers two options:
- **Copy for Medium**
- **Copy for Substack**

After copying, paste (`Cmd/Ctrl+V`) into the Medium or Substack editor.

## What gets converted

56 Obsidian markdown elements are handled:

| Element | Medium | Substack |
|---------|--------|----------|
| Bold, italic, strikethrough, inline code | Yes | Yes |
| Highlights `==text==` | Converted to bold | Converted to bold |
| Headers H1-H4 | Yes | Yes |
| Headers H5-H6 | Flattened to H4 | Yes |
| Lists (ordered, unordered, nested) | Max 2 levels | Unlimited |
| Task lists `- [ ]` | Unicode checkboxes | Unicode checkboxes |
| Callouts `> [!note]` | Styled blockquote with label | Styled blockquote with label |
| Code blocks (with language) | `<pre><code>` | `<pre>` |
| Tables | HTML table | HTML table |
| Images (local) | Base64 embedded | Base64 embedded |
| Images (remote URL) | URL passthrough | URL passthrough |
| Image captions | Italic text below image | `<figcaption>` |
| Footnotes | Superscript + Notes section | Native |
| Math (LaTeX) | Rendered via KaTeX | Rendered via KaTeX |
| Mermaid diagrams | Stripped (not supported) | Stripped (not supported) |
| Wikilinks, tags, comments, frontmatter | Stripped | Stripped |
| Embeds `![[note]]` | Resolved and inlined | Resolved and inlined |

## Settings

Settings > Community plugins > Pubcopy > Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Strip frontmatter | On | Remove YAML frontmatter |
| Strip tags | On | Remove `#tag` references |
| Strip wikilinks | On | Convert `[[links]]` to plain text |
| Mermaid format | SVG | SVG or PNG (for future use) |
| Image handling | Auto | Auto: base64 for local, URL for remote |
| Show notification | On | Display notice after copying |

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/canartuc/pubcopy.git
cd pubcopy
npm install
```

### Build

```bash
# Development (watch mode, rebuilds on file change)
npm run dev

# Production build
npm run build
```

### Test

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

### Deploy to your vault

First run asks for your vault path and saves it to `.deploy.json` (gitignored):

```bash
npm run deploy
# > Obsidian vault path: /path/to/your/vault
# > Saved to .deploy.json
# > Deployed to .../plugins/pubcopy
```

Every subsequent run just builds and copies:

```bash
npm run deploy
```

After deploying, restart Obsidian or reload the plugin.

### Project structure

```
src/
├── main.ts                    # Plugin entry, commands, menus
├── settings.ts                # Settings interface and tab
├── converter/
│   ├── index.ts               # Conversion pipeline orchestrator
│   ├── preprocessor.ts        # Strip frontmatter, tags, wikilinks, etc.
│   ├── html-converter.ts      # Markdown to HTML via remark/rehype
│   ├── image-handler.ts       # Local base64, remote URL, captions
│   ├── embed-resolver.ts      # Resolve ![[note]] embeds
│   ├── footnote-processor.ts  # Platform-specific footnotes
│   └── math-renderer.ts       # LaTeX via KaTeX
├── platforms/
│   ├── index.ts               # PlatformProfile interface
│   ├── medium.ts              # Medium-specific rules
│   └── substack.ts            # Substack-specific rules
├── clipboard/
│   └── writer.ts              # Clipboard API (text/html + text/plain)
└── utils/
    ├── errors.ts              # PubcopyError, WarningCollector
    └── notifications.ts       # Obsidian Notice wrappers
```

### Release

Push a tag to trigger a GitHub Actions release:

```bash
# Update version in manifest.json and package.json first
git tag X.Y.Z
git push origin X.Y.Z
```

GitHub Actions runs tests, builds, and creates a release with `main.js`, `manifest.json`, and `styles.css`.

## License

MIT
