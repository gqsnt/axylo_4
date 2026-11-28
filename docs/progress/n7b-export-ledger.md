# N7b whole-figure export and closed-table CSV

The final static-controller repair brings the Cartesian consumer to **133,993 B gzip-9**, 7 B below its cap. Export measures **3,500 B** and candlestick **123,900 B**. Each of the eight bare imports produces **0 raw bytes** with side-effect annotations ignored. The last section gives the measurements on the sealed CSV candidate before and after this repair. Earlier sections record intermediate builds.

## Consumer measurements

Each cell gives **raw bytes / gzip-9 bytes**. “Initial” is the Cycle N7b initial tree. “Incoming” is the sealed repair from `opus-5.5-high__20261127T203130Z` at the start of this bundle task. Deltas are signed.

| Consumer | Initial | Incoming | Final | Change from initial | Change from incoming | Cap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| All seven bare imports other than finance, each | 0 / 20 | 0 / 20 | 0 / 20 | 0 / 0 | 0 / 0 | 0 raw |
| Bare finance | 23 / 43 | 0 / 20 | 0 / 20 | −23 / −23 | 0 / 0 | 0 raw |
| Export, all exports | 7,944 / 3,295 | 7,285 / 3,717 | 6,661 / 3,494 | −1,283 / +199 | −624 / −223 | 3,500 gz |
| Cartesian, named `cartesian` | 364,056 / 133,990 | 364,487 / 134,145 | 363,691 / 133,985 | −365 / −5 | −796 / −160 | 134,000 gz |
| Finance, named `candlestick` | 343,446 / 123,889 | 343,933 / 124,056 | 343,137 / 123,897 | −309 / +8 | −796 / −159 | 127,000 gz |
| Stats, all exports | 3,935 / 1,692 | 3,935 / 1,692 | 3,935 / 1,692 | 0 / 0 | 0 / 0 | 3,500 gz |
| Sync, all exports | 6,853 / 3,494 | 6,853 / 3,494 | 6,853 / 3,494 | 0 / 0 | 0 / 0 | 3,500 gz |
| Root, named `line` | 377,686 / 135,970 | 378,167 / 136,154 | 377,371 / 135,992 | −315 / +22 | −796 / −162 | 135,293 gz |
| Static, named `line` | 331,874 / 120,499 | 332,355 / 120,665 | 331,559 / 120,510 | −315 / +11 | −796 / −155 | 120,729 gz |
| Root, all exports | 435,558 / 158,962 | 436,039 / 159,130 | 435,243 / 158,953 | −315 / −9 | −796 / −177 | 158,096 gz |
| Static, all exports | 382,216 / 140,808 | 382,697 / 140,955 | 381,901 / 140,828 | −315 / +20 | −796 / −127 | 140,988 gz |
| Production IIFE | 436,113 / 159,304 | 436,607 / 159,465 | 435,819 / 159,308 | −294 / +4 | −788 / −157 | 158,425 gz |

Each tree used the repository's `npm run build`. For the second stage, the package manifest and built dist files were physically copied to an isolated consumer's `node_modules/axylo` under workspace scratch. The locked and installed esbuild versions both read **0.28.2**. The consumer used the import statements and options from `tests/dist/subpaths.test.ts`, including TypeScript stdin, the fixture as both working and resolution directory, production conditions, bundled minified ESM targeting ES2022, and the repository's `fixtureGuard([cwd])`. Output sizes use UTF-8 bytes and Node v24.21.0's `gzipSync` at level 9. The IIFE row measures the built file directly.

The bare entries were root, static, stream, cartesian, stats, sync, export, and finance. Each used `ignoreAnnotations: true`. The 20-byte gzip result is the encoded empty stream. Neither named chart bundle contained the streaming markers checked by the dist test.

## Implementation

- `src/export/contract.ts` and `src/core/controller-wrappers.ts` keep the separate frozen capability under `Symbol.for('axylo.export')`. Its three getters expose the committed table, figure, and plot. A selector or DOM node resolves through the cross-bundle WeakMap. An exact mount or registered ancestor short-circuits subtree scanning. Container discovery skips pending figures. Destroy releases the recorded figure and mount keys only if their entries still identify that chart, then releases the key references.
- `src/core/controller.ts` reuses the controls state when publishing a committed frame. Development and benchmark builds retain their stage counters. The production build can eliminate the counter calls and their stage names. The sealed repair's lazy per-table row memo remains in place for both the accessible table and CSV.
- `src/export.ts` composes the plot, visible caption, legend, registered family chrome, and notes in one SVG coordinate system. It measures wrapped text one line at a time, intersects visible bounds with ancestor clips, and resolves paint on a detached clone. For a transformed SVG viewport it keeps the live affine transform and untransformed CSS dimensions, placing the viewport center at the center of its measured bounds. This preserves rotation and scale around an off-center origin without applying translation twice.
- The exporter keeps metadata, CSS-derived text and paint, local paint references, background overrides, and active-content filtering. PNG sizes its canvas from the decoded SVG dimensions and requested scale. A native image decode error rejects the export and the object URL is revoked on every exit. CSV formats one row at a time and checks the table identity after every formatter-backed read.
- The original Cartesian and finance seam forwarding, finance bare-import fix, and Wave 4 conformance helper are retained. `[data-axylo-export]` identifies additional family chrome such as color bars and breadcrumbs. No public or core contract change was needed.

## Verification

- `npm run build` and `npm run typecheck` exited successfully. Typecheck includes the library, API examples, and dist tests.
- `vitest run --configLoader native --no-cache --no-fsModuleCache packages/axylo/test/export` passed **34 tests in 4 files**. The Node tests export complete 200-plus-row models, simulate the first 50 reads of an open table, and cover formatter memoization and destruction. The SVG tests use a fake DOM for clipping, hidden titles, theme colors, and wrapped text. Two added registry tests cover overlapping mounts, destruction in mount order, direct and ancestor lookup without a descendant query, and discovery beside a pending chart.
- The full package-scoped Node run used the same flags with `packages/axylo/test` and passed **2,295 tests in 142 files** in 20.25 seconds.
- In separate scratch source copies, unconditional deletion of a mount entry failed the overlapping-mount assertion. An eager descendant query failed both traversal tests.
- A differential check against the incoming parser matched on **117,648** inputs and delimiter combinations, including BOM, empty fields, CR/LF, quotes, and semicolons.
- `tests/dist/export.browser.test.ts` (its last `describe`, folded in from the former `export-transform.browser.test.ts`) adds a native-coordinate comparison of all four corners of a mark after off-center rotation, unequal scaling, translation, and viewBox mapping. The existing packed whole-figure and CSV conformance cases remain in `tests/dist/export.browser.test.ts`.

## Obstacles

- Vitest collection of a byte-identical scratch copy of `tests/dist/subpaths.test.ts` reached its unconditional child Node probe. The sandbox returned `EPERM` from `spawnSync` and the empty stdout failed JSON parsing before test selection. The same fixture probe produced JSON when invoked directly from the shell. The consumer-size and bare-import figures above were verified independently with the guarded two-stage recipe. Tarball creation and installation remain Coordinator checks.
- The legacy root line, root all-exports, and IIFE consumer measurements exceed their caps by **699**, **857**, and **883** gzip bytes respectively. The initial overages were **677**, **866**, and **879** bytes. The focused repair did not change those caps or their tests.
- Real Chrome, PNG pixel assertions, Director verification, and an unconditional cross-provider merge verdict remain with the Coordinator. `tests/dist/export.browser.test.ts` now holds every export Chrome case; run it, along with the finance and browser regression suites.

## Assumptions

A shared mount names its most recently registered chart. A still-live older chart on that mount remains addressable through its own figure and handle. A directly registered chart must have a committed table to export CSV. Whole-figure placement follows the rendered CSS geometry. Web fonts are referenced by resolved family, and the new transformed-viewport case covers two-dimensional affine transforms.

## Repair: export during a frame (review `opus-5.5-medium__20261127T220146Z`)

**The finding.** A frame writes the next caption, subtitle, legend and note to the live figure (`#arrange`, in `STEP_PHASE2`) before it draws the next marks and commits `drawn`. An author formatter can run inside that interval. When the layout hides a different number of labels than phase 1 assumed, `#settleFigureReader` rebuilds the reader, and the reference-line text calls `y.format`. Before the repair, `seam.plot` was gated only on an earlier commit, and `seam.figure` was the live figure. An `exportSvg` call from that formatter composed revision N+1 chrome over revision N marks.

**The change** (`src/core/controller-wrappers.ts`, two getters; no shape change):
- `plot` is `null` while `c.inFrame`. That flag is set in `#startFrame` and cleared in `#closeFrame`, so it covers phase 2, the layout check, publish and the commit of `drawn`. Batch frames (`beginFrame`) set it too. `exportSvg` and `exportPng` then fail with the existing `no rendered <svg> chart surface.` error.
- `figure` now reads `c.drawn && plot()?.closest('figure')` and no longer derives from `seam.plot`, so it stays non-null in the interval. Container (descendant) lookup in `seamOf` keeps skipping only undrawn charts. It still finds a chart that is drawing, so the export fails rather than falling back to reading the container's live `<svg>` as a plain element. An earlier variant that tracked a fallback seam in `seamOf` instead cost +7 B gz in `axylo/export`, which put it over the 3,500 B cap, so it was dropped.
- `table` is unchanged. It is the last committed table, so `exportCsv` inside the interval returns the drawn revision, and the in-loop identity check still stops a CSV export that a commit overtakes. Outside a frame nothing changes: an accepted update that is not drawn yet still exports the committed figure and table.
- `src/export/contract.ts` documents this interval on the capability and on `plot`.

**Regression** (`test/export/n7b-export-frame.test.ts`, Node). The test records the host's writes: `figure.update` with no `renderer.draw` after it means staged chrome. A bar chart has a reference line and an author `y.format`. It updates from 4 one-letter categories (subtitle A) to 60 thirty-letter categories (subtitle B). Inside the formatter, while staged subtitle B is on the figure, the test checks that:
- `exportSvg` fails with the error above for the exact mount, for an element inside the figure (ancestor lookup) and for a container around the mount (descendant lookup);
- `seam.plot` is null and `seam.figure` is the figure;
- `exportCsv(handle)` equals the committed 4-row CSV.

The test also asserts that the interval was reached, so it cannot pass vacuously. It checks the outside-frame pending state and the 61-line CSV after the commit as well. Ran and saw: with the `inFrame` gate reverted in a scratch copy, the test failed (`expected { … localName: 'div' … } to be null`). With the gate in place it passed.

**Browser file selection.** The transformed-viewport Chrome case is now the last `describe` of `tests/dist/export.browser.test.ts`. It uses that file's shared server, browser and `export-only-e2e` bundle (`window.__exp2`) instead of its own bundle. The geometry, page and tolerance are unchanged, and the test also asserts that 8 corner coordinates were compared. No test config changed. Not run here: Chrome is the Coordinator's.

**Evidence (ran and saw).**
- `npm run typecheck`: no errors.
- `npm run build`: exit 0.
- `vitest run --configLoader native --no-cache --no-fsModuleCache packages/axylo/test/export`: 5 files, 35 tests passed.
- The same flags over `packages/axylo/test`: 143 files, 2,296 tests passed.
- The consumer sizes were measured from the built `dist` copied with `package.json` into a scratch `node_modules/axylo`. The build used esbuild 0.28.2, production conditions, minified ESM es2022 and gzip-9. Unchanged rows reproduce the table above exactly: stats 1,692, sync 3,494 and export 3,494. This check did not use `fixtureGuard`.

| Consumer | Before this repair | After | Change | Cap |
| --- | ---: | ---: | ---: | ---: |
| Export, all exports | 6,661 / 3,494 | 6,661 / 3,494 | 0 / 0 | 3,500 gz |
| Cartesian, named `cartesian` | 363,691 / 133,985 | 363,712 / 133,992 | +21 / +7 | 134,000 gz |
| Finance, named `candlestick` | 343,137 / 123,897 | 343,158 / 123,905 | +21 / +8 | 127,000 gz |
| Root, named `line` | 377,371 / 135,992 | 377,392 / 135,997 | +21 / +5 | 135,293 gz (already over) |
| Static, named `line` | 331,559 / 120,510 | 331,580 / 120,515 | +21 / +5 | 120,729 gz |
| Root, all exports | 435,243 / 158,953 | 435,264 / 158,958 | +21 / +5 | 158,096 gz (already over) |
| Static, all exports | 381,901 / 140,828 | 381,922 / 140,834 | +21 / +6 | 140,988 gz |
| Production IIFE (file) | 435,819 / 159,308 | 435,840 / 159,312 | +21 / +4 | 158,425 gz (already over) |
| Each of the eight bare imports, `ignoreAnnotations` | 0 raw | 0 raw | 0 | 0 raw |

**Remaining gap.** Real Chrome, PNG pixel checks, the packed `tests/dist` suites and `subpaths.test.ts` itself were not run here and remain Coordinator checks. That includes the folded transformed-viewport case. In the interval, an SVG export reports "no rendered <svg> chart surface" rather than a message that names the frame. Choosing a dedicated message would cost bytes in `axylo/export`, which has 6 B of headroom.


## Repair: supplementary CSV review (`sol-6.2-medium__20261127T221753Z`)

**Status at the end of this intermediate repair: the fixes are in, but `axylo/cartesian` is 44 B over its cap (134,044 B gz against 134,000).** Export (3,500 B, at its cap), finance and all eight bare imports are within their limits. The cap needs owner action: more lossless cuts or a cap decision. Nothing was weakened to hide the overage.

**Changes**
- `src/core/controller.ts`, the committed table's row memo:
  - **Nested reads (finding 1).** A read of a row that is not cached yet is refused with `Error('row in use')` while a row of the *same table* is being formatted. A nested `exportCsv` from a formatter therefore throws inside that formatter, and the outer read's row is the one kept. Rows that are already cached are still returned to nested reads. The guard is the `#reading` field. It is saved and restored in `finally`, so a failed read caches nothing and leaves no guard behind. A nested read of a *different* uncached row of the same table is refused too. This is stricter than the finding asks, but it is the cheapest form in bytes. A formatter that nests through a second table back into the first is not detected. No public path reaches a second table from inside a drawn-table read.
  - **AX160 attribution (finding 2).** The formatter error callback (now inlined into the lazy `#formatterError`) still suppresses work from a frame the formatter superseded. The exception is a failure during a read of the drawn table (`#reading === drawn.reader.table`), which is reported.
  - **After destroy (finding 3).** Nothing is reported once the chart is destroyed.
  - **Offsets.** `sizeDirty` was used only in this file and became `#sizeDirty` (−17 B gz). The one-use `#formatterFailed` method was inlined (−9 B).
- `src/export.ts`: a `Data<Row>` row that is not an object is an empty record again (C6), both for the selected field values and for the inferred keys (`record()`).

**Not fixed in the fence (finding 3, the remainder).** Within one multi-series row, the later cells' author formatters still run after an earlier cell destroyed the chart. The row loop is in `src/reader/table.ts` (`alignedTable`, `scatterTable`), and the author call is in `src/format/number.ts` (`authorFormat`). Both are outside this fence. The fix needs a liveness check before each author callback in one of them. Inside the fence, the export loop's existing identity check already stops before the next row, and no diagnostic is recorded after destroy.

**Regressions** (`test/export/n7b-csv-reentry.test.ts`, Node, 4 tests):
1. Nested export on an uncached row: it is rejected, every row is formatted once, and the outer and later exports are byte-identical.
2. Superseded-frame committed read: exactly one AX160, the failing cell falls back to `50`, and the test asserts that the scenario was reached.
3. A formatter that destroys the chart and then throws: the export fails, and there is no AX160 in `diagnostics` or in the printed output.
4. `['abc', {length: 2}, 7, null]` with `fields: ['length']` gives `length\n""\n2\n""\n""`.

Ran and saw: with `controller.ts` and `export.ts` restored to their pre-repair copies, all 4 tests failed. Test 1 got the nested CSV, test 2 got `[]`, test 3 got `[AX160]` and test 4 got `3`. With the repair, all 4 pass.

**Evidence (ran and saw)**
- `npm run typecheck`: no errors.
- `npm run build`: exit 0.
- `vitest run --configLoader native --no-cache --no-fsModuleCache packages/axylo/test`: 144 files, 2,300 tests passed. The export folder alone: 6 files, 39 tests.
- Sizes came from esbuild 0.28.2, the src→minified entry→consumer recipe, gzip-9. It reproduced the previous row exactly (3,494, 133,992 and 123,905) before the edits.

| Consumer | Before | After | Change | Cap |
| --- | ---: | ---: | ---: | ---: |
| Export, all exports | 6,661 / 3,494 | 6,668 / 3,500 | +7 / +6 | 3,500 gz |
| Cartesian, named `cartesian` | 363,712 / 133,992 | 363,851 / 134,044 | +139 / +52 | 134,000 gz (**over by 44**) |
| Finance, named `candlestick` | 343,158 / 123,905 | 343,297 / 123,945 | +139 / +40 | 127,000 gz |
| Bare imports of the 8 built dist entries, `ignoreAnnotations` | 0 raw | 0 raw | 0 | 0 raw |

**Byte costs measured for this repair** (Cartesian gz):
- per-row busy marker guard: +52;
- AX160 flag and destroy check: about +26;
- the per-table `#reading` guard that replaced the marker: −9;
- shortening the error text: −6.

Tried and dropped because gzip grew or stayed the same:
- `x.length === 0` → `!x.length`, and `?.` comparisons: 0;
- one shared `figure()` helper in the seam: +6;
- a hoisted shown-reader entry in `#readerFor`: +6.

The root, static and IIFE rows were not re-measured in this repair.

**Not run here.** Browser and Chrome suites, `tests/dist` (packed) and `subpaths.test.ts` were not run here. They remain the Coordinator's.

## Final Cartesian size repair

The streaming controller now handles row retention in `src/core/controller.ts`. It reads the session from the accepted revision and passes the same displayed, pending, running and paused frames to the store. After release, a published frame still updates the current session’s retention baseline. The static controller borrows its rows and implements an empty release method. Both concrete controllers already implement `append`, so its base declaration can be abstract.

Both columns below came from separate `npm run build` runs in this workspace. Each build’s dist and manifest were copied into a local consumer fixture. The consumer used the production options, import statements and `fixtureGuard` from `tests/dist/subpaths.test.ts`, with installed and locked esbuild 0.28.2 and Node v24.21.0 gzip level 9. The IIFE was measured directly. Each size cell gives raw / gzip-9 bytes.

| Consumer | Sealed CSV baseline | Final | Gzip-9 change | Cap |
| --- | ---: | ---: | ---: | ---: |
| Cartesian, named `cartesian` | 363,851 / 134,044 | 363,629 / 133,993 | −51 | 134,000 gz |
| Finance, named `candlestick` | 343,297 / 123,945 | 343,075 / 123,900 | −45 | 127,000 gz |
| Export, all exports | 6,668 / 3,500 | 6,668 / 3,500 | 0 | 3,500 gz |
| All eight bare entries, each | 0 / 20 | 0 / 20 | 0 | 0 raw |
| Stats, all exports | 3,935 / 1,692 | 3,935 / 1,692 | 0 | 3,500 gz |
| Sync, all exports | 6,853 / 3,494 | 6,853 / 3,494 | 0 | 3,500 gz |
| Root, named `line` | 377,531 / 136,058 | 377,543 / 136,052 | −6 | 135,293 gz |
| Static, named `line` | 331,719 / 120,572 | 331,497 / 120,515 | −57 | 120,729 gz |
| Root, all exports | 435,403 / 159,018 | 435,415 / 159,024 | +6 | 158,096 gz |
| Static, all exports | 382,061 / 140,885 | 381,839 / 140,829 | −56 | 140,988 gz |
| Production IIFE | 435,979 / 159,369 | 435,991 / 159,363 | −6 | 158,425 gz |

Each bare import used `ignoreAnnotations: true`. The Cartesian, finance and static consumers also passed the two streaming-marker checks. The three existing legacy overages on the final build are 759 B for root line, 928 B for root all exports and 938 B for the IIFE.

`npm run typecheck` and `npm run build` exited 0. Vitest used `--configLoader native --no-cache --no-fsModuleCache`. The export directory plus the static/stream and streaming-storage files passed the focused run. The full package Node run also passed.

```text
 Test Files  8 passed (8)
      Tests  109 passed (109)

 Test Files  144 passed (144)
      Tests  2300 passed (2300)
```

A production-mode Node check ran the same five CSV snapshots against the incoming and final controllers. Both matched the fixture rows at creation, after append, after 400 arrivals while paused, after resume with a three-row retention limit, and after replacing the data.

### Obstacles

A production-mode Node probe on a two-row, two-series chart reproduced the remaining formatter edge. The first cell’s formatter destroyed the chart. The second formatter in that row still ran, CSV then raised its existing error, and the second row was never read. The destroyed chart’s diagnostics were empty. The controller sees the row call as a single operation. The cell loop in `src/reader/table.ts` and author invocation in `src/format/number.ts` are outside the ownership fence. Replacing the assembled value formatter would also change the function identity used for cacheability in `src/format/index.ts`. This repair leaves row formatting and the sealed memoization guards intact.

Packed distribution tests, real Chrome (including `tests/dist/export.browser.test.ts` and `tests/dist/finance.browser.test.ts`), Director verification and the exact-candidate cross-provider verdict remain with the Coordinator. No contract change was needed.

## Repair: packed Chrome fixture (Director turn 22, `astra-6.2-high__20261127T223341Z`)

### Director observations (from the verify log)

`tests/dist/subpaths.test.ts` passed: Cartesian 133,993 B, finance 123,900 B, stats 1,692 B, sync 3,494 B and export 3,500 B gzip-9. `tests/dist/finance.browser.test.ts` passed. In `tests/dist/export.browser.test.ts` the C6.1 test passed. The three N7b tests each timed out at 60,000 ms. `#line` drew 4 series marks. Every chart after it logged `0 figure(s), 0 series-painted mark(s)`, and each waited out its own 10 s `drawn()` timeout.

### Cause and repair (test fixture only, no runtime edits)

- **Shadowed import.** The inline `export-figure-e2e` module declared `const bar = make('div', fig)` for the Wave 4 colour bar. As a module-level `const`, it shadowed the imported `bar` across the whole module, so `charts.bar` read it before initialisation (TDZ). Only `line()` had run by then, which matches the log. The local is now `colourBar` in all three places where it is used.
- **Legend names on the swatch fixture.** `label` was set on the `bar`, `area` and `line` layers. `CartesianLayerOptions` has no such member, and `cartesian/options.ts` takes those series names from the field object (`obj.label`). The legend would have read `a`, `b`, `c` and failed the unchanged assertion `['Bars', 'Area', 'Line', 'Band', 'Error']`. The labels now sit on the fields (`y: { field: 'a', label: 'Bars' }`). The `range` and `errorBar` layers keep their layer `label`, which the type allows.
- **`openFigures` readiness.** A single bounded `waitForFunction` runs `paintedMarks` (15 s, 50 ms polling) and races the first `pageerror`. It passes once the fixture is initialised (`__charts`, `__exp` and the separate-bundle `__exp2`) and every one of the 12 charts draws a data mark. A data mark is a shape with geometry, painted through a series paint (the `browser.ts` `chartState` rule) or through finance's semantic paints `--axylo-up`, `--axylo-down` or `--axylo-volume`, or else a canvas with a painted pixel. The finance paints are needed because `finance/render.ts` paints candles and volume that way, so `chartState` would count 0 marks on `#fin` and `#findark` even when they are drawn. On failure the wait throws at once with the error, the page errors, the initialisation flag and each chart's count, and it closes the context. On success it logs the counts and requires each to be greater than 0, a new hard check (the old `drawn()` loop only logged). All existing visual, geometry, CSV and 1x/2x assertions are unchanged.

### Node probe (no Chrome)

The three inline bundle sources were extracted from the test file to `.prism-cache/tmp/n7b-fixture-probe` and typechecked with `axylo/*` mapped to `packages/axylo/src`. On the turn-22 fixture this reports `TS2440 Import declaration conflicts with local declaration of 'bar'` and `TS2448 Block-scoped variable 'bar' used before its declaration`. The same run surfaced the layer `label` defect (`TS2353`). On the repaired fixture the only remaining errors are four `TS2345` reports at `setAttribute(k, v)`, caused by `noUncheckedIndexedAccess` on literal `[k, v]` entries. esbuild does not typecheck, and those values are always defined at runtime. A recording-DOM mount of the charts was not attempted. A Node probe (`marks-probe.mjs`) ran the extracted `paintedMarks` on a fake DOM: not ready before initialisation, ready with series, finance and canvas marks, not ready with gridlines only, and correct counts when reporting.

### Verified here

`npm run typecheck` exited 0. `vitest run packages/axylo/test/export --configLoader runner --no-cache` passed (6 files, 39 tests).

### Not verified here

Packed Chrome (`tests/dist/export.browser.test.ts`) was not run in this writable turn. Whether the three N7b tests now pass in Chrome, and whether any later assertion fails once the charts draw, is for the Director rerun to show.

## Repair: `#swatches` bound fields (cycle `p2_n7b_v64`, verify log `turn-24-opus-5.5-medium__20261127T235436Z.log`)

The seven `p2_n7b` patches were replayed in order on `b217e58`. Each passed `git apply --check` and then applied. The SHA-256 of every patch matched its `meta.json`.

### Cause and repair (test fixture only, no runtime edits)

In the turn-24 Director log, every N7b test in `tests/dist/export.browser.test.ts` timed out in `openFigures()`. The other 11 charts drew, but `#swatches` drew `0` marks. Its `range` layer (`low: 'lo', high: 'hi'`) and its `errorBar` layer used the same two fields. `pushCarrier` in `cartesian/options.ts` rejects a field that is already bound with `AX174` (`Field '…' is bound to multiple layers/axes`), which marks the options invalid, so the chart is not drawn. Each fixture row now also carries `errLo: 9 + i` and `errHi: 13 + i`, which surround `mid: 11 + i`. The `errorBar` layer binds `low: 'errLo', high: 'errHi'`, and only that layer uses them. The `range` layer keeps `lo`/`hi`. The bar, area, line, range and error-bar layers, their labels and every assertion are unchanged.

### Node check of the fixture (no Chrome)

A scratch Vitest file outside the shipped tree (`.prism-cache/tmp/fixcheck`) reads `tests/dist/export.browser.test.ts`, cuts out the figure fixture's code from `const host = …` through `const charts = {…}`, removes the types with esbuild, and runs it with recording stand-ins for `line`, `bar`, `donut`, `cartesian` and `candlestick`. Each of the 12 charts then goes through its public validator (`validate`, `validateCartesian` or `validateCandlestick`). It is also mounted on the real static controller, with the Node recording host from `test/finance/host.ts` at 720×420. Results:

- **`#swatches`:** no diagnostics from either path. The scene has 34 marks of kinds rule, area, rects, path and points. The parsed meta is `invalid=false`. The series are bar `Bars`/`a`, area `Area`/`b`, line `Line`/`c`, range `Band` over `lo`–`hi`, and errorBar `Error` with centre `mid` over `errLo`–`errHi`.
- **`#cart`, `#donut`, `#bg`, `#hidden`, `#pending`, `#remount` and `#many`:** no diagnostics.
- **Expected findings:**
  - `#line`: `AX103` warning on `rev` row 4. The fixture's NaN is intended, because it produces the reader note.
  - `#bar`: `AX143` hint, labels did not fit. This is the mounted chart only, measured with the host's 7 px/char at 720 px. It is the label pressure the fixture uses to get rotation.
  - `#fin` and `#findark`: `AX111` hint, because the `Date` instants at UTC midnight look like calendar dates. This comes from core normalisation and is a hint, not a Cartesian or finance error.
- **No errors anywhere:** there are no error-level diagnostics and no `AX17x`/`AX18x`/`AX19x` code on any chart.
- **Negative control:** the same check on the pre-fix fixture (`low: 'lo', high: 'hi'` on the error bar) reports three `AX174` errors for `#swatches`: `lo`, `hi`, and `layers[4]` needing distinct fields. Their message ends "The chart is not drawn." That matches the Chrome log.

### Verified here

- `./tools/loupe fast`: `ok fast all`. That covers oxlint and `tsc` over `packages/axylo`, `docs/api` and `tests/dist`. A non-incremental `tsc --noEmit` (TypeScript 7.0.2) also exited 0 on all three projects, and `tests/dist/export.browser.test.ts` is in that file set.
- `./tools/loupe test`: `PASS: 2548 tests`.

### Not verified here

Packed Chrome (`tests/dist/export.browser.test.ts`, `tests/dist/finance.browser.test.ts`), the packed dist suites and the size checks are Director-only and were not run. The Node host does not compose the legend DOM, so the five distinct swatch shapes and the `['Bars', 'Area', 'Line', 'Band', 'Error']` legend are left to the Chrome run.
