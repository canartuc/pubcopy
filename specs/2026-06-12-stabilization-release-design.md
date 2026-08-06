# Pubcopy Stabilization & Release — Design (2026-06-12)

## Goal

Clear all 6 issues from the Obsidian community plugin automated scan, fix the
file-explorer right-click copy bug, modernize dependencies and Node to latest
LTS, achieve a full test pass (vitest + Obsidian CLI against the
`obs_drop_test` vault), run measured performance-improvement loops, and publish
a new release autonomously so the scan re-evaluates with attestation and
release notes present.

## Non-goals

- No new features (user chose "stabilize only").
- No reduction of scan *disclosures* that originate from bundled libraries
  (KaTeX, unified ecosystem). Disclosures originating from our own `src/` code
  are in scope.
- No broad rewrites. Performance work follows small measured loops only.

## Scan issues and fixes

| # | Issue | Fix |
|---|-------|-----|
| 1 | `builtin-modules` should be replaced | Use `builtinModules` from `node:module` in `esbuild.config.mjs`; remove the dependency. |
| 2 | Unsafe assignment of an `any` value | `loadSettings()` assigns `await this.loadData()` (returns `any`). Type-narrow to `Partial<PubcopySettings> \| null` via `unknown`. Audit `src/` for any further `any` flows under type-aware lint. |
| 3 | Vulnerable `postcss` via `vitest` | Update vitest to latest (also clears critical GHSA-5xrq-8626-4rwp) and refresh the lockfile. |
| 4 | 2 release assets missing artifact attestation | Add `actions/attest-build-provenance` step to `release.yml` with `id-token: write` and `attestations: write` permissions, attesting `main.js`, `manifest.json`, `styles.css`. |
| 5 | Release has no description | `generate_release_notes: true` on the release action. |
| 6 | (general hygiene) | Update all dependencies to latest; CI + engines on Node latest LTS. |

## Bug: copy from file-explorer right-click does nothing useful

Root cause: the `file-menu` handler (`src/main.ts`) ignores the `file`
argument. Its actions call `copyFullNoteForPlatform()`, which reads from
`workspace.getActiveViewOfType(MarkdownView)`. Right-clicking a file in the
explorer does not make it the active view, so the user gets "No active
Markdown file." or silently copies a different (active) note.

Fix: thread the clicked `TFile` through to a new
`copyFileForPlatform(file, profile)` that reads content with
`vault.cachedRead(file)`. This single code path serves both the three-dot
menu and the explorer right-click, and as a bonus lets users copy a note
without opening it. Must verify the converter resolves embeds/links relative
to the clicked file's path, not the active file (check
`converter/embed-resolver.ts` source-path handling).

## Dependency & toolchain modernization

- All `dependencies` and `devDependencies` to latest compatible versions.
- Node latest LTS (24.x) in `ci.yml`, `release.yml`, and `package.json`
  `engines`.
- `npm audit` clean for production deps; dev advisories resolved by updates.

## Testing strategy

1. **Unit/integration (vitest):** keep all existing tests green after
   dependency updates; add regression tests for the file-menu fix (mocked
   `App`/`Vault`/`TFile`), and edge-case tests for converter behavior found
   lacking during review.
2. **Obsidian CLI:** smoke-test real plugin behavior against the
   `obs_drop_test` vault using the installed CLI (`obsidian` binary). If the
   current installer's CLI support is insufficient, pause and ask the user to
   update Obsidian.
3. **Extreme testing:** converter stress fixtures (very large note,
   math-heavy, footnote-heavy, image/embed-heavy, pathological markdown) used
   both for correctness and as the performance benchmark corpus.

## Performance loop protocol (user-specified)

Measure first; smallest viable change; preserve correctness/readability; no
broad rewrites; stop when gains are marginal. Each loop reports: bottleneck,
baseline, change, result, next step. A benchmark harness (node script over
the stress corpus, wall-clock ms, multiple iterations, median) provides the
numbers. No win is claimed without before/after measurements.

## Release plan (autonomous, per user choice)

1. All fixes merged to `main`; CI green.
2. Version bump to the next appropriate version (patch unless behavior
   warrants minor) across `manifest.json`, `package.json`, `versions.json`.
3. Tag and push; `release.yml` builds, attests, and publishes with generated
   release notes.
4. Verify with `gh release view` that assets, attestations, and notes are
   present.

## Risks

- Major-version dependency updates (vitest, esbuild, unified ecosystem) may
  break tests or output HTML; mitigated by running the full suite and
  comparing converter snapshots before/after.
- `setSubmenu()` is undocumented API; fallback path already exists and stays.
- Obsidian CLI capabilities unknown on the current installer; fallback is to
  ask the user to update.
