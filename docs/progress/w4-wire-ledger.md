# W4 wire ledger: `axylo/spatial`, `axylo/hierarchy`, export seams, AX160 hook

Wave 4 integration (`p2_w4_integ`) on the pre-wire baseline `fd5a5f6` (`phase2/wave4-integration`). Builder lane,
2026-11-28. `public.ts` and `core/contracts.ts` are unchanged.

## What was wired

| Area | Change |
|---|---|
| `src/spatial.ts` (new) | The `axylo/spatial` entry: `heatmap`, `validateHeatmap`, `bubble`, `validateBubble`, and their public types (`HeatmapOptions`, `HeatmapAxisField`, `HeatmapValueField`, `HeatmapColorOptions`, `HeatmapChart`, `BubbleOptions`, `BubbleRadius`, `SizeField`, `SizeFieldOptions`, `BubbleChart`). They are declared here, and `spatial/heatmap/index.ts` and `spatial/bubble/options.ts` re-export them, so `dist/spatial.d.ts` imports only `./public.js` and `./static.js`. |
| `src/hierarchy.ts` | The hierarchy public types (options, chart, crumb, events, point, data, messages, `NodeText`, and a structural `TableModel`) move into the entry file, and the `hierarchy/*` modules re-export them, so `dist/hierarchy.d.ts` imports only `./public.js`. |
| `package.json`, `scripts/build.mjs`, `scripts/size.mjs` | `./spatial` and `./hierarchy` added: types, development and default files, in `files`, in the build loop and as size rows. Their development files carry the readable stylesheet as a literal (see "Bare imports" below). The legacy files' build settings are unchanged. |
| Heatmap | The wrapper forwards the inner handle's seams (`forwardSeams`). The colour-bar list is marked `data-axylo-export="color-bar"`. Its gradient stops keep their colours in an export (see "Heatmap colour-bar stop colours (repair)"). |
| Bubble | It already used core `Handle`'s seam. The size legend list is marked `data-axylo-export="size-legend"`. A size format that throws reports through the controller's formatter report (`fallback`, below). |
| Violin | Uses cartesian's existing `forwardSeams`. No change. |
| Hierarchy | An `ExportSeam` (frozen getters) on the handle under `Symbol.for('axylo.export')`, not enumerable and read-only. It is registered for the figure and its mount, and destroy unregisters it. `plot` is the mark SVG, and it is null while parts are being painted. `table` is the state last fully painted. The header (title and breadcrumb), note and empty-state text are marked chrome. The overlay group gets `axylo-overlay`, which export skips. |
| Hierarchy table | Pages 100 rows at a time (spec A4): `pageSize` is 100, `pageForX` returns the node's page, and the table has Previous, Next and "Page x of y" controls, hidden for a single page. The model still holds every node. Drill and focus are untouched by paging. New messages: `previousPage`, `nextPage`, `pageOf`. |
| AX160 hook | `Controller.fallback` is a `declare`d public property, assigned where the private `#formatterError` was assigned, so it keeps the same guards and late delivery. It is typed on `ControllerCore`. Bubble calls `c.fallback(meta.field)` for a failing size read that the accepted revision owns, once per table (review repair, below), and falls back to `schedule()` before the first frame. |
| Byte offset in `core/controller.ts` | Eight lazily made private fields (`#actionsMade`, `#invalidateMade`, `#frameCallback`, `#probeReport`, `#presentation`, `#deliveredKeys`, `#widenedX`, `#notifications`) start undefined instead of null. Each is only read through `??=`, `?.` or a truth test (checked usage by usage), so behaviour is the same. `presentationDiagnostics` accepts `undefined` (a type-only change). |

## Measured (ran and saw; Node v24.21.0, esbuild from the workspace `node_modules`)

Method: the baseline `fd5a5f6` (`git archive` of `scripts`, root `package.json`, `tsconfig.base.json`,
`packages/axylo/{src,package.json,tsconfig*.json}`) and the candidate (the same files from this workspace) were
each built with their own `node scripts/build.mjs`, in sibling trees under `.prism-cache/tmp/w4/`. Each `dist/`
was installed as `node_modules/axylo` (its `package.json` and a `dist` symlink) in a consumer directory. Consumer
bundles were made as `tests/dist/subpaths.test.ts` makes them: esbuild, minify, ESM, es2022, `production`
condition, gzip level 9. The IIFE row is `gzip -9` of `dist/axylo.iife.min.js`.

This is equivalent to the packed run, not the packed run itself: there was no `npm pack`, no fixture install and
no `tests/dist` execution here (all reserved for the Director).

Recipe trap: the layout matters. With `package.json` (`sideEffects`) and the tsconfig files in place, the numbers
differ by a few bytes from a bare copy of `src`, so only the faithful trees above are used.

### Legacy gzip-9 (≤ 0 B required)

| Row | Baseline `fd5a5f6` | Candidate | Delta |
|---|---:|---:|---:|
| `export { line } from 'axylo'` | 136,052 | 136,044 | −8 |
| `export * from 'axylo'` | 159,024 | 159,018 | −6 |
| `export { line } from 'axylo/static'` | 120,515 | 120,508 | −7 |
| `export * from 'axylo/static'` | 140,829 | 140,829 | 0 |
| `axylo.iife.min.js` | 159,363 | 159,354 | −9 |

`dist/axylo.css` is byte-identical. The hook alone, `declare report` without the offset, measured +4 / −2 / +4 / +2 / −5 B. The
offset and the name were chosen by measuring every variant in the faithful tree. The static "everything" row has
no margin left (0 B).

Other rows, for the record: `axylo/cartesian` 137,816 → 137,800, `axylo/finance` 123,900 → 123,896, and
`axylo/stats` 3,483 and `axylo/sync` 3,494, unchanged. `axylo/export` was 3,500 on this wiring and is 3,498 after the
stop-colour repair (below).

### Historical legacy caps (already exceeded before the wire)

`tests/dist/subpaths.test.ts` checks the legacy rows against `LEGACY_CAPS`, which date from `b097f1a` (C3). The verified pre-wire
`fd5a5f6` numbers already exceed three of them, so those three tests fail on the baseline as well. The N7b ledger records
the same thing (`docs/progress/n7b-export-ledger.md`, "already over"). W4 did not change the caps or loosen them, and its delta is ≤ 0 B on every row:

| Row | `LEGACY_CAPS` | `fd5a5f6` | Over at `fd5a5f6` | Candidate | W4 delta |
|---|---:|---:|---:|---:|---:|
| root `line` | 135,293 | 136,052 | +759 | 136,044 | −8 |
| root all exports | 158,096 | 159,024 | +928 | 159,018 | −6 |
| IIFE | 158,425 | 159,363 | +938 | 159,354 | −9 |
| static `line` | 120,729 | 120,515 | within | 120,508 | −7 |
| static all exports | 140,988 | 140,829 | within | 140,829 | 0 |

The Director's packed run will report the three root/IIFE failures. They come from before W4 and are not a W4 regression. Fixing them is legacy
size work for the owner and is not part of this wave.

### New subpaths (gzip-9, `export * from …`)

| Entry | Measured | Cap in `tests/dist/subpaths.test.ts` |
|---|---:|---:|
| `axylo/spatial` | 142,020 (142,342 after the review repair below) | 142,500 |
| `axylo/hierarchy` | 21,525 (21,591 after the review repair below) | 21,600 |

### Bare imports (`import '…'`, `ignoreAnnotations: true`: `sideEffects` and pure annotations ignored)

| Entry | production | development |
|---|---:|---:|
| `axylo/spatial` | 0 B | 0 B |
| `axylo/hierarchy` | 0 B | 0 B |

Before the build change, `spatial.dev.js` bundled to 25,290 B. That was the development stylesheet (`theme/css.ts`
computed at import time). The same residue is in the baseline's `axylo`, `static`, `stream`, `cartesian` and
`finance` development files. Those were not changed and are not covered by a zero assertion. The new subpaths' development files now embed the readable
stylesheet text as a literal. It is the same string `css.ts` computes, not minified.

### Node SSR (fresh process per entry and condition, against the candidate install)

All ten entries (`axylo`, `/static`, `/stream`, `/cartesian`, `/stats`, `/sync`, `/export`, `/finance`,
`/spatial`, `/hierarchy`) imported under the default and `--conditions=development` conditions. Each resolved to
its own `dist` file. `window`, `document`, `HTMLElement`, `Element`, `Node`, `customElements`, `ResizeObserver`,
`getComputedStyle`, `requestAnimationFrame` and `matchMedia` were absent before and after every import.

### Declarations

`dist/spatial.d.ts` imports only `./public.js` and `./static.js`. `dist/hierarchy.d.ts` imports only `./public.js`.
`dist/stats.d.ts` and `dist/export.d.ts` already imported only `./public.js` at the baseline and were not edited.
The packed type check from `subpaths.test.ts` (100 lines, including every `@ts-expect-error`) compiles with 0
errors under both Bundler and NodeNext against the candidate's `dist` (tsc, scratch project).

## Node tests added (ran and saw)

- `test/spatial/bubble/ax160-empty.test.ts`: an empty plot (every y missing) whose table has three rows, with a
  size format that throws for 37. Reading the drawn table gives one AX160 for `s` in `chart.diagnostics` and in
  `onDiagnostic`, and a changed reader note. No repeat. Nothing after destroy. Mutation check: with bubble's watcher
  set back to `schedule()` only, the test fails.
- `test/hierarchy/export-seam.test.ts`: the seam's descriptor, the registry under the figure and its mount, and
  null and unregistered after destroy. CSV of all 134 nodes matches the fixture's pre-order paths and depths, the
  same with the table closed, open on page 1 and open on page 2. Paging is 100 rows a time and `pageForX` gives the
  page from the fixture. Drill and focus are kept. While the chart redraws, a value formatter finds `plot` null
  and `table` the previous one.
- `test/spatial/heatmap/export-seam.test.ts`: the forwarded seam is the inner handle's, and the CSV of a
  60 × 4 matrix (2 pages) equals the fixture.
- `test/hierarchy/tree.test.ts`: the N9b "unpaginated" expectation (`pageSize = rowCount`) changed to the new paging, 100 rows per page (spec A4), as the W4 brief asked.

## Heatmap colour-bar stop colours (repair)

**The gap.** The heatmap sets each stop's colour only through inline CSS `stop-color` (`var()` / `color-mix()`, which only CSS
resolves). `export.ts` drops inline styles, and its list of copied computed properties had no `stop-color`. So the
standalone SVG, and the PNG rasterized from it, painted every stop black.

**The fix (`src/export.ts`).** `stop-color` joins the computed paint copied onto each clone (`PAINT`). Each exported stop now
gets its resolved colour as a presentation attribute. The inline style is still removed, and so are the handlers, foreign references and so on.
The heatmap is unchanged: its live CSP contract holds, and `test/spatial/heatmap/committed.test.ts` (no `stop-color`
attribute on the live bar) is untouched and passes. Two equivalent simplifications in `export.ts` pay for the bytes:

- the child loop `for (let i = n; i > 0;) { i--; … }` became `for (let i = n; i--;)`. It visits the same indices in the same backwards order;
- the top-level `DIMENSIONS` constant is inlined as the loop's own `['x', 'y', 'width', 'height'] as const`.

Measured `axylo/export` gzip-9 (ran and saw; `export * from 'axylo/export'`, esbuild minify, ESM, es2022, `production`):

| Variant (src recipe: `PRODUCTION` define, minified stylesheet, then the consumer re-bundle) | gz9 |
|---|---:|
| sealed candidate | 3,500 |
| + `stop-color` alone | 3,506 (`'color stop-color …'`), 3,505 (`'stop-color color …'`) |
| + the `i--` loop | 3,502 |
| + `DIMENSIONS` inlined (final) | **3,498** |

Faithful cross-check: two sibling trees under `.prism-cache/tmp/sz/` (`scripts`, root `package.json`, `tsconfig.base.json`,
`packages/axylo/{src,package.json,tsconfig*.json}`), one with the sealed `export.ts` and one with the repaired file. Each was built with
`node scripts/build.mjs`, and consumers were bundled from each `dist`. `axylo/export` measured 3,500 → **3,498 B (−2 B)**, and the bare
`import 'axylo/export'` (`ignoreAnnotations`) gave 0 B in both. `dist/axylo.js`, `dist/static.js` and `dist/axylo.iife.min.js` are
byte-identical (`cmp`), because no legacy entry imports `export.ts`. The legacy rows are the same as the candidate column above.

New Node test (ran and saw): `test/export/n7b-export-svg.test.ts` gained "gives each gradient stop its computed stop-color
as an attribute, without the inline style that set it". With `stop-color` taken out of `PAINT` again, it fails. With the fix, it passes.

## W4 browser fixture review (repair; not run in Chrome)

I checked `tests/dist/w4-spatial-hierarchy.browser.test.ts` against the chart DOM and the shared helpers by reading the source. It has not been
executed. Findings:

- Selectors that match the source: heatmap cells and bubbles are `<path>` in `.axylo-scene` (render/svg.ts, heatmap/render.ts); hierarchy
  marks are `rect` (treemap) and `path` (sunburst) in `.axylo-hierarchy-marks`, and the outlines are in `.axylo-overlay` (export skips them); the hierarchy title is
  `.axylo-h-title`, the crumbs are `.axylo-h-crumbs [data-node]` (a button for each ancestor, `span.axylo-h-current` for the drilled node), and the note is
  `.axylo-h-note`; the bubble legend is `.axylo-bubble-legend` `circle`, `.axylo-legend-name` and `.axylo-bubble-legend-value`; the heatmap uses `.axylo-heatmap-stop`, `-scale-title` and `-tick`.
  Hierarchy registers its seam under the figure and the host (`register(seam, figure)` after `host.appendChild`), and destroy unregisters it and
  removes the figure, so the teardown `registered`/`figures` checks can hold. "View as table" and "Next page" are the default
  messages in both core and hierarchy.
- Corrected: the stop-colour test is no longer marked expected-to-fail. Its assertion (exported stop colours = live
  computed colours, more than one distinct) is unchanged.
- Corrected: the bubble and hierarchy CSV identity assertions compared the parsed column with itself (a tautology). They now use values from the fixture:
  bubble `[x, size]` in x-then-y order (`spatial/bubble/table.ts`), `x` 0..11 × `y` 0..9, size `12y + x + 1`; hierarchy, all 135
  pre-order paths joined with " / " (`hierarchy/reader.ts`), the invalid leaf `Root / B2 / Bad` last (AX190 keeps its row).
- Added: the reader's paging. After the closed/open export, the test clicks "Next page", waits until page 2's first row is
  `parsed[1 + pageSize]`, and checks that the shown page equals the matching CSV slice and that every route still gives the closed CSV.
- Added: an active breadcrumb for both hierarchy families. The sunburst is drilled into `B0` (it was not drilled before), so the crumbs read
  `Root › B0`, and they are exported. After the CSV checks, clicking the sunburst's `Root` crumb button drills back up (`drilled.id` is `Root`); the treemap keeps `B1`.
- Expected but unverified: `expectWholeFigure`'s "scene marks painted in a concrete colour" for the heatmap relies on the end
  bins being pure anchors (`colorAt` returns the anchor `var()` at shares 0 and 100, so the computed value is `rgb`), while the middle bins compute to
  `oklab(…)`. Bubble `x`, `y` and size cells are assumed to format plain integers as "0".."120" (en-US).

## Cross-provider review repair (`sol-6.2-medium__20261128T005412Z`, four blockers)

Builder lane, 2026-11-28. `public.ts`, `core/contracts.ts`, the controller, the caps and every existing expected
value are unchanged. Files changed in this round: `src/spatial/bubble/{text,composition}.ts`,
`src/hierarchy/{chart,reader}.ts`, `tests/dist/w4-spatial-hierarchy.browser.test.ts`; new tests
`test/spatial/bubble/{ax160-ownership,legend-sync}.test.ts` and `test/hierarchy/export-review.test.ts`.

1. **Packed Chrome fixture (not run here).** The bubble legend now expects `['100', '25', '5']`: `referenceSizes(120)`
   is the nice floors of 120, 120/4 and 120/16 (`spatial/bubble/legend.ts`). The console check now expects exactly one
   `warning: [axylo AX190] …` line, from the negative leaf. `core/delivery.ts` prints each code once per page. Any other
   warning, error or page error still fails. Each family also checks `exportPng` itself (the Blob, `type === 'image/png'`,
   read back as a data URL) at 1x and 2x, with N7b's `expectPng`, beside the existing `exportPngDataUrl` check.
2. **Bubble AX160 ownership.** `text.ts` now tells failing reads apart one by one, by wrapping the author format and
   tracking engine-rejected options. It used to rely on the readout's once-only `onError`. It asks the bubble's watcher
   whether the read is owned. Reads that are not owned are neither reported nor counted in `sizeFormatFailed`. A
   bubble table row read names its table (`state.reading`, set by a wrapper around `row`). A table read is owned only
   in two cases: it is the drawn table and nothing newer is accepted, or it is the table that the frame drawing the
   accepted revision built. Owned reads are reported once per table (`state.reported`) through the controller's
   unchanged `fallback`, which keeps its guards. Other reads (legend, summary, layout, tooltip) are owned inside a frame
   (the controller's guards apply) and outside a frame only while the drawn revision is the accepted one. The fallback
   text is unchanged in every case.
3. **Bubble legend timing.** Inside the frame that draws the accepted revision (`inFrame && inflight === accepted`),
   `updateLegend` writes the size legend synchronously from the lookup stage. No author code runs after that point
   before publication. The microtask is kept only for a lookup made outside a frame.
4. **Hierarchy.** `shown` is published only when the paint loop finishes. After the retry limit it is `null`, so the
   seam exposes no figure, plot or table, and `exportCsv` throws, until a later paint completes. The reader keeps each
   node's formatted value text in a map that fills lazily as nodes are read. The value is formatted once per reader,
   so the bounded 4,096 node-text cache can drop entries without changing any text. While this table's formatter
   runs, a nested read of a node that has not been formatted yet gets the default number text. That read does not
   re-enter the formatter, and neither that text nor that node's text object is kept.

### Tests (ran and saw)

- `ax160-ownership.test.ts` (3 tests): (a) a read of old table `s` after an update to `t` (new title and handler) is
  accepted but not drawn, and (b) a read of `s` after `t` draws: no AX160 in `t`'s diagnostics, its `onDiagnostic`
  or its note. Then `t`'s own first failing read reports once, to all three outputs. (c) An active read outside a
  frame reports at once, and only once. (d) After destroy, old and active reads report nothing.
- `legend-sync.test.ts`: on the real interaction layer (`n3-dom`), a size-only update to `alt` whose format throws for
  25. Inside the AX160 `onDiagnostic` call after `rec.frames()`, the legend reads `Altitude (m)` with
  `[25 (default text), '5 m', '1 m']`, matching the drawn table header. This failed before the fix (`['pop']`).
- `export-review.test.ts` (5 tests, treemap and sunburst): seam `null`/`null`/`null` after the retry limit, then the
  settled revision whole; a nested export from the 40-formatter runs that formatter once and keeps `40 u` in the
  table; 4,201 nodes with a stateful formatter give identical CSV closed, repeated and open, and page 1 equals the CSV.
- Pre-fix check: with the four source files swapped back to the reviewed tree, 6 of the 8 new ownership and hierarchy
  tests failed. The 2 that passed are the preservation tests (active read, after destroy). All pass with the fix.
- `./tools/loupe test packages/axylo/test/spatial/bubble` → `PASS: 94 tests`; `…/test/hierarchy` → `PASS: 166 tests`;
  full `./tools/loupe test` → `PASS: 3019 tests`. `./tools/loupe fast` → `ok fast all`, and `tsc --noEmit` on
  `packages/axylo` and `tests/dist` gave 0 errors.

### Sizes (ran and saw; gzip-9)

Recipe: three faithful trees under `.prism-cache/tmp/w4/`, each built with its own `node scripts/build.mjs`, with the
consumer bundled as `subpaths.test.ts` does it. The trees are `base` (`git archive fd5a5f6`), `prev` (the reviewed
candidate) and `cand` (this repair).

| Row | `fd5a5f6` | reviewed | repair | Δ vs `fd5a5f6` |
|---|---:|---:|---:|---:|
| root `line` | 136,052 | 136,044 | 136,044 | −8 |
| root all exports | 159,024 | 159,018 | 159,018 | −6 |
| static `line` | 120,515 | 120,508 | 120,508 | −7 |
| static all exports | 140,829 | 140,829 | 140,829 | 0 |
| IIFE (`axylo.iife.min.js`) | 159,363 | 159,354 | 159,354 | −9 |
| `axylo/export` (cap 3,500) | 3,500 | 3,498 | 3,498 | −2 |
| `axylo/stats` / `axylo/sync` (cap 3,500) | 3,483 / 3,494 | same | same | 0 |
| `axylo/spatial` (cap 142,500) | — | 142,020 | **142,342** | new |
| `axylo/hierarchy` (cap 21,600) | — | 21,525 | **21,591** | new |

The bare imports (`ignoreAnnotations: true`) of `axylo/spatial` and `axylo/hierarchy` bundle to 0 B under both
`production` and `development`. A Node SSR import of all 10 entries, in a fresh process under both default and
`--conditions=development`, left all 10 probed DOM globals absent before and after. This was against the repair
tree's dist, not a packed install.

The pre-existing legacy-cap overages are unchanged: root `line` is +751 over 135,293, root all exports +922 over
158,096, and the IIFE +929 over 158,425. At `fd5a5f6` they were already +759, +928 and +938. The Director's packed
run will still fail those three tests. W4 did not cause that.

The first version of the hierarchy repair measured 21,626 B, over its cap. Dropping a flag variable and a
`try`/`finally` brought it to 21,591. The readout catches what the formatter throws, so the nesting count always
comes back down.

## Review 6 repair (three blockers of the full cross-provider review)

### What changed

1. **Bubble AX160 ownership** (`spatial/bubble/composition.ts`): each bubble table records the revision that owns it
   when it is built: the in-flight revision inside a frame, the accepted one otherwise. A failing row is reported only
   when that owner is still the accepted revision, on top of the existing drawn/drawing rule. An `x.tickFormat` of
   t's frame that reads s's table (still `state.table` before t's reader is made) now reports nothing.
   **Retirement:** the bubble remembers the meta whose size failure it reported. When the reader of a revision with
   another meta is built, it withdraws that finding through the controller's reporter, with the controller itself
   passed as the second argument (`fallback(field, controller)`). The formatters pass what was thrown there, so no
   thrown value can retire a finding. An equal size configuration reuses its meta (`sameMeta`), so the finding stays.
   Controller (`core/controller.ts`, the `fallback` closure): the `format` bucket keeps one AX160 per field. A report
   replaces the field's entry, and a retirement removes it. This replaces `#addPresentation`, whose only caller was here.
   Stock formatter findings for other fields are kept, and nothing changes after destroy. `public.ts` and
   `core/contracts.ts` are untouched. `controller-types.ts` widened `fallback`'s second parameter to `unknown`.
2. **Bubble legend** (`updateLegend`): when a lookup runs inside a frame, the legend is written in that frame, even if
   a size format accepted another update during the lookup. The core still publishes that in-flight plot and table
   once it has started writing. When the frame is superseded, a microtask also re-syncs the legend to
   `legends.get(controller.drawn.layout)`, which is the layout actually drawn. That covers a frame that stops before writing.
3. **Hierarchy** (`hierarchy/chart.ts` `paint`): at the retry limit, drawing stops with `break` and keeps the parts it
   did not draw marked dirty. It no longer clears them. `shown` is set only when no part is left (`dirty ? null : committed`).
   A later no-op, false-returning `drill('missing')` or partial action therefore opens export only after its paint has
   drawn every remaining part, from one revision.

### Checks (ran and saw)

- New regressions, each confirmed to fail on the reviewed sources and pass on this repair:
  - `test/spatial/bubble/ax160-review6.test.ts` covers four tests:
    - the tick formatter reading the old table;
    - empty to working-format retirement in the diagnostics and the note;
    - the same size options keeping one finding;
    - a stock finding surviving.
    Three of them failed on the old sources: 1 against the reviewed composition, and 2 against the composition without retirement.
  - `test/spatial/bubble/legend-sync.test.ts`, "a size format that calls update while the legend is looked up". The
    lookup is marked by wrapping the composition's `lookup`. On the reviewed composition it failed with
    `expected 'pop' to be 'Altitude (m)'`.
  - `test/hierarchy/export-review.test.ts`, "after the retry limit, false drills keep export closed …", for treemap and
    sunburst. It failed on the reviewed `chart.ts`.
- Two items not covered: the abort path of blocker 2 (a superseded frame that stops before it writes) has no dedicated
  regression, and its microtask re-sync is not proven synchronous before callbacks. The stock-finding test uses an x
  tick formatter on an empty chart. That test fails without retirement, but it does not prove that a stock AX160 was present.
- `./tools/loupe fast` → `ok fast all`. `./tools/loupe test` → `PASS: 3026 tests` (3019 + 7 new).

### Sizes (ran and saw; gzip-9, faithful-tree recipe above, `.prism-cache/tmp/w4/{prev,final}`)

`prev` is the reviewed candidate tree (`coordinators/p2_w4_integ/trees/opus-5.5-high__20261128T005933Z`). It reproduced
the recorded numbers exactly.

| Row | `fd5a5f6` | reviewed | review-6 repair | Δ vs `fd5a5f6` |
|---|---:|---:|---:|---:|
| root `line` | 136,052 | 136,044 | 136,030 | −22 |
| root all exports | 159,024 | 159,018 | 159,006 | −18 |
| static `line` | 120,515 | 120,508 | 120,512 | −3 |
| static all exports | 140,829 | 140,829 | 140,829 | 0 |
| IIFE | 159,363 | 159,354 | 159,346 | −17 |
| `axylo/export` (cap 3,500) | 3,500 | 3,498 | 3,498 | −2 |
| `axylo/spatial` (cap 142,500) | — | 142,342 | **142,472** | 28 B headroom |
| `axylo/hierarchy` (cap 21,600) | — | 21,591 | **21,588** | 12 B headroom |

The bare imports (`ignoreAnnotations: true`) of `spatial`, `spatial.dev`, `hierarchy` and `hierarchy.dev` are all 0 B.
No caps were changed. Variants measured and rejected: the first controller retirement form was +29/+38/+29/+34/+42 B
on root/static/IIFE and pushed spatial over its cap. A filter that kept `#addPresentation` was +5/+10 B on the static rows.
The final form and its guard order were chosen by measurement. The historical absolute overages remain, all from
before W4: root `line` +737 over 135,293, root all exports +910 over 158,096, IIFE +921 over 158,425. At `fd5a5f6`
they were +759, +928 and +938. The Node SSR import, the packed `.d.ts` closure, the packed dist suites and Chrome were not re-run here.

## Reserved for the Director (not run here)

`tests/dist/w4-spatial-hierarchy.browser.test.ts` (new, real Chrome) has not been run, including after either repair above (the
expected bubble labels, the AX190 warning and the `exportPng` Blob checks of the review repair are unexecuted). It covers heatmap, bubble and
violin through N7b's `expectWholeFigure`; their family chrome (gradient stops with resolved colours, colour-bar
title and ticks, nested circles and values); hierarchy title, drilled breadcrumbs `Root › B1` (treemap) and `Root › B0` (sunburst), note, marks and
labels; PNG at 1x and 2x; CSV closed, open and paged to page 2 on more than 50 rows over several pages, through both
export bundles, by target and by handle, against row identities derived from the fixture; the sunburst's Root crumb drilling back up; and
0/0/0 teardown. The Director's packed `subpaths.test.ts` run should show `axylo/export` at 3,498 B and the three historical
legacy-cap failures (root `line`, root all exports, IIFE) that `fd5a5f6` already had.

The extended `tests/dist/subpaths.test.ts` and `package-contents.test.ts` (exact inventory) also have not run, nor
has `npm run size`, `verify:heavy`, or any other packed suite.

`tests/dist/export-conformance.ts` now counts `[data-axylo-export] svg` as chrome graphics. That changes nothing for
the existing export tests, because no chart before W4 marks any element.

## Size repair attempt after the AX160 fixes (rejected, no source change)

Variant tried: the fallback's bucket key `own = own === this ? own : 'format'` (controller object cast to `PresentationStage`) replaced by
the real key `own = own === this ? 'size' : 'format'`. Measured with a quick in-workspace recipe (`node scripts/build.mjs`, then
`import { line }` / `import *` from `dist/static.js` bundled with esbuild minify, ESM, es2022, `production`, gzip-9), same recipe on both sides:
static `line` 120,506 → 120,509 (+3 B), static all exports 140,883 → 140,886 (+3 B). It grows the bundle, so `controller.ts` was restored
byte-for-byte (`cmp`). These are quick-recipe numbers, not the faithful-tree numbers in the table above. The +3 / +6 B static growth vs `fd5a5f6` is unresolved.

## Director decision on the static growth (2026-11-28, `p2_w4_integ2`)

Disposition of the unresolved +3 / +6 B entry above: accepted. The Director authorizes up to +16 B gzip-9 on each
`axylo/static` measurement (static `line`, static all exports) against `fd5a5f6` for the internal AX160 stock-versus-size
separation in `src/core/controller.ts`. The growth is the cost of keeping a stock AX160 finding apart from the size
field's own finding, so no further size work is done on it. The limits that still hold against `fd5a5f6`: root `line`,
root all exports and IIFE at ≤ 0 B, and 0 B bare imports of `spatial`, `spatial.dev`, `hierarchy` and `hierarchy.dev`
under production and development. The +3 B (static `line`) and +6 B (static all exports) figures, and spatial 142,477 B,
hierarchy 21,588 B, root `line` −18 B, root all exports −15 B, IIFE −12 B, are the Director's record of the faithful
measurement of the sealed `p2_w4_integ` lineage; they were not re-measured in this replay. Source is the six sealed patches
replayed unchanged on `fd5a5f6`; only this section was added.
