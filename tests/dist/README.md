# Distribution tests

What a user installs, tested from the packed tarballs rather than the source tree (plan M7; spec DX1, DX7,
DX8, DX10, DX11).

## Running

```bash
npm run build                    # packages/*/dist
npm run test:dist                # Node tests
npm run test:dist:browser        # browser tests, system Chrome (in CI: AXYLO_BROWSER=1 npx vitest run --config tests/dist/vitest.config.ts)
node scripts/size.mjs            # sizes table, bench/size-latest.json; --check fails on a target (96 / 80 / 2 KiB; not a CI gate yet)
```

The config's global setup runs `scripts/pack.mjs --no-build` first: `npm pack` for `packages/axylo` and
`packages/react` into `.packed/`, then `npm install --offline` in each fixture from its own `package.json`
(the tarballs through `file:` specifiers, React and its types from the npm cache; nothing is linked). Set
`AXYLO_DIST_BUILD=1` to run the root build first; `node scripts/pack.mjs` alone builds by default. If the
npm cache lacks registry metadata for the fixtures' third-party packages (a cache filled by `npm ci` alone),
that install falls back to `--prefer-offline`; our own packages never come from a registry.

Generated, git-ignored: `.packed/`, `.out/`, `fixtures/*/node_modules/`, `fixtures/*/example/` (copies of
`examples/first-chart`), `fixtures/*/.out/`.

## Isolation

The fixtures sit under the repository, and its root `node_modules` links the workspace packages. Node,
esbuild and TypeScript all walk up there for anything a fixture lacks, so a fixture could silently use a
package it never declared. Every resolution in these tests is therefore guarded:

- Node runs with `--import guard/node-guard.mjs`, a resolve hook that throws for any file outside the fixture;
- esbuild builds carry `fixtureGuard` (scripts/pack.mjs), which fails the build the same way;
- TypeScript has no option that stops the walk, so its `--listFiles` output is the guard: every file read
  must be in the fixture or be the compiler's own lib.

`isolation.test.ts` shows each guard passing the declared imports and stopping an undeclared one that,
unguarded, resolves into the workspace.

## What each file proves

| File | Proves |
|---|---|
| `isolation.test.ts` | npm installed each fixture from the packed tarballs (its lockfile names them and their integrity), with no links in `node_modules`; declared packages resolve inside the fixture in Node (both conditions) and esbuild, including the adapter's own `import 'axylo'`; an undeclared package is stopped by all three guards. |
| `package-contents.test.ts` | Every path in `exports` (each condition), `types`/`main`/`module` and `files` is in the tarball; the tarball holds nothing beyond those entries, the declarations their `types` import, the two script-tag files, `package.json`, `README.md` and `LICENSE`; no source, tests, source maps or build state; declarations import only peer dependencies. |
| `types.test.ts` | `tsc` (strict, `skipLibCheck: false`) type-checks a consumer of every export and the first-chart snippet in each fixture under both `moduleResolution: Bundler` and `NodeNext`, with the DX3 `@ts-expect-error` mistakes failing as they should, reading no file from outside the fixture. |
| `conditions.test.ts` | The `development` condition and the default are different files in Node and esbuild; no shipped core or adapter file refers to the build-time `__DEV__` or `__BENCH__` constants. (A source-derived check of development-only text was retired: it failed on ordinary identifiers; `flavours.browser.test.ts` is the evidence.) |
| `flavours.browser.test.ts` | Development-only behaviour, from a hand-written list (spec 3.5, plan 1.6 and 1.7, the diagnostics docs), on all four core files and both adapter files: hints print in development only and are delivered in both; warnings print in both; the adapter's memoization hint is development-only. |
| `side-effects.test.ts` | Importing either package and using nothing bundles to 0 bytes; `sideEffects` marks only the stylesheet, and `import 'axylo/axylo.css'` survives bundling. |
| `tree-shaking.test.ts` | Importing the production file for its effects alone, with side-effect hints ignored, bundles to nothing; a consumer of one chart kind carries that kind's markers and no other kind's; the library's source, bundled one kind at a time with the release settings, includes no module that belongs only to another kind (hand-listed), and `validate` alone includes no composition, drawing, DOM, lookup or reader module. |
| `node.test.ts` | DX8 in plain Node: importing `axylo` (both conditions) needs no DOM globals and adds none; `validate()` reports the Phase 1 `dirty` fixture as spec 3.5 says; `@axylo/react` server-renders each component to its empty container. |
| `licence.test.ts` | DX11: MIT in both `package.json` files and shipped `LICENSE` files; no runtime dependencies; shipped JavaScript imports only its peers; the release inventory in `THIRD-PARTY-NOTICES.md` lists exactly the tarballs' files, and each origin it claims holds (bundle inputs only from the package's `src`, the stylesheet equal to the string its module exports, declaration sources present); every licence or copyright header found in source or shipped files is quoted in its notices. |
| `snippets.test.ts` | DX1, static: each `examples/first-chart` file is at most ten non-blank lines, passes only data, fields and the title, and is copied verbatim into its fixture and its package README. |
| `size.test.ts` | `size.mjs --check` compares integer bytes with `targetKiB × 1024`. |
| `first-chart.browser.test.ts` | DX1 in Chrome: the npm snippet (production and development conditions), the script-tag snippet (CDN URLs answered from the packed files) and the React snippet each draw a named figure with series marks, with no console error or warning, and each still draws without its title, raising only AX140. Importing the package leaves the document untouched. Through the packed adapter, StrictMode creates, destroys and creates again, the destroyed chart ignores calls and receives no events, and unmounting destroys the second chart; server markup hydrates without a mismatch. |
| `csp.browser.test.ts` | DX8 in Chrome under a real `Content-Security-Policy` header (`browser.ts`, `cspPolicy`): all five types and the compact variant draw, tooltips and tables open, from both script-tag files and from bundled modules, with the stylesheet adopted at run time and linked by the page. No violation event, no report (each page has its own report URL, checked again after all pages ran), no console error; the stylesheet's rules are in the computed styles and its declared series colour is the painted one, and both disappear without the sheet. A missing target throws naming its selector. A negative control matches each report to its directive and page. |
| `text.browser.test.ts` | DX8 text insertion, under the same policy: a distinct markup-shaped sentinel per text source and chart type reaches heading, accessible name and description, legend, ticks, axis titles, tooltip or readout, table caption, headers and every cell (against its fixture row), and `aria-valuetext`, character for character, and no sentinel is ever parsed. Every built-in message the triggered states show is its override, literally; the dirty-input note reads as its template; author error text is shown as text. |
| `scripts/size.mjs` | DX7: minified and gzipped bytes of consumer bundles built from the fixtures, against the owner's targets (96 KiB everything, 80 KiB line only, 2 KiB React adapter), with rows for each other kind and for `validate` alone, and a per-module breakdown from a source rebuild with the release build's own settings. |

## Scope of DX1

The documented first chart is a line chart, and these tests establish DX1 for it by npm, script tag and
React, with and without its title. The other four chart functions (`area`, `bar`, `scatter`, `donut`) are
exported from the same entry points and shipped in the same files, so what is package-level (resolution,
loading, styles, the CSP and text tests, which draw all five) carries over; a ten-line first-chart snippet
for each of them is not written or tested here.

## Built-in messages not exercised

`text.browser.test.ts` replaces every key of `Messages` and requires the override wherever the states it
triggers show that key. These keys are not shown in those states, so their overrides are not checked:
`noObservation`, `error` (the author's error text is shown instead, and is checked), `internalError`,
`referenceSummary`, `pause`, `resume`, `showSeries`, `hideSeries`, `value`, `seriesNotDrawn`, `seriesValue`,
`position`, `jumpNotFound`, and the chart-type names (`typeLine` … `typeDonut`), which only appear through
templates that are themselves replaced. `valuesChanged` and `labelsHidden` do show (grouped donut slices,
long bar categories) but are not required, since the spec does not tie them to those fixtures. Wherever any
override shows, the page-wide check still requires it whole and unparsed. `seeTable` is checked in the
dirty-input note, with the other templates left built in.

## What they cannot show

- Other browsers: only system Chrome runs here. Firefox and Safari (spec: real Safari is checked by hand at M8) are not covered.
- A real registry install: the tarballs are installed by `npm install` from local files, so `npm publish` itself and registry resolution of our packages are not exercised. Version `0.0.0` is never published.
- Other bundlers: only esbuild builds the consumer bundles. webpack and Rollup are not installed; Vite and rolldown are present only as Vitest's own dependencies and are not used as consumer bundlers here. The `sideEffects` declaration for the stylesheet follows webpack's documented rule for CSS imports, which esbuild does not enforce, so its effect in webpack is not tested.
- DX10 beyond the first chart: the other documentation examples are not rendered from the packed files by these tests.
- Third-party code copied into `packages/*/src` without any header would not be detected (see `THIRD-PARTY-NOTICES.md`).
- Windows and macOS: `scripts/pack.mjs` runs `npm.cmd` through the shell on Windows; it has not been run there.
