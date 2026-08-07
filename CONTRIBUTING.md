# Contributing to Pubcopy

Thanks for taking the time.

## Requirements

- Node 24 or newer (`engines` requires `>=24.0.0`; CI runs 24)
- Obsidian desktop, if you want to run the end-to-end tests

## Setup

```sh
git clone https://github.com/canartuc/pubcopy.git
cd pubcopy
npm install
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Build in watch mode |
| `npm run build` | Type-check, then produce `main.js` |
| `npm run lint` | ESLint over `src/` and `manifest.json` |
| `npm test` | Unit and integration tests (vitest) |
| `npm run test:watch` | The same tests, in watch mode |
| `npm run test:cli` | End-to-end tests against a real Obsidian vault |
| `npm run docs` | Regenerate the API docs |
| `npm run deploy` | Build and copy into a vault set in `.deploy.json` |

## Tests

Unit tests live in `tests/` and run against a mocked Obsidian API in
`tests/mocks/obsidian.ts`. They need nothing installed:

```sh
npm test
```

The end-to-end tests drive the real Obsidian app through its CLI. They need
Obsidian installed and running, a vault named `obs_drop_test` registered in it,
and Pubcopy enabled in that vault:

```sh
npm run test:cli            # uses the obs_drop_test vault
npm run test:cli my-vault   # or name your own
```

They write temporary files into the vault and delete them afterwards. If you
cannot run them, say so in your pull request and CI will still cover the rest.

`npm run docs` deletes everything in `docs/` before writing. Keep hand-written
documents in `specs/`.

## Things that are easy to break

The converter has a few rules that are not obvious from reading the code around
them. Each one is there because of a bug that shipped.

**Do not transform serialized HTML with regular expressions.** The HTML
serializer does not escape `<` or `>` inside attribute values, so an image alt
or a link title containing `</table>` looks exactly like real markup to a
string scanner. Structural changes belong in a rehype plugin working on the
tree, between sanitization and serialization. An earlier version of the table
rewrite did this with regexes and could be made to emit a live `<script>` into
the clipboard.

**Test escaping by parsing, not by searching.** `expect(html).not.toContain("<script>")`
cannot tell a live element from the same text sitting harmlessly inside an
attribute. Parse the output and look for real elements and `on*` attributes, as
`tests/converter/security.test.ts` does.

**Bound your quantifiers.** Patterns that run over whole notes use bounds like
`{1,1000}` rather than `+` or `*`. Unbounded versions backtrack quadratically on
input such as a run of unclosed `[[`: one measured 5.3 seconds on a 50 KB note,
and would run for hours at the 2 MB input cap.

**Recompute protected ranges per pass.** Helpers in
`src/converter/protected-ranges.ts` keep code fences and inline code untouched.
Ranges are half-open, and every pass that changes the text length recomputes
them from its own input, because offsets from an earlier pass are already stale.

**Escape anything you interpolate into HTML.** Use `escapeHtml` from
`src/utils/html.ts`. The exception is content that already came out of the
sanitizer, which would be escaped twice.

## Adding a setting

Settings are declared in two places in `src/settings.ts`, on purpose:

- `getSettingDefinitions()` is the declarative API for Obsidian 1.13 and newer.
  Settings declared there show up in the settings search box.
- `display()` is the fallback for older versions, which `minAppVersion` still
  covers. Obsidian skips it whenever `getSettingDefinitions()` returns anything,
  so the two never both render.

Add your setting to both, plus `PubcopySettings` and `DEFAULT_SETTINGS`. The
tests fail if a stored setting is missing from the definitions.

Do not delete `display()` to remove the apparent duplication. That silently
breaks every user below Obsidian 1.13.

## Adding a platform

Platforms are data, not code. Add a profile under `src/platforms/` describing
what the target editor accepts, and register it in `src/main.ts`. If you find
yourself writing `if (profile.name === "...")` in the converter, add a
capability flag to `PlatformProfile` instead.

## Pull requests

- Branch off `main`.
- Run `npm run lint`, `npm test`, and `npm run build` before pushing.
- CI runs lint, type-check, tests, build, and `npm audit --omit=dev`. All of it
  must pass.
- Explain what breaks without the change. A failing test that now passes is the
  clearest way to do that.

## Releases

For maintainers:

```sh
npm version minor --no-git-tag-version   # or patch; syncs manifest and versions.json
```

Commit, merge to `main`, and wait for CI to pass there. Push the tag last. It
must be the bare version with no `v` prefix and must match `manifest.json`:

```sh
git tag 1.7.0 && git push origin 1.7.0
```

The release workflow builds, attests, and publishes. Check the assets and their
provenance when the workflow finishes:

```sh
gh release view 1.7.0
gh attestation verify main.js --repo canartuc/pubcopy
```

## Reporting bugs

Include the Obsidian version, your platform, and the smallest note that
reproduces the problem. For conversion bugs, the markdown you copied and what
you got after pasting are usually enough.
