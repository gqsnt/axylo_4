# N7a — `axylo/finance` split price/volume panes: ledger

Author lane (Claude, `ts_builder` role) inside the isolated Prism workspace. This ledger records what was built,
the decisions taken where the brief or spec left room, the commands run and their last lines, and what is still
open. **Ran and saw** and **expected / not run** are kept apart. Nothing was committed (the coordinator commits).

## Ownership fence

Files created or changed. A `find -newermt` over the workspace (excluding `node_modules`, `.prism-cache`,
`packages/axylo/dist`) lists only these:

| File | Change |
|---|---|
| `packages/axylo/src/finance.ts` | Entry point now delegates to `finance/chart.ts`; public exports and types unchanged (only the doc comment in `dist/finance.d.ts` differs). |
| `packages/axylo/src/finance/core.ts` | New price domain rules (`explicitPriceDomain`, `fitPriceDomain`, `NEUTRAL_PRICE_DOMAIN`); the `-36%` stretch is gone; `yAxis.label` / `volumeAxis.label` added to `FinanceMeta`. |
| `packages/axylo/src/finance/layout.ts` (new) | `financeLayout`: the pure split-pane layout stage, volume scale, volume ticks and title, layout key, AX160 for the volume formatter. |
| `packages/axylo/src/finance/aggregate.ts` (new) | `aggregateOhlcv`: pixel-bin OHLCV aggregation in typed arrays, bounded by plot width. |
| `packages/axylo/src/finance/render.ts` | Scene with per-pane geometry, clipping, dense bins, divider and volume axis; SVG handlers for pane clip paths and semantic paints. Lookup, overlay and reader are unchanged apart from imports. |
| `packages/axylo/src/finance/chart.ts` (new) | The composition and the strict-rollback wrapper, moved out of `finance.ts` so a Node test can open the same composition on a recording host. |
| `packages/axylo/test/finance/c6-3-finance.test.ts` | Uses `financeLayout` instead of `alignedLayout()`. No expected value was changed. |
| `packages/axylo/test/finance/n7a-panes.test.ts` (new) | 25 unit, property and controller tests (see below). |
| `packages/axylo/test/finance/host.ts` (new) | Hardening round: replaced the 207-line copy of `test/core/host.ts` with a ~70-line purpose-built host (frame queue, recorded draws and commits) that still drives the real `controllerFor`. |
| `packages/axylo/test/finance/fixtures.ts` (new, hardening) | The fixture rows, `stage()` over the pure stages, geometry readers and the minimal fake SVG document, shared by both N7a test files (moved out of `n7a-panes.test.ts`). |
| `packages/axylo/test/finance/n7a-hardening.test.ts` (new, hardening) | 13 tests for the hardening findings (see "Hardening round"), including a Node mirror of the Chrome suite's `#flagged` fixture through the real controller. |
| `packages/axylo/test/finance/n7a-ax199.test.ts` (new, Repair 6) | 9 real-controller regressions for the two AX199 blockers (see "Repair 6"). |
| `packages/axylo/test/finance/n7a-preview-boundary.test.ts` (new, Repair 7) | 8 `staticControllerFor` recording-host regressions for the preview-order blocker and the data holder (see "Repair 7"). |
| `packages/axylo/test/finance/host.ts`, `n7a-resets.test.ts`, `n7a-review3.test.ts` (Repair 7) | `resolvedTable()` helper; two borrowed-identity assertions moved from the controller patch to the resolver boundary (see "Repair 7"). |
| `tests/dist/finance.browser.test.ts` | Rewritten as a real-Chrome suite under the packed strict-CSP harness (**not run here**). |
| `docs/progress/n7a-finance-panes-ledger.md` | This file. |

No edits to `public.ts`, `core/**`, `theme/**`, `dom/**`, `cartesian/**`, `layout/**`, `render/**`, `apps/docs/**`,
build configuration or any other module. Shared modules are imported read-only: `core/axes`
(`layoutInput`, `alignedLayout`), `layout` (`computeLayout`), `layout/labels` (`placeText`, `wrapText`),
`render/svg` (`svgPath`, `svgRects`, `svgRule`, `svgBand`, types), `dom/attributes` (`svgElement`),
`scale/linear`, `format`, `diagnostics/registry`, `reader/table`.

## What was built

### 1. Split-pane layout (`finance/layout.ts`)

- The shared Cartesian layout is asked for a plot that is the **price pane only**: container height minus the
  volume block, container width minus the right-hand volume lane. Ticks and margins are fitted to that pane,
  so price tick density matches the price pane's real height.
- Split of the full plot height `P`: gap = `max(6, round(0.05·P))`, volume = `round(0.23·P)`, price = the rest
  (about 72%). The x tick labels and the x title are moved down by the volume block, so the **shared x axis
  sits below both panes**.
- `layout.plot` covers **both panes**, and so does the x projection. Pointer lookup, the cursor rule (the overlay
  is clipped to `layout.plot`) and zoom work from either pane. `projection.y` is the **price pane's** scale.
- The volume pane has its **own linear scale** `[0, volumeMax]` mapped onto its own height. It has 2–3 nice
  ticks (the densest `linearTickCandidates` set of at most three whose labels are at least one line + 2 px
  apart), placed in a lane on the **right**, so volume and price labels never share a column. The volume title
  is `volumeAxis.label` (falling back to the volume field's label) plus `volumeAxis.unit`, rotated −90°,
  centered on the volume pane and moved only as far as it must to stay beside the plot. Volume tick labels use
  `volumeAxis.format` (Intl options or a function). A throwing formatter falls back to the default and raises
  **AX160** (`presentation`) for the volume field, through `layoutDiagnostics`.
- The price axis title is `yAxis.label` (else the generic value title) plus `yAxis.unit`. It comes from a derived
  "price view" with the volume series removed, so the shared title logic keeps the price unit and the shared
  value extent ignores volume. The derived view is memoized per view, so the shared axis memo (and its AX160
  tracking for `yAxis.tickFormat`) is the same object in `prepareTicks`, `compute` and `layoutDiagnostics`.
- The shared layout's coarser-domain fallback is turned off for the price axis, so the projection domain is
  exactly the view's `yDomain`.
- **No volume, or volume hidden:** the price pane is the whole plot. **Short plot:** if the price pane would be
  under the shared 80 px minimum, the volume pane shrinks. If the volume pane would then be under 24 px, it is
  not drawn and the price pane takes the plot (see decisions).
- **Layout key:** the shared key over the price view, plus volume shown/hidden, frame identity, slot flags,
  visible slot range, `yAxis.label`, `volumeAxis.label`, the volume field label, unit and format.
- **Compact charts:** the panes are split the same way, with no text.

### 2. Price domain (`finance/core.ts`)

- An **explicit `yAxis.domain`** with two finite, distinct ends is used exactly (sorted). Its ends are never
  stretched, on any zoom.
- The **automatic domain** comes from the lows and highs of visible, drawable candles (not AX180, not
  incomplete) and the y references, padded by 8% of the span on each side. If the prices are non-negative, the
  lower end stops at 0. A single-value span is padded by 5% of its magnitude (or 1).
- If nothing is drawable (all invalid, or a zoom into a gap), the domain is the finite neutral `[0, 1]`.

### 3. Clipping and paints (`finance/render.ts`)

- **Geometry is cut to each pane in the scene itself:**
  - Wicks and doji bars are cut at the price pane edges.
  - Down bodies are intersected with the price pane.
  - Hollow up outlines are rebuilt as open outlines when an edge falls outside the pane.
  - y reference lines outside the price pane are not drawn; y bands are clamped to it.
  - x references and bands span both panes.
  - Volume bars are bounded by the volume pane.
- **SVG clip paths per pane:** each data mark is tagged (finance-local `WeakMap<Mark, PaneTag>`). The finance
  SVG handlers wrap `svgPath` / `svgRects` and point the element's `clip-path` at a finance-owned
  `<clipPath>` in `SvgContext.defs` (one for price, one for volume, updated in place). This also clips the
  overflow of strokes. The renderer's attribute cache is left alone, so a reused node goes back to the
  renderer's clip. `rule` and `band` keep the shared handlers, so grid and tick rules are still batched. This
  works under strict CSP: attributes and CSSOM only.
- **Paints:**
  - up: `var(--axylo-forced-series, var(--axylo-up, <series slot 1>))`
  - down: `var(--axylo-forced-series, var(--axylo-down, <slot 2>))`
  - volume: `var(--axylo-forced-series, var(--axylo-volume, <slot 3>))`

  The fallbacks are the chart's themed palette slots, which AX141 contrast-checks. Under forced colors the
  shipped stylesheet defines `--axylo-forced-series: CanvasText !important`, so system colors win over author
  colors. Direction is never shown by color alone: up is hollow (stroked path, `fill: none`), down is filled,
  unchanged is a horizontal tick. Wicks use the axis token.
- A hairline divider (grid rule) sits in the middle of the gap. The volume pane has its own right-hand axis line,
  tick marks and gridlines (no gridline at 0). The price axis line and price gridlines stay inside the price
  pane.

### 4. Dense aggregation (`finance/aggregate.ts`)

- A view aggregates when its visible slot count is above `max(plot.width / 2, 200)`. Slots are grouped by
  projected CSS-pixel column of `BIN_WIDTH = 2` px. This is one pass over the visible slots, which are sorted by
  x, so each bin is a contiguous run.
- Storage is `Float64Array` / `Uint32Array` / `Int32Array` of `ceil(plot.width / 2)` entries, never sized by row
  count.
- Each bin keeps the first open, maximum high, minimum low, last close, the number of drawable candles, and the
  sum of drawable volume (NaN when it has none).
- A slot projected on or past the right edge joins the last column, so no out-of-range bin is created.
- Bins are computed in the layout, with its final x projection, and carried on the layout, so the scene and the
  volume ticks use the same bins.
- Mark count is at most one down body and one volume bar per column, i.e. at most `plot.width + 2` SVG rects.
- Tooltip, keyboard reading, `aria-valuetext`, table and summary still read raw slots, so zooming back in or
  reading any row is exact.

### 5. Readouts, AX180 / AX181 and strict rollback

- Lookup, tooltip, table and reader code is unchanged. The existing `(invalid OHLC)` / `(invalid volume)`
  qualifiers and the omission behaviour are kept: a volume bar is drawn only for a drawable candle with a
  finite, non-negative volume. This matches the existing C6.3 test's expected bar count.
- `openFinanceChart` keeps the existing rollback: on a throwing `inner.update`, the previous raw options, meta
  and pending AX180 issues are restored. Because layout, scene, lookup and reader all read `stateRef.meta`,
  both panes go back to the committed state. This is now exercised end to end through the real controller.

## Decisions where the brief or spec left room (for review)

1. **F7 tick-ended domains vs. padded price bounds.** Spec F7 has automatic value domains end on the first tick
   at or beyond each extreme. The brief asks for "clean top/bottom padding". I kept the 8% padding (as C6.3
   had) and turned off the shared coarser-domain fallback, so the domain is exactly what the view says. The
   price ticks are the nice ticks inside it. If the owner prefers F7 tick-ended price domains, that is a change
   in `fitPriceDomain` plus re-enabling `coarser`.
2. **Dense `volumeMax` is the largest bin sum**, not the largest single volume. Summed bars then keep heights
   proportional to each other, and the tallest summed bar fills the pane. Volume ticks are labelled in summed
   units for that view. Zoomed in (not dense), `volumeMax` is the largest single drawable volume.
3. **Degenerate zero-volume axis.** When no drawable volume is positive (all zero, all missing, all invalid), the
   volume scale is nominally `[0, 1]`. Its only tick is `0` at the baseline, and no bars are drawn. Zero and
   missing volumes never get a baseline stub; positive bars are exactly proportional, with no minimum height.
4. **Volume axis on the right.** Putting it on the left would share the price label column, and label widths
   could not be guaranteed. The right lane is sized from the measured volume labels and title (up to 4 layout
   passes, because dense bin sums depend on the plot width).
5. **Too short for two panes.** When the volume pane would be under 24 px after giving price its 80 px minimum,
   the volume pane is dropped and the price pane takes the plot. Volume stays in the tooltip, table and
   summary. No diagnostic is raised: no code in spec 3.5 fits (AX142 means "no plot at all"). Flagged for the
   owner.
6. **Bin width 2 CSS px** (not 1). It matches the `plot.width / 2` threshold and leaves a visible 1.5 px body.
   Dense bodies are `0.75 × BIN_WIDTH` wide.
7. **Volume tick formatter runs in layout.** A function `volumeAxis.format` is called while volume ticks are
   labelled (inside `compute`), as `yAxis.tickFormat` is for the price ticks in `prepareTicks`. Its failures
   are reported as AX160 from `layoutDiagnostics`.
8. **Paint fallbacks are the palette slots** (series 1/2/3), not fixed green/red. They are themed,
   contrast-checked and colorblind-safe with the shape encoding.

## Hardening round (repair lane, after the first cross-provider findings)

Each finding was first confirmed in the source, then fixed inside the fence. Nothing outside
`packages/axylo/src/finance*`, `packages/axylo/test/finance*`, `tests/dist/finance*` and this ledger was
touched (`find -newermt` over the workspace, excluding `node_modules`, `.prism-cache` and the generated
`packages/axylo/dist`, lists only those files).

1. **References were not owned by the price pane (confirmed).** `buildFinanceScene` drew x references from the
   plot top to the plot bottom (across the volume pane), and y lines and bands as untagged `rule` / `band`
   marks with only the whole-plot clip, so a stroke on the pane edge bled into the gap.
   Now every reference is projected with the shared `projectReference` onto the **price pane**. That is the same
   call and rect `layout/references.ts` uses for the labels, which are placed on the price-pane layout, so marks
   and labels agree. A line outside the domain returns null and is not drawn: it is not pinned to an edge.
   Lines are dashed `path` marks (normal and contrast dash `[4, 3]`, width 1.5), bands are `band` marks, and
   both are tagged with the price pane. A new `financeBand` handler and the existing `financePath` set the
   price pane's SVG `clipPath` on them, so the stroke of a line on a pane boundary is clipped too.
   The `rule` handler stays the shared `svgRule` on purpose. The renderer batches grid and tick rules only when
   `marks.rule === svgRule`; wrapping it would turn every tick into its own `<line>`. The full-height cursor is
   an overlay rule with the plot clip and is unchanged.
2. **Packed Chrome test (unrun) compared raw SVG boxes with pane bounds (confirmed).** A CSS clip does not
   shrink `getBoundingClientRect`, and first and last bodies are centered on the pane sides.
   Now the test checks four things for every mark:
   - its vertical extent against its pane (the scene cuts geometry vertically);
   - its horizontal extent against the pane widened by at most half the widest body (12 px);
   - that its `clip-path` resolves to a `clipPath` rect equal to the pane;
   - that the painted part (the box cut to its clip) is non-empty and inside the pane.

   Added to the test:
   - **Out-of-domain candle:** `#fixed` now has a candle wholly above `[100, 120]` (130/131/125/126). No price
     mark leaves the pane, all 21 volume bars are drawn, and the table row keeps `130 / 131 / 125 / 126`.
   - **`#flagged` fixture** with one AX180 row and one AX181 row:
     - diagnostics `{AX180, count 1, rows [1]}` and `{AX181, count 1, rows [3]}`;
     - the summary (figure `aria-describedby`) contains "Values not shown";
     - the qualifiers `(invalid OHLC)` / `(invalid volume)` appear in keyboard `aria-valuetext`, the pointer
       tooltip and the table;
     - 4 volume bars and 2 down bodies;
     - no wick or body vertex at the AX180 x (located by the keyboard cursor rule), a wick at the AX181 x, and no
       volume bar at either x.
   - **Volume off and on** through the public `update({ volume: undefined })` / `update({ volume: 'vol' })`:
     the price clip grows by more than 1.25× and reaches the old volume bottom (±2 px), only `Price (USD)`
     remains as a title, and both panes come back exactly.
   - **Rollback evidence** now waits two animation frames instead of `waitForTimeout(100)`.
   - Below-the-fold charts are scrolled into view before pointer coordinates are measured.
   - The DOM-independent half of the `#flagged` expectations ran in Node through the real controller
     (`n7a-hardening.test.ts`, last test): diagnostics, the summary sentence, the tooltip and table cells, and the
     bar and body counts all matched. The Chrome-only half (selectors, events, painted boxes) has not run.

   Selectors, controls and events were checked against the source:
   - `axylo-${name}` slots in `dom/figure.ts`;
   - `aria-valuetext` from `core/focus.ts#valueText` with "Point {index} of {count}";
   - `+` / `=` zoom in `dom/interaction.ts`;
   - the first ArrowRight from focus steps to the first point (`lookup.step(null)`);
   - "View as table" / "Hide table" / "Reset zoom" in `messages`;
   - `M x y` path data in `render/svg.ts#pathData`;
   - public diagnostics drop `effect` (`toPublic`), so the test does not read it.
3. **Finite-number edges (confirmed).**
   - **Price padding:** `fitPriceDomain` computed `(hi - lo) * 0.08`, which is infinite for `[-1e308, 1e308]`,
     and `hi + pad` overflowed near `Number.MAX_VALUE`. The padding is now `hi*0.08 - lo*0.08`, the ends are
     held at `±Number.MAX_VALUE`, and non-finite extremes fall back to the neutral domain. The linear scale and
     tick generator were already overflow-safe for such spans.
   - **Volume sums:** `aggregateOhlcv` summed finite volumes to `Infinity`. A bin sum that overflows is now held
     at `Number.MAX_VALUE` and counted in `bins.saturated`. `layoutDiagnostics` reports it as **AX181,
     effect `changed`, origin `presentation`**, with a message saying those bars are drawn at the top of the
     axis and the table keeps exact values. Ordinary sums are unchanged (the existing property test), and raw
     readouts never used the bins.
   - **Volume lane:** the fourth pass accepted a wider measured lane without reserving it, and an oversized lane
     could make the next shared layout too small, dropping the whole chart. The lane now only grows, is capped
     at 25% of the width, and is never taken if it leaves no plot. Labels the settled lane cannot hold are fitted:
     - tick labels are middle-truncated (kept distinct), or hidden;
     - the title is dropped when it no longer fits beside the ticks;
     - every hidden label is counted into `layout.fit.y.hidden`, which drives the L1 note and AX143.
   - **Volume unit:** still in the axis title (`withUnit`, the shared price-axis convention). Tests show that
     `volumeAxis.format`, `unit` and `label` reach the tick labels, the title `Traded (shares)`, the tooltip and
     the table (`4.2k shares`, `-0.1k shares (invalid volume)`).
4. **Overbuilt structure.** The copied host is replaced by a ~70-line purpose-built one that still uses the real
   controller (both strict-rollback tests and the new hide/show test run through it). Shared staging moved to
   `fixtures.ts` instead of being copied into the new test file.

Assumption to review: reusing **AX181** (the finance volume code) for saturated dense sums, with effect
`changed`. The spec's section 3.5 has no code for "a sum is not representable". AX181 already means "this
volume cannot be drawn as given".

### Hardening evidence — ran and saw

```
$ npx vitest run packages/axylo/test/finance --configLoader native --no-cache
 Test Files  3 passed (3)
      Tests  39 passed (39)

$ npm run typecheck
> tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist
(no errors)

$ npm run build
built axylo.css, axylo.dev.js, …, finance.d.ts, finance.dev.js, finance.js, …
```

Initial-snapshot gzip-9 comparison. Baselines were copied read-only into `.prism-cache/tmp/n7a-size` and built
with the same `scripts/build.mjs`:

- `c6`: sibling `runs/work/opus-5-72140a`, the pre-N7a finance;
- `sealed`: sibling `runs/work/opus-5-61a3d4`, the sealed N7a candidate this round started from. Its finance
  line counts and the 207-line host match it, and its non-finance `src` is byte-identical (`diff -rq` → 0).

```
file               c6 raw/gz9        sealed raw/gz9    now raw/gz9
axylo.js           433932/157863     433932/157863     433932/157863   (cmp: identical to both)
axylo.iife.min.js  434424/158092     434424/158092     434424/158092   (identical)
static.js          383877/140779     383877/140779     383877/140779   (identical)
cartesian.js       350086/124353     350086/124353     350086/124353   (identical)
finance.js         330639/118536     340454/121920     341583/122539   (+619 B gz9 vs sealed)
```

`stream.js`, `stats.js`, `sync.js` and `export.js` are also `cmp`-identical. **Legacy root tax: 0 B.**

A local esbuild consumer bundle of `export { candlestick } from '<dist>/finance.js'` (minified ESM) is
121,624 B gz9 for sealed and 122,206 B gz9 now, under the 127,000 B cap in `tests/dist/subpaths.test.ts`. This
is a local estimate, not the packed fixture.

### Still for the Coordinator (not run in this lane)

- `tests/dist/finance.browser.test.ts` in real Chrome. It is type-checked only and has never been executed:
  `npm run build && AXYLO_BROWSER=1 npx vitest run --config tests/dist/vitest.config.ts tests/dist/finance.browser.test.ts`.
  First-run risks:
  - the tooltip or readout locator for `#flagged`;
  - the `±2 px` plot-bottom tolerance after hiding volume;
  - the summary being reachable through the figure's `aria-describedby`.
- `npm run size` and the packed `tests/dist/subpaths.test.ts` cap.
- Full `npm test` (only `packages/axylo/test/finance` was run).
- A fresh independent cross-provider review of this exact candidate.

## Evidence — ran and saw (first authoring round; superseded counts above)

All commands ran from the workspace root.

```
$ npm run typecheck
> tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist
(exit 0, no output)

$ npx vitest run packages/axylo/test/finance --configLoader native --no-cache
 Test Files  2 passed (2)
      Tests  26 passed (26)

$ npm run build
built axylo.css, axylo.dev.js, axylo.iife.js, axylo.iife.min.js, axylo.js, cartesian.d.ts, …, finance.d.ts, finance.dev.js, finance.js, …
```

The 26 Node tests: 1 existing C6.3 test plus 25 N7a tests in `n7a-panes.test.ts`. They cover:

- the automatic domain from fixture values: `[96.88, 113.12]` from lows 98 / highs 112 with 8% padding;
- an explicit `[100, 120]` that stays exact, both directly and on a zoomed view;
- the non-negative floor (`[0, 107.96]`);
- the neutral domain for all-invalid data and for a zoom into a gap;
- y references in the fit (`[95.44, 132.56]`);
- the ~72/5/23 split, disjoint panes, the divider and x ticks below the volume pane;
- the volume scale `[0, 5000]`, ticks `0 / 2,000 / 4,000`, and bar heights `1 / 0.84 / 0.62` of the pane;
- `yAxis.label` and `volumeAxis.label` with units, and no text overlap;
- `volumeAxis.format` (`0 / 2M / 4M`) and AX160 for a throwing formatter;
- no volume, hidden volume and a short plot;
- zero, missing and partial volume;
- volume tick thinning;
- layout-key invalidation for visibility, zoom, volume extent, both labels and the format;
- clipping at an explicit `[101, 106]` (a body cut exactly at 106 → 102; a reference outside the pane dropped);
- the real SVG renderer with the finance handlers on a minimal fake document (pane `clipPath` rects equal the
  panes, `clip-path` on up / down / wick / volume, the paint expressions, hollow vs filled, stable across two
  draws);
- a fast-check property over random OHLCV input for the aggregation invariants (first open, max high, min low,
  last close, summed volume, contiguous bins, full coverage, centers inside the plot, bin count ≤ columns,
  right edge exactly on the plot edge), 150 runs;
- 10,000 candles: bin count ≤ `ceil(plot.width / 2)`, rects ≤ 2 × columns, `volumeMax` = the largest bin sum,
  the tallest bar = the pane height, sampled bin sums equal raw sums; a 40-candle zoom back gives no bins, 40
  bars and exact raw tooltip values;
- picking from both panes and exact tooltip qualifiers for AX180 / AX181 rows;
- the overlay cursor from the plot top to the volume pane bottom;
- strict rollback through the real controller (`controllerFor` + recording host): a rejected
  `{ strict: true, open: 'c', … }` leaves pane rects, volume ticks, diagnostics (`AX180`, `AX181`), mark
  geometry and tooltip identical, and the next valid update applies its labels on top of the committed state;
- an explicit domain through controller zoom and reset;
- a fast-check property over container sizes 240–1920 × 160–900, with and without labels: panes disjoint and
  ordered, pane minimums held, every text box inside the container, no two text boxes overlapping. 80 runs.

**Legacy root bundle tax: 0 B.** The baseline is sibling workspace `runs/work/hydrog-1b450b`, whose
`packages/axylo/src` outside `finance*` is byte-identical to this workspace's (`diff -rq` → 0 lines) and whose
finance files match four other untouched workspaces. I copied it read-only into
`.prism-cache/tmp/n7a-base` and built it with the same `scripts/build.mjs`. Byte counts are `wc -c` and
`gzip -9c | wc -c`:

```
file                   base_raw   cand_raw  base_gz9  cand_gz9   d_gz9
axylo.js                 433932     433932    157863    157863       0 identical
axylo.iife.min.js        434424     434424    158092    158092       0 identical
axylo.iife.js            964307     964307    237903    237903       0 identical
static.js                383877     383877    140779    140779       0 identical
cartesian.js             350086     350086    124353    124353       0 identical
stream.js                433932     433932    157865    157865       0 identical
sync.js                    3785       3785      1588      1588       0 identical
stats.js                   3561       3561      1515      1515       0 identical
export.js                  7944       7944      3295      3295       0 identical
finance.js               330639     340454    118536    121920    3384 differs
axylo.css                 16001      16001      3280      3280       0 identical
index.d.ts / public.d.ts / static.d.ts: identical; finance.d.ts: doc comment only
```

Other checks:

- A local esbuild consumer bundle of `export { candlestick } from './packages/axylo/dist/finance.js'`
  (minified, ESM) is 121,898 B gzip-9, under the 127,000 B cap in `tests/dist/subpaths.test.ts`. This is local
  dist, not the packed fixture.
- `dist/finance.js` contains neither `adoptNormalized` nor `StreamSession`, as in the baseline.
- `package.json#files` lists explicit dist files, so the new `dist/finance/*.d.ts` declarations are not packed.

## Not run here — for the Coordinator / Director

- **Chrome suite (`tests/dist/finance.browser.test.ts`): written and type-checked, never executed.** Browser runs
  were not allowed in this lane. The suite asserts:
  - pane clip rects disjoint and price above volume;
  - candle / volume bounding boxes inside their panes, and `clip-path` URLs on the marks;
  - price ticks only beside the price pane, all positive;
  - 2–3 volume ticks beside the volume pane;
  - titles `Price (USD)` / `Shares` inside the SVG, and no overlapping text boxes;
  - `[100, 120]` end ticks exactly 100 and 120;
  - live `--axylo-up` / `--axylo-down` / `--axylo-volume`, with the up path having `fill: none`;
  - hover from the volume pane and the price pane with exact OHLC + volume text;
  - the cursor line spanning both panes;
  - ArrowRight ×3 on `.axylo-proxy`, with `aria-valuetext` values matching the row named by "Point n of 60";
  - `+` zoom then **Reset zoom**;
  - table headers and rows equal to the fixture (50-row page), then **Hide table**;
  - axe-core with zero violations, axe evaluated through `page.evaluate` (DevTools protocol) because strict CSP
    blocks an inline script tag;
  - strict rollback leaving panes, bars, titles and diagnostics equal, then a valid update applying;
  - 5,000 candles with `< 1,500` SVG rects and `< 2,000` SVG nodes;
  - no page errors, no CSP reports, and teardown removing the SVGs.

  Scoped command (from `package.json` `test:dist:browser` and `tests/dist/vitest.config.ts`; its global setup
  packs `dist` into `tests/dist/fixtures`, so build first):

  ```
  npm run build && AXYLO_BROWSER=1 npx vitest run --config tests/dist/vitest.config.ts tests/dist/finance.browser.test.ts
  ```

  Points that may need adjusting on the first real run (assumptions I could not observe):
  - the proxy key `+` zooms (it does in `dom/interaction.ts`: `+` or `=`);
  - the toolbar button names are exactly `Reset zoom` / `Hide table`;
  - `page.evaluate(axeSource)` defines `window.axe` under the page CSP;
  - the volume group's DOM rect order is slot order, which hover uses to aim at a row.
- **`npm run size`** was not run: it packs fixtures and writes `bench/size-latest.json`, outside this lane's
  fence. The 0 B root claim above rests on the direct baseline-vs-candidate build comparison.
- **`tests/dist/subpaths.test.ts`** (the finance cap of 127,000 B gzip-9 on the packed fixture) was not run; the
  local estimate is above.
- **Full `npm test`** was not run (scoped to `packages/axylo/test/finance` per the brief). No other test imports
  finance modules (`grep`: only `tests/dist/subpaths.test.ts`, `scripts/size.mjs` and `scripts/build.mjs`
  mention finance).
- **Independent cross-provider review** has not happened yet. Nothing here is self-certified as merge-ready.

## Packed-Chrome failure on the flagged chart and its correction (repair lane)

**Observed by the Director (packed real-Chrome run, not by this lane):** `tests/dist/finance.browser.test.ts`
reached the `#flagged` keyboard block and timed out inside `readAt(1)`, right after focusing the flagged
proxy and pressing ArrowRight. Everything before that point in the test had run.

**Cause (read from the source, not re-observed):** `dom/interaction.ts` `#onProxyFocus` calls `#takeover`,
which sets the focus to `firstDatum` when no pointer target is shown, then `#keyboardLeads` and
`#writeProxy`. Focus therefore already reads "Point 1 of 6", and the test's first ArrowRight stepped to
point 2, so the poll for "Point 1 of 6" could never succeed. The poll asserted a boolean, so the failure
did not show the reading the proxy actually held.

**Correction (test only, no assertion weakened):**
- `Home` on the focused proxy establishes the first candle deterministically (`NAVIGATION.Home = 'first'`;
  `#move` presents the keyboard reading even when focus is already there), then ArrowRight ×1 reaches the
  AX180 row (point 2) and ×3 the AX181 row (point 4) — the same rows the assertions already named.
- `readAt` polls the `aria-valuetext` string with `toContain('Point n of 6')`, so a timeout prints the
  observed value; it waits two animation frames before reading the cursor rule's `x1`, so a rule drawn
  for the previous point cannot be read.
- Added (strengthening): the first reading contains row 0's values (`100 / 106 / 99 / 104 USD`,
  `+4 USD (up)`, `1,000`) and no "invalid"; the cursor `x` increases strictly from point 1 to 2 to 3 to 4
  (dates ascend on the time axis).

**Unexecuted assertions after `readAt`, checked against the source and fixture (inferred, not run):**
- valuetext parts: the finance reader is an aligned view, focus is not single, so `core/focus.ts`
  `valueText` builds the reading from `lookup.tooltip` rows; those rows' values are pinned in Node by
  `test/finance/n7a-hardening.test.ts` (`'104 USD (invalid OHLC)' … '2,000'`, `'-500 (invalid volume)'`).
- cursor vs marks: the cursor is an overlay `line` (`render/svg.ts` `svgRule`, `x1` snapped) inside the same
  `svg.axylo-svg` as the scene (viewBox equals its CSS size), so `x1`, the wick/up path vertices and volume
  bar centers minus the SVG's left edge are all in the same SVG px.
- pointer: `svgLeft` is horizontal only (vertical scroll does not change it); pane boxes are re-measured after
  the second `scrollIntoViewIfNeeded`; `FinanceLookup.pick` accepts any point inside the plot, both panes included.
- table: columns `day, Open, High, Low, Close, Change, Direction, Volume`, so `[6]` is Direction (`omitted`)
  and `[7]` Volume (`2,000`), matching the Node table assertions.
- The parked pointer at (1, 1) lies in the body margin, outside every chart, so it cannot become a pointer
  target that `#takeover` would prefer over the keyboard focus.

No mismatch found beyond the off-by-one. **Not re-run here:** Chrome was not launched in this lane (worker
guardrail); the Director reruns the packed browser gate. This is a correction, not a passing browser rerun.

## Repair of cross-provider review sol-6.2-medium__20261126T183943Z (blockers 1–4)

Fence: only `packages/axylo/src/finance/{core,chart,layout,render}.ts`, `packages/axylo/test/finance/{fixtures,host,n7a-panes,n7a-revision}.ts`,
`tests/dist/finance.browser.test.ts` and this ledger changed. `src/finance.ts`, `aggregate.ts`, contracts, `public.ts`,
theme, dom, core and cartesian are untouched (diffed against the parent tree
`coordinators/axylo_p2_n7a_finance_panes/trees/opus-5.5-medium__20261126T183532Z`).

### 1. One revision per frame
- **Meta is bound to revision objects, not read live.** `stateRef.meta` is now only "the meta of the call being
  resolved". The finance resolver binds each `ResolvedOptions` to it (`bindResolved`); `normalizeFinance` records
  `{ meta, flags }` per frame (`frameMeta` / `flagsForFrame`). Layout, layout key and layout diagnostics read
  `metaForResolved(ctx.resolved)` (titles, units, formats) and the frame's meta (fields, flags); scene, lookup and
  reader read the frame's meta. A frame the controller renames without normalizing (`renamed()`) is recorded the
  first time a stage meets it — its view stage in the same update, with that update's meta — and its flags are
  recomputed from its unchanged, borrowed columns (nothing copied). The mutable `FinanceMeta.slotFlags` is gone.
- **Explicit domain** reaches the view through `state.valueDomain` (the accepted resolved options' own, as for every
  kind), so a domain-only update that keeps the frame still draws the new domain. Equal domain ends keep the
  previous array so an unrelated update keeps the view.
- **Tick memo across unrelated updates.** `priceView` is cached per view, volume series and price title (not per
  meta object): a title-only update keeps the view and the shared axis memo, so a `yAxis.tickFormat` that updates
  the title on every call no longer starves every frame. A real `yAxis.label` change makes a new price view.
- **Nested updates.** `chart.update` called while another update is being decided (onDiagnostic of a strict
  rejection or of an accepted update, a getter on the patch, a row getter) waits until that outer call is accepted
  or rejected, then runs over the options accepted by then; the outer call's rollback can no longer erase it, and
  rejected options never become its base. A waiting update's own StrictError has already gone to onDiagnostic and
  is not rethrown into the outer caller. Frame-time callbacks (tick formatters) are not nested and run at once.

### 2. Explicit-domain geometry and hollow bodies
- `CandleBuffers.add` tests the candle's raw pixel extent against the price pane before any minimum sizing; the
  body takes part only if its raw extent meets the pane, then gets its 1 px minimum (centred). Wicks are
  directional (`y0 < y1` or nothing — never turned around) and run to the raw body edges; crossing candles keep
  their genuine, cut wicks. Pane clip paths are unchanged.
- Wick ends are compared as stored (`Math.fround`): ends that round to the same float32 would be a zero-length
  segment (found by the new property test).
- Hollow stroke = `clamp(body / 3, 0.5, 1.75)` (`hollowStroke`): the interior `body − stroke` is ≥ 1 px for every
  body ≥ 1.5 px. Dense bins: 1.5 px body, 0.5 px stroke → 1 px interior, outer extent exactly the 2 px column.
  Bins, threshold, DOM bound, down (filled rect) and doji (horizontal tick) are unchanged.

### 3. Short plots
- When 23 % volume + gap would leave the price pane under the shared 80 px minimum, the gap shrinks to 4 px and the
  volume pane takes what is left; `MIN_VOLUME_PANE` is now 16 px (one 15 px tick line). The review's measured
  720 × 145 container now draws price 80 px + volume 17 px, ticks `0` and `5,000`, three bars.
- Below that the price pane is the whole plot and the omission is disclosed: `panes.volumeOmitted`, one hidden
  label in `fit.y.hidden` (the reader's "Some labels hidden. See table." note and AX143), and a presentation
  **AX142** (`effect: 'omitted'`, `field` = the volume field) with a tailored message. AX142 ("plot too small to
  draw") is the nearest existing meaning; its default outcome (summary and table control) is replaced by the
  real one (price pane drawn; tooltip, table and summary keep every volume). No contract change. A resize back to a
  taller container restores the pane and clears the AX142 (tested on the real controller).

### 4. Volume ticks
- Candidate labels are lazy (`linearTickCandidates(…, deferLabels = true)`); sets are considered in order and a
  set is taken only if every label is nonblank and distinct (also when the lane is wide enough). Fallbacks: the
  top tick alone (if its label differs from the baseline's), else the baseline alone; with no readable label, no
  tick and a disclosed hidden label. One-tick sets come after every set that labels the scale.
- `VolumeTickFailures` tracks formatter throws per tick value (as the shared `TickFailures`); AX160 is emitted only
  when a tick whose label is actually drawn (not hidden by lane fitting) is among them. Readout formatting is
  unchanged (`formatFinanceVolume` / the controller's formatters).

### Review fixtures → tests (`packages/axylo/test/finance/n7a-revision.test.ts`)
| Review fixture | Test |
|---|---|
| `yAxis.tickFormat` updating the title on every call | frames commit and settle; author tick labels; exact tooltip/table; later volume-label and price-label updates drawn |
| `volumeAxis.format` removing `volume` while formatting 0 | every commit coherent (pane ⇔ bars ⇔ readout ⇔ table); final frame without volume; volume back later |
| strict rejection, valid nested onDiagnostic update | nested label kept, rejected data/label absent, no AX180; later update keeps nested base |
| (non-strict counterpart) | nested update based on the accepted outer update |
| `[100,120]`, O=L=120.001 H=C=120.002 and the lower / bearish counterparts | only the inside candle's 2 wicks and body drawn |
| crossing candles | directional, cut wicks; no body for a body above the domain |
| dense 10,000 candles | interior ≥ 1 px, outer ≤ 2 px column |
| 720 × 145 measured container | volume pane, 3 bars, no AX142 |
| 720 × 125 → 200 resize | AX142 + note while omitted; pane back and AX142 cleared |
| `[0.01,0.03,0.05]`, `maximumFractionDigits: 0` | distinct nonblank labels, "0" only at 0 |
| `[1000,2000,3000]`, formatter throws at 500 | no AX160; throws at drawn 0 → AX160 |
| (property) any valid candle vs `[100,120]` | nothing drawn when wholly outside; every point in the pane; wicks strictly downward as stored |
| (property) any max, pane height, colliding/blank formatter | ≤ 3 ticks in `[0, max]`, labels nonblank and distinct |

Changed existing test expectations (behaviour change the review asked for, not a weakening): the `n7a-panes`
short-plot case (400 × 150 used to require price-only) now requires, for every height 100–200 px, either both
panes with price ≥ 80 px and volume ≥ 16 px, or price-only with `volumeOmitted` and a hidden label. The test
fixture `stage()` now passes the resolved domain as the view state's `valueDomain`, as the controller's
`viewStateFor` does (it passed `null` while the view read the domain from meta).

Packed browser (added, **not run** here): `#fixed` end-tick label centres (120, 100) within 1.5 px of the price
pane's top and bottom. In Node the layout centres them exactly on the edges (price pane 12–252 px at 640 × 380);
Chrome stability is unverified.

### Repair evidence — ran and saw
- Parent check: the new file run against the parent's `src/finance` (copied in, then restored, `diff -r` clean):
  `Tests  11 failed | 4 passed (15)` — the 11 are the review reproductions.
- `npm run typecheck` → exit 0 (library, docs/api, tests/dist).
- `npx vitest run packages/axylo/test/finance --configLoader native --no-cache` →
  `Test Files  4 passed (4)`, `Tests  57 passed (57)` (run three times in a row, same result). The two
  property tests also passed once at 1,500 / 3,000 runs (temporarily raised, then restored to 80 / 200).
- `npm run build` → all bundles built. `gzip -9nc`: `dist/axylo.js` 157,854 B, `dist/axylo.iife.min.js` 158,074 B,
  equal to the review's parent measurement → **0 B** legacy root delta (finance code is not in the root bundle).
- `npm run size` was started and stopped at its `npm pack` step (EROFS on the npm cache; packing is outside this
  lane) — no size result from it.

### Not run here / remaining limits
- Chrome, axe-core, `test:dist`, `npm run size` / packing: for the Director's gate.
- (Superseded by Repair 3 for onDiagnostic: handlers now run after their call is decided.) A waiting (nested) update returns before it is applied; `chart.diagnostics` read inside the handler is the
  outer call's. A waiting update's StrictError is reported through onDiagnostic only.
- At 1.5 px bodies and DPR 1 the 1 px hollow interior is antialiased; it is geometrically open, not pixel-verified.
- The volume formatter still runs at layout time (its labels depend on the dense bin maximum, a function of the
  plot width); a formatter that updates the chart there now gets a coherent stale frame followed by the new revision.

## Repair 3 — review `sol-6.2-medium__20261126T190553Z` (blockers 1–3)

Scope: `packages/axylo/src/finance/{chart,core,layout}.ts`, new `packages/axylo/test/finance/n7a-review3.test.ts`,
this ledger. No shared, public, manifest or `tests/dist` edits.

| Blocker | Change |
|---|---|
| 1. nested strict errors | `finance/chart.ts`: the controller gets one stable `onDiagnostic` relay for the chart's life. While a call (create or update) is decided, the relay holds that call's findings; once the call is accepted or rolled back (meta and issues restored) they go to the author's handler for that call synchronously, in order, before the call returns or rethrows. A handler's `update()` therefore runs normally over committed options and returns or throws its own `StrictError`. A throwing handler is caught and reported once (`console.error`, as core delivery); delivery stops when the chart is destroyed. Getter-made reentrant updates still wait (unchanged). |
| 2. format snapshots | `chart.ts` merges each patch with core `applyPatch` (plain objects copied, functions and `data` borrowed), so the accepted raw options are a snapshot taken at submission. `core.ts` `parseFinanceInput` keeps the previously accepted `priceFormat` / `volumeFormat` object when `sameValue` finds equal content, so the layout key (identity-compared) changes only when the accepted value does. |
| 3. AX160 per label | `layout.ts`: every candidate tick is wrapped once (`TrackedTick`) and its label is made on first read under `VolumeTickFailures.made`, which records whether that call fell back. `volumeTicks` returns `{ value, label, fallback }`; lane retries make fresh trackers and ticks; `drawn()` reads the flags of the ticks still shown after shortening/hiding. Whole-option failures (bad Intl) still flag every drawn tick. |

### Fixtures (`n7a-review3.test.ts`, 13 tests)
| Fixture | Expected (from spec 3.5 / the review) |
|---|---|
| strict outer `AX180`, handler calls `update(negative volume)` in try/catch | inner `StrictError` has AX181 and not AX180, caught inside the handler; outer has AX180 and not AX181; distinct objects; order `AX180, nested:start, AX181, nested:threw, outer:threw`; handler sees rolled-back diagnostics |
| strict rejection, handler makes valid update | nested returns; title-y keeps accepted `Shares`, not `Rejected`; 3 rows |
| accepted non-strict outer with AX180, nested `{strict: true, data: negative volume}` | nested throws AX181 to its caller; outer returns; 4 rows, AX180 kept, no AX181 |
| AX180 + AX181 in one rejected call, throwing handler | both delivered in order; outer throws its StrictError; `console.error` once. A destroying handler gets one finding only |
| controller-side `onDiagnostic` identity | one function across create and two updates |
| Intl `{maximumFractionDigits: 0}` → edit to 2/2 digits, resubmit the same `volumeAxis` | table `5,000.00` and axis `2,000.00` together |
| edit to 3/3 digits without submitting, resize 720→760, then unrelated `title` update | axis stays `2,000.00` (never `2,000.000`), table `5,000.00`; after resubmission both three digits |
| price format edited, unrelated `volumeAxis` patch | table price cell stays `100` |
| `parseFinanceInput` with equal / new format content | same object kept / replaced; function formats by identity; borrowed `data` and function format reach the controller by identity |
| max 5,000: zero fails in discarded `[0,2000,4000]` (4000 reads `$2000`), succeeds in drawn `[0,5000]` | labels `zero, $5000`; no AX160 (stage and real controller) |
| inverse: zero succeeds in discarded set, fails in drawn set | drawn `0` (fallback), `$5000`; AX160 |

### Repair 3 evidence — ran and saw
- Parent check: `n7a-review3.test.ts` against the sealed candidate's `src/finance/{chart,core,layout}.ts` (copied
  in, then restored, `cmp` clean): `Tests  10 failed | 3 passed (13)`. The 3 that pass on the parent are
  preservation cases (valid nested update after a rejection, the inverse AX160 case, borrowed identity).
- `npm run typecheck` → exit 0.
- `npx vitest run packages/axylo/test/finance --configLoader native --no-cache` →
  `Test Files  5 passed (5)`, `Tests  70 passed (70)`.
- `npm run build` → exit 0. Root bundles built from the parent and from this candidate are byte-identical
  (`cmp`: `axylo.js`, `axylo.iife.js`, `axylo.iife.min.js`, `static.js`, `cartesian.js`); `gzip -9nc` `axylo.js`
  157,854 B, `axylo.iife.min.js` 158,074 B → **0 B** root delta. `finance.js` 123,364 → 123,724 B (+360 B, the
  `applyPatch`/`sameValue` import and the per-label tracker).

### Not run here / remaining limits
- Chrome, axe-core, `test:dist`, `npm run size` (it packs): for the Director's gate.
- A handler-raised error is printed with the global `console`, not the host's console. When a finance
  `update()` is itself called from a controller drain (for example an event listener), the controller queues
  that call's notifications behind the running drain. Those reach the relay after the call has returned, and go
  to the accepted options' handler.
- Updates made by row/option getters while a call is decided still wait for that call. Their `StrictError`
  reaches `onDiagnostic` only, as before. No getter-made update can throw from its own call without merging
  into options that may yet be rejected.

## Repair 4 — callback ownership (per-call relay) and queued-error precedence

### Defect
`finance/chart.ts` gave the controller one relay for the chart's life and, when no call was being decided, sent
each finding to `acceptedRaw.onDiagnostic`. `core/controller.ts #enqueue` defers delivery while it is draining
or inside a frame, so an update made from an event listener could be rejected strictly with
`{onDiagnostic: rejectedHandler, data: BAD_OHLC, strict: true}`, throw correctly, and later hand AX180 to
whichever handler was accepted by drain time. (This was listed as a known limit under Repair 3; it is now fixed.)
A second defect turned up in the same place. In the getter-queue loop, `if (!(err instanceof StrictError) || failed) throw err`
let a queued update's error (strict or not) replace the outer call's own strict error whenever the outer call failed.

### Change (`packages/axylo/src/finance/chart.ts` only)
- `relayFor(handler)`: one relay per authored function (`WeakMap`), bound to that function. An unchanged handler
  stays the same function to the controller; a replaced one gets its own relay. Non-function / absent handler →
  one shared no-op relay (the controller still prints, as before).
- Held findings carry their relay's handler. `release` hands each to its own handler, in order. Throwing
  handlers are still isolated and printed once, and delivery still stops after destroy.
- Getter-queued updates: a queued `StrictError` is never rethrown (its findings already reached its handler).
  A queued non-strict error is thrown after the queue drains, and only when the outer call succeeded. Otherwise
  it is printed with `console.error`. The outer call's own failure always wins.

### Tests
- `n7a-review3.test.ts`: the old "one onDiagnostic for the chart's life" test now checks memoized identity. The
  same handler gives the same relay, a new handler gives a new relay, and going back to the first handler gives
  the first relay again.
- New `n7a-callback-owner.test.ts` (6 tests), real `controllerFor` on the recording host:
  1. `hover` listener raised by the controller's `emit` → strict-rejected update with `rejected` handler, then accepted
     `{onDiagnostic: accepted, strict: false, data: BAD_VOLUME}` before the drain reaches the rejection:
     `rejected` gets AX180 only, `accepted` AX181 only, the original handler nothing; rollback + acceptance hold.
  2. Synchronous rejection with a new handler outside a listener: that handler gets AX180 before the throw. The
     rollback keeps the first handler.
  3. No handler + listener rejection, then a handler set afterwards: it never receives the earlier AX180.
  4. Getter-queued strict AX181 inside an outer strict AX180 call: the outer call throws its own AX180 error, and both findings are delivered.
  5. Getter-queued patch whose own getter throws, inside a failing outer call: the outer StrictError is thrown
     and the queued error is printed.
  6. The same queued throw inside an accepted outer call still reaches the caller (preserved behaviour).

### Evidence — ran and saw
- Parent check: the chart.ts change was simulated in reverse by restoring the relay's `acceptedRaw.onDiagnostic` fallback and the old loop
  line, then restored (`cmp` clean). Result: `n7a-callback-owner.test.ts` → `Tests  3 failed | 3 passed (6)`. Failures were tests 1 (`expected [] to
  include 'AX180'`), 4 (`expected [ 'AX181' ] to include 'AX180'`, so the queued error did replace the outer one) and 5.
- `npm run typecheck` → exit 0.
- `npx vitest run --configLoader native --no-cache packages/axylo/test/finance` → `Test Files  6 passed (6)`,
  `Tests  76 passed (76)`.
- `npm run build` → exit 0. `gzip -9nc`: `axylo.js` 157,854 B and `axylo.iife.min.js` 158,074 B, the same as the
  Repair 3 figures (**0 B** root delta). `finance.js` 123,787 B gzip. `grep` finds no finance relay code in `axylo.js`.

### Not run here
- Chrome / axe-core / `test:browser` / `test:dist` / `npm run size` (packs): Director gate.
- Full Node suite, ran and saw: `npx vitest run --configLoader native --no-cache` → `Test Files  117 passed (117)`, `Tests  2169 passed (2169)`.

## Repair 5 — explicit `undefined` resets reach the controller (review sol-6.2-medium__20261126T192538Z)

### Blocker
`openFinanceChart` keeps its raw snapshot with core `applyPatch`, which drops a key set to `undefined`. It then
sent the full translation of that snapshot to the controller as a patch. In a patch an absent key means "keep",
so the controller kept `strict: true` and `reference`.

### Fix (`packages/axylo/src/finance/chart.ts`)
- The wrapper keeps `acceptedTranslated`, the translation the controller last accepted. That is the create
  translation at first.
- Each update sends `resetsFrom(acceptedTranslated, translated)`: the new translation, plus `undefined` for each
  previously accepted key the new translation lacks. Option names are not listed and patch getters are not
  read a second time.
- `acceptedTranslated` changes only after `inner.update` returns. A rejected call leaves it as it was, so a later
  accepted reset of the same key is still forwarded.
- Unchanged: the translation itself (default `legend: false`; finance-only keys become `y` fields), borrowed
  data and function identity, relay identity, nested and queued update handling, and strict rollback.

### Tests: new `packages/axylo/test/finance/n7a-resets.test.ts` (6 tests, real `controllerFor` on the recording host)
1. `strict: true`, then `update({ strict: undefined, data: BAD_OHLC })`: returns, reports AX180, keeps 4 rows.
   Under the old strict setting the same data was rejected first.
2. `update({ reference: undefined })`: the view has no references, the scene has no dashed reference line,
   and the layout has no `Pivot` label.
3. `update({ volumeAxis: undefined })`: the `Session` axis title is gone and stays gone after an unrelated update.
4. A strict-rejected `{ reference: undefined, volumeAxis: undefined, data: BAD_OHLC }`: the reference and the
   title remain, also after an unrelated accepted update, and strict stays in force. A later accepted reset
   then removes the reference.
5. A reset accepted right after the same reset was rejected reaches the controller.
6. `legend: undefined`: the controller receives the finance default `legend: false`, the same relay function,
   and the same `data` object.

### Evidence (ran and saw)
- Without the forwarding (`inner.update(translated)`): `Tests  3 failed | 2 passed (5)`. Tests 1, 2 and 4 failed,
  so the blocker is reproduced. Source restored.
- Mutant that updates `acceptedTranslated` before `inner.update`: test 5 fails (`1 failed | 5 passed (6)`).
  Source restored.
- `npm run typecheck`: exit 0.
- `npx vitest run --configLoader native --no-cache packages/axylo/test/finance`: `Test Files  7 passed (7)`,
  `Tests  82 passed (82)`.
- `npm run build`: exit 0. `gzip -9nc`: `axylo.js` 157,854 B and `axylo.iife.min.js` 158,074 B, the same as
  Repair 4, so the root delta is **0 B**. `finance.js` is 123,848 B. The finance-only string
  `Candlestick requires four distinct` is in `finance.js` only.

### Not run here
- Chrome, axe-core, `test:browser`, `test:dist` and `npm run size` (which packs): Director gate.
- The full Node suite was not rerun in this repair.

## Repair 6 — the two AX199 blockers of the 4th cross-provider review (sol-6.2-medium, `finance/chart.ts:148`)

### Blockers
1. **Resets lost through AX199 recovery.** Starting from `strict: true` plus a visible `reference`,
   `update({ strict: undefined, reference: undefined, data: rowsWithThrowingXGetter })` is reported as AX199 by
   the controller and returns normally (the call is not strict, because its own `strict` is reset). The controller
   keeps its previous options, but the wrapper advanced `acceptedRaw` / `acceptedTranslated` / `acceptedMeta` /
   `acceptedIssues` because `inner.update()` returned. A retry of both resets therefore sent neither reset: with one
   invalid candle it threw a strict AX180; with valid rows it still drew the old reference.
2. **Row reads outside the controller's boundary.** The wrapper merged each patch with core `applyPatch`, which
   compares old and new values structurally to compute `changed`. For two `data` arrays of the same length that
   walks the rows, so a throwing row getter escaped `chart.update()` as a plain `Error`, with no AX199.

### Fix (`packages/axylo/src/finance/chart.ts` only)
- `mergeRaw(accepted, patch)` replaces `applyPatch(acceptedRaw, patch).next`. When the accepted options hold
  `data`, the base handed to core `applyPatch` has an own `data: undefined` placeholder at the same key position.
  A submitted value replaces it (borrowed, never compared, because `sameValue(undefined, x)` is false without
  reading `x`). An explicit `undefined` deletes the key (it is own in the base). An omitted key keeps the
  placeholder, which is then given back the accepted borrowed value. Each submitted patch getter is still read once.
  Small options are still snapshotted by core `applyPatch`. The only row comparison left is the controller's own,
  inside its `#guarded` boundary.
- Acceptance comes from the controller itself. `createFinanceComposition` takes an optional `seen(env)` that its
  `normalize` calls before any row is read. The chart controller passes itself as the `DataEnvironment`, so the
  wrapper keeps the first env that has an `accepted` accessor (`ControllerCore.accepted`, an unconditional public
  getter, present in the production `finance.js` as `get accepted(){return this.#r}`). Around each
  `inner.update()` the wrapper reads `accepted?.options` before and after. The four snapshots advance only when
  the record after the call exists and is a different record. The controller builds a new options record on
  every accepted update (`OptionsStore.preview` → `applyPatch` → a fresh object), and a view-only zoom keeps the
  record, so a bare revision counter is not used. None of this depends on `onDiagnostic` timing or deduplication,
  `__DEV__` or `__BENCH__`.
- Edge cases: before the first normalization (a create that failed while resolving) no controller is known.
  `accepted` is then `undefined`, so nothing advances, and the controller's store still holds the create options,
  which the wrapper's snapshots match. A destroyed controller has `accepted === null`, so nothing advances.
  Repeated failed calls change nothing. A strict rejection still throws before the check, as before. Relays,
  held/queued findings, queued updates and getter re-entrancy are unchanged: the check sits inside the same `try`
  and `release(call)` still runs for every call.

### Tests: new `packages/axylo/test/finance/n7a-ax199.test.ts` (9 tests, real `controllerFor` on the recording host)
Fixtures: `THREE` (accepted, 3 rows), `BAD_OHLC` and `VALID_FOUR` (4 rows each, the retries). A throwing x getter
is an enumerable object-literal `get day()`. Blocker 1 uses a **changed-length** failing payload (5+ rows,
`VALID_FOUR` plus throwing rows, a different length for each failing call in one test). That way no element-wise
comparison is reached on the way, and the getter is first read by the controller's normalization. Blocker 2 uses a
**same-length** payload (3 rows, the first one throwing), which reached the wrapper's comparison on the parent.
- Blocker 1, fresh chart per branch:
  1. failed resets (reported AX199, normal return), then the retry of both resets with `BAD_OHLC`: returns, AX180
     reported, AX199 gone, 4 rows;
  2. failed resets, then the retry with `VALID_FOUR`: 4 rows, no view references, no dashed reference mark, and a
     later `update({ data: BAD_OHLC })` is accepted (strict stayed reset);
  3. two failed reset calls plus one strict-rejected (AX199) call without resets, then the readable retry carries both resets;
  4. a create that fails before normalization (`data` whose `columns` getter throws, a class instance so it is
     never compared structurally), a second such call with `reference: undefined`, then
     `update({ reference: undefined, data: THREE })`: AX199 gone, 3 rows, no reference;
  5. a failed call, then a view-only `zoom(null)`, then the retry: AX180 is accepted and the reference is gone;
  6. a destroyed chart ignores updates (no throw).
- Blocker 2:
  7. strict: same-length replacement throws `StrictError` with AX199; 3 rows kept; still strict (AX180 rejected);
  8. non-strict: AX199 reported, normal return; a readable retry clears AX199 and shows 4 rows;
  9. a replacement through a patch getter is read once and drawn; an omitted `data` keeps it; `data: undefined` clears it.

### Evidence (ran and saw, in this worker)
- Parent check: the two behavioral edits were reversed in place (`mergeRaw` → `applyPatch(acceptedRaw, patch).next`;
  the acceptance check → unconditional), the new file was run, and the fix was restored (`cmp` clean):
  `Tests  7 failed | 2 passed (9)`. Each failure has the intended reason:
  1 → `expected [ 'AX180' ] to deeply equal []` (strict AX180 on retry); 2 → reference count `expected 1 to be +0`;
  3 → the second failed reset call strictly rejected (AX199), because its `strict` reset was never re-sent;
  4 → `expected 1 to be +0` (old reference kept); 5 → strict `AX180` on the retry;
  7 → `expected Error: x getter failed to be an instance of StrictError`; 8 → `expected Error: x getter failed to be null`.
  Tests 6 and 9 pass on the parent: they guard the new code path (destroyed handle; borrowed/omitted/explicit-undefined `data`).
- `npm run typecheck`: exit 0.
- `npx vitest run packages/axylo/test/finance --configLoader native --no-cache`: `Test Files  8 passed (8)`, `Tests  91 passed (91)`.
- Full Node suite, `npx vitest run --configLoader native --no-cache`: `Test Files  119 passed (119)`, `Tests  2184 passed (2184)`.
- `npm run build`: exit 0, for the parent-equivalent source and for the fix, each into workspace-local copies.
  `axylo.js`, `axylo.iife.js`, `axylo.iife.min.js` and `static.js` are **byte-identical** (`cmp`) between the two.
  `gzip -9nc`: `axylo.js` 157,854 B and `axylo.iife.min.js` 158,074 B (the same as Repairs 4–5), so the **0 B**
  root delta holds. `finance.js` 123,918 → 123,984 B gzip (+66 B; raw 345,086 → 345,270 B).

### Not run here (Director gate)
- Real Chrome `tests/dist/finance.browser.test.ts`, `test:browser`, axe-core, `npm run size` / `size.mjs` (packs).
- The unconditional cross-provider `Verdict: Merge` on the final verified candidate.

## Repair 7 — preview order of the 5th cross-provider review (sol-6.2-medium__20261126T200021Z)

### Blocker
`ChartController.update` installs the call's `strict`, name and `onDiagnostic` only after
`OptionsStore.preview(patch)`. `preview` runs core `applyPatch`, which compares a submitted `data` structurally
with the accepted one (`sameValue`); for two arrays of the same length that walks the rows and runs their getters.
A same-length replacement with a throwing row getter therefore failed inside `preview`, and `#guarded` handled it
with the **previous** call's settings: from `strict: true`, `update({ strict: undefined, reference: undefined, data })`
threw a strict AX199 instead of returning with AX199 reported; from non-strict, `update({ strict: true, onDiagnostic: h2, data })`
returned instead of throwing, and a rejection's AX199 went to the previously accepted handler, not `h2`.
Repair 6's tests did not reach this: blocker-1 used changed-length payloads, and blocker-2's strict test kept the
same `strict` and handler on both sides. `core/**` is outside the fence, so the fix is finance-only.

### Fix (`packages/axylo/src/finance/chart.ts` only)
- A module-private `DataHolder` class (`{ readonly source }`, not exported, not a plain object). `translate()` (the
  wrapper's controller patch) replaces `data` with a holder that points to the exact value given: no iteration,
  clone or accessor read. core `sameValue` compares non-plain objects by identity only, and `applyPatch` borrows
  `data` as given, so `preview` never reads a row; the first row read is the controller's resolve/normalize, after
  it installed the submitted settings, inside its `#guarded` boundary.
- The holder in `acceptedTranslated` is reused when the merged source is the same value (`===`) as the accepted
  holder's source. An update that leaves `data` out, or gives the same rows again, is then no data change to the
  controller (frame kept). `acceptedTranslated` advances only on an accepted call (Repair 6), so the comparison is
  with the accepted source, never a failed proposal. A different array or columns object gets a new holder, so the
  controller renormalizes it (a change from the parent, which kept the frame for a same-content copy of the rows).
- `createFinanceComposition` wraps `createFinanceResolver`: if `options.data` is a holder, the resolver is given a
  shallow copy of the options with the original `data`. On the static controller every data consumer goes through
  `composition.resolve`: normalize (replace path), labels-only rename (`resolve(previous.source.table)`) and
  presentation updates. A finance chart has no `openStore` (stream path), so `streamOptions` / `openStore` never see
  the holder. `validateCandlestick` uses `parseFinanceInput(...).translated` directly and never sees a holder.
- Unchanged: `mergeRaw` (Repair 6), explicit `undefined` vs omission (a cleared `data` has no key in the
  translation and is sent as `undefined` by `resetsFrom`), the create handoff (the same translated object is
  given to `open`, so `OptionsStore`'s first preview still reuses it), relays and notification ownership, the
  acceptance check, queued updates.

### Tests
New `packages/axylo/test/finance/n7a-preview-boundary.test.ts` (8 tests, real `staticControllerFor`, recording host).
The failing payload is 3 rows (the accepted length) whose first row has an enumerable throwing `get day()`.
1. from `strict: true` with a visible reference, `update({ strict: undefined, reference: undefined, data: sameLength })`
   returns normally and AX199 is reported; a readable same-length retry of both resets with one invalid candle
   (`BAD_THREE`) returns, AX180 is reported, AX199 is gone, 3 rows;
2. the same failure, then a readable valid same-length retry: no view reference and no dashed reference mark;
3. from non-strict with handler `h1`, `update({ strict: true, onDiagnostic: h2, data: sameLength })` throws a
   `StrictError` with AX199; `h2` has AX199 before the throw, `h1` does not; rollback: a following
   `update({ data: BAD_VOLUME })` is accepted (non-strict) and its AX181 goes to `h1`, not `h2`;
4. inside a `hover` listener (the controller's notification drain is active), a strict same-length rejection with
   a changed handler `h2`: `StrictError` with AX199, `h2` gets AX199, `h1` gets nothing; rollback kept `h1` and
   strict: a following `update({ strict: false, data: BAD_VOLUME })` delivers AX181 to `h1` only;
5. holder reuse: resolution reads the caller's rows (`table.rowAt(0) === rows[0]`); a title update and the same
   array again keep `accepted.frame`; a label rename reads the same rows; a new array (same rows) is normalized
   from that array (`sameTableData(table, rowsTable(copy))`) with a new frame;
6. caller-owned typed columns: `accepted.source.table.columns === columns` and `.o === o` (the `Float64Array`);
7. an omitted `data` keeps the accepted rows; `data: undefined` clears them (0 rows);
8. a failed proposal is not the comparison base: rows whose getter throws once (AX199), a title update keeps the
   accepted rows, then the same rows, now readable, are accepted as new data (new frame, their rows).

Changed assertions in existing tests (representation, not values): `n7a-resets.test.ts` ("legend: undefined …")
and `n7a-review3.test.ts` ("keeps borrowed data …") asserted that the controller patch's `data` **is** the
caller's array. The patch now carries the holder, so these failed with the fix (`expected DataHolder {…} to be [ … ]`).
They now assert the property they stood for at the boundary where the data is read: the table that
`composition.resolve` makes from the sent options was made from the caller's array (`sameTableData` with
`rowsTable(data)`) and returns the caller's row objects; the resets test also asserts that the unchanged data is
sent as the same holder the create was given. Both pass on the parent too. New helper `resolvedTable()` in `host.ts`.

### Evidence (ran and saw, in this worker)
- Parent reproduction: the workspace has no `.git`, so the parent `chart.ts` was rebuilt by reversing the three
  edits. It matches the Repair 6 build exactly: `finance.js` 345,270 B raw, 123,984 B `gzip -9nc`. The fixed file
  was restored after each check (`cmp` clean). Finance suite on the parent: `Tests  5 failed | 94 passed (99)`.
  Tests 1, 2 → `expected AxyloStrictError: [axylo AX199] … to be null`; 3 → `expected null to be an instance of
  StrictError`; 4 → `expected [] to include 'AX199'` (it went to `h1`); 5 → the copy kept the old frame. Tests 6–8
  pass on the parent: they guard the holder (borrowed columns, omission/clearing, failed-proposal base).
- `npm run typecheck`: exit 0.
- `npx vitest run packages/axylo/test/finance --configLoader native --no-cache`: `Test Files  9 passed (9)`, `Tests  99 passed (99)`.
- Full Node suite, `npx vitest run --configLoader native --no-cache`: `Test Files  120 passed (120)`, `Tests  2192 passed (2192)`.
- `npm run build`: exit 0 for the parent and for the fix, each `dist` copied to `.prism-cache/tmp`. `axylo.js`,
  `axylo.iife.js`, `axylo.iife.min.js` and `static.js` are **byte-identical** (`cmp`). `gzip -9c` / `-9nc`:
  `axylo.js` 157,863 / 157,854 B, `axylo.iife.js` 237,903 / 237,889 B, `axylo.iife.min.js` 158,092 / 158,074 B,
  identical for both, so the **0 B** legacy root delta holds. `finance.js` raw 345,270 → 345,582 B (+312),
  `gzip -9nc` 123,984 → 124,098 B (+114).

### Not run here (Director gate)
- Real Chrome `tests/dist/finance.browser.test.ts`, `test:browser`, axe-core, `npm run size` / `size.mjs`, `npm pack`.
- The unconditional cross-provider `Verdict: Merge` on the final verified candidate.
