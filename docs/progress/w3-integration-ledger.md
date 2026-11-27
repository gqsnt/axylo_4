# Wave 3 integration seal (`p2_w3_integ`) — author ledger

Author leaf: `ts_builder` (requested Opus 5.5 high, as the harness reports it). Baseline: the source checkout's
working tree at `f6c6c22` (merge of `phase2/n5-intervals-boxplot` into `phase2/wave3-integration`). Every changed
file was compared with that tree. Not committed.

## Findings and what closes them

| # | Change | Regression tests (Node, ran) | Packed checks (written, not run here) |
|---|---|---|---|
| 1 | `cartesian.ts`: `ScatterLayerOptions` (`y` one or many, `yAxis?` axis ID or `'left'`/`'right'`, `label?`, `size?`) and `BoxplotLayerOptions` (`min`/`q1`/`median`/`q3`/`max`, `yAxis`, `label?`, `capWidth?`, `size?`, `outliers?` = a field of number lists), matching `cartesian/options.ts` | `npm run typecheck` (library, docs/api, tests/dist) | `subpaths.test.ts` declarations block, Bundler and NodeNext: both marks compile; four `@ts-expect-error` (no `q3`, `outliers` on a string field, string `y`, unknown `yAxis`); asserts `dist/cartesian.d.ts` is in the program. `c5.browser.test.ts`: both `as never` and the typing caveat removed |
| 2 | `SeriesSwatch.legendForOne?(view)` (`dom/interaction-types.ts`), checked next to the `series.length > 1` gate (`interaction-controls.ts`); `cartesian/mark-swatch.ts` answers true for a lone range or error-bar drawing | `w3-integration.test.ts`: toggle offered for a lone range/errorBar, not for a lone line/bar; hide and restore the last hidden series through the controller, chart stays `ready`, entry `pressed=false, struck` while hidden | `c5.browser` W3 block: one entry, pointer click hides and restores, Enter/Space on the focused entry do the same |
| 3 | `dom/interaction.ts` `#present`: the cache key also holds the winning ref (`lookup.primary`) and its anchor for an `x` target, so moving between layered marks at one x redraws, re-anchors and raises hover. Peer (`S_SYNC`) presentation still never calls `#hover` | existing lookup-level test (`n5-repair2` "switches winning primary and anchor") | `c5.browser` W3 block: scatter → line vertex at x = 2 changes the hover event `a` → `b` and moves the tooltip, back to `a`. The N6 sync suite is unchanged and was not run here |
| 4 | Repeated-x scatter: `cartesian/repeats.ts` (new) keeps the rows a scatter series repeats at an x per slot (typed CSR keyed by the series' `y` column), read with the same `readX`/`readValues` as the frame. `normalize.ts` holds AX108 back for scatter series only and re-emits it for every other layer; `view.ts` fits the axis; `scene.ts` draws them; `lookup.ts` indexes them and returns a `point` target with a `point` DatumRef (`seriesKey`, source `row`, `x`) when the picked point's slot repeats; `reader.ts` lists them in the table and summary; `overlay.ts` marks the picked point; `controller-helpers.ts` `pointForDatum` reads a `point` ref on an aligned frame (x from the frame, y from the lookup's `pointValue`) | `w3-integration.test.ts` (8 cases): 3 points drawn at hand-computed pixels, no AX108; each pick, datum, tooltip, members/has/primary/slot/ordinal/resolve/anchor/step; table `['1', '2, 3']`; axis fits a repeated 30; controller hover **and** select payloads `{series, x, y, row, index}` for all three rows; a line beside the scatter keeps AX108 (one), and line-only or range-only repeated x still AX108; category and calendar-date x; borrowed typed columns untouched; log-axis AX171 counts a repeated row; hidden scatter draws and picks nothing | `c5.browser` W3 block: 3 markers, no AX108, pointer hover + click on each of the three markers gives the expected payloads, tooltip `Pts 3` |
| 5 | `core/focus.ts` `alignedRows(…, lookup?)` reads rows past the tooltip's from `lookup.datum` when the slot holds a value (a missing slot keeps the frame's text, so a stacked series' rows do not gain "incomplete", which the total already says); `interaction-nav.ts` passes the lookup | `w3-integration.test.ts`: ninth series reads `20 – 80` in `alignedRows`, `pinnedModel` page 2, `valueText` and `datumReading` | `c5.browser` W3 block: pinned "+1 more" page shows `Band 20 – 80`; keyboard Home reads `Band 20 – 80` |
| 6 | `lookup.ts` `markerDistance`: the error-bar centre is measured as the series' painted marker (cue shape, size 4.5) clipped to the plot (polygon: Liang–Barsky per edge plus even-odd inside test; circle: radial point or plot-edge crossings) | `n5-repair2` W3 block: square corner at (+4, −4) hits (2.475 px), (+4.5, −4.5) misses, circle 2 px above the top loses to a cap 1.0 px away (clipped 1.091 px; whole circle would be 0.952). The brute-force oracle now uses its own painted-shape distance (Sutherland–Hodgman for polygons, sampled and refined arc for circles) | — |
| 7 | Bounds: `distOf` is `sqrt(gx² + gy²)` (monotone, so equal bounds prune ties exactly); a leaf marker's distance is never below its box bound; rectangles and centre markers get separate trees so every marker node uses a centre bound (distance to the centres' box minus the marker's reach) | `n5-repair2` W3 block: 100k coincident-x whiskers, diagonal pick → lowest slot, nodes ≤ 128, geometry ≤ 64; 100k subpixel circle cluster, diagonal pick → rightmost centre, nodes ≤ 256, geometry ≤ 128 | — |

All 14 new Node regressions were run against the baseline sources (changed `src` files swapped back to `f6c6c22`):
14 failed there, and they pass on the candidate. The 15th, "hidden scatter draws nothing", passes on both.

## Changed expectations in existing tests (why)

- `n5-scatter.test.ts` "reports duplicate x as for every aligned series (AX108)" now expects **no** AX108 for a scatter
  layer, and AX108 for the same rows on a line layer. Spec F11: "On scatter, points sharing an x … are ordinary
  data". This is finding 4 of the brief. The file's header sentence was updated to match.
- `n5-repair2.test.ts` brute-force oracle: the error-bar centre term was `hypot − size/2`, which is a full circle;
  series 1 is painted as a square (finding 6 says not to keep that assumption in the oracle). It now calls an
  independent `paintedMarkerDistance`. Nothing else in the oracle changed.

## Lossless size reductions in the fence (all existing tests unchanged and passing)

- Point index: one tree over all points instead of a 16 px cell grid with a tree per cell (the grid only limited which
  trees were visited; the search's bounds already limit that). Same dedupe and tie order. The coincident group's
  earliest-slot entry is now found while scanning the group (its slots never decrease), not by a binary search.
- Per-cell sort paths merged into one `cmpPos` sort (TimSort finds the already-sorted runs).
- Compound primitive buffers sized exactly (at most 6 primitives per box slot, 4 per error-bar slot) instead of growing.
- An unneeded fast path in `canVisitNode` removed; box-outlier and repeated-row axis fitting share one helper; the
  reader summary's three min/max loops share one closure.
- The compound query knows from the tree it searches whether a node holds markers, so neither the BVH builder nor the
  primitives keep a per-primitive marker flag (a marker's `y` is NaN for rectangles).

## Measured (ran and saw)

- `npm run typecheck`: clean (library, docs/api, tests/dist).
- `npx vitest run --configLoader native --no-cache` (all Node tests): **142 files, 2469 tests passed**, exit 0.
- `npm run build`: built. Sizes use the subpaths consumer's esbuild options (bundle, minify, esm, es2022,
  `conditions: ['production']`) over the built `dist`, gzip level 9. Baseline = `f6c6c22` sources built the same way:

| bundle | baseline | candidate | Δ | cap |
|---|---|---|---|---|
| `export { cartesian } from 'axylo/cartesian'` | 133,004 | **134,112** | +1,108 | ≤ 134,000 — **exceeded by 112 B** |
| root `line` | 135,779 | 135,909 | +130 | ≤ +200 ✓ (legacy 135,293 already exceeded at baseline) |
| root `everything` | 158,789 | 158,923 | +134 | ≤ +200 ✓ (legacy 158,096 already exceeded at baseline) |
| static `line` | 120,343 | 120,451 | +108 | ✓ 120,729 |
| static `everything` | 140,635 | 140,749 | +114 | ✓ 140,988 |
| IIFE min (file gzip-9) | 159,126 | 159,245 | +119 | legacy 158,425 already exceeded at baseline |
| stats / sync / export | 1,692 / 3,494 / 3,295 | same | 0 | ✓ |
| bare `import` of axylo, static, stream, cartesian, stats, sync, export | 0 B | 0 B | 0 | ✓ (finance 23 B at baseline and candidate) |

The brief gives the packed cartesian baseline as 133,909 B. The same method gives 133,004 B on the `f6c6c22`
sources, and the stale installed fixture (an older pack) gives 127,120 B. So the 905 B gap is not explained here.
The packed `subpaths.test.ts` number must be read by the Director; no `npm pack` was run in this sandbox.

## Not done / not verified

- **Cartesian gzip cap: 134,112 B against ≤ 134,000 by the local method (112 B over).** Features cost +2,631 B
  before the reductions above recovered 1,523 B. No further lossless cut was found inside the fence. Splitting the
  tree at the median instead of peeling skewed clusters failed three bounded-work tests, so it was reverted. Moving
  `markerDistance` into the lookup closure made the bundle larger, so that was reverted too.
- Chrome was not launched (worker rule): the W3 block in `tests/dist/c5.browser.test.ts`, the existing c5/N5 blocks,
  `cartesian.browser.test.ts` and `n6-sync-dashboard.browser.test.ts` are for the Director. The packed `subpaths.test.ts`
  (declarations under Bundler/NodeNext, sizes) was not run either.
- Assumptions in the Chrome block that were not observed: the line's last-value marker is the only marker of series 0
  in `#layer`/`#nine`; a click pins and selects (as `final-pin.browser.test.ts` does); Escape releases the pin; the
  toolbar entry toggles on Enter and Space.

## Assumptions where the spec or brief was open

- A repeated-x scatter pick returns a `point` target only when the picked slot actually repeats. A point alone at
  its x keeps the `x` target the other Cartesian marks use, so earlier lookup tests stay valid.
- A scatter x read as a whole (keyboard, aligned tooltip row, table cell, summary's last reading) lists every row:
  `2, 3`. A `point` ref reads its own row.
- Repeated rows without a plottable value (null, invalid) are not points and are not listed. Their diagnostics come
  from the frame's own read as before.
- The summary reads a scatter's repeated rows as it reads the slot's own row, including the existing behaviour that
  a scalar series on a log axis counts a nonpositive value in its summary range. The table marks a nonpositive
  value on a log axis "(not plotted — log)" in repeated rows too (`carrierReadout`).
- The scatter's own-slot row stays the first row at that x in sorted order, as `data/normalize.ts` keeps it.

## Repair round (`bounded_ts_fix`, requested Opus 5.5 medium as the harness reports it)

Input: Director verify log `turn-2-opus-5.5-high__20261127T164930Z.log`: packed cartesian 134,112 B (> 134,000), and
both strict declaration checks failing with one in-fence error (TS4104 on `sbD`) plus two Sync errors.

### Changes

- `tests/dist/subpaths.test.ts`: the new fixture line declares `sbD: readonly Diagnostic[]`, the type
  `validateCartesian` returns. No other line, assertion or cap changed; Bundler and NodeNext stay strict and the Sync
  imports are untouched.
- Lossless size cuts (results and tie order unchanged; every existing test unchanged):
  - `cartesian/lookup.ts` compound query: a leaf's accepted distance is `max(dMin, painted marker distance)` (dMin is
    the same bound the nodes were pruned by, never below the box bound), and the leaf's acceptance test is `canBeat`,
    which is the same expression the old inline test spelled out. `nodeDist` reuses `lowerOf(…, false)`. The two
    trees are searched by a two-step loop instead of literal arrays. Rectangles and markers are partitioned in one
    pass (markers fill `order` from the back; one marker per slot, so their order does not decide a winner).
  - `cartesian/lookup.ts` point index: the `py` checks against `plot ± CELL_PAD` were implied by `inPlot` (a marker's
    half size is at most 12 px: options.ts caps `size` at 24); the root's `d2 <= RADIUS_PAD2` test is covered by
    `canVisitNode` (a node past 24.001 px cannot hold a point within 24 + 1e-6 px), so the constant is gone.
  - `cartesian/lookup.ts` `step`: the four relative moves clamp `at + delta` to `[start, end - 1]` (equal to each old
    one-sided bound because a resolved `at` lies in that range); `tooltip` shares one empty model for a non-`x` target
    and an x outside the view.
  - `dom/interaction.ts` `#present`: the presentation key is assigned as a new tuple once it changed (the branch only
    runs when the presentation is redrawn), instead of being patched field by field.
- Tried and reverted: sorting the subrange instead of `nthElement` (−139 B but 15–40 % slower tree builds on 100k
  clustered rows); a shared plot-clip helper for `rectDist`/`pushRect` (+28 B); a middle-element pivot in
  `nthElement` (−48 B, same build time on the bench, kept out because median-of-3 is the more robust pivot and the
  margin was reached without it).

### Measured (ran and saw)

- `npm run typecheck`: clean (library, docs/api, tests/dist).
- `npx vitest run --configLoader native --no-cache` (all Node tests): **142 files, 2469 tests passed**.
- `npm run build`, then the subpaths consumer's esbuild setup (stdin, bundle, minify, esm, es2022,
  `conditions: ['production']`) over the built `packages/axylo/dist` files, gzip level 9:

| bundle | `f6c6c22` base | before repair | after repair | cap / gate |
|---|---|---|---|---|
| `export { cartesian }` from `dist/cartesian.js` | 133,004 | 134,112 | **133,949** | ≤ 134,000 ✓ (51 B margin) |
| finance `candlestick` | — | 123,821 | 123,796 | ≤ 127,000 ✓ |
| root `line` | 135,779 | 135,909 | 135,883 | +104 ≤ +200 ✓ |
| root `everything` | 158,789 | 158,923 | 158,893 | +104 ≤ +200 ✓ |
| static `line` | 120,343 | 120,451 | 120,424 | +81, ≤ 120,729 ✓ |
| static `everything` | 140,635 | 140,749 | 140,717 | +82, ≤ 140,988 ✓ |
| `axylo.iife.min.js` file | 159,126 | 159,245 | 159,215 | +89 (legacy 158,425 already exceeded at base) |
| stats / sync / export | 1,692 / 3,494 / 3,295 | same | same | ≤ 3,500 ✓ |
| bare import axylo, static, stream, cartesian, stats, sync, export | 0 | 0 | 0 | ✓ (finance 23 B, as at base) |

  No streaming markers (`adoptNormalized`, `StreamSession`) in the cartesian bundle. The base column was built from
  `~/projects/axylo` (`f6c6c22`) the same way and reproduces the earlier table exactly.
- Tree build time (`createCartesianLookup`, 100k rows, best of 5, five shapes incl. clustered boxplot): unchanged
  within noise (e.g. clustered boxplot 124–125 ms before and after).
- Declarations: the fixture's `check.ts` (extracted verbatim from `subpaths.test.ts`) was compiled with tsc under
  both configs against a copy of `dist` holding only the files `package.json` `files` lists. Both report only:
  - Bundler: `dist/sync.d.ts(8,208)` and `(9,93)`: TS2307 cannot find `./sync/group`, `./sync/dashboard`.
  - NodeNext: the same two lines: TS2834 (relative import without extension).
  The TS4104 is gone, `dist/cartesian.d.ts` is in the program and every `@ts-expect-error` is still used.

### Outstanding blocker (outside this fence)

The packed `axylo/sync` declarations are broken: `dist/sync.d.ts` re-exports `./sync/group` and `./sync/dashboard`,
which `package.json` `files` does not pack, and without the `.js` extension NodeNext requires. It was present in the
initial snapshot. Closing it needs the Sync source (`src/sync.ts` re-exports with `.js` extensions, or one bundled
declaration) and/or the manifest's `files` (`dist/sync/**/*.d.ts` and what those import), which this repair may not
touch. Until then both declaration tests in `tests/dist/subpaths.test.ts` fail on these two lines only.

### Left for the Director

Actual `npm pack` + `tests/dist/subpaths.test.ts`, and all Chrome suites (`c5.browser`, `cartesian.browser`,
`n6-sync-dashboard.browser`) were not run here.

## Repair round 2 (`ts_builder`, requested Opus 5.5 high as the harness reports it)

Input: the cross-provider review of the sealed candidate (`coordinator_p2_w3i/sol-6.2-medium__20261127T174345Z/report.md`),
five candidate blockers. Starting tree: `trees/opus-5.5-medium__20261127T173450Z` (this workspace was byte-identical
to it outside `.prism-cache`). Not committed.

| Review blocker | Change | Node regression (`test/cartesian/w3-integration-repair.test.ts`, ran) |
|---|---|---|
| 1 Same-x placement | `dom/interaction-nav.ts` `placementBox(d, lead, marks, pointer)`: the pointer's own hover (`S_HOVER`) on a lookup whose x pick names its winner (the Cartesian lookup, which has `pointValue`) is placed at the winner's box (`leadAt`, the anchor of `lookup.primary(target)`, already computed for the presentation key). Keyboard, pinned and peer (`S_SYNC`) targets, and the root lookups, keep the union of every mark at the x. The tooltip rows, the `anchor` kept in `#content` (and so the held-tooltip comparison) and the hover event path are unchanged; `S_SYNC` still never calls `#hover` | packed Chrome fixture's `#layer` data: placement box centred on the scatter point (y = 80), then on the line vertex (y = 20) at the same x, 60 value units apart; the union spans both and is unchanged; `pointer = false` and a lookup without `pointValue` keep the union |
| 2 Readiness + log fit | `core/controller-helpers.ts` `hasData`: a series' repeated rows in its draw range count (O(1): the CSR start offsets). `cartesian/axes.ts` `positiveExtremaInRange`: the repeated rows in the range count, so AX172 and the automatic log domain see them | through `controllerFor`: `(1, null), (1, 2), (2, null), (2, 4)` is `ready`, draws (1, 2) and (2, 4), diagnostics `[]`, and a pick on (2, 4) names row 3; all-null stays not ready; `(1, -2), (1, 3), (2, -4), (2, 5)` on an automatic log axis is `ready`, diagnostics exactly `['AX171']` (field y, count 2, rows 0 and 2), domain covers 3 … 5, two points at 3 and 5 |
| 3 Dense repeated x | `cartesian/repeats.ts` `valueAtRow` bisects the slot's repeats by source row (a slot's repeats are in source-row order: `readX` sorts by x with a stable sort). `cartesian/lookup.ts` `datumText(…, own)` formats one given value instead of the whole slot, used by `pointText`. `anchor` of a point ref tests visibility with the marker's painted half size (`halfOf`, shared with the point index), not a fixed 1 px | 20,000 rows at one x: tooltip and datum of a picked point call the formatter ≤ 2 times (was 20,001 per the review), and resolve + datum read the source-row column ≤ 32 times (39,972 on the candidate); size-12 marker centred 3 px above the plot: picked, anchored at its centre, `markBox` of the pick is that anchor, tooltip reads row 1; unsorted and sorted rows: every pick names its own source row, datum value and `resolve`, and controller hover payloads `{series, x, y, row, index}` match the source rows |
| 4 Overflow error bar | `core/focus.ts` `alignedRows`: the lookup's reading is taken when either the frame slot or the lookup reports a value. An error bar with no centre and both bounds is a value to the lookup (`No data (20 – 80)`); a plain or stacked missing slot is missing to both, so it keeps the frame's own missing word (no "incomplete" on a tooltip row) | 8 lines + an error bar with no centre at x = 2 (+ a plain line and a stack missing there): pinned page 2 reads `No data (20 – 80)`; keyboard `valueText` and `datumReading` read `Err No data (20 – 80)`; the plain and stacked rows read `No data`, the stack's other series `6` |
| 5 Coincident circles | `cartesian/lookup.ts` compound query: the centre-marker tree stores each marker as its exact centre (a zero-size box; rectangles are never zero-size, which also replaces the `pPtY` column). `lowerOf` for markers is the larger of the marker-box bound, the centres' bound less the reach, and, for a single centre (a primitive, or a node whose centres all coincide), that marker's exact painted distance. A node of coincident centres then has exactly the value each of its primitives takes, so the existing (dist, dx, slot) tie test prunes it. The leaf's value is `lowerOf` of its own centre, never below an ancestor's bound | 100,000-row coincident-x distribution of the whisker test, circular centres at one y, diagonal pick 1 px outside the circles: lowest slot (`x[1]`) wins, primary is that slot, nodes ≤ 128, candidates ≤ 64 (the review measured 16,418 nodes and 99,999 geometries). The coincident-whisker and subpixel-circle tests in `n5-repair2` are unchanged and pass |

Each new regression was run with the changed source file swapped back to the sealed candidate's copy: every file's
swap fails at least one new test (`controller-helpers.ts` and `axes.ts`: the two blocker 2 tests; `repeats.ts`: the
bisection read count; `lookup.ts`: formatter count, size-12 anchor, coincident circles; `focus.ts`: both blocker 4
tests; `placementBox` forced to the union: the blocker 1 test).

Packed Chrome fixture (`tests/dist/c5.browser.test.ts`, written, **not run here**): `#nine` gains a tenth series, an
error bar with no centre at x = 3 on its own bound fields. The pinned pager is now paged until both `Band 20 – 80` and
`Err No data (20 – 80)` have been seen (at most ten pages, each label only matched as `+N more`), so it no longer
depends on how many rows fit; the keyboard reads `Band 20 – 80` on Home and `Err No data (20 – 80)` on End. The
same-x `#layer` placement assertion is kept as it was.

### Lossless size cuts (results and tie order unchanged; every existing test unchanged and passing)

- `lookup.ts`: the point index is returned as a tuple, not an object with ten named fields; `pickPreferred` returns
  `[series, slot, at?, rep?]` and compound hits `[slot, dist]` (property names survive minification);
  `nodeDist(b, markers)` and `nodeDx(b)` replace three spelled-out node reads; `pointText` no longer overrides a
  whole-slot text.
- `focus.ts` / `controller-helpers.ts`: two operand-order and optional-chain forms measured 2 B smaller each.

### Measured (ran and saw)

- `npm run typecheck`: clean (library, docs/api, tests/dist).
- `npx vitest run --configLoader native --no-cache` (all Node tests, final tree): **143 files, 2480 tests passed**, exit 0.
- `npm run build`, then the subpaths consumer's esbuild setup over `packages/axylo/dist`, gzip level 9. The candidate
  column was rebuilt from the sealed tree the same way and reproduces the repair-round table above exactly:

| bundle | `f6c6c22` base | candidate | this round | cap / gate |
|---|---|---|---|---|
| `export { cartesian }` from `dist/cartesian.js` | 133,004 | 133,949 | **133,982** | ≤ 134,000 ✓ (18 B margin) |
| root `line` | 135,779 | 135,883 | 135,968 | +189 ≤ +200 ✓ |
| root `everything` (`export *`) | 158,789 | 158,893 | 158,981 | +192 ≤ +200 ✓ |
| static `line` | 120,343 | 120,424 | 120,512 | +169, ≤ 120,729 ✓ |
| static `everything` (`export *`) | 140,635 | 140,717 | 140,818 | +183, ≤ 140,988 ✓ |
| stats / sync | 1,692 / 3,494 | same | same | ≤ 3,500 ✓ |
| bare import axylo, static, stream, cartesian, stats, sync, export | 0 | 0 | 0 | ✓ |

### Not done / not verified here

- Chrome: `c5.browser` (incl. the changed W3 block), `cartesian.browser`, `n6-sync-dashboard.browser` — Director.
- Packed `tests/dist/subpaths.test.ts` (npm pack, declarations, sizes) — Director. The packed Sync declaration failure is
  the known baseline issue and was not touched (no Sync source, manifest, contracts or build script edits).

## Repair round 3 (`ts_builder`; the harness reports model `claude-opus-5-5`, requested opus-5.5-high)

Source: the fresh cross-provider report `sol-6.2-medium__20261127T180827Z` (three implementation blockers).

### Changes

1. **Held tooltip keeps its pick's winner** (`dom/interaction.ts`). The `S_HELD` state now records `q`, where the
   pick that drew the held tooltip was made (the pointer before the move that enters the hold). On a new commit
   the reconcile step picks there again on the new lookup, so `primary`, `anchor` and the hover event follow the
   same winning mark; a different target there drops the hold as before. Placement uses the winning mark's box
   in `S_HELD` as in `S_HOVER` (`(k | 1) === S_HELD`), so entering the hold no longer swaps to the union box.
2. **Point index capacity by the visible window** (`cartesian/lookup.ts`, `cartesian/repeats.ts`
   `repeatsIn`, also used by `cartesian/scene.ts`): repeats counted are `start[end] - start[start]`, as the scene does.
3. **Near-coincident circular centres** (`cartesian/lookup.ts` `lowerOf`): the fixed `1e-9` px slack became
   `(box + reach + (poly ? qx + qy : 0) / 10) * 1e-14` (about 90 ulps of the distances; polygons also scale with
   the page coordinates their vertices are rounded at). Leaf values stay `max(…, markerDistance)`, so true
   distances and the (dist, dx, slot) order are unchanged. New dev-only counters: `lastPickGeometry` (incremented
   where `markerDistance` runs, internal coincident nodes included, and for each rectangle measured at a leaf)
   and `pointCapacity` (the length of each of the point index's five typed arrays).
4. **Packed Chrome fixture** (`tests/dist/c5.browser.test.ts`): the repeated-x scatter loop waits for the select
   payload count and for the tooltip to close instead of fixed 60/120 ms delays; a standalone error bar
   (`#loneErr`) toggles by pointer, Enter and Space with painted-state checks.

### Regressions (each fails on the parent logic, checked by swapping the parent code back in)

- `test/dom/finition-interaction-lifecycle.test.ts` "W3 repair: a held Cartesian tooltip…" (real `createInteraction`
  on that file's DOM mock): unchanged commits (same frame and a new lookup) keep placement and raise no hover;
  changed data and a hidden series drop the hold; leave and Escape clear it; a passive peer cursor raises no hover
  across commits. With the parent `interaction.ts`: fails, `translate(203.5px, 136.2px)` vs `…81.8px`.
- `test/cartesian/n5-repair2.test.ts` "W3 integration repair 3…": capacity with 100,000 offscreen repeats at x = 0
  and 3 visible points (zoom [9.5, 12.5]) ≤ visible slots, zoomed picks exact; near-coincident cluster (doubles
  `1 + i·2⁻⁵²`, projected span > 0 and < 1e-9 px, checked in the test) picks the brute-force winner with ≤ 256
  nodes and ≤ 512 geometry evaluations; the earlier subpixel cluster's geometry is bounded too. With the parent's
  capacity and bound: fails, capacity 100,003 and 14,332 nodes.

### Measured (ran and saw)

- `npm run typecheck`: exit 0. `npx vitest run --configLoader native --no-cache`: 143 files, 2,487 tests passed.
- Size, by the src recipe (reproduces the parent's 133,982 / 135,968 / 158,981 / 120,512 / 140,818 exactly):

| bundle | `f6c6c22` base | parent | this round | cap / gate |
|---|---|---|---|---|
| `export { cartesian }` | 133,004 | 133,982 | **133,994** | ≤ 134,000 ✓ (6 B margin) |
| root `line` | 135,779 | 135,968 | 135,971 | +192 ≤ +200 ✓ |
| root `export *` | 158,789 | 158,981 | 158,982 | +193 ≤ +200 ✓ |
| static `line` | 120,343 | 120,512 | 120,520 | +177 ≤ +200 ✓ |
| static `export *` | 140,635 | 140,818 | 140,827 | +192 ≤ +200 ✓ |
| bare `import 'axylo/cartesian'` | 0 | 0 | 0 | ✓ |

  Lossless cuts that paid for the fixes: the held state spreads the tooltip content and copies points by spread;
  the window repeat count is one shared helper.

### Not done / not verified here

- Chrome (`c5.browser` incl. the changed W3 block, `cartesian.browser`, `n6-sync-dashboard.browser`), `npm pack`,
  the packed `subpaths.test.ts` sizes and the stats/sync bare-import checks: Director. The Sync declaration
  packing error is the known out-of-fence baseline issue; Sync source was not touched.

## Repair round: held winner + clipped circle bound (bounded_ts_fix, opus-5.5-medium)

- `dom/interaction.ts`: the S_HELD reconcile also drops the hold when the re-pick's winner
  (`lookup.primary`) differs from the last hover datum. A hold raises no hover, and category remaps already
  remap `#lastHover`, so no new state field is needed.
  Test: `finition-interaction-lifecycle.test.ts`, "…coincident with a line vertex, is hidden". **It also passes
  with the fix reverted**: in the DOM mock, the line vertex's tooltip after release looks the same as the
  silently swapped held one. It is not a discriminating regression yet.
- `cartesian/lookup.ts`: one-row circle nodes clear of the side edges are bounded by the clipped distance at
  `clamp(qx, x1, x2)`. That distance is convex and even in the horizontal offset, because only the top/bottom clip
  applies. A slack of 1e-14 relative is subtracted. Leaves and coincident centres stay exact. Tests in
  `n5-repair2.test.ts`: 100k centres 2 px above the plot spread over 0.045 px (≤128 nodes, ≤512 geometry;
  **16,388 nodes with the bound reverted**), and node + geometry bounds for the coincident-x whiskers.
- Size (src recipe, gzip-9; this recipe's base was ~133,997 vs dist 133,994): cartesian **134,061 — over the
  134,000 cap**. Interaction +14 B on root `export *` (≈ +207 vs +200: **over**), static +12 B.
  Lossless cuts still needed: ≈61 B in cartesian and ≈7 B in root.

## Repair round: size recovery (bounded_ts_fix, opus-5.5-medium, time-boxed; incomplete)

- Size recipe (src → esbuild with `PRODUCTION` + `stylesheetPlugin(minified)`, `legalComments: 'none'`, minify esm es2022,
  re-bundle, gzip-9) reproduced the turn-15 figures exactly before any edit: cartesian 134,061, root `export *` 158,998.
- `cartesian/lookup.ts` `markerDistance`: the Liang–Barsky direction is `(c & 1 ? 1 : -1) * (c < 2 ? ex : ey)`
  rather than four branches. This is lossless: `-1 * x === -x` for every double, including ±0. Cartesian −3.
- `cartesian/bar-geom.ts`: `laneWidth - +(lanes > 1)`. `dom/interaction.ts`: presentation flags use `+showTip | +pinned * 2 | … | +remote * 16`
  (both are booleans, so the values are the same).
  Tried and reverted: `options.ts` `index: +(pos !== 'left')` fails typecheck (`0 | 1`).
- Final, by the same recipe: **cartesian 134,055 (−6), still 55 B over**. **Root `export *` 158,994 (+205, 5 B over)**.
  Static was not measured.
  Tried and reverted: `(e - (vertical ? cx : cy)) ** 2` (+1 B).
  The coincident-mark lifecycle regression is still not discriminating.

## Repair round: size headroom + discriminating held-winner regression (`ts_builder`; requested opus-5.5-high, harness model `claude-opus-5-5`)

### Held winner (finding: the coincident regression did not discriminate)

- Why the old test passed with the winner check reverted (traced with temporary logging, since removed): the hold
  was kept and silently swapped to the line vertex, but `#present` still raised `b@2` because the presentation key's
  winning ref changed. The later "back" commit then dropped the hold through the anchor check anyway (the x target's
  anchor became the union box). Both trees gave the same events.
- New test `finition-interaction-lifecycle.test.ts` "a hold whose winner is hidden under a coincident mark becomes a
  plain hover that picks at the pointer": data with a slot at x = 2.4, whose 2 / 2.4 pixel midpoint (~306 px) lies inside
  the held tooltip's own box (203.5–323.5 px). While held, moving there raises nothing (a hold ignores corridor moves).
  The commit that hides the winning scatter must release the hold and pick again at the pointer: events `['b@2.4']`.
  It uses the real `createInteraction` on the file's DOM mock. No runtime test hooks were added.
- Mutation (ran): with ` || t!.kind === 'x' && !sameRef(lookup.primary(t!), this.#lastHover)` removed from the S_HELD
  reconcile, it fails with `expected [ 'b@2' ] to deeply equal [ 'b@2.4' ]`. That is the hold kept on the swapped
  vertex. The other 25 tests in the file still pass. Restored: 26/26 pass.
- Held-commit review: when the winner differs or disappears, `#dropHold(next, !down.d)` clears `#rest`. It then picks
  at the current pointer (a real hover, as shown above), or goes idle while a drag is pressed. No change was needed.

### Lossless size cuts (results, tie order, bounds and counters unchanged; no test changed)

- `cartesian/axes.ts` `positiveExtremaInRange`: repeated rows are visited per slot inside the slot loop
  (`visitRepeats`) instead of a second range loop (−24 B cartesian).
- `dom/interaction.ts`: `(k | 1) === S_HELD` for "hover or held" at the two `S_HOVER || S_HELD` tests, as the
  placement already did (comment at the state constants). The two `#rest` records spread `#pointer` (always a fresh
  `{x, y}`: `toLocal` / `{ x, y }`).
- `core/focus.ts` `alignedRows`: `new Set(given.map(…))` for the tooltip's series; the lookup reading is chosen with
  `(…) && read`.
- `core/controller-helpers.ts` `pointForDatum`: aligned and point refs on an aligned frame share one branch.
- `cartesian/lookup.ts`: `pointAt` returns a tuple; the compound marker size comes from `halfOf` (`m.size` is a
  number, and `2 * (s / 2) === s`); `row?.[i] ?? i` in `pick` and `datumText`. `cartesian/repeats.ts`: the same in
  `valueAtRow`, and `valuesText`'s visitor is an expression. `cartesian/reader.ts`: `series.some(repeatsOf)`, with
  no per-cell repeats guard (`valuesText` already returns null without repeats).
- Tried and reverted (larger): a shared `refAt` for aligned ref literals (+23), a `kindOf`-based `legendForOne`
  (+26), a `byPointer` helper (mixed, static line +10), reader repeat fold (+9), touch-start spread (+3), the
  `alignedRows` fallback object (+4), and dropping the braces from the view `widen` callback (+2).

### Measured (ran and saw)

- `npm run typecheck` (each `tsc` exit 0). `npx vitest run --configLoader native --no-cache`: **143 files,
  2,491 tests passed**, exit 0.
- `npm run build`, then the subpaths consumer's options over `packages/axylo/dist` (gzip-9). This gives the same
  numbers as the src recipe:

| bundle | `f6c6c22` base | start of round | final | cap / gate |
|---|---|---|---|---|
| `export { cartesian }` | 133,004 | 134,055 | **133,978** | ≤ 134,000 ✓ (22 B margin) |
| root `line` | 135,779 | 135,986 | **135,970** | +191 ≤ +200 ✓ |
| root `export *` | 158,789 | 158,994 | **158,962** | +173 ≤ +200 ✓ |
| static `line` | 120,343 | 120,532 | **120,499** | +156 ≤ +200 ✓, ≤ 120,729 |
| static `export *` | 140,635 | 140,833 | **140,808** | +173 ≤ +200 ✓, ≤ 140,988 |
| finance `candlestick` | — | — | 123,889 | ≤ 127,000 ✓ |
| stats / sync / export | 1,692 / 3,494 / 3,295 | same | same | ≤ 3,500 ✓ |
| bare import axylo, static, stream, cartesian, stats, sync, export | 0 | 0 | 0 | ✓ |
| `axylo.iife.min.js` file | 159,126 | — | 159,309 | legacy 158,425 already exceeded at base |

  No streaming markers are in the cartesian or finance bundle.

### Not done / not verified here

- Chrome suites, `npm pack` and the packed `subpaths.test.ts` are left for the Director. The packed Sync declaration
  failure is the known out-of-fence baseline issue, and no Sync source, manifest or script was touched.

## Repair round 4: `missing: 'zero'` on repeated scatter rows + varying-height clipped-circle bound (`ts_builder`; requested opus-5.5-high, harness model `claude-opus-5-5`)

Closes the two candidate blockers of the Sol review (`coordinator_p2_w3i/sol-6.2-medium__20261127T190420Z/report.md`).

### Changes

- `cartesian/repeats.ts` `collectRepeats`: a repeat is kept when the canonical reader (`readValues`, impute on) gives a
  number. That reader gives 0 for a null or absent value when the field has `missing: 'zero'` (its state stays
  missing), and NaN for an invalid value or a null without it. This is the policy the aligned frame applies to a
  slot's own row (`data/normalize.ts` `alignedSeries`), so the row order no longer decides imputation. The aligned
  frame gives a filled slot row -1. When such a slot has repeats, its own row's real source row is written into the
  series' row column. That column is a fresh `Int32Array` on the ordered path, which repeats always take. Point refs,
  `valueAtRow`, datum rows and event `index`/`row` then name the caller's row. Slots without repeats keep the
  aligned behaviour (row -1 for a filled value), as before. No borrowed column is copied or written.
- `cartesian/lookup.ts` `lowerOf`: for circles, a node whose centres all lie on or past one horizontal plot edge
  (`y2 <= plot.y`, or `y1 >= plotBottom`) is bounded at its most inward centre height (`y2` at the top, `y1` at the
  bottom).
  - Why this is a lower bound: a pointer is always inside the plot, so it only sees the plot's side of that edge.
    On that side, a disk moved outward at a fixed x shows a subset of what it showed. With side clipping excluded
    (the existing side check), the node's centres are then translates of one convex, mirror-symmetric shape, so
    the horizontally nearest centre x (clamped) is used as in the constant-height row bound.
  - Slack: the bound subtracts the existing relative slack whenever the node is not a single point (`x1 < x2 ||
    y1 < y2`). A node of coincident centres keeps its exact value, so exact ties prune as before.
  - Unchanged cases: polygons keep the old `y1 === y2` rule (the subset argument does not hold for every convex
    polygon); mixed-side and in-plot height ranges fall back to the box bounds; leaves still measure each centre
    exactly.
- Size, lossless (`lookup.ts`): `inPlot`'s comparisons already fail for NaN and ±Infinity, so the `Number.isFinite`
  guards before it in the centre-marker sink and in `anchor` were removed. The compound slot loop's x test became
  `!(px + xExtent >= plot.x && px - xExtent <= plotRight)`, which also rejects NaN. Tried and reverted: one
  condition for the bound (+4 B); `markerDistance` as a closure (+71 B); writing every own row of a repeated
  series (−12 B, but it widens behaviour past the finding).

### Regressions (fail on the parent: checked by swapping the reconstructed parent `lookup.ts` + `repeats.ts` back in; the reconstruction rebundles to exactly the parent's 133,978 B)

- `test/cartesian/w3-integration-repair4.test.ts` (new, 6 tests). The rows (1,2),(1,null),(2,4), the same with the
  null first, and an absent field in either position are checked under `missing: 'zero'`:
  - drawn points are (1,0),(1,2),(2,4) with no AX108;
  - AX102 is reported once with effect `changed`, and the null cases report nothing;
  - picks give point refs with the right source row, including the filled one; datum, anchor, aligned
    readout and table read `0, 2` / `2, 0`; row -1 is no datum;
  - controller hover and select carry `y: 0`, the caller's row object and its index, in both orders.
  - Guards: an invalid string stays omitted with AX106 in either order, and a null without `missing` stays a silent
    gap in either order.
  - **3 of 6 fail on the parent** (draw, pick/provenance, events). The 3 guards pass on both.
- `test/cartesian/n5-repair2.test.ts`, new describe "W3 integration repair 4" (7 tests):
  - 100,000 centres 2 px past the top or the bottom, 0.045 px wide (the review's fixture) or 0.004 px wide, with
    0.005 CSS px vertical spread. Further right is further out, so a node's nearest x and its most inward height come
    from opposite ends. The expected winner is worked out by hand: the pointer sits right of the cluster and 1 px
    inside the edge, so each centre's nearest point is the right end of its chord, at px + sqrt(r² − h²). At 0.045
    px wide the rightmost centre wins; at 0.004 px the leftmost wins, which is not the nearest-x slot a miss falls
    back to. The sampled painted-outline oracle confirms the winner. The tests assert nodes ≤ 128 and true
    marker-geometry evaluations ≤ 512.
  - Measured on the final tree: 31 nodes / 40 geometry at 0.045 px, and 55 nodes / 76–77 geometry at 0.004 px.
    On the parent: **16,387 nodes / 100,002 geometry** in all four, so all four fail there.
  - Bound-assumption tests (pass on both, since the parent never applies the relaxation):
    - 100,000 ulp-spaced centres at one height: an exact tie goes to the lowest slot, and the result still
      lands inside the 3 px slack.
    - A 64-centre mixed-height case designed so that bounding a leaf by its *outermost* height prunes the true
      winner. Mutation check: the outward-height variant (`y1` at the top) fails it by picking x = 100.19 instead
      of 100. The fast-check brute-force property below did not catch that mutation; this case does.
    - fast-check (120 runs, fixed seed): random clusters of 24–160 centres past either edge, at the left corner,
      the middle and the right corner, including exact-height ties. The picked centre must be as near as the
      nearest painted one (within 1e-6). Misses are not checked, because they fall back to the nearest x slot.

### Measured (ran and saw)

- `npm run typecheck`: exit 0 (all three `tsc`).
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache` (full Node suite, final tree): **144 files,
  2,504 tests passed**, exit 0. That is 2,491 + 13 new.
- `npm run build`, then a consumer over `packages/axylo/dist` with the subpaths test's esbuild options and gzip-9. The
  src recipe gave the same numbers.

| bundle | parent | final | cap / gate |
|---|---|---|---|
| `export { cartesian }` | 133,978 | **133,997** | ≤ 134,000 ✓ (3 B margin) |
| root `line` / `export *` | 135,970 / 158,962 | same | unchanged ✓ |
| static `line` / `export *` | 120,499 / 140,808 | same | unchanged ✓ |
| finance `candlestick` | 123,889 | same | ≤ 127,000 ✓ |
| stats / sync / export | 1,692 / 3,494 / 3,295 | same | ≤ 3,500 ✓ |
| bare axylo, static, stream, cartesian, stats, sync, export | 0 | 0 | ✓ |
| bare `axylo/finance` | 43 | 43 | pre-existing, not in this round's gate |

### Not done / not verified here

- No Chrome, pack, localhost or packed `subpaths.test.ts` runs, and no commits. Those stay with the Coordinator.
- No Sync source, manifest, build script, `public.ts` or `contracts.ts` change, and no existing test or cap edited.

## Repair round 5: clipped circles at the plot corners (`bounded_ts_fix`; requested opus-5.5-medium, harness model `claude-opus-5-5`)

- **Blocker.** A cluster of 100,000 circular centres with about 0.005 px of height spread, 0.453 px inside the left or right plot edge, picked the right winner but visited 16,387 nodes and 100,002 geometry evaluations. The tighter row bound in `lookup.ts` `lowerOf` was turned off for any node within half a marker of a side edge.
- **Fix** (`src/cartesian/lookup.ts`, one condition): circle rows now always use the bound at the virtual centre `clamp(qx, x1, x2)`. This is conservative because `pick` only accepts a `qx` inside the plot. Each horizontal slice of a clipped disk is its chord cut to the plot's x span. Moving a centre toward `qx` keeps every non-empty slice non-empty and moves no slice further from `qx`. This combines with the existing inward-height subset bound. The final distance is still the exact `markerDistance` with all four clip edges, and the existing slack and tie rules are kept. Polygon markers are unchanged: they keep the bound only for nodes with a single x.
- **Tests** (`test/cartesian/n5-repair2.test.ts`, "W3 integration repair 4"): 8 new 100k cases, one for each corner (top/bottom × left/right) at widths of 0.045 px and 0.004 px. The winner is worked out by hand as the chord end on the horizontal edge that reaches furthest into the plot. At the 0.004 px width it is the outermost centre, which differs from the slot a miss would fall back to. The painted oracle cross-checks the winner. Each case caps nodes at ≤ 128 and geometry evaluations at ≤ 512. Ran and saw: with the parent lookup, all 8 failed on the node cap (`expected 16387 to be less than or equal to 128`, after the winner assertions had passed). With the fix, all 63 tests in the file pass. The random corner oracle, the dense whisker cases and the exact/mixed geometry checks are unchanged and pass.
- **Measured** (ran and saw), using an in-memory esbuild run with `build.mjs` `PRODUCTION` and the minified stylesheet plugin, then `export { cartesian }` rebundled and gzip -9. Cartesian is **133,990 B**. Swapping only this line back gives 133,997 B, so the change is −7 B. Root (159,089) and static (140,922) are byte-identical before and after. The bare imports of cartesian, stats and sync are 0 B. `npm run typecheck` exited 0. Full Node suite: `Test Files 144 passed (144)`, `Tests 2512 passed (2512)`.
- **Not run:** `npm pack`, the packed `.d.ts`/subpaths suite and Chrome (left to the coordinator). The Sync declaration and the Director's temp configuration are still pending with the operator and were not touched.

## Final seal: packed `axylo/sync` declaration closure (`bounded_ts_fix`; requested opus-5.5-medium, harness model `claude-opus-5-5`)

- **Blocker.** `package.json` ships `dist/sync.d.ts` and `dist/public.d.ts` only, but `src/sync.ts` re-exported from `./sync/group` and `./sync/dashboard`. Their declarations are not in the tarball, so a consumer's `tsc` failed with `TS2307` (Bundler) or `TS2834` (NodeNext).
- **Fix** (`src/sync.ts`; `src/sync/group.ts` and `src/sync/dashboard.ts` deleted): the group code comes first, then the dashboard code, moved over without changing any runtime logic. The type imports come from `./public.js` (`ChartEvents`, `Point`, `Target`, `XValue`) and `./core/contracts`, which are used only in unexported internals and do not appear in the emitted `.d.ts`. The runtime import `./core/peer` (`SYNC`) stays the shared seam. `releaseAll` is no longer exported. The `export type { ChartEvents, Point, XValue } from './public.js'` line is kept. No unit test imported either deleted file, so no test changed.
- **Fixture** (`tests/dist/subpaths.test.ts`, the shared Bundler/NodeNext declaration check only): it now imports `createDashboard` and the types `Dashboard`/`DashboardPanel`. Two panels are made by the real typed factories `fixed.line` and `stream.line`, and the test calls `zoom`, `reset`, `ids`, `add`, `remove` and `destroy`. No cap, gate or other assertion was changed.

### Measured (ran and saw)

- `npm run typecheck`: exit 0 (all three `tsc`).
- `npm run build`: exit 0. The emitted `dist/sync.d.ts` has one import, `import type { ChartEvents, Point, Target, XValue } from './public.js'`, and the re-export `from './public.js'`. There is no `dist/sync/` directory.
- Manifest-only consumer (in the workspace's `.prism-cache/tmp`, no `npm pack`): only the 28 `files` entries of `package.json`, plus the manifest itself, were copied into `node_modules/axylo`. The fixture's `check.ts` was taken verbatim from `subpaths.test.ts`. `tsc` exited 0 under both Bundler and NodeNext, and the loaded `axylo` files were only the nine packed `.d.ts`. As a negative control, the old re-export `sync.d.ts` in the same fixture fails with 2× `TS2307` (Bundler) and 2× `TS2834` (NodeNext).
- Sizes: consumer over that fixture with the esbuild options from `subpaths.test.ts` (without the `fixtureGuard` plugin), gzip-9.

| bundle | before | final | cap / gate |
|---|---|---|---|
| `export * from 'axylo/sync'` | 3,494 | **3,494** (raw 6,853) | ≤ 3,500 ✓ |
| stats / export | 1,692 / 3,295 | same | ≤ 3,500 ✓ |
| bare `axylo/sync`, `axylo/stats`, `axylo/export` (`ignoreAnnotations`) | 0 | 0 | ✓ |
| group only (`createSyncGroup`, `syncCharts`) | — | 2,752, no dashboard code | — |

- `npm test -- --configLoader runner --no-cache` (full Node suite): `Test Files 144 passed (144)`, `Tests 2512 passed (2512)`.

### Director verification (ran and saw, by the Director, on parent `opus-5.5-medium__20261127T194202Z`)

The author evidence above is manifest-only: a hand-copied `files` set with no `npm pack`. Everything in this section comes from the Director's packed run of that exact parent candidate (log `p2_w3i_sync/verify/turn-4-opus-5.5-medium__20261127T194202Z.log`). The tarball was `axylo-0.0.0.tgz`, 31 files, 2,234,447 bytes, installed into both the `npm` and `script` fixtures.

- `npm run typecheck` (all three `tsc`) and `npm run build`: exit 0. Build emitted `sync.d.ts`, `sync.dev.js` and `sync.js`.
- `npm test` (full Node suite): `Test Files 144 passed (144)`, `Tests 2512 passed (2512)`.
- Packed `tests/dist/package-contents.test.ts`: `Tests 9 passed (9)`.
- Packed `tests/dist/subpaths.test.ts -t "cartesian|stats|sync"`: `Tests 8 passed | 9 skipped (17)`. The named filter skipped the other 9. The log prints only the counts and the two size lines. Matching the filter against the test names gives these 8: the `package.json` exports check, the bare imports of `axylo/cartesian`, `axylo/stats` and `axylo/sync` (0 raw bytes with `ignoreAnnotations`), the two size-cap tests, and both declaration fixtures (Bundler and NodeNext, which include the new typed `createDashboard` call). The caps are unchanged.
- Packed Chrome: `Test Files 3 passed (3)`, `Tests 10 passed (10)`. That is `c5.browser.test.ts` 3, `cartesian.browser.test.ts` 3 and `n6-sync-dashboard.browser.test.ts` 4.

| packed bundle (Director, gzip-9) | value | cap |
|---|---|---|
| `axylo/sync` | **3,494 B** | ≤ 3,500 ✓ |
| `axylo/stats` / `axylo/export` | 1,692 / 3,295 B | ≤ 3,500 ✓ |
| `axylo/cartesian` | 133,990 B | ≤ 134,000 ✓ |
| `axylo/finance` | 123,889 B | ≤ 127,000 ✓ |

### Review

- Parent candidate `opus-5.5-medium__20261127T194202Z`: unconditional cross-provider `Verdict: Merge` from `sol-6.2-medium__20261127T194506Z`.
- This ledger-only revision changes no source, test or configuration. The coordinator verifies it and gets a fresh review for the new candidate. The Director results above belong to the parent and are not re-run evidence for this candidate.
