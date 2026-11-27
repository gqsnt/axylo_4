# N8a — `axylo/spatial` heatmap ledger (Wave 4, Track A)

Status: implemented in the isolated workspace, repaired for the three blockers of cross-provider review
`sol-6.2-medium__20261127T170351Z` (section 9; that candidate, `opus-5.5-medium__20261127T170945Z`, passed the
Director's Chrome and Node run, section 10), then repaired again for the two blockers of review
`sol-6.2-medium__20261127T172920Z` (section 11: color-bar slot lifecycle and one legend model per commit).
**The section 11 candidate has not been run in Chrome**: its Chrome evidence is pending the Director's run. Section 10's
Chrome results belong to the earlier candidate only. Not committed.

Keep the kinds of evidence apart below: **observed here** (ran in this workspace and saw), **observed by the
Director** (read from the Director's verification log, section 10; not rerun here), **inferred** (follows from what
was observed). Sections 6–9 keep the earlier worker-turn Node measurements as historical evidence.

## 1. What was built (owned paths only)

| File | Role |
|---|---|
| `packages/axylo/src/spatial/color-scale.ts` | OKLab sequential (viridis anchors) and symmetric diverging scales, `K` quantized bins (default 32, 2–64), overflow-safe binning, live CSS expressions with private defaults |
| `packages/axylo/src/spatial/heatmap/core.ts` | options parsing, AX182–AX186, MatrixFrame normalization behind a `WeakMap<AlignedFrame, MatrixFrame>`, view |
| `packages/axylo/src/spatial/heatmap/layout.ts` | plot rect, row/column labels (rotated / thinned / truncated), band projection, render-time AX185 |
| `packages/axylo/src/spatial/heatmap/render.ts` | per-bin batched scene, custom `rects` SVG drawer, O(1) lookup with 2D stepping, overlay |
| `packages/axylo/src/spatial/heatmap/reader.ts` | summary and lazy `TableModel` (matrix ≤ 24 columns, long above) |
| `packages/axylo/src/spatial/heatmap/legend.ts` | continuous color bar (one SVG `linearGradient` of 17 live CSS stops, independent of the bin count; min/mid/max ticks; missing + invalid swatches), mounted via `sliceList` |
| `packages/axylo/src/spatial/heatmap/chart.ts` | composition + wrapper (accepted state, strict rollback, held findings), export hooks |
| `packages/axylo/src/spatial/heatmap/index.ts` | **entry for p2_w4_wire**: `heatmap`, `validateHeatmap`, `heatmapInternals`, all option types |
| `packages/axylo/test/spatial/heatmap/*` | 7 Node suites (incl. `committed.test.ts`, the review-repair regressions) + `fixtures.ts`, `host.ts`, `interactive.ts`, `browser.entry.ts` |
| `packages/axylo/test/browser/chart/n8a-heatmap.browser.test.ts` | dedicated Chrome test (passed in the Director's run, section 10) |

No edit to `public.ts`, `core/**`, `dom/**`, `render/**`, `theme/**`, `export*`, `spatial.ts`, `bubble/**`,
`hierarchy/**`, `package.json`, `scripts/build.mjs`, `scripts/size.mjs`. Observed: `find -newermt <session start>`
lists only the files above, plus `apps/docs/.cache/types/{probe.ts,tsconfig.json}`, which the existing
`apps/docs` tests regenerate during the full suite (gitignored cache, left as is).

## 2. Public options (from `src/spatial/heatmap/index.ts`)

```ts
import { heatmap, validateHeatmap } from 'axylo/spatial'; // after p2_w4_wire; today: src/spatial/heatmap/index.ts

heatmap('#load', {
  title: 'Server load by hour',
  data: rows,                       // array of objects, or { columns: { day: [...], hour: [...], load: Float64Array } }
  x: { field: 'hour', label: 'Hour' },          // column of each cell; string or { field, label?, categories? }
  y: { field: 'day', label: 'Day', categories: ['Mon', 'Tue', 'Wed'] },  // row of each cell
  value: { field: 'load', label: 'Load', unit: '%', format: { maximumFractionDigits: 1 } },
  color: { scheme: 'diverging', mid: 0, domain: [-50, 50], bins: 16 },    // all optional
  legend: 'bottom',                 // false | 'auto' | 'top' | 'right' | 'bottom' (color bar placement)
  // CommonOptions: subtitle, description, state, tooltip, table, messages, locale, strict, onDiagnostic, labelledBy
});
validateHeatmap(options); // Node / SSR: every call-time finding, no DOM
```

Supported data shapes are the core's (`data/options.ts` `resolveTable`): an array of row objects or
`{ columns: Record<string, ArrayLike> }` (typed columns borrowed for reading). Row/column keys may be strings
(non-empty), finite numbers, booleans or valid `Date`s (as ISO text). `colors` does not apply (AX150 says to use
the CSS custom properties).

Styling: `--axylo-sequential-0 … 4` and `--axylo-diverging-0 … 4` (anchors; private defaults are the `var()`
fallbacks, so nothing is defined globally). Each bin is `color-mix(in oklab, anchor_i w%, anchor_i+1)`, written
through CSSOM `style.setProperty` (no `<style>`, no style attribute strings: CSP-safe).

## 3. Architecture (zero shared-contract edits)

- **Frame.** The controller runs a one-series aligned chart (`kind: 'line'`): x positions are the cell indexes
  `0 … rows×cols−1` (row-major), the single series' `y`, `slot`, `row` are the MatrixFrame's own `values`
  (`Float64Array`), `state` (`Uint8Array`: 0 value, 1 missing, 2 invalid — the contract's SLOT codes) and `source`
  (`Int32Array`, −1 for absent cells). The MatrixFrame (dims, category keys, domain, per-cell bin) sits in a
  module `WeakMap` keyed by that frame, created lazily (nothing at import time). One series means one theme
  binding, no series legend toggles, and the controller's formatters are the value field's (F6 readouts).
- **Heatmap options shape the frame.** The controller cannot see `color`, categories, labels, unit or format of
  the heatmap; the wrapper hands the controller a new data holder whenever the frame key
  (`frameKeyOf`: fields, labels, unit, format, categories, scheme, domain, mid, bins) changes, so the change is
  normalized, validated and accepted or rejected exactly like data. This also keeps every frame on the
  normalize path: the controller's rename-in-place path (labels/units/format only) would otherwise produce a
  frame without a matrix.
- **Strict rollback.** Wrapper as in `finance/chart.ts`: per-call meta and pending option issues are set just
  before the controller resolves, the accepted ones restored after; acceptance is read from the controller's
  accepted options identity. Stages read the matrix bound to the frame, so a rejected call cannot leak.
- **Interaction.** Refs are `DatumRef.kind === 'point'` (`x` = cell index, `row` = source row) and
  `stepInSeries: null`, so `dom/interaction.ts` sends ←/→ (`next`/`previous`), ↑/↓ (`series-previous`/`series-next`),
  Home/End and PageUp/PageDown to `lookup.step`. `firstDatum` on this aligned view goes through
  `stepAcross` → x = 0 → `lookup.primary({kind:'x', x: 0})`, which the heatmap lookup answers with the top-left
  cell. `core/focus.ts` reads point announcements through `lookup.datum`, which carries row and column with their
  positions. Both risks named in the request are covered by tests through the real `createInteraction`.
- **Color bar refresh** (superseded by section 11; kept as the earlier design). `dom/interaction.ts` caches control inputs and calls `sliceList` only when they change;
  for a one-series non-donut chart those inputs do not include the view. The heatmap's per-instance legend is
  therefore also refreshed from the composition's lookup stage (rebuilt whenever view, layout, formatters,
  messages or locale change; it runs inside the same `#publish` as the commit). The refresh repaints a mounted
  bar only; `sliceList` mounts, hides (legend `false`, not ready, too small) and releases it
  (`sliceList(…, null, …)` on destroy), and hiding or releasing drops the last view it held. Mutation check
  (observed, first build): replacing the refresh call with a no-op makes the refresh test fail with the stale
  ticks `['0', '1.5', '3']`.
- **Export reachability.** `heatmapInternals(handle)` → `{ table(): TableModel | null, legend(): LegendModel | null }`,
  read from the controller's **last drawn record** (`ControllerCore.drawn`: `reader.table`, `formatters`,
  `accepted.view/messages/options`), never from a stage callback; see section 9.3 for the exact rules.

## 4. Policies for ambiguous cases

| Case | Policy |
|---|---|
| Duplicate `(row, col)` | **AX182** warning, effect `omitted` (counts in the reader's note, F12): the **first** row in data order is drawn; every later row for that cell is counted and sampled (≤ 10 rows) and is **named in that cell's reading** (tooltip, keyboard and table alike), e.g. `1 (duplicate rows not drawn: 2.5, No data, "n/a", +1)` — first three values, then a count — so the note's "See table" is true. Duplicates of a missing cell count too. |
| Value `null`, `undefined`, absent key, `''`, NaN in a typed float column | **missing** (state 1), silent, hatched with one diagonal, reads "No data". A cell with no row at all is missing too (source −1). |
| Value NaN / ±Infinity in rows, ±Infinity in typed columns, strings, booleans, bigint, objects | **invalid** (state 2), **AX183** warning `omitted`, crossed out (two diagonals), reads `Invalid value (<raw>)`. Strings are not parsed (no AX104 path). |
| Row/column key missing or unusable; key outside given `categories` | **AX183** (separate messages), rows left out. |
| More than 4,000,000 cells | error state, reported as **AX134** (the core's series × x code; the shell is exactly that), so a sparse long table cannot allocate unbounded memory. |
| Explicit `domain` not two finite ascending numbers | **AX184** warning (effect `none`), ignored, data range used. |
| Explicit `domain` the data never reaches | **AX184** warning: every cell takes an end color. Values outside an explicit domain otherwise clamp to the end bins silently (author choice; readouts stay exact). |
| `mid` not finite | **AX184**, 0 used. Diverging `mid` outside an explicit domain: **AX184**, domain ignored. |
| Diverging domain | always symmetric about `mid`: radius = larger distance of the (explicit or data) ends from `mid`; the legend shows the actual ends. |
| Inferred constant domain (one distinct value) | not a finding: every value takes the middle bin; legend shows the single value. |
| No finite value at all, but cells exist (all missing, all invalid, or both) | **ready and interactive** (section 9.2): no domain, no AX184, no bar (swatches only), every cell hatched / crossed out, focusable, read "No data" / "Invalid value (…)". No rows at all (`data: []`) keeps the controller's empty state. |
| Typed-column NaN vs row NaN | a `Float64Array`/`Float32Array` NaN is the contract's SLOT_NULL (`core/contracts.ts`: typed columns mark missing with NaN): **missing**. A NaN in a plain array / row object is a value given as a number that is not finite: **invalid** (AX183), like ±Infinity in either. |
| Sub-pixel cells | **AX185** hint, origin `presentation`, from `layout.layoutDiagnostics` (never thrown; cleared when cells fit). |
| > 50,000 cells | **AX186** hint (call origin, never thrown). Exactly 50,000 is not reported. |
| Unknown keys / bad `bins` / bad `scheme` / `mid` on sequential / `colors` | AX150 warning, ignored. |
| Home / End | first / last cell **of the current row** (WAI-ARIA grid). |
| PageUp / PageDown | the core maps PageUp → `page-next`, PageDown → `page-previous`; the heatmap moves **up / down 8 rows** respectively (WAI-ARIA grid direction), clamped. |
| Edges | non-wrapping: a step past an edge returns null and focus stays. |
| Labels that do not fit | rotated −90°, then thinned to every k-th (ordered positions, spec L1) and truncated with an ellipsis; `fit.hidden = 0` (every key is in the table and in each cell's reading), so no AX143. |
| Cell gap | cells ≥ 6 px on both sides keep a 0.5 px inset (1 px background between neighbours); smaller cells have none and same-bin horizontal runs merge into one rectangle. |
| Strict | AX182, AX183, AX184 and AX150 are warnings: `strict: true` rejects the create/update and rolls back; hints (AX185, AX186) never throw. |

`AX182–AX186` are not in `docs/02-product-spec.md` §3.5 (not owned); the registry rows above are the proposed text.

## 5. Forced colors and the not-colour-alone rule

All heatmap paints are `var(--axylo-forced-series, <normal>)`. The core stylesheet defines `--axylo-forced-series:
CanvasText !important` and `--axylo-background: Canvas !important` only inside `@media (forced-colors: active)`
(observed in `AXYLO_CSS` by a Node test). So in forced colors bins are CanvasText, hatches CanvasText strokes over
the Canvas background rect, cell gaps Canvas. Because `SvgRenderer.draw` does not forward the `ResolvedTheme` to
SVG drawers, the switch is done in CSS, not in JS. The summary always ends with "Color shows an approximate range
only: each cell's exact value is read when it is focused, and every value is in the table." The Chrome test that checks
the computed system colors in forced colors passed in the Director's run (section 10; the colors themselves are
asserted, not printed). (Section 9.2: the closing sentence now drops
each claim the chart cannot honour: the table clause with `table: false`, the focus clause on a compact chart.)

## 6. Measurements

### Observed (Node v24.21.0, Vitest 5.1.0, this workspace, 2026-11-27)

Command: `npx vitest run --configLoader native --no-cache --silent=false packages/axylo/test/spatial/heatmap/svg.test.ts packages/axylo/test/spatial/heatmap/purity.test.ts`

- **Fixture A (build time, d bytes)**: `typedGrid(250, 200, (r, c) => Math.sin(r / 17) * 50 + Math.cos(c / 23) * 50)`
  (long-form columns, `Float64Array` values), plot container 900 × 640, test measurer 7 px/char. Boundary: parse
  → resolve → normalize → view → layout → scene → lookup → `svgRendererWith(heatmapSvgMarks).draw` on the N3 DOM
  double; one warm-up, then 5 runs. **Median 9.0 ms (min 7.3, max 9.8)**; earlier runs in this session: medians
  8.9 and 9.1 ms. **Total path `d` bytes: 346,596** (cells are 3.5 × 2.5 px, no inset, so same-bin runs merge).
- **Fixture B (DOM cap)**: the same grid with every 97th cell missing (`k % 97 === 3`) and every 1,001st invalid
  (`k % 1001 === 500`): **34 marks = 32 bin paths + 1 missing + 1 invalid; 41 SVG nodes in the plot SVG, 41 created**
  (cap 80). Redrawing the same scene creates nothing.
- **Sizes** (esbuild in-memory with `scripts/build.mjs`'s own `PRODUCTION` define and stylesheet plugin, ESM, minified):
  - heatmap entry `src/spatial/heatmap/index.ts`: raw 274,619 B, gzip 96,986 B (the whole static chart stack; the
    barrel/`size.mjs` wiring is p2_w4_wire's);
  - its bare import (`import '<built file>'`, `ignoreAnnotations: true`): **0 B**;
  - root `src/index.ts`: raw 435,440 B, gzip 159,109 B; `src/static.ts`: raw 385,385 B, gzip 141,919 B; **spatial
    inputs in both metafiles: 0**.
- Baseline vs candidate for root/static: superseded by the observed comparison in section 10.3 (byte-identical
  production `axylo.js` and `static.js`). The in-memory figures above stay as the earlier measurement.

### Chrome (observed by the Director, section 10)

```
[n8a-ledger] Chrome 250x200 typed, 900x640: create→2 frames 29.2 ms, 39 SVG nodes, 32 paths, d bytes 375093
```

The Chrome test builds the same values as Node fixture A (`sin(r / 17) * 50 + cos(c / 23) * 50`, string keys,
900 × 640 container, no missing or invalid cell), so it has 32 bin paths and no hatch paths: 39 nodes against
fixture B's 41 (34 paths). Its `d` total, 375,093 B, is 28,497 B more than Node fixture A's 346,596 B. Inferred, not
investigated: Chrome lays out with real font metrics instead of the Node test measurer (7 px/char), so the plot
rectangle, cell sizes, coordinate digits and same-bin run merging differ. The two timings are different boundaries
(Node: stages + draw on the DOM double; Chrome: create → 2 animation frames) and are not comparable.

## 7. Verification

Observed (Node), first build (superseded by section 9.4 after the review repair):

```
npx vitest run --configLoader native --no-cache packages/axylo/test/spatial/heatmap   → Test Files 6 passed (6), Tests 57 passed (57)
npm run typecheck                                                                     → exit 0 (library + tests, docs/api, tests/dist)
npx vitest run --configLoader native --no-cache                                       → Test Files 136 passed (136), Tests 2346 passed (2346)
```

Covered (5 consecutive reruns of the heatmap suite stable; one generator bug found and fixed on the way: the
diverging-symmetry property drew e = 0, the midpoint itself, which has no mirror bin with an even count — now
e ≥ 1, with the midpoint's own bin asserted separately): bin monotonicity (any finite domain incl. ±MAX_VALUE), diverging mirror symmetry (even/odd bins),
OKLab lightness order, missing ≠ invalid ≠ 0 (property), AX182–AX186 counts/rows/levels, typed-column NaN, given
categories, O(1) pick (property), non-wrapping 2D steps (property), tooltip = announcement = table text (property,
wide finite range), duplicate disclosure in all three readings and the note, 24/25-column table switch, lazy table, strict rollback of frame/view/lookup/table/legend
(duplicate, domain, invalid on create, unknown option; plus a fast-check property over grids × six rejected patches), AX185 render-time delivery and clearing, real `createInteraction`:
first focus, ←→↑↓ Home End PageUp PageDown readings, hover pick → exact tooltip model; color bar mount, refresh
after data/domain/format/legend changes, release on destroy, unchanged after a rejected update; 50k DOM cap;
forced-colors CSS linkage; bare-import purity; zero root/static inputs.

Chrome: passed in the Director's run (section 10); section 9.5 has the command and what it checks.

## 8. Limitations and contract notes

- Reader text added by the heatmap (summary sentences, "row 2 of 3", "Invalid value", the color-bar label) is
  English: `Messages` (public.ts) has no heatmap keys. `typeLine`, `pointOf` and `plotInstructions` are overridden
  per chart through the translated `messages` and stay author-overridable. Needed contract change for full A10:
  heatmap message keys in `Messages`.
- (Resolved in section 9.2: the summary no longer names hues or lightness.)
- A heatmap option change (e.g. `color.bins`) is a new frame (new epoch): keyboard focus re-resolves by cell index.
- `select` / `hover` events (core `pointForDatum`) carry the caller's `row` object, its `index` and `series` for a
  cell, but `x` is 0 and `y` null: the core builds x/y for aligned refs on aligned frames and point refs on point
  frames only. Exact change needed for a cell-aware payload: a composition hook (e.g. `Composition.eventPoint?(frame,
  lookup, ref)`) or heatmap fields on `Point` in `core/controller-helpers.ts` / `public.ts` (not owned).
- The `ChartType` the controller sees is `'line'`; diagnostics that name the chart type (AX143 is avoided) would say
  line. Generated names use "Heatmap" through `typeLine` (and `typeBar`, section 9.2).
- A value-less matrix is viewed as `'bar'` (section 9.2). The controller's AX132 bar-density hint can then fire;
  the wrapper keeps it out of `diagnostics` and `onDiagnostic`, but a **development** build prints it once per page
  to the console (`core/delivery.ts` prints hints only when `development`, before any handler). Exact shared
  change that would remove both the `'bar'` adaptation and this print: let `hasData`
  (`core/controller-helpers.ts`) treat SLOT_NULL / SLOT_INVALID as drawable for a composition that says so (e.g.
  an optional `Composition.drawsEmptySlots?: true`, read in `displayState`), so the heatmap view stays `'line'`.

## 9. Review repair: sol-6.2-medium__20261127T170351Z (2026-11-27)

Three blockers, repaired inside the original fence: `src/spatial/heatmap/{legend,chart,reader,core}.ts`;
`test/spatial/heatmap/committed.test.ts` (new), `interactive.ts` (new, moved out of `lifecycle.test.ts`),
`lifecycle.test.ts`; the Chrome test; this ledger. `src/spatial/color-scale.ts` is unchanged this round.

### 9.1 Continuous color bar

- `legendModel` now returns `stops: { offset, color }[]`: **17 stops** at `i / 16`, each `colorAt(scheme, t)`, the
  same live CSS expression as the plot bins (`var(--axylo-forced-series, color-mix(in oklab, var(--axylo-<scheme>-i,
  #…) w%, var(--axylo-<scheme>-i+1, #…)))`). The stops do not depend on `bins` (the model keeps `bins` as the
  plot's quantization, for export text). Anchors fall exactly on stops 0, 4, 8, 12, 16. 17 stops = 4 per anchor
  segment, so the sRGB interpolation SVG does between neighbouring stops stays close to the OKLab mix.
  The per-bin `colors` field is gone: nothing outside the heatmap read it.
- Degenerate domain (one distinct value): two stops of that one bin's color, one tick at 0.5.
- DOM: `svg > defs > linearGradient#axylo-heatmap-scale-N (x1 0, x2 1) > stop.axylo-heatmap-stop` (offset
  attribute, `stop-color` CSS property), then `rect.axylo-heatmap-bar-fill` with CSS `fill: url("#id")`, then
  `rect.axylo-heatmap-bar-outline`. Every color goes through CSSOM `style.setProperty` (`stop-color` as a CSS
  property, since only CSS resolves `var()` and `color-mix()`); no `<style>`, no style or stop-color attribute.
- Ids: a module counter (`let gradients = 0`, a literal: still 0 B bare import) gives each chart's legend one id
  the first time it paints; repaints reuse it and `replaceChildren` removes the old gradient, so the document has
  one element per id. Two charts never share one.
- Forced colors: every stop is `var(--axylo-forced-series, …)`, so the bar takes the system text color inside the
  kept outline; the summary never relies on color.
- Visible repaint: `refresh` (lookup stage) repaints a mounted bar only; `sliceList(…, null)` (hide, destroy)
  drops the view it held.

### 9.2 Matrix with cells but no finite value

- Observed before the fix: such a matrix showed the empty state (`hasData` needs a SLOT_VALUE for line views).
- Fix (owned): `buildHeatmapView` returns `kind: 'bar'` exactly when the matrix has cells and `valueCount === 0`.
  `hasData` counts any non-SLOT_NO_ROW slot of a bar view, which matches a heatmap (every cell is drawn). The
  frame, its series (`slot` **is** `MatrixFrame.state`: SLOT_NULL / SLOT_INVALID untouched) and its NaN values
  are unchanged. No heatmap stage reads the view kind.
- Audit of `view.kind === 'bar'` in shared code (grep over `src/core`, `src/dom`, `src/reader`, `src/lookup`,
  `src/render`):
  - `controller-helpers.ts hasData`: the intended effect.
  - `controller.ts #reportFit`: AX132 when visible slots > plot width. Observed on a 30 × 40 all-null matrix: it
    fired. The wrapper filters it (section 8). `horizontal` is false.
  - `reader/index.ts readerWith` names the chart with `typeBar`, which `parseHeatmapInput` maps to the heatmap's
    `typeLine`. Tested: the name never says bar.
  - `core/axes.ts`: not used by the heatmap layout. `core/instrument.ts`: a line-only branch in the dev probe.
  - `dom/*`: no `'bar'` view-kind branch (`horizontalBars` reads the layout projection).
  - `visibleSlots` stays full: the screen-reader slider (`#onProxyInput` → `#atOrdinal`) and `firstDatum` read it.
- Typed-column NaN stays SLOT_NULL (missing); a row's NaN and ±Infinity are SLOT_INVALID (AX183). Tested.
- Summary: no hue or lightness words. The closing sentence names the table only with `table` on, and focus
  readings only on an interactive (non-compact) chart. It says nothing about the legend: the reader's cache key has
  no legend input, so a legend claim could go stale.
- Tests (`committed.test.ts`, real controller + real `createInteraction` on the DOM double): all-missing,
  all-invalid and mixed matrices → ready, `view.kind 'bar'`, slot/state identity, scene marks `missing`/`invalid`,
  initial focus reading, ArrowRight / ArrowDown / boundary, hover tooltip, swatches without a bar, table row,
  exported legend with no stops; `[]` → missing-only → one value (`'line'`) → `[]`; typed vs row NaN; no AX132.
  Mutation (observed): forcing `kind: 'line'` fails 5 of these tests.

### 9.3 Export hooks bound to the last drawn revision (superseded by section 11.2)

`heatmapInternals(handle)` reads `ControllerCore.drawn`, the record `#publish` writes just before
`interaction.commit`. The wrapper reaches it through the controller it already captures from `normalize`'s
environment. No stage callback writes export state any more: `createHeatmapReader`'s `built` hook is removed and
the reader is the stateless `heatmapReader`.

| Case | `table()` | `legend()` |
|---|---|---|
| Before the first draw, after an internal failure (`drawn` null), after `destroy()` | null | null |
| Accepted update not drawn yet | previous drawn revision's | previous drawn revision's |
| Strict rejection | unchanged (same object) | unchanged |
| `table: false` | null (the committed reader has none) | unaffected |
| `table` back on | the new committed reader's table | unaffected |
| `legend: false` | unaffected | null |
| Display not ready (`state: 'loading'`, error, empty) | the committed reader's table | null (the same `displayState` rule the page's bar waits for) |
| Too small for the bar | unaffected | still the model (the scale is known; only room is missing) |
| A formatter that calls `update()` while formatting | follows the next drawn revision | same; visible ticks agree |

`legend()` caches one model per drawn record (the same object until the next draw). Visible-vs-export agreement
is tested for bottom and top placements, after data, legend and formatter changes. Mutations (observed): dropping
the readiness rule fails the loading-state test; returning the unfiltered `diagnostics` fails the AX132 test.

### 9.4 Verification (observed, Node v24.21.0, Vitest 5.1.0, 2026-11-27)

```
npx vitest run --configLoader native --no-cache packages/axylo/test/spatial/heatmap
 Test Files  7 passed (7)
      Tests  72 passed (72)
npm run typecheck   → exit 0 (tsc -p packages/axylo, docs/api, tests/dist)
npx vitest run --configLoader native --no-cache   (whole Node suite, before the last summary unit test was added)
 Test Files  137 passed (137)
      Tests  2360 passed (2360)
npx vitest run --configLoader native --no-cache --silent=false packages/axylo/test/spatial/heatmap/svg.test.ts packages/axylo/test/spatial/heatmap/purity.test.ts
 [n8a-ledger] heatmap entry …: raw 276010 B, gzip 97525 B; bare import with ignoreAnnotations: 0 B
 [n8a-ledger] index.ts …: raw 435440 B, gzip 159109 B, spatial inputs 0
 [n8a-ledger] static.ts …: raw 385385 B, gzip 141919 B, spatial inputs 0
 [n8a-ledger] dense fixture (250x200, …), 900x640: 34 marks, 34 paths (32 bins + missing + invalid), 41 SVG nodes, 41 created
 [n8a-ledger] 250x200 typed, 900x640, stages+draw ms: median 8.9 min 7.0 max 13.1; path d bytes 346596
```

The heatmap entry grew from 274,619 B to 276,010 B raw (96,986 → 97,525 B gzip) with this repair. The
lifecycle color-bar test's two `.axylo-heatmap-band` counts (32 and 4) described the stepped bar this repair
replaces. They now assert one `.axylo-heatmap-bar-fill` and 17 stops for both bin counts. No other expected value
changed.

### 9.5 Chrome run (not run in a worker turn; passed in the Director's run, section 10)

From the repository root, nothing else in parallel. The test now starts Chrome through `acceptance/short-tmp.ts`,
so a deep TMPDIR cannot overflow Chrome's 107-byte socket path:

```bash
mkdir -p .prism-cache/tmp && TMPDIR=$PWD/.prism-cache/tmp AXYLO_BROWSER=1 \
  npx vitest run --configLoader native --no-cache packages/axylo/test/browser/chart/n8a-heatmap.browser.test.ts
```

What it now checks:

- The page is set up with `<main>`, h1 and h2 around both charts. blank.html has none of them, and axe's
  `region`, `page-has-heading-one` and `heading-order` rules want them.
- Both charts at **2 bins**: 2 bin paths + missing + invalid; ticks `0.25 / 17.75 / 35.25` and `-13 / 0 / 13`.
- The bar: one gradient-filled bar per chart, with the gradient inside that chart; 17 stops at i/16; adjacent
  computed stop colors all different; an interior stop unlike either end; ticks at the left edge, centre and right
  edge; distinct ids; anchors at stops 0/8/16 equal to the default palette in computed RGB; a page override of
  `--axylo-sequential-2` restyling stop 8 live; after a data update, one gradient with the same id and visible
  ticks equal to `heatmapInternals(...).legend()` ticks (`0 / 150 / 300`).
- As before: hover exact value and No data, the 2D key sequence, the matrix table, axe zero violations in light,
  dark and forced colors, forced-colors system colors, the 50,000-cell cap.

Not observed: whether Chrome's computed `fill` serializes the reference as `url("#id")` or as an absolute URL
(the test accepts both; the passing run does not print which).

## 10. Director verification of candidate `opus-5.5-medium__20261127T170945Z` (2026-11-27)

### 10.1 Which code revision

Read from the Coordinator's records (`runs/coordinators/p2_n8a/`), read-only:

| Item | Value | How known |
|---|---|---|
| Base commit | `e78558bd8dfbe47260fcb05d65ddbe9e17e480db` (`chore(wave2): seal Wave 2 size baseline`), HEAD of the target worktree `/home/canarit/projects/axylo-wt-n8a` | observed: `git rev-parse HEAD`; `git status` shows only untracked `node_modules` and `bench/node_modules` |
| Baseline snapshot | `runs/coordinators/p2_n8a/initial`, `initial_tree_sha256` `b51e93a3…68294` | observed: `diff -rq` against that worktree (excluding `node_modules`, `.prism-cache`, `.cache`, `.git`) prints nothing |
| Candidate patches | `opus-5.5-high__20261127T162810Z` (sha256 `8d5e6a8dcb5d0587f96a92fd00778df1817ec306f99a249a7b529a4b2cda5d97`, first build), then `opus-5.5-medium__20261127T170945Z` (sha256 `69cf72ee11c4919affb5b1437d74a5ade851edc088627643b1e98d06a79c981e`, the section 9 repair, a delta over the first) | observed: `sha256sum` equals each patch's `meta.json` |
| Verified tree | `verified_run_id` `opus-5.5-medium__20261127T170945Z`, `verified_tree_sha256` `6c51e73c61554067049a0415bece91274aa5ea27ac447ff29278a1f472568550` | Coordinator-reported in `checkpoint.json`; not recomputed here (the hashing rule is the Coordinator's) |
| This workspace | identical to `trees/opus-5.5-medium__20261127T170945Z` and to the Coordinator's `view` before this ledger edit | observed: `diff -rq` (same exclusions) prints nothing |

This ledger edit (section headings, status, this section) is the only change since that tree; no source or test file
changed, so the tree hash will differ but the code the Director verified is unchanged.

### 10.2 What the Director's run showed

Log: `/home/canarit/projects/prism/runs/coordinators/p2_n8a/verify/turn-4-opus-5.5-medium__20261127T170945Z.log`
(run tree `runs/coordinators/p2_n8a/verify-7jhasqph/tree`; `state.json` `last_result`: `exit_code` 0, `ok` true).
Command (`checkpoint.json` `verify_cmd`, run by the Director with `TMPDIR=/tmp`, `npm_config_cache=/tmp/prism-npm-cache`):
`npm run typecheck && npm test && AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser/chart/n8a-heatmap.browser.test.ts`.

```
> tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist        (no errors)
 Test Files  137 passed (137)
      Tests  2361 passed (2361)                                                   (Node, whole suite)
[n8a-ledger] Chrome 250x200 typed, 900x640: create→2 frames 29.2 ms, 39 SVG nodes, 32 paths, d bytes 375093
 ✓ packages/axylo/test/browser/chart/n8a-heatmap.browser.test.ts (10 tests) 3222ms
     ✓ axe-core reports no violations (light) 378ms
     ✓ axe-core reports no violations (dark) 362ms
     ✓ axe-core reports no violations (forced colors) 392ms
 Test Files  1 passed (1)
      Tests  10 passed (10)                                                       (system Chrome)
```

The same Node run printed the Node measurements again on the Director's machine: dense fixture B 34 paths / 41 SVG
nodes; fixture A `median 25.6 min 16.0 max 32.3` ms, `d` 346,596 B (slower than the worker-turn 8.9 ms median:
the whole suite ran in parallel); in-memory sizes unchanged from section 9.4.

Rerun of the Chrome test, from the repository root, nothing else in parallel, scratch kept inside the workspace:

```bash
mkdir -p .prism-cache/tmp && TMPDIR=$PWD/.prism-cache/tmp AXYLO_BROWSER=1 \
  npx vitest run --configLoader native --no-cache packages/axylo/test/browser/chart/n8a-heatmap.browser.test.ts
```

### 10.3 Root and static production bundles, baseline vs candidate (observed here)

`npm run build` itself was not run: `scripts/build.mjs` `main()` deletes `packages/axylo/dist` in the tree it
lives in and then starts `npx tsc` through `execFileSync` (a child process, not allowed in this turn). Instead,
`packages/axylo/{src,package.json}` and `scripts/build.mjs` of each side were copied into
`.prism-cache/tmp/n8a-size/{baseline,candidate}` (baseline from `runs/coordinators/p2_n8a/initial`, read only), and a
driver imported that copy's own `build.mjs` exports (`stylesheets`, `stylesheetPlugin`, `PRODUCTION`) and made the
same esbuild calls as `main()` for `axylo.js` (`src/index.ts`) and `static.js` (`src/static.ts`): `bundle`,
`target: 'es2022'`, `legalComments: 'none'`, `format: 'esm'`, `minify`, production define and minified stylesheet,
written to that copy's `dist`. Then `gzip -9c <bundle> | wc -c` (gzip 1.14). Node v24.21.0, esbuild 0.28.2.

| Bundle | Baseline raw / gzip -9 | Candidate raw / gzip -9 | sha256 (both sides) | spatial inputs |
|---|---|---|---|---|
| `axylo.js` (root) | 435,488 / 158,548 B | 435,488 / 158,548 B | `77815b3711a7782cb45658afea8239bb02b8f197c909c462a0e4af9c9d6b2224` | 0 of 114 |
| `static.js` | 385,433 / 141,372 B | 385,433 / 141,372 B | `ebd8a118e164d08e4789974446e6859be17f1491eb2e5a6d90d2fe1fa68a7e60` | 0 of 115 |

Observed: the root and static production bundles are byte-identical between baseline and candidate, so the N8a
root/static gzip tax is **0 B**. Input-tree equivalence (observed, `diff -rq` of `initial` against this workspace):
the only differences are the new `packages/axylo/src/spatial/`, `packages/axylo/test/spatial/`,
`packages/axylo/test/browser/chart/n8a-heatmap.browser.test.ts` and this ledger.

These outfile byte counts differ from the in-memory figures in sections 6 and 9.4 (435,440 / 385,385 B raw, zlib
gzip 159,109 / 141,919 B). The purity test uses the same esbuild options but counts `text.length` (UTF-16 code
units, so non-ASCII characters count once instead of as their UTF-8 bytes) and gzips with Node's `zlib` default
level; here the file bytes and `gzip -9` are measured (inferred from reading `purity.test.ts`; the 48 B raw gap was
not traced character by character). Both sides above use one method, which is what the delta needs. This is still
not the `npm run size` table (packed tarballs; `npm pack` not run).

## 11. Review repair: sol-6.2-medium__20261127T172920Z (2026-11-27)

Two blockers, repaired inside the fence: `src/spatial/heatmap/{legend,chart}.ts`; tests
`test/spatial/heatmap/{repair.test.ts (new), live.ts (new), interactive.ts, committed.test.ts, lifecycle.test.ts
(header comment only)}`; one new case in `test/browser/chart/n8a-heatmap.browser.test.ts`; this ledger.
`color-scale.ts`, `core.ts`, `layout.ts`, `render.ts`, `reader.ts`, `index.ts` are unchanged this round.

### 11.1 Blocker 1: the slot and its visibility

Cause (read from `dom/interaction.ts` and `dom/interaction-controls.ts`): `#renderControls` calls `sliceList` only when
`collectControlInputs` changes. For a one-series, non-donut chart those inputs hold neither `ready` nor `tooSmall`;
readiness reaches them only through the INSPECT bit (`reader.table && ready`), which `table: false` removes. The old
legend returned `null` from `sliceList` when not ready or too small, so with `table: false` a chart that became ready
never got its bar, and one that stopped being ready kept it. (Inferred from the same code: `tooSmall` changes never
reached `sliceList` for any one-series chart, table or not.)

Lifecycle now:

- `sliceList` returns one persistent list whenever the state has the legend on, whatever the readiness; it releases
  the list (and everything it painted) only for `legend: false`, for `null` (teardown) and on `destroy()`.
- The wrapper routes this chart's host interaction entry points through the legend (`attachLegend`, installed when the
  wrapper first sees its controller, before the first frame; `controller.host.interaction` is a per-chart object, so
  no shared module changes). After the layer's own `prepare` and `commit`, `legend.arranged(state)` sets the slot's
  visibility from that state: seen exactly when `legend !== false && ready && !tooSmall` and the committed model has
  something to key. `prepare` runs in the controller's `#arrange`, before it measures, and its return value is
  or-ed with "the legend changed what the figure holds", so the controller measures the arrangement it shows. Entering
  and leaving the L8 fallback go through `#arrange` (`#passWrite`), so the fallback's measured share includes the hidden
  bar and cannot flip back (no oscillation; observed in Node: `settle()` returns 0 frames after each resize; Chrome
  check added, not run).
- Hidden means `hidden` plus CSSOM `display: none`. The list's inline `display: flex` would otherwise win over the
  user-agent `[hidden]` rule. The core stylesheet's `.axylo [hidden] { display: none !important }` covers it too,
  but the inline value no longer relies on that. A figure slot that holds nothing else visible (no toolbar) is hidden
  as well, so its margins (and the side slot's grid, `css.ts:299`) take no room. The legend unhides only a slot it hid.
- Placements, enable/disable and fresh rebuilds still go through the layer's cache-miss path (`d.legend` is a cache
  input); the content is painted from the committed model only (11.2).

### 11.2 Blocker 2: one model per commit, shared by page and export

- `prepare(view, formatters, messages)`, called from the lookup stage (inside `#publish`, before any write), formats a
  **candidate** model unless the committed or candidate entry was made from the same three objects (identity).
- `publish(state)`, called just before the layer's `commit` (the controller has assigned `drawn` just before), adopts
  the entry made from exactly the committed `view`/`formatters`/`messages`: the committed one (same-geometry reuse,
  no formatting), else the candidate, else (only when no lookup ran for it, e.g. a compact chart) it formats here.
  It drops the candidate, so a superseded candidate's view is kept at most until the next commit, and no `Drawn` is
  retained. `commit(null)` publishes nothing.
- The page paints only the published model (`#sync`, after the commit; on `prepare` it keeps showing the previous
  commit's texts), so visible ticks and `heatmapInternals(h).legend()` are **the same object**.
- `legend()` returns the published model under the section 9.3 rules (null: `legend: false`, not ready, nothing to key,
  before the first draw, `drawn === null`, destroyed; too small: still the model). It never formats. Inside a formatter
  it returns the previous commit's model; a strict rejection draws nothing and publishes nothing.
- A formatter that destroys the chart while the model is being formatted: `dispose()` bumps an epoch, the result is
  dropped, and `publish` returns without publishing.
- Section 9.3's lazy `committedLegend(drawn)` (formatting on the first export) and the lookup-stage `refresh` are removed.

### 11.3 Tests (expected values from the fixtures: ticks are low / midpoint / high of the data range)

`repair.test.ts` runs on `live.ts`: the real controller drives the real `createFigure` and `createInteraction` as its host's
figure and interaction (DOM double), so prepare/commit and control-cache hits happen as the controller makes them.
The test controls the measured size.

- Blocker 1: loading → ready (slot hidden with `display: none` and its slot hidden; then seen, `display: flex`, ticks =
  export); ready → loading → ready → error → ready with new data; resize to 100 × 60 (below `layout.ts` 120 × 80) and
  back (hidden, export keeps the scale, `settle()` = 0 further frames after each); `legend: false` ↔ top / right /
  bottom / auto with slot class checks; `legend: false` while loading, on again, then ready.
- Blocker 2: a stateful formatter (unit flipped after the commit): export `toBe` the published model, visible ticks
  equal its texts, five reads and reads after loading / resize / legend toggles call the formatter **0** times; a
  formatter reading `legend()` while formatting the new bar's midpoint sees the previous commit's ticks, no
  recursion (depth 1); strict rejections (infinite value, reversed domain) leave the same object and visible ticks; a
  formatter replacing the data while it formats the bar: after every single frame visible ticks equal export, ending
  on the last data; a formatter destroying the chart: export null, no list left.
- Changed assertions in `committed.test.ts` (persistent-slot design, required by this review): two `t.legend()`
  null checks for a not-ready chart became `t.shownLegend()` null ("not seen": the list or an ancestor `hidden` or
  `display: none`); one positive check was added (seen with the No data swatch once ready).
- Mutations (observed, each reverted, 81 tests): (a) `attachLegend` installs nothing → 19 fail (8 of
  `repair.test.ts` and 11 existing bar/export tests in `committed`/`lifecycle`; the destroy case still passes);
  (b) `arranged` ignores the state → 5 fail (the four blocker-1 cases and the stateful case); (c) `exported()`
  formats a fresh model → 4 fail (stateful, reentrant, strict, and the existing "never leak into export" test);
  (d) no CSSOM `display` write → 1 fails (loading → ready).
- Chrome (added to `n8a-heatmap.browser.test.ts`, **not run here**): a `table: false` chart in a 640 × 420 box:
  initially loading → ready → loading → ready, resize to 150 × 110 and back, `legend: false` → right → top; each
  step asserts visual visibility (`getClientRects`, computed `display`, `offsetHeight`), visible ticks = export, and
  **0 mutations in the chart over 10 further frames** (no resize/fallback oscillation). Assumption to confirm in that
  run: 150 × 110 is below the plot minimum with the title in real fonts (inferred, not measured).

### 11.4 Verification (observed, Node v24.21.0, Vitest 5.1.0, this workspace, 2026-11-27)

```
npx vitest run --configLoader native --no-cache packages/axylo/test/spatial/heatmap
 Test Files  8 passed (8)
      Tests  81 passed (81)
npm run typecheck   → exit 0, no errors (library + tests, docs/api, tests/dist)
npx vitest run --configLoader native --no-cache --silent=false packages/axylo/test/spatial/heatmap/svg.test.ts packages/axylo/test/spatial/heatmap/purity.test.ts
 [n8a-ledger] heatmap entry …: raw 276898 B, gzip 97805 B; bare import with ignoreAnnotations: 0 B
 [n8a-ledger] index.ts …: raw 435440 B, gzip 159109 B, spatial inputs 0
 [n8a-ledger] static.ts …: raw 385385 B, gzip 141919 B, spatial inputs 0
 [n8a-ledger] dense fixture (250x200, …), 900x640: 34 marks, 34 paths (32 bins + missing + invalid), 41 SVG nodes, 41 created
 [n8a-ledger] 250x200 typed, 900x640, stages+draw ms: median 8.7 min 6.7 max 12.0; path d bytes 346596
```

Not run in this turn (by instruction): Chrome (whole `n8a-heatmap.browser.test.ts`, including the new case), the
whole Node suite, `npm run build`, the production root/static bundle comparison of section 10.3 (the in-memory
root/static figures are unchanged and spatial inputs stay 0, so 10.3's 0 B result is expected to hold; inferred).

## 12. Review repair: sol-6.2-medium__20261127T174530Z (2026-11-27)

Both findings reproduce on the shared controller/interaction commit order (live.ts drives the real `createFigure`
and `createInteraction`) and are fixed inside `spatial/heatmap/legend.ts` only. No frozen file and no fence path
was edited; no shared contract change is needed.

### 12.1 Fixed-size fallback: a stable legend reservation

Cause (core/controller.ts, read, not edited): entering L8 stores `#fallback = measured-in-fallback − normal` and
`#layoutForSize` subtracts it until the fallback is left. The bar used to be `display: none` when too small, so its
40 px became part of that delta; turning the legend off then changed nothing measurable, the stale 40 px was still
subtracted, and the chart stayed in the fallback where a fresh `legend: false` chart drew a plot.

Fix: the bar's **room** and its **sight** are decided apart. Room is kept whenever the legend is on and the chart
is ready, too small included; too small it is `visibility: hidden` plus `aria-hidden="true"` (hidden to readers and
to sight, not laid out away). The fallback's delta is then only its own DOM, so turning the legend off or moving it
while in the fallback converges to a fresh chart's geometry at the same host size, and nothing oscillates (the
reservation does not depend on the fallback decision). Cost: in the fallback the bar's (blank) room stays, so the
summary/table have that much less height than before; they are otherwise unchanged (inferred; Chrome to confirm).

### 12.2 One observable change per commit

Cause: `attachLegend`'s commit published the model (export) before `DomInteraction.commit`, but the list was only
repainted by `arranged` after it; the interaction layer's commit formats the focused cell (`#writeProxy`) and the
tooltip in between, so a formatter could read new export ticks beside old painted ones.

Fix: `publish` paints the committed model in the same synchronous step that exports it (no author code runs between
the two: the labels were formatted in the lookup stage, or by `publish`'s fallback *before* either is changed).
A list is **seen** only when it shows exactly the published model (`#exported === painted`), so a list mounted by
arrange (legend off → on), before its commit publishes, keeps its measured room but stays unseen. Unmount (legend
off) removes the list at arrange, while export keeps the previous commit until publish (see 12.4). A disposed
legend (a formatter destroyed the chart mid-commit) ignores later `publish`, `arranged` and slot calls.

### 12.3 Tests (new `test/spatial/heatmap/commit-order.test.ts`; live.ts gained an opt-in geometry-aware measure)

- Geometry: a laid-out list takes 40 px of height (top/bottom slot) or 200 px of width (side slot). layout.ts needs
  140 px of host height for the 80 px plot minimum (observed by a throwaway probe, then removed; not an expected
  value of any assertion). With `room` the harness re-measures once after the first frame, as a page's
  ResizeObserver does once the first painted bar shrinks the plot.
- Fresh reference at 720 × 150 (bottom → too small; `false` → plot 720 × 150); bottom → `false` in the fallback →
  plot 720 × 150, frames settle, back on → fallback; bottom → right → same as a fresh right chart (520 × 150, ticks
  0/4/8); every (first, last) of {false, bottom, top, right} at heights 130/150/170/190 equals a fresh chart with
  `last` and then settles at 0 frames.
- Commit order: a focused cell whose value formatter runs inside `DomInteraction.commit` sees painted ticks = export;
  any formatter call over data, mount, unmount, placement and fallback changes never sees a seen bar other than
  export; a formatter that destroys the chart inside commit leaves no list and no export.
- Mutations (observed, each reverted): room excluding too-small (the old rule) → the 3 fixed-size transition tests
  fail; `publish` without the paint plus "seen" ignoring the published model → the 2 commit-order tests fail.
- Changed existing assertions (requirement change, not weakening): repair.test 'resized below the plot minimum'
  checked `list.hidden` in the fallback; it now checks `aria-hidden="true"` (it still checks `shown()` null), and
  live.ts `shown()` also treats `visibility: hidden`/`aria-hidden` as unseen. In the Chrome file, the existing
  `table: false` case's `seen` also requires computed visibility not hidden and no `aria-hidden` ancestor.
- Chrome (added to `n8a-heatmap.browser.test.ts`, **not run here**): 640 px wide hosts at 130–230 px high; for
  bottom→false, bottom→right, top→false, false→bottom, the changed chart's plot clip size and seen state equal a fresh
  chart's with the last legend, 0 mutations over 10 frames, and at least one height leaves the fallback.

### 12.4 Not done / assumptions

- Unmount: between arrange and publish the removed list cannot be seen while export still returns the previous
  commit's model ("preserve previous-commit reads"); the invariant held is "a seen bar is export's".
- First frame: arrange runs before any model is committed, so a fresh chart's first measure has no bar room; the
  ResizeObserver remeasure that follows corrects it (pre-existing; unchanged).

### 12.5 Verification (observed, Node v24.21.0, Vitest 5.1.0, this workspace, 2026-11-27)

```
npx vitest run --configLoader native --no-cache packages/axylo/test/spatial/heatmap
 Test Files  9 passed (9)
      Tests  88 passed (88)
npx vitest run --configLoader native --no-cache packages/axylo
 Test Files  134 passed (134)
      Tests  2129 passed (2129)
npm run typecheck   → no errors (library + tests, docs/api, tests/dist)
```

The package-scoped count (134 / 2,129) is narrower than the Director's whole-repo run, so it is not comparable
with the 138 / 2,370 below. Latest **already observed** legacy evidence is the *previous* candidate's
(Director log turn 9): 138 Node files / 2,370 tests, 11 Chrome tests, 50,000 cells: 29.3 ms create-to-two-frames,
39 SVG nodes, 32 paths, 376,301 path-data bytes. Those figures belong to that revision; nothing in Chrome has been
run for this repair (12 Chrome tests now, one new).

## 13. Director Chrome failure, turn 12 (2026-11-27)

### 13.1 Observed (Director log `verify/turn-12-opus-5.5-medium__20261127T174916Z.log`)

Measured revision: candidate run `opus-5.5-medium__20261127T174916Z` (patch sha256
`3869bb640f77f3a00a9320f771d9956523fdbcf3ce57da2631a0739cbaf55917`), Director verify tree `verify-wvw51hav`.

- Typecheck passed; Node: 139 files / 2,377 tests passed.
- Chrome: 12 tests, 11 passed, 1 failed (exit 1): "at a fixed host size, turning the legend off or moving it from the
  fallback …" failed at `expect(exercised).toBeGreaterThan(0)` (0 > 0). Every per-case equality with a fresh chart
  and every 0-mutation check before it passed.
- Dense (observed in that run): Chrome, 250 × 200 typed, 900 × 640 host: **33.6 ms create→2 frames, 39 SVG nodes,
  32 paths, 376,301 `d` bytes**. These supersede the turn-9 figures (29.3 ms, same node/path/byte counts) as the
  latest observed, for the revision above only.

### 13.2 Cause (from source, a test flaw)

The test counted "the moved chart had no plot before the change" as `clipPath rect` being absent. `render/svg.ts`
creates the scene clip and its rect in the renderer's constructor, before any scene, and keeps it (it may stay
0 × 0) through the L8 fallback, so `before.plot === null` could never hold and the counter stayed 0 whatever the
chart did. No library code changed in this repair.

### 13.3 Change (test only, `packages/axylo/test/browser/chart/n8a-heatmap.browser.test.ts`)

- A shot now records `fallback` (the `.axylo-summary` sentence shown, i.e. not `axylo-visually-hidden` and nonempty,
  the L8 state of `dom/figure.ts`) and `plot` = `{ width, height, bins }` only when not in the fallback, the clip has
  a positive size and the scene has ≥ 1 `path.axylo-heatmap-bin` with a nonempty `d`.
- Per case: before and after each satisfy exactly one of fallback / drawn plot; before and after both settle at 0
  mutations over 10 frames (no oscillation); after equals a fresh chart with the final legend (fallback, plot size,
  bin count, seen).
- Across cases: ≥ 1 case turns the legend off from the fallback, ≥ 1 moves or adds it from the fallback, and ≥ 1
  leaves the fallback for a drawn plot. All four transitions kept; heights now 110–230 px (110 added so the
  no-legend → bottom case also starts in the fallback). Failure messages list every case's before / after / fresh.
- Not run in Chrome here (expected to pass, not observed). Whether 110–230 px yields both fallback counters > 0 is
  inferred from the layout minimums (plot ≥ 80 px high plus axis rows and title), not measured.
