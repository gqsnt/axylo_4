<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a6f0d7846bf125638. Saved by the coordinator from the hand-back. -->

## Distribution tests for Axylo (M7: DX1, DX7, DX8, DX11): report

All 101 distribution tests pass against the packed tarballs. The size targets do not: the line-only and everything bundles are about 98 KiB gzipped, against 25 and 40 KiB. I did not commit anything.

**Library state for the final run.** HEAD was `43fc75d`, plus another agent's uncommitted changes in `packages/axylo/src` (core, dom, render, theme, view). My `node scripts/pack.mjs` rebuilt dist at 06:54 CET. The last test and size runs were at 06:55 CET.

### Files

New:
- `/home/canarit/projects/axylo/scripts/pack.mjs`: root build (unless `--no-build`), `npm pack` of both packages into `tests/dist/.packed/`, then a built-in tar extractor unpacks them into the fixture `node_modules`. `react`, `react-dom` and `@types/react*` are linked from the root `node_modules`; `axylo` and `@axylo/react` are never linked.
- `/home/canarit/projects/axylo/examples/first-chart/npm.ts`, `script.html`, `react.tsx`: 8, 10 and 10 non-blank lines.
- `/home/canarit/projects/axylo/tests/dist/`:
  - test config and helpers: `vitest.config.ts` (its global setup packs before every run), `setup.ts`, `tsconfig.json`, `paths.ts`, `browser.ts` (my own HTTP server, see below), `README.md`
  - Node tests: `isolation`, `package-contents`, `types`, `conditions`, `side-effects`, `node`, `licence`, `snippets` (`*.test.ts`)
  - browser tests: `first-chart.browser.test.ts`, `csp.browser.test.ts`
  - pages: `pages/{observe.js, page.css, charts.ts, inject.js}`
  - fixtures: `fixtures/{npm,script,react}/` with `package.json`, `tsconfig.json`, consumer files, `node-import.mjs`, `main.tsx`, `hydrate.tsx`, `ssr.tsx`
- `/home/canarit/projects/axylo/packages/axylo/LICENSE`, `packages/react/LICENSE` (MIT, holder "The Axylo authors": please confirm), both READMEs (they quote the example files verbatim, and a test enforces that), `THIRD-PARTY-NOTICES.md`.

Rewritten: `/home/canarit/projects/axylo/scripts/size.mjs`.

I did not reuse `packages/axylo/test/browser/harness.ts`: it serves the whole repository with no response headers.

### Metadata changes I made, each driven by a failing test
- **`files` in `packages/axylo/package.json`:** narrowed from `["dist"]` to the 5 JS/CSS files plus `index.d.ts` and `public.d.ts`. Before, the tarball shipped 96 files, 87 of them internal `.d.ts` files that nothing imports. It now ships 10.
- **`files` in `packages/react/package.json`:** narrowed to `index.js`, `index.dev.js` and `index.d.ts`. `patch.d.ts` is not imported by `index.d.ts`.
- **`sideEffects` in `packages/axylo/package.json`:** changed from `false` to `["*.css"]`, because `false` was untrue for `axylo/axylo.css`. esbuild keeps the CSS import either way. The reason is webpack's documented rule for CSS imports; I could not test it because webpack is not installed.

### What ran (all observed)
- Node, `npx vitest run --config tests/dist/vitest.config.ts`: `Test Files 8 passed (8) / Tests 83 passed (83)`.
- Browser, `AXYLO_BROWSER=1 npx vitest run --config tests/dist/vitest.config.ts`: `Test Files 2 passed (2) / Tests 18 passed (18)`.
- `npx tsc -p tests/dist`: exit 0.
- `packages/react/test/dist.test.ts`: still 12/12 after the metadata changes.

What each group shows:
- **Isolation:** the fixture packages are real directories, not links. Node (with and without `--conditions=development`) and esbuild resolve `axylo`, `axylo/axylo.css`, `@axylo/react`, and the adapter's own `import 'axylo'`, to fixture paths only. A control assertion confirms the root `node_modules/axylo` really does link to the workspace, so the check has something to catch.
- **Package contents:** every `exports` target under every condition, and every `files` entry, is in the tarball. Nothing else ships beyond the declarations the types entries import, the two IIFE files, README, LICENSE and package.json. No source, tests or source maps; declarations import only peer dependencies.
- **Types:** strict `tsc` with `skipLibCheck: false` passes on a consumer file and on each snippet, in both fixtures. `--listFiles` shows the declarations came from the fixture. The `@ts-expect-error` lines for the DX3 mistakes behave correctly, so the declarations are real types, not `any`.
- **Conditions:** `development` and the default are different files in Node and in esbuild, and neither contains `__DEV__`.
  - How I checked for development-only code: I found every `if (__DEV__) …` in the source and bundled the source twice, once as is and once with those statements cut out. Text present only in the first bundle counts as development-only.
  - Found for `axylo`: `__dev`, `stages`, `retainedRows`. For `@axylo/react`: `[axylo/react] <`, `> was given `, `columns`.
  - Each is present in the packed development file and absent from the production one.
  - In the browser, the AX104 hint prints once in the development flavour and not at all in production.
- **Side effects:** importing either package and using nothing bundles to 0 bytes. Importing `axylo` in Node adds no globals, and in Chrome it leaves the document untouched. `import 'axylo/axylo.css'` survives bundling.
- **DX8 in Node:**
  - Importing `axylo` works without DOM globals.
  - `validate()` on the Phase 1 dirty fixture returns exactly AX102 (row 5), AX103 (row 3) and AX106 (row 4), as spec 3.5 and plan 1.6 say.
  - `line('#nowhere')` with no document throws a message naming `#nowhere`.
  - Server rendering of the snippet and all five components gives an empty `<div>` container each.
- **DX1 in Chrome:**
  - The npm snippet (production and development conditions), the script-tag snippet and the React snippet under StrictMode each draw one figure named "Monthly visitors" with series-painted marks, and print no console error or warning.
  - Hydrating the server markup produces no mismatch.
  - Without `title`, the chart still draws and raises only AX140.
- **DX8 under CSP:** 8 page variants: {IIFE min, IIFE dev, bundled module prod, bundled module dev} × {stylesheet applied at run time, stylesheet linked by the page}. Each draws all five chart types plus the compact variant and opens tooltips and all five tables. Result: zero violation events, zero reports, zero console errors, no elements created from `<img onerror>` or `<script>` text in titles, series, categories, labels, units or formatters, and `#no-such-chart` is named in the thrown error. Run-time styling adopts exactly one sheet; the linked case adopts none; there are never any `<style>` elements. A negative control (an `insertAdjacentHTML` page) is caught by both instruments.
  - The exact policy: `default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; report-uri /csp-report`
- **DX11:** MIT field and LICENSE text in both packages. No runtime dependencies. The shipped JS imports nothing, except `react` and `axylo` from the adapter. Bundling each package's source with the release settings reads only its own `src`, so no `node_modules` code is compiled in. No licence headers in `packages/*/src` or in the shipped files.

### Sizes (`node scripts/size.mjs`, from the packed files, esbuild minify, production condition, gzip level 9)

| entry | min B | js gzip B | css file gzip B | total KiB | target KiB | status |
|---|---|---|---|---|---|---|
| line only (`npm.ts`) | 282,947 | 99,956 | — | 97.61 | 25 | OVER |
| everything | 283,389 | 100,093 | — | 97.75 | 40 | OVER |
| script tag (IIFE min + css) | 283,869 | 100,179 | 4,095 | 101.83 | — | no target |
| React adapter alone | 2,375 | 1,197 | — | 1.17 | 2 | ok |

- `--check` exits 1.
- The JS already carries the stylesheet string, so the bundler rows do not add the CSS file. Adding it, as the old script did, would add 4,095 B.
- Breakdown by directory (minified bytes): data 24.3%, core 16.1%, dom 13.5%, theme 8.8%. Largest modules: `core/controller.ts`, `dom/interaction.ts`, `data/store.ts`, `theme/css.ts`.
- A rebuild from source with the release settings is byte-identical in size to the packed `axylo.js`.
- **Finding: chart types do not tree-shake.** Line-only saves 137 B gzip compared with everything. Building from source gives the same result (line-only 99,735 B, everything 99,912 B, `validate` only 20,686 B).
  - The likely cause (inferred, not proven) is that every chart function goes through `createChart(type, …)` in `packages/axylo/src/core/chart.ts` / `core/controller.ts`, which reaches all types.

### Failing tests
None among the 101. The only failure is `size.mjs --check`, above, for DX7.

### Where the spec was ambiguous, and what I assumed
1. **DX1 options:** "no option besides data and fields" conflicts with AX140, which is a warning (spec 3.5), and with "no console warnings". The snippets therefore pass `title`, as the plan 1.1 example does. A test shows the title is not required. `acceptance/matrix.json` DX1 still says "only data and fields".
2. **Script-tag file names:** plan 1.6 calls the script-tag files `axylo.js`/`axylo.min.js`. The build produces `axylo.iife.js`/`axylo.iife.min.js`, and `axylo.js` is the production ESM file. The snippet uses `dist/axylo.iife.min.js`.
3. **Script-tag URL:** the snippet uses unversioned `https://cdn.jsdelivr.net/npm/axylo/dist/...` for a package not yet published. The test routes those URLs to the packed files.
4. **Script-tag target:** the spec gives no size target for the script-tag row.
5. **React snippet shape:** it exports a component, which the fixture's `main.tsx` mounts.
6. **Server markup:** the expected SSR output (an empty container) is taken from plan 1.7, "create on mount".

### Lines for files I don't own
Root `package.json` scripts: add
```
"test:dist": "vitest run --config tests/dist/vitest.config.ts",
"test:dist:browser": "AXYLO_BROWSER=1 vitest run --config tests/dist/vitest.config.ts",
```
In the same file, append ` && tsc -p tests/dist` to `typecheck`, and add ` && npm run test:dist && npm run test:dist:browser` to `check` after `test:browser`.

`.gitignore`, after `dist/` (that rule currently ignores all of `tests/dist`; I checked this negation in a scratch repo):
```
!/tests/dist/
/tests/dist/.packed/
/tests/dist/.out/
/tests/dist/fixtures/*/node_modules/
/tests/dist/fixtures/*/example/
/tests/dist/fixtures/*/.out/
```

`vitest.config.ts`: no change needed or recommended. The root `include` does not cover `tests/dist`, which is intended: these tests need the pack global setup, so they run through their own config. Adding them to the root config would pack on every `npm test`.

`.github/workflows/ci.yml`, after `- run: npm run build`:
```yaml
      - run: npx tsc -p tests/dist
      - run: npx vitest run --config tests/dist/vitest.config.ts
      - run: npx vitest run --config tests/dist/vitest.config.ts
        env:
          AXYLO_BROWSER: 1
```
The existing `npm run size` step now measures the packed files. Add `-- --check` only once you want the size targets to gate CI.

### Not verified
- Only system Chrome on Linux; no other browsers, and no Windows or macOS (the junction and `npm.cmd` paths in `pack.mjs` have never run there).
- No real `npm install` or registry.
- No bundler except esbuild: webpack and Rollup are absent, and Vite/rolldown exist only as Vitest's own dependencies.
- DX10 beyond the three first-chart snippets.
- Nothing is left running. The headless Chrome visible during my run belonged to the other agent's vitest process.

