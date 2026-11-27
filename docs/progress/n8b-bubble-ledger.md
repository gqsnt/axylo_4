# N8b ledger: `bubble` + `validateBubble` (Wave 4, Track B)

Status (current, Chrome seal `p2_n8b_seal`): the two Chrome failures reported by the Director (hover from
the small to the large bubble after a click; axe-core `region` on `#chart`) are repaired in the Chrome suite
only, no library source changed; see "Chrome seal (`p2_n8b_seal`)" at the end. Director `verify` exited 0 on the
browser-fix candidate `opus-5.5-medium__20261127T185721Z` (log `turn-2-opus-5.5-medium__20261127T185721Z.log`):
typecheck passed, full Node 139/139 files and 2377/2377 tests, real Chrome `n8b-bubble.browser.test.ts` 1/1 file
and 10/10 tests, zero axe violations in light, dark and forced colors with the table closed and open. The 50k
Chrome numbers are in "Director verify" at the end. These results were observed by the Director on that parent
candidate, not by this ledger-only worker; this file is the only change since, so the tested browser code is
the same.
Earlier status, kept for history: before that run the repaired Chrome suite had not been run by a worker (no
browser runs in the sandbox); before that, repair after the cross-provider rejection, Chrome suite then not run.
Earlier 50k numbers are in "Exact-code seal"; earlier 50k and bundle numbers are per revision.
No merge verdict is claimed here: merge is pending a fresh independent cross-provider review (last review:
"Merge after named fixes").
No commit. No edits outside `packages/axylo/src/spatial/bubble/**`, `packages/axylo/test/spatial/bubble/**`,
`packages/axylo/test/browser/chart/n8b-bubble.browser.test.ts` and this file. No edit to `public.ts`,
`core/**`, `render/**`, `theme/**`, `dom/**`, `package.json` or the build scripts.

## What the repair changed

1. **Renderer.** The bounded paint-group plan and its `outlines` fallback (and the AX189 presentation finding
   that announced it) are gone. Exact global painter's order is now drawn as **one opaque SVG path per series**
   that holds exactly the visible parts of that series' bubbles (`paint.ts`, below). The tests that enshrined
   the fallback (`falls back to outlines…`, the `planPaint` group-order properties, the 50k `fill/outline`
   expectations) were replaced by a rendering oracle.
2. **Size validation.** A NaN size is an AX187 omission whether it comes from a row or a typed column (it was
   silent "no data" for typed columns); its row stays in the table. A required size setting that is absent,
   reset (`undefined`/`null`), not a field name (`42`, `{ label }`, `''`), or names a field no row/typed column
   has is **AX150 for `size` with the chart-error effect**, raised by the call that set it. No bubble-only AX101.
3. **Keyboard.** Points without a drawn bubble (null or omitted size) are skipped by every step direction,
   `count`/`ordinal` and focus recovery, in the lookup and in the single-series `stepInSeries` part; focus is
   never left on a point without a bubble. Their rows stay in the table and export table.
4. **Size channel** is keyed by the `PointFrame` itself (`WeakMap<PointFrame, SizeChannel>`); a shared-series
   clone (`renamed()`'s `{ ...frame }`) is registered as an alias of the channel found through its series array.
5. **Picking** selects the containing bubble painted on top by rank in the painter's order (it compared drawn
   radii, which put a 2 px disc above a zero marker that is painted above it).
6. **Purity:** two bubble top-level expressions that a bundler ignoring annotations keeps (`Math.PI * 2`,
   `new Uint32Array(0)`) were removed; bubble-owned retained bytes are now 0 (below).

## Files

| File | What it holds |
|---|---|
| `src/spatial/bubble/index.ts` | `bubble()`, `validateBubble()`, `openBubbleChart()` (test hosts), `bubbleInternals()` (committed table, legend, size meta, latest drawn geometry); public types re-exported |
| `src/spatial/bubble/options.ts` | `BubbleOptions`, `SizeField`, `BubbleRadius`; size-column reader; AX187/AX188/AX189; AX150 for the size setting |
| `src/spatial/bubble/geometry.ts` | size channel (`WeakMap<PointFrame, …>` + series-array alias), radius rule, painter's order and rank, whole-circle `d` (hover overlay) |
| `src/spatial/bubble/paint.ts` | **new**: the visible map, one path per series |
| `src/spatial/bubble/composition.ts` | the per-chart `Composition` (`kind: 'scatter'`): resolve, layout, scene (one mark per series), `points` SVG drawer, lookup (pick, drawn-only keyboard), overlay, reader, size-legend `sliceList` |
| `src/spatial/bubble/table.ts`, `legend.ts`, `text.ts` | table with the size column; nested-circle legend; size readouts (unchanged) |
| `test/spatial/bubble/oracle.ts` | **new**: independent rendering oracle (SVG arc parser, nonzero winding, painter's-order owner) |
| `test/spatial/bubble/paint.test.ts` | **new**: oracle tests (alternating concentric, crossing discs, equal discs, tangencies, zero rings; two fast-check properties) |
| `test/spatial/bubble/validation.test.ts` | **new**: typed NaN, required size setting (validate = mounted), strict reset/recovery, keyboard skipping, frame-keyed channel |
| `test/spatial/bubble/bubble.test.ts` | radius, order, chart-level picture oracle and property, 50k, picking, diagnostics, updates, legend, readouts |
| `test/spatial/bubble/legend-dom.test.ts` | legend lifecycle on the real interaction layer (unchanged) |
| `test/spatial/bubble/bubble.entry.ts` | source entry for the Chrome test |
| `test/browser/chart/n8b-bubble.browser.test.ts` | Chrome suite, updated (not run) |

For the barrel (`p2_w4_wire`): `export { bubble, validateBubble } from './spatial/bubble'` plus
`export type { BubbleOptions, BubbleRadius, SizeField, SizeFieldOptions, BubbleChart } from './spatial/bubble'`.
`bubbleInternals(chart)` returns `{ table, legend, meta, geometry }`: `table` the committed reader `TableModel`
(every row of the view through `row(i)`, paged only by the DOM view), `legend` the size-legend model, `geometry`
the latest drawn bubbles (its paths: `paintedMap(geometry, seriesCount).series[s].d`).

## The renderer: exact painter's order in one path per series (`paint.ts`)

The rejection was right: SVG paints a path in one colour all at once, so paths of whole circles cannot follow a
painter's order that interleaves series. The renderer therefore computes the picture the painter's order
produces and gives each series the boundary of the region it owns.

* **Picture.** Painter's order: largest first; equal radii by source row (then series), so the smallest and
  then the latest is on top; a zero marker above every disc. Every shape is opaque. A positive size is a disc of
  radius r in its series colour ringed by a **1 px unpainted band** (`GAP`), so a bubble over another of the same
  series keeps a visible edge (the plot shows through). A zero size is a 1 px ring at radius 3 (2.5–3.5 px) with
  a 1 px unpainted band on each side and a see-through hole. A point is owned by the topmost shape containing it
  and painted with that shape's band there.
* **Arcs.** Every band edge is a circle. Per circle: (1) subtract the angles covered by higher shapes' occupied
  annuli, stopping as soon as nothing is left (a tangent or coincident higher edge counts as covering, so equal
  discs are drawn once); (2) when the side away from the bubble's own bands shows lower shapes, split the visible
  angles where lower circles cross **or touch** (a tangency is a cut, so no piece's midpoint lies on another
  circle) and read the lower owner of each piece 1e-7 px off the circle on that side (a coincident lower circle
  falls on the side it bounds); (3) a piece whose two sides have different owners goes to the inner owner
  traversed with increasing angle and to the outer owner reversed. Each series' pieces are then the oriented
  boundary of its region (nonzero fill).
* **Contours.** Pieces are joined at end points: end points within two 0.01 px lattice steps are one vertex,
  transitively (union-find), because a vertex shared by two circles is computed from each. Every SVG arc spans
  at most 2π/3 (a near-half-turn arc turns 0.01 px rounding of radius and ends into a centre shift of ~0.2 px;
  observed in the stress property before the limit). `open` counts contours that did not return to their start.
* **Cost.** Uniform grid of centres (cell = half the largest occupied radius); per bubble the shapes whose area
  can meet its own; the cover test visits them in a scattered order (stride coprime with the count) so a covered
  circle, the common case when dense, stops early; only visible circles look at lower shapes, scanned by rank
  from the top down so the first container wins.
* **Drawer.** The `points` drawer writes the series' `d` (`data-bubble="series"`), `fill: currentColor`,
  `fill-rule: nonzero`, no stroke. The hover/focus overlay (unchanged role) draws the target bubble whole and
  opaque above everything with a 2 px ring, so a bubble can always be seen whole when pointed at.

### Oracle (Node, ran and saw)

`test/spatial/bubble/oracle.ts` shares no code with the renderer: it parses `d` with the SVG 1.1 F.6.5
endpoint-to-centre rules (radius scaled up when too small), flattens arcs at 0.01 rad, and evaluates the nonzero
winding at sample points (random, plus ±0.15 px around every band edge); the expected owner is computed by
painting the shapes in its own order. Points within 0.05 px of an edge are skipped. Checked: 12 alternating
concentric discs A ⊃ B ⊃ … in both row orders; three interleaved crossing series; equal discs; external and
internal tangency; zero rings over discs of their own and another series; a fast-check property (integer +
quarter positions, up to 18 shapes, 3 series, 120 runs) and a float32 property (up to 40 shapes, 4 series, 200
runs); through the chart: the A/B/A/B fixture with crossing discs and a zero marker (both row orders) and a
property over random rows (60 runs). Every case: zero mismatches, zero open contours. A one-off stress run of
the float32 property at 1,500 runs (40 shapes, 4 series) also passed (scratch file, removed). Mutation check (ran
and saw, then restored): writing the outer owner's pieces with the inner orientation fails 4 of 4 oracle tests;
letting a higher bubble of the same series not cover fails 2 of 4 (both properties).

## 50,000 bubbles (input to N11)

Fixture (same in Node and Chrome tests): `n = 50,000`; Park–Miller LCG `seed = 7; seed = seed·16807 mod (2³¹−1)`;
per row `x = rand·1000`, `y = rand·1000`, `s = i % 97 === 0 ? 0 : rand·1e6`, series `['a','b','c'][i % 3]`;
typed columns; `bubble({ title: '50k', x: 'x', y: 'y', size: 's', series: 'g' })`; plot container 720 × 420.

**Node, ran and saw** (recording host `test/finance/host.ts`, three runs):

```
TMPDIR=$PWD/.prism-cache/tmp npx vitest run packages/axylo/test/spatial/bubble/bubble.test.ts --configLoader native --no-cache -t "50,000" --silent=false
[N8b 50k] Node recording host: create 31.0 ms, first frame 25.7 ms, visible map + d 1532.3 ms, 38 scene marks, 7 svg nodes, 3 bubble paths, d bytes 452924 + 466000 + 463587 = 1382511, pieces 11943/12298/12225, contours 3207/3258/3291, circles 101032 (culled 85156)
[N8b 50k] Node recording host: create 34.2 ms, first frame 26.4 ms, visible map + d 1536.4 ms, ...same counts and bytes
[N8b 50k] Node recording host: create 33.6 ms, first frame 24.7 ms, visible map + d 1593.9 ms, ...same counts and bytes
```

(`node v24.21.0`, 20 cores.) `d` bytes: **1,382,511** in **3** paths (452,924 + 466,000 + 463,587), 36,466
circle pieces in 9,756 closed contours, **0 open contours**; 101,032 band circles considered, 85,156 entirely
covered by higher shapes.

Phases: *create* = `openBubbleChart` → controller create; *first frame* = the first animation frame on the
recording host (layout, scene, lookup, reader; the host records the scene and never calls the SVG drawer);
*visible map + d* = `paintedMap(geometry, 3)`: the planar map and every `d` string the drawer writes (computed
once per geometry and cached). No DOM write is measured in Node.
SVG nodes: renderer-equivalent count for the scene marks (grid/tick rule runs merged as `SvgRenderer.draw`
merges them); asserted ≤ 25, and exactly three bubble paths, one per series. Previous candidate for comparison:
6,533,585 `d` bytes in 6 paths with the order lost in the fallback; now ~1.38 MB in 3 paths, order exact.
Cost note: the visible map is ~1.6 s in Node at this density (each circle meets ~1,000 neighbours); the scene
and lookup are unchanged (~20 ms).

**After the review repairs (2026-11-27), Node, ran and saw** (same fixture and command, `--configLoader runner`,
three runs):

```
[N8b 50k] Node recording host: create 30.0 ms, first frame 29.7 ms, visible map + d 1526.5 ms, 38 scene marks, 7 svg nodes, 3 bubble paths, d bytes 452984 + 466027 + 463621 = 1382632, pieces 11943/12298/12225, contours 3207/3258/3291, circles 101032 (culled 85156)
[N8b 50k] Node recording host: create 29.7 ms, first frame 26.2 ms, visible map + d 1542.4 ms, ...same counts and bytes
[N8b 50k] Node recording host: create 31.5 ms, first frame 24.6 ms, visible map + d 1483.5 ms, ...same counts and bytes
```

`d` bytes now **1,382,632** (+121 B against 1,382,511): the same pieces and contours, but painting visits the
distinct shapes in (x, y, r) order, so contours start at other pieces. Visible map + d: 1,483–1,543 ms.

**50,000 coincident bubbles** (all at (100, 100), r = 24, series `row % 3`; `repair.test.ts`): before the
repair 388 ms at 10k, 1,326 ms at 20k, 7,978 ms at 50k (reviewer's measurement, quadratic candidate
enumeration). After: `paintedMap` reports `painted = 1` distinct shape and `pairs = 0` neighbour pairs
enumerated (the asserted work counter), ~7 ms at 50k (ran and saw, `$TMPDIR/repro.mjs`); one non-empty path
(series 1, row 49,999 on top). Every row stays in the geometry, the pick grid and the table.

**Chrome, still to run** (`n8b-bubble.browser.test.ts` "50,000 bubbles…" logs `[N8b 50k Chrome] {created, drawn,
frames, sceneNodes, svgElements, bubblePaths, paints, dBytes, bubbles}`; `drawn` = create until the bubble paths
are in the document; asserts `.axylo-scene` children ≤ 25 **and every element of the chart's SVG
(`svg.querySelectorAll('*')`) ≤ 25**, paints `['0:series','1:series','2:series']`,
50,000 bubbles in the committed geometry). Numbers to be recorded here by the Coordinator.

## Size validation and the controller (traced)

* `size`/`radius` are not controller encoding keys (`core/stages.ts` `ENCODING_KEYS`): a size-only patch takes
  the presentation path and keeps the frame. Everything about sizes is read in the composition's `resolve`,
  which every update path calls, and reported into the call's option sink.
* `core/controller-helpers.ts` `dataFindings` keeps **AX100/AX101** with the data call that raised them
  (`dataOptions`) and, on calls that keep the data, drops new ones from the option sink and re-adds the retained
  ones. A bubble-only AX101 therefore could not be raised by a size-only reset (a strict reset passed) and,
  raised on a data call, stayed after the size was fixed (sticky error state). The size setting is now reported
  as **AX150 (`size`, chart-error)**, as `data/options.ts` does for a scatter given several y fields: option
  findings are regenerated every call, so it is raised, rejected under strict synchronously, and cleared exactly
  with the setting. The message names the field asked for, the fields there are, and a near match.
  `validateBubble` runs the same resolver, so it reports the same diagnostics as a created chart (tested for
  seven variants: absent, `null`, `42`, `{ label }`, `''`, a missing row field, a missing typed column).
* All rows lacking the field is one AX150, not AX102 per row; some rows lacking it stays AX102.

## Defaults and behaviour the brief left open (assumed here)

| Topic | Chosen |
|---|---|
| Radius | `r = max · √(v / dMax)`, `dMax` = largest drawable size over all drawable series of the frame (not the zoom window or visibility). Defaults `radius.min = 2`, `radius.max = 24` CSS px; `0 ≤ min ≤ max ≤ 1000`, otherwise AX150 and the default |
| Area proportionality | exact for positive sizes the floor does not lift; the `radius.min` floor is the one exception |
| Paint | opaque series colour, 1 px unpainted ring around each disc; zero size: 1 px ring at r 3, see-through hole |
| Null / `''` | "No data", silent (F2); not drawn; skipped by the keyboard; in the table as "No data" |
| NaN, ±Infinity, negative | AX187 (warning, `omitted`), rows or typed columns alike, counted once per field with the first 10 source rows; not drawn; skipped by the keyboard; in the table (NaN as "No data", others as given) |
| Absent key in some rows | AX102 (omitted) |
| Size setting absent, reset, invalid, or naming no field | AX150 for `size`, chart-error (error state; strict rejects) |
| Strings | as a y field: all plain decimals → parsed + AX104 hint; `parse: 'number'` → parsed; otherwise AX106 |
| AX188 | warning, effect `none`: at least one size and every size zero |
| AX189 | hint, effect `none`: more than 10,000 rows with a drawable size (`DENSE_BUBBLES`) |
| Pick | among discs containing the pointer (`d ≤ r + 0.5`, a zero marker's disc of radius 3), the one painted on top (rank); outside every disc: nearest edge within 24 px, ties within half a device px → later row |
| Keyboard | scatter order (x, then y) over drawn bubbles only; `count`/`ordinal` over drawn bubbles; from an undrawn or vanished point, the nearest drawn one after it, else before it |
| Table / export table | every point of the view, drawn or not (the table follows the zoom window, as scatter's does) |

## Bundles (Node / esbuild, ran and saw)

Script: `.prism-cache/tmp/n8b/check.mjs` (scratch, not part of the patch): esbuild 0.28, ESM, `target es2022`,
`define { __DEV__: 'false', __BENCH__: 'false' }`, minified, gzip level 9.

| Check | Result |
|---|---|
| `import 'src/spatial/bubble'` (side effects only), annotations honoured | **0 B** |
| same with `ignoreAnnotations: true` | **25,347 B, 0 B from `spatial/bubble/**`** (was 51 B: `Math.PI * 2` in paint.ts, `new Uint32Array(0)` in composition.ts, both removed). Retained, all pre-existing and outside the fence: `theme/css.ts` 24,903 B (top-level `forced = [...LIGHT.series.map(…)].join()` and the `AXYLO_CSS` template that interpolates it), `theme/palette.ts` 396 B (`LIGHT`, read by it), `scale/time.ts` 47 B (two top-level array literals). `import 'src/finance.ts'` under the same flag: 25,372 B, a superset (5 modules). Each bubble module alone: 0 B bubble-owned |
| Wrapper / module splitting | not able to remove the 25,347 B inside the fence: `bubble()` must reach `core/chart.ts` (static chart), which imports `theme/css.ts`; under `ignoreAnnotations` esbuild also ignores `sideEffects`, so any reachable impure top level stays. Splitting `validateBubble` from `bubble` does not help a bare `import 'axylo/spatial'` (the barrel reaches both). Making `bubble()` reach the chart lazily would need a dynamic `import()` (async API). The fix is in `theme/css.ts` (build `forced`/`AXYLO_CSS` inside a function or a `/* @__PURE__ */`-free lazy getter) and `scale/time.ts`: core edits, not made |
| SSR: bundled `export { bubble, validateBubble }` imported in plain Node (`typeof document === 'undefined'`) | imports; `validateBubble` (typed `s = [1, NaN, -1]`) → `[["AX187","warning",2,[1,2]]]`; without `size` → `[["AX150","size"]]`; `bubble('#chart', …)` throws only when called (`Axylo: no document to find the target "#chart" in.`) |
| `export { bubble, validateBubble }` | 356,351 B raw / 131,103 B gzip; `export { validateBubble }` 51,565 / 19,428 (it includes `paint.ts` through `composition.ts`; the resolver lives there) |
| root `src/index.ts`, `src/static.ts` | 0 `spatial` inputs in the metafile; 443,981 / 162,488 and 393,926 / 145,278 B (raw / gzip -9). No input of either was edited: legacy delta 0 B by construction |

## Verification (Node, ran and saw)

See the report at the end of this cycle for the exact last lines; commands:

```
npx tsc -p packages/axylo --noEmit && npm run typecheck
TMPDIR=$PWD/.prism-cache/tmp npx vitest run packages/axylo/test/spatial/bubble --configLoader native --no-cache
TMPDIR=$PWD/.prism-cache/tmp npx vitest run packages/axylo/test/spatial/bubble --configLoader native --no-cache -t "50,000" --silent=false
TMPDIR=$PWD/.prism-cache/tmp npx vitest run --configLoader native --no-cache          # whole Node suite
```

After the review repairs (ran and saw, workspace-local caches):

```
export TMPDIR=$PWD/.prism-cache/tmp npm_config_cache=$TMPDIR/npm VITE_CACHE_DIR=$TMPDIR/vite NODE_COMPILE_CACHE=$TMPDIR/ncc
npm run typecheck                                                                     # exit 0
npx vitest run --configLoader runner --no-cache packages/axylo/test/spatial/bubble    # 5 files, 60 tests passed
npx vitest run --configLoader runner --no-cache packages/axylo/test/{spatial,lookup,finance,core}  # 44 files, 585 passed
```

## Chrome, still to run (Coordinator / Director, outside the sandbox)

The browser test starts Chrome through `acceptance/short-tmp.ts` (`startWithShortTmp(start, { engine: ENGINE })`),
so a deep workspace-local `TMPDIR` works; set `TMPDIR` and `npm_config_cache` inside the workspace, not `/tmp`.

```
AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser/chart/n8b-bubble.browser.test.ts
```

(builds `test/spatial/bubble/bubble.entry.ts` with `openEntry`.) Covers: multi-series size legend beside series
toggles; hover and click on a small bubble inside a large one of another series; **the unhovered picture checked
with Chrome's `isPointInFill` (nonzero) on every series path against the painter's order** for alternating
concentric series with crossing discs, a zero marker and equal discs (both row orders), and for the multi-series
fixture; tooltip, `aria-valuetext` and table text; zoom; axe-core light / dark / forced colors with the table
open and closed; single-series legend refresh and destroy; the 50,000-bubble DOM bound and timing. Bubble
positions come from `bubbleInternals(chart).geometry`. None of it has been run.

(History: this section describes the suite before the Director's first Chrome run. That run and the seal repair
are recorded in "Chrome seal (`p2_n8b_seal`)" at the end.)

## Review repairs (2026-11-27)

- Paint: `ownerAt` uses exact containment (the sample is 1e-7 px off the circle; the old 1e-6 tolerance skipped a
  lower shape whose edge coincides, e.g. a zero ring's inner edge on a 0.5 px disc's gap edge). Fixes the
  concentric fill and the reviewer's minimized open-contour fixture; 400 seeded half-pixel lattice fixtures
  (many coincident centres) give 0 open contours and agree with the oracle.
- Positive radii are painted and picked at no less than `MIN_DRAWN_RADIUS = 0.5` px (`paintedRadius`, applied in
  the geometry and the legend; `radiusOf` itself is unchanged, so the area rule and its tests are as before).
- Exact duplicate shapes (same x, y, r) collapse onto the topmost before neighbour enumeration (`distinctShapes`).
- Nearest edge: a second pass against the true minimum (latest row within the tie window).
- Keyboard step, count, ordinal, anchor and focus recovery use the drawn geometry, so a centre outside the
  plotted domain is skipped (single-series stepping uses the geometry the view was last looked up with).
- Export: `bubbleInternals(chart)` reads one snapshot of `controller.drawn` (meta, reader table, legend, geometry,
  revision); an accepted-but-not-drawn update is not seen, `table: false` gives `table: null`, destroy gives null
  and drops the state's references. `snapshot()` returns the object whole.
- AX160 for the size format through `Composition.layout.layoutDiagnostics` (the seam the stock axes use): the
  legend's reference values and the summary range are formatted there; a throw marks the meta and AX160
  `{ field: size field }` is reported. (Superseded: lazily formatted rows now report too; see the fifth review
  repairs.)

## Fifth review repairs (2026-11-27, `sol-6.2-medium` report, five required findings)

1. **No radius floor beyond `radius.min`.** `paintedRadius`/`MIN_DRAWN_RADIUS` (0.5 px) removed; the radius of
   `radiusOf` is the one painted, picked, anchored and shown in the legend. `BubbleGeometry.r` is now a
   `Float64Array`, so a positive radius below Float32's range never becomes a zero marker. Paths, halo, focus and
   legend circles are written at 0.01 px for radii ≥ 1 px and at 0.0001 px below (`geometry.scaleFor`). Tests
   (`repair.test.ts`, expected radii from r = max·√(v/vMax)): `{ min: 0, max: 24 }` with sizes 0.0001 and 1 gives
   0.24 and 24 px in geometry, anchor and written arcs (area ratio 0.0001 to 1e-12), legend 24 / 12 / 24·√0.05;
   `{ min: 0, max: 0.25 }` with sizes 1, 4, 100 gives 0.025, 0.05, 0.25 in geometry and arcs, legend 0.25 /
   0.125 / 0.25·√0.05. The 0.01 px end-point join lattice is unchanged: a piece of a sub-pixel circle shorter
   than 0.02 px still merges into its neighbours' vertex (whole small circles are unaffected).
2. **Contours / zero-ring picking.** Cause of the open contour: step 1 culls a lower edge within `EPS` (1e-6 px)
   beyond a higher shape's reach, while the owner sample sat `OFF` = 1e-7 px off the circle, so a 5e-7 px sliver
   was both culled and sampled inside: neither circle bounded the region beyond. Now the owner lookup skips
   exactly the lower edges step 1 culls (same expression on the same operands, `dbj + radius <= reach + EPS`),
   and `OFF = EPS/2` stays inside every sliver that is drawn. No snapping tolerance was widened. The four rows
   close (0 open) and (54.25, 51.25) has winding 0 in both series; a fast-check property (300 runs) over equal
   radii, disc-on-gap edges, internal and external tangencies perturbed by 0 to 1e-4 px (with a zero ring or a
   third disc) checks 0 open contours and the oracle picture — it found the δ = EPS boundary case before the
   shared predicate was introduced. Picking: a zero marker contains only its ring (ZERO_RADIUS − 1 … + 0.5); its
   hole is a fallback distance of 0, so a radius-2 disc under a zero ring at the same centre is picked at the
   centre, an isolated ring still from its hole.
3. **Bounded work.** A concentric cluster (every distinct painted shape at one exact centre) is painted by a
   radial sweep (`concentricMap`): band edges sorted, a max-heap of active shapes by paint rank, a full circle at
   each owner change; O(n log n), `pairs = 0`. Single-series stepping uses a cached ascending `Int32Array` of
   the series' drawn point indexes and binary search (O(log n) per key after one O(n) pass).
4. **Export legend.** The lookup stores its legend model per layout; `bubbleSnapshot` reads it and calls no user
   code (a counting format is not called by snapshot reads; a format that destroys the chart when called is not
   called, the snapshot is returned, and destroy afterwards gives null).
5. **Lazy AX160.** The first throw of a size format for a meta (any row, any time) calls
   `ControllerCore.schedule()` once (`text.watchSizeFormat`, deduplicated per meta; schedule only requests a
   frame, so nothing re-enters update or a frame). `layoutDiagnostics` formats the legend references and range
   once per layout (not per frame) and reports AX160 `{ field }` with effect **`changed`** while the meta has
   failed, so the reader note says it. Test: sizes 1, 37, 100, format throws only for 37: no AX160 until the 37
   row is read from the table, then one AX160 in `chart.diagnostics` and one `onDiagnostic`, reader note set,
   no repeat on further reads. **Hook needed for compact / non-ready states:** the controller calls
   `layoutDiagnostics` only when `shown.kind === 'ready' && !compact` (`core/controller.ts:1562`); a lazy
   failure in a compact or non-ready chart is reported once it next draws ready and noncompact. Same-frame
   delivery there needs the controller's value-formatter reporter (`#addPresentation('format', AX160 'changed')`,
   `core/controller.ts:324`) exposed to the composition, e.g. `ControllerCore.reportFormat(field: string)`.

### Measured (Node, `node v24.21.0`, ran and saw)

| case | paintedMap ms | pairs | contours (s0,s1,s2) |
|---|---:|---:|---|
| 6,000 at one centre, r = 2 + 22i/6000 | 7.0 | 0 | 1,0,0 |
| 50,000 at one centre, same rule | 24.8 | 0 | 1,0,0 |
| 2,000 at one centre + 1 other bubble | 87.6 | 3,998,001 | 2,0,0 |
| 6,000 at one centre + 1 other bubble | 520.3 | 35,994,000 | 2,0,0 |

**Limit:** the sweep applies only when every distinct shape shares one centre; one other point anywhere puts
the whole plot back on the general step, quadratic in the cluster (≈ n² pairs). A per-centre-group hybrid
(sweep inside a group, general step between groups) is the next step and is not built.

Ledger 50k fixture after these repairs (same command as above, two runs): create 30.5 / 29.7 ms, first frame
25.0 / 25.7 ms, visible map + d 1,526.8 / 1,563.0 ms, 3 bubble paths, **1,382,632** `d` bytes
(452,984 + 466,027 + 463,621), 0 open, 7 scene-equivalent SVG nodes. Unchanged bytes: every radius here is
≥ 1 px, so the finer precision is not used. A second random 50k fixture (seed 42, 960 × 600, s ∈ [1, 100]):
create 33.8 ms, first frame 33.8 ms, paint 1,063.2 ms, 3 paths, 1,635,798 bytes, 0 open.

Tests: `packages/axylo/test/spatial/bubble` 6 files, 72 tests passed (`review5.test.ts` new, 11 tests);
spatial + lookup + finance + core 45 files, 597 tests passed; `npm run typecheck` passed. Chrome not run.

## Distribution recipe for `axylo/spatial` (for the Director's `p2_w4_wire`; verified in memory against the bubble entry)

Stage 1 builds the entry as `scripts/build.mjs` builds the other subpath files, **with `stylesheetPlugin` in both
the production and the development build** (today the `.dev.js` entries get no plugin):

```js
import { stylesheets, stylesheetPlugin, PRODUCTION, DEVELOPMENT } from './scripts/build.mjs';
const { readable, minified } = await stylesheets();
const common = { entryPoints: ['packages/axylo/src/spatial.ts'], bundle: true, target: 'es2022', legalComments: 'none', format: 'esm' };
build({ ...common, define: PRODUCTION, plugins: [stylesheetPlugin(minified)], minify: true, outfile: 'dist/spatial.js' });
build({ ...common, define: DEVELOPMENT, plugins: [stylesheetPlugin(readable)], minifySyntax: true, outfile: 'dist/spatial.dev.js' });
```

`minifySyntax: true` on the development stage 1 (identifiers and whitespace stay readable) folds the shared
`format/time` constant arrays an unminified consumer would otherwise keep: 0 B for the development file with an
unminified consumer too (reviewer's probe, esbuild 0.28.2; not re-run in this pass).

Stage 2 (the check): bundle `import '<stage-1 file>'` with `bundle: true, format: 'esm', ignoreAnnotations: true`.
Ran and saw with `src/spatial/bubble/index.ts` as the entry (`$TMPDIR/twostage.mjs`, esbuild in memory):

| stage 1 | stage-1 bytes | bare import, minified | bare import, not minified |
|---|---:|---:|---:|
| production, minified CSS literal | 349,897 | **0** | **0** |
| development, readable CSS literal | 737,309 | **0** | 177 |
| development, no plugin (as `.dev.js` is built today) | 736,316 | 25,290 | 25,850 |
| production, no plugin | 358,390 | 25,290 | 25,437 |
| source entry, no stage 1 | – | 25,347 | – |

The 177 B are two constant arrays of the shared `format/time` module (`tickParts`, `disambiguators`, enum
`|` expressions) that esbuild keeps only when it does not minify; no bubble-owned code. From the production
file, `export { bubble, validateBubble }` imported in plain Node (no DOM) is synchronous: `typeof bubble` is
`function`, `validateBubble` returns `AX187` for a negative size. The source-level gate (no stage 1) still
retains 25,347 B of shared CSS, palette and time code; that is a source-vs-distribution distinction, closed only
for distribution files. The Director must re-run stage 2 on the wired `dist/spatial.js` **and**
`dist/spatial.dev.js` (with heatmap included).

## Unresolved

1. The 25,347 B retained under `ignoreAnnotations` at source level are core modules (`theme/css.ts`,
   `theme/palette.ts`, `scale/time.ts`), pre-existing and shared with `axylo/finance`; removing them needs core
   edits. The distribution files reach 0 B with the recipe above.
2. The 50k visible map costs ~1.5 s in Node (measured above); Chrome time not measured. It is computed once per
   geometry (layout × view) and cached; a size-only, zoom or resize update recomputes it. A concentric cluster
   sharing the plot with any other bubble is still quadratic (fifth repairs, measured limit).
3. Lazy AX160 is delivered through a scheduled ready, noncompact frame; compact / non-ready charts need the
   controller hook named in the fifth repairs (item 5).
4. The configured Coordinator verify command hard-codes `TMPDIR=/tmp npm_config_cache=/tmp/prism-npm-cache`
   (observed in the process list of `run_model.py coordinator-run ... --job-id p2_n8b`), against the
   workspace-local scratch rule.
4. Generated name, summary and plot role say "Scatter"; the size sentence of the summary is English only. Both
   need `Messages` entries (`public.ts`). Proposed contract change: `typeBubble?: string` and
   `bubbleSizeSummary?: string` ('Bubble area shows {label}, from {min} to {max}.').
5. The single-series legend refresh is scheduled from the lookup stage (a microtask after the frame) because the
   toolbar does not call `sliceList` again for a single series' size, data or locale change.
6. Running the whole Node suite creates `apps/docs/.cache/types/` (gitignored, made by `apps/docs` tests).

## Repair R6 (2026-11-27): purity literal, radius precision, AX160 on empty charts

**Purity.** `paint.ts` `const OFF = EPS / 2` → `const OFF = 5e-7` (same value; a literal, so no retained top
level under `ignoreAnnotations`). Ran and saw (`$TMPDIR/twostage.mjs`, lockfile esbuild, entry
`src/spatial/bubble/index.ts`, stage 1 with `stylesheetPlugin`, dev stage `minifySyntax: true`):

| stage 1 | stage-1 bytes | bare import, minified | bare import, not minified |
|---|---:|---:|---:|
| production, minified CSS literal | 352,633 | **0** | **0** |
| development, readable CSS literal | 699,134 | **0** | **0** |

Raw-source probe (`import 'src/spatial/bubble/index.ts'`, `ignoreAnnotations`, minify, PRODUCTION define):
25,347 B total, **0 B from `spatial/bubble/**`**; shared (outside the fence): `theme/css.ts` 24,903,
`theme/palette.ts` 396, `scale/time.ts` 47. The wired `axylo/spatial` artifact (with heatmap) is still the
Director's to check.

**Radius precision.** Radii (and the whole-circle diameter step of focus/halo `circlesPath` and the composition
ring path) are written by `geometry.writeRadius`: 7 significant digits (`String(Number(r.toPrecision(7)))`),
relative error ≤ 5e-7. End points stay on the `scaleFor` lattice (0.01 px ≥ 1 px, 0.0001 px below); arcs span
≤ 2π/3, so the chord (≤ r·√3 + 0.02) stays below the diameter and the renderer never rescales the written
radius. Legend `r` uses the same writer. Tests: `test/spatial/bubble/precision.test.ts` — `max: 1.006` writes
`1.006` in painted arcs, focus path and legend; sizes 1, 2 at `max: 24` (radii 24·√½, 24) keep area ratio ½
within 1e-6 in path and legend; fast-check for any r in [1e-6, 1000]. `legend-dom.test.ts` third reference
radius expectation moved from the 0.01 rounding to the 7-digit rule (rule change requested, not a loosening).

**50k (same fixture as above), two Node runs:** create 32.0 / 29.3 ms, first frame 24.6 / 26.5 ms, visible map +
d **1,536.8 / 1,548.9 ms**, 7 svg nodes, 3 bubble paths, **d bytes 537,622 + 552,135 + 549,499 = 1,639,256**
(+256,624 B, +18.6 % against 1,382,632: longer radius digits in every arc). Pieces/contours unchanged.

**AX160 for inspectable empty charts — not repaired, needs Director.** Repro: valid x, every y `null`, sizes
`1, 37, 100`, a size formatter that throws only for 37; read the table so 37 is formatted; drain frames → no
AX160 in `chart.diagnostics` / `onDiagnostic`, no reader note. Cause in source: bubble's lazy failure only calls
`controller.schedule()` and relies on `composition.layout.layoutDiagnostics`, which `core/controller.ts`
(`#layoutStage`, `const layoutDiags = shown.kind === 'ready' && !compact ? … : undefined`) calls only when the
chart is ready. The reporter that would serve it, `Controller.#formatterFailed(field)` (adds AX160 to the
`'format'` presentation stage), is an ECMAScript-private method: no seam reachable from `spatial/bubble/**`
without editing core or adding a shadow channel. Hook needed (core-owned): expose a public
`reportFormatFailure(field: string): void` on the controller (or pass it in the composition context) that calls
`#formatterFailed`, then bubble's `watchSizeFormat` callback calls it with `field = meta.field` (the size field) instead of
`schedule()`; add the empty-table regression with it.

## Exact-code seal (2026-11-27): whole-circle repair, independent measurement

Source: independent review `sol-6.2-medium__20261127T182458Z` (`report.md` under
`runs/coordinator_p2_n8b/`), run on the exported candidate whose SHA-256 matches the seal. This revision is
R6 plus the whole-circle repair in `paint.ts`: a whole circle is two relative semicircles with opposite diameter
offsets and the same sweep flag (closed, winding kept). The reviewer measured, decoding the emitted path with
the updated oracle, a small-to-large area ratio of 0.499999838 against the expected 0.5 (0.50049104 in the
prior review), windings `+1` / `−1` for the two sweep directions. The measurement below was run by the
reviewer, not by this worker.

**50k, Node, recording host (same fixture and test as "50,000 bubbles"), reviewer ran and saw:**

| measure | seal revision | prior revision (R6, worker run) |
|---|---:|---:|
| create | **30.3 ms** | 32.0 / 29.3 ms |
| first frame | **24.6 ms** | 24.6 / 26.5 ms |
| visible map + `d` | **1,551.4 ms** | 1,536.8 / 1,548.9 ms |
| SVG nodes (recording host, renderer-equivalent) | **7** | 7 |
| bubble paths | **3** | 3 |
| `d` bytes | **1,563,858** | 1,639,256 |

The seal revision's `d` bytes are 75,398 B (−4.6 %) below R6, which is the effect of the relative semicircle
syntax. Earlier figures (1,382,511 and 1,382,632 B) belong to the revisions before R6's 7-digit radii. The per-path
split for the seal revision was not reported and is not recorded here.

**Node tests and typecheck on the seal revision (reviewer ran and saw):**

```text
Test Files  8 passed (8)
     Tests  76 passed (76)
npm run typecheck   exit 0
```

**Bundles by revision.** The bundle and purity numbers in "Bundles" (first candidate), the distribution recipe
table (fifth repairs) and "Repair R6" (0 B for both stage-1 files, 25,347 B raw-source with 0 B from
`spatial/bubble/**`) were measured on those earlier revisions. They were **not re-run on the seal revision**.
The whole-circle repair changes only path text inside functions, so no new top-level code is expected (inferred,
not measured).

**Pending (not verified on the seal revision):**

1. Chrome: `n8b-bubble.browser.test.ts` (native `isPointInFill` against painter's order, which accepts
   relative arc syntax; hover/click pick; tooltip/table parity; keyboard; zoom), **axe-core** light / dark /
   forced colors, and the **real SVG descendant count** (`svg.querySelectorAll('*')` ≤ 25) with Chrome 50k
   timing. None run.
2. The **wired `axylo/spatial` artifact gate** (stage 2 on `dist/spatial.js` and `dist/spatial.dev.js` with
   heatmap): Director's, after wiring.
3. **AX160 on inspectable empty charts.** The case is proven (see "Repair R6": every y `null`, a size formatter
   that throws for one value, table read, no AX160 and no reader note). It is still not repaired. It needs the
   Director-owned internal reporter hook: expose the controller's existing formatter-failure reporter
   (`#formatterFailed`) to the bubble composition, then add the empty-table regression. This needs no change to
   `public.ts` or `core/contracts.ts`, but it does touch `core/**`, so it stays outside this track's fence.
4. **Verify command scratch paths.** The Director/Coordinator verify command still sets
   `TMPDIR=/tmp npm_config_cache=/tmp/prism-npm-cache`. It must use a workspace-local `TMPDIR`
   (`$PWD/.prism-cache/tmp`) and npm cache (`$TMPDIR/npm`) before the Chrome run.

## Repair R8: finite-range size underflow

**Defect (confirmed before the fix, probe on this workspace):** `radiusOf(Number.MIN_VALUE, Number.MAX_VALUE, 0, 24)`
returned `0`, because `v / max` underflows, so a positive size was drawn as the hollow zero marker.
`referenceSizes(Number.MIN_VALUE)` returned `[1e-323]`: `10 ** -324` is `0` and the nice-step products lose
the value, so the reference was above the data (2 · MIN_VALUE).

**Fix (`spatial/bubble/geometry.ts`, `spatial/bubble/legend.ts`):**

- `radiusOf`: unchanged `maxRadius · √(v / max)` while `v / max ≥ 2^-1022` (the smallest normal double), so
  ordinary ratios give the same bits as before. Below that, `(maxRadius · √v) / √max` (there `v < 4`, so the
  product is finite; a fallback keeps the root quotient first if it is not). MIN_VALUE beside MAX_VALUE at 24 px
  is now `3 · 2^-1046` ≈ 3.97874211e-315.
- Representability choice: when even the final radius underflows (a subnormal `radius.max`, e.g.
  `radius: { min: 0, max: Number.MIN_VALUE }`), a positive size gets `Number.MIN_VALUE`, the smallest positive
  double. It is never `0`, so it is never the zero-marker sentinel. This is not a visible floor: nothing is
  lifted to a drawable size, and `radius.min` stays the only floor.
- `niceFloor` / `referenceSizes`: for `k ≤ -308`, `s · 10^k` is parsed from its decimal literal (one correct,
  monotonic rounding) instead of being multiplied. Above that range the arithmetic is unchanged. The result is
  positive and `≤ v`, and a quarter or sixteenth that underflows to 0 adds no entry. `referenceSizes(MIN_VALUE)`
  is now `[5e-324]`, and `referenceSizes(1e-322)` is `[1e-322, 2.5e-323, 5e-324]`.

**Tests (`test/spatial/bubble/extremes.test.ts`, 9 tests).** Expected values come from binary exponents and the
nice-step rule, not from a run:

- the exact subnormal radius
- an area-ratio property where `v / max` underflows (the old rule returned 0 there)
- monotonicity across the `2^-1022` boundary
- "positive size never 0" for any `radius.max` in `[MIN_VALUE, 1000]`
- bit-for-bit preservation of the ordinary formula
- the subnormal legend cases, plus a property over all positive finite maxima: 1–3 positive, strictly decreasing
  references `≤ max`
- the chart path: sizes `[MIN_VALUE, MAX_VALUE]` (geometry radius `3 · 2^-1046`, painted on top, finite `d`,
  positive legend), and a subnormal `radius.max` (positive sizes at MIN_VALUE, only the size-0 row hollow)

**Ran and saw (this workspace, Node):**

```text
npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/spatial/bubble
 Test Files  9 passed (9)
      Tests  85 passed (85)
npm run typecheck   exit 0
[N8b 50k] Node recording host: create 30.4 ms, first frame 25.6 ms, visible map + d 1572.6 ms, 38 scene marks, 7 svg nodes, 3 bubble paths, d bytes 513039 + 527625 + 523194 = 1563858, pieces 11943/12298/12225, contours 3207/3258/3291, circles 101032 (culled 85156)
[N8b 50k] Node recording host: create 31.1 ms, first frame 24.9 ms, visible map + d 1537.8 ms, ...same counts and bytes
```

The regular 50k `d` output is unchanged at **1,563,858** bytes (513,039 + 527,625 + 523,194). Purity check:
esbuild `--bundle --minify --ignore-annotations` of `geometry.ts` + `legend.ts` alone emits 0 bytes.

**Still pending, unchanged by R8:** Chrome / axe / real SVG DOM count, the wired `axylo/spatial` artifact gate,
AX160 on inspectable empty charts, and the verify-command scratch paths (all listed above). Both Director decisions
(AX160, verification scratch) are still open. R8 does not simulate or waive them.

### R9 — subnormal root quotient before the product

**Blocker (cross-provider review).** With sizes `[MIN_VALUE, 2^-50]` and `radius: { min: 0, max: 2^-560 }`, the
subnormal-ratio branch computed `(maxRadius · √v) / √max`. The product `2^-560 · 2^-537 = 2^-1097` underflows to 0,
so the radius fell back to `MIN_VALUE`. The exact radius is `2^-1072 = 4 · MIN_VALUE`, which a double can hold.

**Fix (`src/spatial/bubble/geometry.ts`, `radiusOf`, subnormal branch only).** The branch now computes
`r = maxRadius · (√v / √max)`. ~~In this branch `v ≥ 2^-1074` and `max ≤ MAX_VALUE < 2^1024`, so the quotient is
at least `2^-549`. That is always normal, so no power-of-two rescaling is needed.~~ **Corrected in R10:** the
bound is `√(2^-1074 / 2^1024) ≈ 2^-1049`, which is subnormal, so the quotient can lose bits; see R10. The ordinary path (`ratio ≥ 2^-1022`) is unchanged. No new module-level expressions were added.

**Tests (`test/spatial/bubble/extremes.test.ts`, +2).** Expected values come from binary exponents:
`√(2^-1074) / √(2^-50) = 2^-512`, and `2^-512 · 2^-560 = 2^-1072`.
- `radiusOf(MIN_VALUE, 2^-50, 0, 2^-560) === 2^-1072 === 4 · MIN_VALUE`, and the largest size gives `2^-560`.
- Through the chart: the geometry radius is `2^-1072` and the large one is `2^-560`. The written path contains
  `a2e-323 2e-323 `, because `2e-323` is the shortest round-trip string of `4 · MIN_VALUE`. It does not contain
  `a5e-324 `, the old `MIN_VALUE` output.
- The old formula, checked separately in Node, gives `0` for this input (so `MIN_VALUE` after the fallback). The
  new formula gives `2e-323`.

**Ran and saw (this workspace, Node):**

```text
npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/spatial/bubble
 Test Files  9 passed (9)
      Tests  87 passed (87)
npm run typecheck   exit 0
esbuild --bundle --minify --ignore-annotations of geometry.ts + legend.ts (side-effect imports only): 0 bytes
```

The 50k benchmark was not re-run in R9. The ordinary-ratio path is byte-identical, and the 50k fixture never
reaches the subnormal branch, so the regular `d` output is expected to stay at 1,563,858 bytes. This is expected,
not observed. **Still pending, unchanged by R9:** Chrome / axe / real SVG DOM count, the wired `axylo/spatial`
artifact gate, AX160, and the verify-command scratch paths. None of them is claimed as passing.

### R10 — subnormal root quotient rescaled by 2^512

**Blocker (cross-provider review).** R9's claim that `√v / √max` is always normal was wrong: its lower bound is
`√(2^-1074 / 2^1024) ≈ 2^-1049`, a subnormal. With `v = 2 · MIN_VALUE`, `max = MAX_VALUE`, `radius.max = 1000`,
R9 returned `2.3444962803e-313` (checked again here in Node with the R9 formula), against the true
`2.344496271e-313`. Paired with `v · 2^60`, the normalized area ratio was `0.999999992081694`.

**Fix (`src/spatial/bubble/geometry.ts`, `radiusOf`, subnormal-ratio branch only).** The root quotient
`q = √v / √max` is computed first. If `q ≥ 2^-1022`, the radius is `maxRadius · q`, as in R9, so the `2^-1072`
regression is unchanged. If `q` is subnormal, the radius is `((√v · 2^512) / √max) · (maxRadius · 2^-512)`.
Scaling by a power of two is exact: `√v ≥ 2^-537` and `√v · 2^512 < 2^1024`. The scaled quotient lies in
`[2^-537, 2^-510)`, which is normal, so the final product rounds once. The scaled `maxRadius` loses bits only when
`maxRadius < 2^-510`. In that case the true radius is below `2^-1022 · 2^-510 = 2^-1532`, far under `MIN_VALUE`.
It rounds to 0 either way, and then to the `MIN_VALUE` representability fallback. The ordinary path
(`v / max ≥ 2^-1022`) is untouched. The `2 ** 512` constants live inside the function, so no module-level
expression was added.

**Test (`test/spatial/bubble/extremes.test.ts`, +1).** The expected value was derived independently:
`r = 1000 · √(2^-1073 / (2^1024 · (1 − 2^-53))) ≈ 47453132812.126 · MIN_VALUE`. That rounds to
`47453132812 · MIN_VALUE`, about `2.344496271e-313`, and was checked with a 60-digit Python `Decimal` computation.
The test checks `r1.toPrecision(10) === 2.344496271e-313` and `r1 === 47453132812 · MIN_VALUE`. The area
tolerance comes from the rounding bounds: r1 is subnormal (error ≤ MIN/2), r2 is normal (a few 2^-53 roundings),
and squaring doubles both, giving `2 · (MIN / (2 · r1) + 4 · 2^-53) ≈ 2.1e-11`. R9's `0.999999992081694` is
about 7.9e-9 off, so it fails this tolerance.

**Ran and saw (this workspace, Node, TMPDIR / npm cache under `.prism-cache/tmp`):**

```text
npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/spatial/bubble
 Test Files  9 passed (9)
      Tests  88 passed (88)
npm run typecheck   exit 0
esbuild --bundle --minify --ignore-annotations of geometry.ts + legend.ts (side-effect imports only): 0 bytes
```

The 50k benchmark was not re-run. Its fixture never reaches the subnormal branch, so `d` is expected to stay at
1,563,858 bytes. That is expected, not observed. **Still pending, unchanged by R10:** Chrome / axe / real SVG DOM
count, the wired `axylo/spatial` artifact gate, the Director-owned AX160 reporter (not waived), and the
verify-command scratch paths.

## Chrome seal (`p2_n8b_seal`, 2026-11-27): click pin vs hover, landmark

**Director's Chrome run, as relayed in the seal brief (not observed by this worker):** 88/88 bubble Node tests,
typecheck and the 0 B bare-import check passed, and 6 of the 10 Chrome tests passed, the 50,000-bubble test among
them, at `sceneNodes 7`, `svgElements 13`, `bubblePaths 3`. Two real failures remained:

1. `n8b-bubble.browser.test.ts:183`. After `mouse.click` on the small bubble, `mouse.move(big.cx, big.cy + 15)`
   still read `52 k$ / Small / 70 years; Population: 4 M`.
2. `n8b-bubble.browser.test.ts:253`, for light, dark and forced colors. The only violation was axe-core
   `region` ("All page content should be contained by landmarks") on `#chart`.

**Cause of 1: the click pin, not the bubble lookup (traced in source; `dom/**` is outside this fence).** A
mouse click goes to `#activate` (`src/dom/interaction.ts`). For a datum with a presentation, that sets
`#shown = { k: S_PIN, … }`, and `#pointerAt` returns early while `#shown.k === S_PIN`. So after the click, no
pointer move picks again until the pin is dismissed, and the failing move came right after that click. The
bubble lookup is correct for this case. `pickGrid.pick` returns the containing bubble ranked highest in painter's
order (hit test: `d ≤ r + 0.5`). Each target carries `{ seriesKey, row, x }`, and `sameTarget`/`sameRef` compare
series and row, so two series with the same x and y are different targets. No change in
`src/spatial/bubble/**`.

There is a second interaction rule the test has to respect: the hover corridor (`S_HELD`). Once the pointer has
rested on a datum for `REST_TIME` (250 ms), moves inside the convex hull of that rest point and the tooltip box
keep the tooltip. So the hover move has to go away from the tooltip, or the result depends on timing.

**Test repair (`n8b-bubble.browser.test.ts`, still 10 cases):**

- The first test still opens the original non-concentric fixture (`NESTED`, small at x 52 inside the large disc
  at x 50). It checks the legend, then hovers the small bubble (tooltip `Small`, `52 k$`, `4 M`), then clicks it
  and checks the `select` payload. The keyboard, table, picture and zoom tests still use `NESTED` as before.
- The same test then opens a second page with no click. The fixture is `CONCENTRIC`: `Large` 1000 and `Small` 4
  at the same (50, 70), plus edge points. Preconditions asserted:
  - the two bubbles are in different series, with the same centre within 1e-6 px;
  - r = 24 and r = 2;
  - the target point is 15 px straight up or down from that centre, so it is more than r_small + 0.5 + 5 px
    from it and less than r_large − 5 px;
  - the target is on the side away from the tooltip and outside the tooltip box.

  Then the move from the small centre to that point must change the tooltip to `Large`, `50 k$` and
  `70 years; Population: 1,000 M`, with no `Small` in it and no `select` event.
- Landmark: the shared `blank.html` and harness are outside this fence. So before mounting, a local `landmark()`
  moves the body's content into a `<main>`, keeping the order `#before`, `#chart`, `#after`, as the histogram and
  n3 a11y suites do. Every mount in this suite does this, the 50k mount included. axe still runs with all rules,
  for all three themes, with the table both closed and open.

**Ran and saw (this workspace, Node, `TMPDIR` under `.prism-cache/tmp`):**

```text
npm run typecheck                      (tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist) exit 0
npx vitest run --configLoader runner --no-cache packages/axylo/test/spatial/bubble
 Test Files  9 passed (9)
      Tests  88 passed (88)
```

**Director verify (real Chrome; observed by the Director, relayed to this worker, not run here).** Candidate
`opus-5.5-medium__20261127T185721Z`, log `turn-2-opus-5.5-medium__20261127T185721Z.log`, exit 0. The candidate
after this ledger-only update has the same browser and library code.

```
AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser/chart/n8b-bubble.browser.test.ts
```

| Check | Result |
|---|---|
| `npm run typecheck` | passed |
| Node unit/property (full) | 139/139 files, 2377/2377 tests |
| Chrome `n8b-bubble.browser.test.ts` | 1/1 file, 10/10 tests |
| axe-core, light / dark / forced colors | 0 violations each, table closed and table open |

`[N8b 50k Chrome]` output on that candidate:

| Field | Value |
|---|---|
| `bubbles` | 50000 |
| `created` (ms) | 26.3 (raw 26.299999997019768) |
| `drawn` (ms) | 2303.4 (raw 2303.39999999851) |
| `frames` | 1 |
| `sceneNodes` | 7 |
| `svgElements` | 13 |
| `bubblePaths` | 3 |
| `paints` | `[0:series,1:series,2:series]` |
| `dBytes` | 1246496 |

The counts match the Director's pre-repair run (7 / 13 / 3), as expected from a test change that only added the
`<main>` wrapper.

**`p2_w4_wire` handoffs (Director-owned; not blockers for this isolated worktree):**

1. **AX160 reporter hook.** `core/controller.ts:1562` calls `layoutDiagnostics` only when
   `shown.kind === 'ready' && !compact`. A size-format failure in an empty, compact or not-ready chart that a
   reader can still inspect (its table or export) is reported only once the chart next draws ready and
   noncompact. Same-frame AX160 there needs the controller's value-formatter reporter
   (`#addPresentation('format', AX160 'changed')`, `core/controller.ts:324`) exposed to the composition, for
   example `ControllerCore.reportFormat(field: string)` (fifth repairs, item 5).
2. **Combined `dist/spatial.js` bare-import check.** Once `axylo/spatial` is wired (barrel, `package.json`
   export, build entry), the 0 B bare-import purity check has to be rerun on the combined `dist/spatial.js`
   (heatmap + bubble + shared color scale), not only on the bubble entry ("Distribution recipe" above).
