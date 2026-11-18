<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a8a13825a6a59c62a. Saved by the coordinator from the hand-back. -->

## Tree-shaking work package: report

Nothing is committed. `dist` was last built from the final tree, which type-checks. I made one restructuring with no intended behaviour change. All four steps are done. I ran full verification twice: at the end of step 1, and once more on the finished tree. Steps 2, 3 and 4 were verified together (Node tests at each change; the browser suites only on the final build), not one step at a time.

### Baseline (measured by me at the start; the brief's 99.47 KiB predates commit e9449a6)
Measured from the packed tarballs with `scripts/size.mjs`:
- everything: 107,960 B gzip (105.43 KiB)
- line only: 107,835 B (105.31 KiB)
- script tag: 108,088 + 5,094 CSS = 110.53 KiB
- React adapter: 1,671 B (1.63 KiB)

At baseline the other kinds alone were about 107.6 KB each. That figure is from a source rebuild, not the tarballs, because nothing was shaken.

### Step 1: per-chart composition
**Map for a reviewer:**
- `src/core/composition.ts` defines the `Composition` interface: normalize, openStore, view, scene, lookup, reader parts, interaction parts, and SVG and canvas mark handlers.
- `src/kinds/{line,area,bar,scatter,donut}.ts` are plain object literals of function references. `src/kinds/index.ts` holds `COMPOSITIONS`.
- `index.ts`: `line()` calls `createChart(LINE, …)`.
- `core/chart.ts`: `createChart(composition, …)` uses `svgRendererWith` / `canvasRendererWith(composition.*)` and `createInteraction(composition.interaction, …)`.
- `core/controller.ts`: new `controllerFor(composition, …)`. `createController(kind, …)` is kept for the tests and maps through `COMPOSITIONS`.

**Per-shape entry points (the old dispatchers are kept as thin wrappers for tests and for `validate`):**
- `data/normalize.ts`: `normalizeAligned`, `normalizePoints`, `normalizeDonut`. The stores and `reader/x.ts` now call these directly.
- `data/store.ts`: `openAlignedStore`.
- `data/store-unaligned.ts`: `openPointStore`, `openDonutStore`.
- `view/index.ts`: `buildAlignedView`, `buildScatterView`, `buildDonutView`.
- `scene/index.ts`: `cartesianScene` plus `line`/`area`/`bar`/`scatter` layers and scenes, and `donutScene`.
- `lookup/index.ts`: `*LookupFor` functions.
- `reader`: `readerWith(parts)`, with `alignedReader`, `scatterReader` and `donutReader`; the table is split per shape.
- `core/focus.ts`: `overlayWith(targetMarks)`, with aligned, scatter and donut target marks.
- `dom/interaction.ts`: `InteractionParts` (overlay, swatch, `stepInSeries`, `donutSliceList`).
- `dom/swatch.ts`: `swatchPattern`, so bar pattern drawing is reached only from `barSwatch`.
- `render/svg.ts` and `render/canvas.ts`: per-mark handler tables. `createSvgRenderer` and `createCanvasRenderer` still have every handler.

**How the ESM ships:** I kept one prebundled file per condition, and made it tree-shakeable.
- I measured both options. With all import-time work removed, prebundled and a module graph (one file per source module, `sideEffects` false) came out within 25 B for every kind.
- The module graph was 5.7 KB better for `validate` alone, but only while the stylesheet template still did work at import.
- I chose prebundled because it leaves `exports`, `files`, the declarations and the package-shape tests unchanged.

**Proof that it shakes:** I removed every piece of import-time work:
- marker polygons are now built lazily;
- computed constants (2π, 2⁻²⁰, squares) became literals;
- the registry became plain data, with the message composed in `createDiagnostic`;
- the option-name lists are written out instead of spread;
- `Intl.Segmenter` is created on first use;
- the time-interval table is built lazily;
- `TOKEN_BINDINGS` is no longer `Object.freeze`d (readonly by type only; nothing mutates it);
- the stylesheet is a literal (step 2).

**New test `tests/dist/tree-shaking.test.ts` (11 tests, all pass):**
- Importing `axylo` only for its effects, with `ignoreAnnotations` set so esbuild ignores `sideEffects`, bundles to 0 bytes.
- For each kind, the bundle must contain its own markers and none of the other kinds'. The markers survive minification:
  - each kind: `kind:"<k>",normalize:`
  - area: `.upper`
  - bar: `axylo-pattern-`
  - scatter: `.minX`
  - donut: `__other__`
  - aligned storage: `adoptNormalized`, which must be absent from scatter and donut
- Each marker is first required in its own kind's bundle, so a marker lost to a rename fails the test instead of passing everything.

**Sizes at the end of step 1** (source rebuilt with the release settings, before CSS minification and instrumentation removal): everything 109,948, line 92,878, area 94,874, bar 94,086, scatter 88,066, donut 81,106.

### Step 2: stylesheet minified once
- New `src/theme/minify.ts` removes only comments and layout whitespace. It keeps commas, colons, values and strings, and drops the `;` before `}`.
- `scripts/build.mjs` substitutes the minified literal for `theme/css.ts` in `axylo.js` and `axylo.iife.min.js`, and writes the same text to `dist/axylo.css`.
- Development files keep `css.ts` as written. I checked that `axylo.dev.js` is byte-identical to a plain `__DEV__: 'true'` rebuild, which the docs guard needs.
- `build.mjs` now exports `stylesheets()`, `stylesheetPlugin()`, `PRODUCTION` and `DEVELOPMENT`, and only builds when run directly.
- Stylesheet: 19,977 B → 13,917 B; gzip 5,094 B → 2,886 B.
- New `packages/axylo/test/theme/minify.test.ts` parses both forms into the same rule tree in order (more than 50 rules and 150 declarations), checks that property names match, and tests idempotence and edge cases.
- The licence test's origin rule now accepts "generated from X through Y". `THIRD-PARTY-NOTICES.md` was updated to match.

### Step 3: production instrumentation removed
- New `src/core/instrument.ts` is the one place for the `__bench` and `__dev` hooks, `StageCounter`, the `Probe` interface and `describe()` (with the line `kept` indexes).
- The harness's future needs (run starts, the plot rectangle, owned bytes) go in `Probe` and `attachHooks` there.
- The controller guards with `__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)`. The `typeof` keeps the acceptance `production.test.ts` working, since it defines only `__DEV__`.
- `__BENCH__` is declared in `core/globals.d.ts` and is false in every shipped file.
- AX199 recovery is untouched.
- Every browser suite loads the dev builds (`axylo.iife.js` and the dev bundles), which still have the hooks. Production-page tests already waited by frames, so no test was changed.
- Saving: about 650–720 B gzip.

**The define the benchmark build needs:**
- Its production IIFE: `define: { __DEV__: 'false', __BENCH__: 'true' }`. `__bench` is attached when `globalThis.__AXYLO_BENCH__ === true`, as before.
- To match shipped bytes otherwise, also add `plugins: [stylesheetPlugin(minified)]`, imported from `scripts/build.mjs`.
- Its dev IIFE needs no change.
- Its "byte-identical to `scripts/build.mjs`" check can only hold for an uninstrumented copy built with `PRODUCTION` plus the plugin.

### Step 4: exact duplicates
- `setAttr`: one copy in new `dom/attributes.ts`, used by figure, toolbar, table and interaction. `table.ts`'s variant skipped the `hasAttribute` check; removing an absent attribute is a no-op, so behaviour is the same.
- `clamp`: `lookup/aligned` now uses `scene/geometry`'s.
- `withUnit`: `core/axes` now uses `reader/table`'s.
- Binary search: `focus.lowerBound` and the controller's `indexOf` now use `lookup/search`.
- Message-key allowlist: now `Object.keys(defaultMessages)`. I checked that it has the same 60 keys in the same order, which matters for suggestion ties.
- `store-unaligned`'s `lowerBound` stays a commented copy, because `test/data/review.test.ts` forbids data importing lookup.

### Final sizes (from the packed tarballs)
| Case | Before | After |
|---|---|---|
| everything | 107,960 (105.43 KiB) | 106,738 (104.24 KiB) |
| line only (first-chart npm.ts) | 107,835 | 89,605 (87.50 KiB) |
| line export | — | 89,516 |
| area | ~107.6 KB | 91,514 |
| bar | ~107.6 KB | 89,997 |
| scatter | ~107.6 KB | 83,830 |
| donut | ~107.6 KB | 77,125 |
| validate | ~21 KB | 20,887 |
| script tag (iife.min + css) | 110.53 KiB | 106,833 + 2,886 = 107.15 KiB |
| React adapter | 1.63 KiB | 1.63 KiB |

I restored `bench/size-latest.json` after each `size.mjs` run. Note that `scripts/size.mjs`'s per-module breakdown rebuilds without the stylesheet plugin, so it now wrongly prints "dist was built from different source". `size.mjs` was outside my files; it should use `stylesheetPlugin` and `PRODUCTION` from `build.mjs`.

### Last lines of every suite
- `npm run typecheck`: clean.
- `npx vitest run`: `Tests 1 failed | 1579 passed (1580)`. The one failure is the known `streaming-storage` memory-budget test.
- Browser, SVG, all of `packages/axylo/test/browser`: `Test Files 33 passed | 1 skipped (34)`, `Tests 834 passed | 1 skipped (835)`. Same result at step 1 and on the final build.
- Browser, canvas, chart and a11y: `Tests 193 passed (193)`, at step 1 and on the final build.
- Dist, Node: `Tests 1 failed | 116 passed (117)`. The failure is `conditions.test.ts > @axylo/react > production file carries none of the development-only text`. It is not mine: I confirmed in a temporary worktree of HEAD that it fails there too, and the React build is byte-identical to HEAD's. The cause is `patch.ts`'s `{ value }` shorthand, which appears as `value:` in the minified file.
- Dist, browser: `Tests 8 failed | 22 passed (30)`. All 8 are `csp.browser.test.ts`, failing with "axylo.css declares no light --axylo-default-series-1". Also not mine: they fail identically at HEAD. The test's hex regex predates the `light-dark()` tokens added in e9449a6.
- React: `Tests 39 passed (39)` at step 1 and on the final build.
- `apps/docs` browser: `6 failed | 1 passed` files. **This one is caused by my change.** The docs guard in `apps/docs/lib/site.mjs` (`checkSameRevision`) requires the installed `axylo.css` to equal `css.ts`'s string. The exact fix: compare against `minifyCss(AXYLO_CSS)` from `src/theme/minify.ts`. `apps/docs/lib/theme.mjs`'s `block()` also expects `selector + ' {'` and a `;` after every declaration, so it needs to accept the minified form. I did not edit `apps/docs`. The docs agent is blocked by this until it is relayed. If you would rather keep `dist/axylo.css` readable instead, that is a one-line change in `build.mjs`.

### Shared code that still names other kinds (kept on purpose, all small and with no module edges)
- The `resolveOptions` key table, `readX`'s type checks, `viewStateFor`, `KIND_NAMES` / `KIND_MESSAGES`.
- Inline frame-shape branches in the controller: `formatSpec` with `pointDateUnit`, `pointFor`, `freeze`, `latestX`, `renamed`, `positionValue`, `hasData`, `themeKeys`.
- Inline branches in interaction: `aligned()` checks, `stepAcross` used for initial focus, the ring hole in placement.
- Bar bands and the stack inside the aligned view, which all three aligned kinds share.

These are the next candidates if you want more off `line`, estimated at a few hundred bytes gzip.

### Things that looked wrong (not fixed)
- The `conditions` and CSP dist test failures above, both pre-existing.
- `controller.ts` imports `fill`, which was already unused at HEAD.

### What a reviewer should look at first
1. `src/kinds/*`: is the set of mark handlers per kind complete (scene plus overlay marks)?
2. `view/index.ts` `cartesianBase` and the `scene/index.ts` split: is the order of diagnostics and layers the same as before?
3. The registry rewritten as data in `diagnostics/registry.ts`.
4. The guard expression in `controller.ts` / `instrument.ts`.
5. `theme/minify.ts` and the docs conflict above.

All of `packages/axylo/src`, `scripts/build.mjs`, `tests/dist/licence.test.ts`, `tests/dist/tree-shaking.test.ts`, `packages/axylo/test/theme/minify.test.ts` and `THIRD-PARTY-NOTICES.md` are under `/home/canarit/projects/axylo`. The scratch directory has been removed.
