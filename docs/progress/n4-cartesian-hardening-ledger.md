# N4 — `axylo/cartesian` dense drawing, stacks, layout and spec amendment: evidence ledger

Wave 2, Track B. Author candidate by the N4 `ts_builder` turn, then one repair round by a second `ts_builder` turn
(requested model: not given in either delegation; observed model per harness metadata: `claude-opus-5-5` in both).
Not committed; not independently reviewed. The repair round is recorded in its own section at the end; where it
changed an earlier statement, the earlier statement is marked in place. "Observed" = run in the
author's sandbox and the output tail is quoted. "Pending" = not run. "Inferred" = reasoned, not shown.

## Scope and fence

Changed (all inside the N4 fence): `packages/axylo/src/cartesian.ts`; `packages/axylo/src/cartesian/{scene,lookup,
reader,layout,bar-geom,overlay,annotations}.ts`; new `cartesian/{dense,stacks,mark-swatch}.ts`; new
`packages/axylo/test/cartesian/{n4-pipeline.ts, n4-dense.test.ts, n4-stacks-layout.test.ts, n4-swatch-parity.test.ts}`;
`tests/dist/cartesian.browser.test.ts`; new `bench/src/cartesian.js`; (repair round, see the end) new tests
`n4-f10-reader.test.ts`, `n4-audit.test.ts`, `bench/src/{fixtures,multichart}.js`, new
`bench/src/adapters/axylo-cartesian.js` and `bench/src/cartesian-artifact.mjs`; `docs/02-product-spec.md`;
`docs/rfcs/c4-1-cartesian-multiscale.md`; `acceptance/matrix.json`; this file. `bench/size-latest.json` (a report
that `node scripts/size.mjs` rewrites) is outside the fence and was restored byte for byte to the cycle's initial
snapshot after the Director's turn-6 verify; it is not part of the N4 change.

Not touched: `public.ts`, `core/**`, `dom/**` (including `dom/mark-swatch.ts`), `theme/**`, `finance/**`, `simplify/**`,
`bench/build.mjs`, `bench/run.mjs`, `bench/lib/**`, `bench/test/**`, `acceptance/journeys.json`, distribution guards in `tests/dist`
other than `cartesian.browser.test.ts`. Contracts unchanged; no contract change needed.

Side effect of running the suites, not an edit: `npm test` rewrote `apps/docs/.cache/types/{probe.ts,tsconfig.json}`
(written by the existing docs tests); `npm run build` rebuilt `packages/axylo/dist`. Scratch lives in `.prism-cache/tmp`.

## What changed, and why

1. **Bare-import side effect (Wave 1 closeout).** Under `ignoreAnnotations: true`, `import 'axylo/cartesian'` kept
   `var lg="M1 6L7 3L13 6L19 3"; var nw=\`${lg}V11H1Z\`;` — the top-level template literal of `dom/mark-swatch.ts`
   (observed: 43 B raw on the snapshot). `dom/**` is outside the fence, so the entry now imports an owned copy,
   `cartesian/mark-swatch.ts`, with the outline written as one literal. `n4-swatch-parity.test.ts` pins the copy to
   the DOM module (same swatch spec and cache key for every layer kind, hidden and shown). The DOM copy is now
   unused by the library; retiring it (and pointing `test/browser/chart/n2-mark-swatch.test.ts` at the owned copy)
   is for the DOM owner. A second retention I introduced on the way (`new Int32Array(0)` at module scope) was found
   by the same probe and removed.
2. **Dense drawing (spec F5, A5; RFC §4.4).** `cartesian/dense.ts` `keep()` gives F5's guarantee per device-pixel
   column and contiguous run (first, last, min, max, earliest on ties, in source order), keeps every break, bridges
   `SLOT_NO_ROW` outside stacks, reports runs of one value as isolated points, and keeps every sample when there are
   at most four per column (simplify/index.ts's `columnLimit`, including the plot's x offset and the DPR). On log
   axes, values that are not positive and finite end the run before `position()` is called; no state or value
   column is copied or derived. Lines, unstacked areas and the existing range bands use it; stacked areas use
   common vertices (`stackVertices`: each cumulative boundary's kept samples plus both ends of every component state
   or sign change), with positive and negative parts as separate bands so a mixed-sign stack never crosses zero.
   A5's marker is placed on the last value drawn inside `visibleSlots` (previously the last value of the overscan
   draw range, which could be off-plot).
   **Deviation from the brief's "reuse simplify/index.ts":** wiring `simplifiedPath`/`simplifyArea`/`stackIndexes`
   worked (all tests passed) but added 9,300 B minified and put `axylo/cartesian` at 132,090 B gzip-9 (observed),
   over the enforced 127,000 B cap of `tests/dist/subpaths.test.ts`. The owned decimator is one linear pass; it has
   no block index or selection cache, so zoom frames re-scan the drawn range (inferred cost: O(drawn slots) per
   series per frame; ~9.6 ms Node scene median for 100k line + 100k bars, dominated by the bars — see risks).
3. **Stacks (spec F10).** `cartesian/stacks.ts` builds one core-shaped `StackView` per (mark, axis) from visible,
   drawable stacked components; any non-value slot (null, gap, no row) adds zero and flags the slot incomplete.
   Stacked bars now take their base from these cumulative arrays (same sums as the old predecessor loop). The
   tooltip gets the core wording: sum, or "{positive} and {negative}" with mixed signs, "(incomplete)" where a
   component is missing; several stacks are joined with "; " in layer order. The keyboard reading of a missing
   component says "(incomplete)"; the table marks the x cell as the core table does (via a view handed only to the
   core table builder; the published view carries no `stack`, because core value-extent helpers would read it as
   the chart's only data). The axis domain code is unchanged: it already sums each side of zero per slot.
   (Repair round: the summary now says it too; the "no incomplete-stack sentence" risk below is closed.)
4. **Layout (spec L9 with L8).** When the dual layout would fall to `too-small` (plot under 120 × 80, or an axis
   title that cannot fit), it now retries with the right axis collapsed (AX175) and only then falls back to L8.
   Audit against `layout/index.ts`: insets, gaps, tick gap, 120 × 80 minimum, clearance and the title/room formulas
   match; differences left as they were: Cartesian clamps the bottom room at 0, and counts hidden category labels
   without the core's middle-truncation count (an aligned version was written, then reverted for the size cap).
   Picking, focus overlay, annotations and the scene now share one slot-pixel function (`bar-geom.ts xSlotPixel`)
   or `position()`, which already maps band scales to band centres (behaviour-identical deduplication).
5. **Spec amendment.** `docs/02-product-spec.md`: F13 (3.1), L9 (3.2), registry rows AX170–AX176 and AX180–AX181
   (3.5) worded from the source (`cartesian/diagnostics.ts`, `finance/core.ts`), and a prose note that AX177–AX179
   are reserved and raised by nothing. `acceptance/matrix.json`: F13 and L9 rows (line/area/bar; scatter, donut,
   compact not applicable with reasons; browser evidence `pending`; L9 area `pending` because no fixture binds an
   area to the right axis), and F3 citations of existing real tests whose exact titles name AX170–AX176, AX180, AX181.
6. **Benchmark workload.** `bench/src/cartesian.js`: `cartesianFixture` (layout `line` = `lineFixture({ series: 1,
   points, seed })` byte for byte; layout `line+bar` = that line on a left linear axis + 100,000 integer bars on a
   right linear axis), `cartesianWorkloadData`, `cartesianOptions` and `cartesianAdapter` (wraps the root Axylo
   adapter so readiness, readback, zoom and hover are measured by the same code). `cartesian.ts` forwards the inner
   `__bench` hook in development and benchmark builds only (dead code in production). (Repair round: this module
   had no caller then; it is now wired, and `cartesianFixture` lives in `fixtures.js`, re-exported unchanged.)

## Observed (commands and tails)

Vitest needs `--configLoader runner --no-cache --no-fsModuleCache` here (`node_modules` is read-only; plain runs fail
with EROFS on `.vite-temp` / `.vitest-cache`). `npm pack` needs `npm_config_cache` pointed at scratch (read-only `~/.npm`).

- `npm run typecheck` → exit 0 (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist`).
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache` → `Test Files 124 passed (124)`,
  `Tests 2231 passed (2231)` (baseline in this workspace: 121 files / 2208 tests; one earlier full run had the
  timing test `format/finition-intl-perf.test.ts` fail once and pass on rerun — untouched code).
- New tests alone: `n4-dense` 9/9, `n4-stacks-layout` 12/12, `n4-swatch-parity` 2/2. The L9-before-L8 test was run
  against the baseline `layout.ts` (temporarily swapped, then restored byte-identical): it fails there
  (`expected 'too-small' to be 'plot'`) and passes on the candidate.
- `npm run build` → exit 0.
- `npm_config_cache=<scratch> node --test acceptance/test/*.test.mjs` → `tests 71, pass 70, fail 0, skipped 1`
  (the skip needs `acceptance/results/browser.json`). `node acceptance/check.mjs` → exit 0; F13 and L9 listed,
  "not run" (no result files in this sandbox).
- `npm --prefix bench test` (run as `cd bench && npm test`) → `tests 121, pass 121, fail 0`.
- Bench fixture (scratch Node script): layout `line` checksum `bfd6a33b` = root `workloadData('first', { size:
  '1x100000' })` checksum `bfd6a33b`; layout `line+bar` deterministic (`69a5994a` twice), its line column
  byte-identical to the baseline's, bars 20–199.

### Size, gzip-9 (in-memory equivalent of `scripts/size.mjs` and `tests/dist/subpaths.test.ts`)

`scripts/size.mjs` and the packed fixture were not used. Both trees were built with the release recipe
(`PRODUCTION` defines, minified stylesheet literal, esm/iife, es2022) and consumed by esbuild as the dist tests do
(minify, esm, `conditions: ['production']`, bare imports with `ignoreAnnotations: true`). Baseline = the turn's start
snapshot of `packages/axylo/src`, placed at the same depth as the candidate (an earlier mixed copy produced ±1–3 B
renaming noise, now explained and excluded).

| entry | baseline | candidate | delta |
|---|---:|---:|---:|
| line only (examples/first-chart/npm.ts) | 135,672 | 135,672 | 0 |
| everything (`export * from 'axylo'`) | 158,540 | 158,540 | 0 |
| `axylo/static` line only | 121,108 | 121,108 | 0 |
| `axylo/static` everything | 141,408 | 141,408 | 0 |
| `axylo.iife.min.js` | 158,866 | 158,866 | 0 |
| `axylo/cartesian` (`export { cartesian }`) | 125,479 | 126,960 | +1,481 |
| `axylo/finance` | 124,473 | 124,473 | 0 |
| bare `axylo` / `axylo/static` / `axylo/stream` (raw) | 0 | 0 | 0 |
| bare `axylo/cartesian` (raw) | 43 | 0 | −43 |
| bare `axylo/finance` (raw) | 23 | 23 | 0 |

Consuming the real `packages/axylo/dist/cartesian.js` from `npm run build`: 126,961 B gzip-9 (39 B under the
127,000 B cap), bare import 0 B raw. (Repair round: 126,977 B, 23 B under the cap.) The margin is thin: any later byte in this entry needs room found first.
The bare `axylo/finance` import keeps 23 B (`var Ze=1, jt=2, Kw=Ze|jt;` in `finance/**`), outside N4's fence;
`subpaths.test.ts` expects 0 for it too, so that test should still fail on finance until its owner fixes it.

## Pending at the time of the author turn (superseded — see "Director verify after turn 6" at the end)

- Chrome: `npm run build && AXYLO_BROWSER=1 npx vitest run --config tests/dist/vitest.config.ts tests/dist/cartesian.browser.test.ts`
  (the existing scenario plus the two N4 scenarios: 100k bounded path through zoom/hover/zoom-in, log omission
  note, 960 → 320 → 960 with AX175 and summary; mixed-sign and incomplete stacks in tooltip and table). Written and
  type-checked only. Its tooltip text expectations (`/10 and .3/`, `/incomplete/`) assume the DOM tooltip shows
  `TooltipModel.total`, which is inferred from the core, not seen. (Repair round: these N4 scenarios were rewritten;
  see the end. Still never run in Chrome.)
- Packed dist Node suite: `npx vitest run --config tests/dist/vitest.config.ts` (packs and installs). Its launch was
  refused in this turn by the permission layer; the size table above is the in-memory equivalent. (Repair round:
  run with `HOME` in scratch; 9 failures, all reproduced on the snapshot — see the end.)
- `node scripts/size.mjs` on the packed fixture.
- `packages/axylo/test/browser/chart/n2-mark-swatch.test.ts` still tests `dom/mark-swatch.ts` (unchanged).
- RFC §8 paired benchmark: no ratio measured. The out-of-fence wiring this item listed is no longer needed: the
  repair round wired it inside `bench/src` (commands at the end).
- Independent cross-provider review of this candidate.

## Risks and open questions

- **100,000 bars are not decimated** (spec 3.6 says bars are not simplified). In Node they dominate the scene
  (~9.6 ms median over 20 builds, line 3,346 vertices, 100,000 rects); in Chrome they are 100,000 `<rect>` nodes. The
  RFC's `≤ 1.15×` startup and `≤ 1.10×` zoom/hover targets against a one-line baseline may not be reachable with
  this workload without a bar policy (AX132-style hint, aggregation), which would be a spec decision for the owner.
- (Closed in the repair round.) No incomplete-stack sentence in the Cartesian summary.
- Assumed: a slot with no row inside a stack is a missing component (spec F10, owner decision 2026-11-18); zero is
  on the positive side (as the core stack and the old bar geometry); multiple stacks' totals joined with "; ".
- Assumed: on log axes a nonpositive value breaks the line (the previous Cartesian behaviour and RFC §4.4), rather
  than being bridged like a no-row slot.
- Area markers (A5: "each line and area carries a shape marker at its last point") are still not drawn for
  Cartesian areas, as before N4.

## Repair round (second `ts_builder` turn, 2026-11-27)

Starting point: the author candidate above, as found in this workspace (snapshotted before the first edit into
`.prism-cache/tmp/n4r/base/`, which is the baseline for every "before" below). No Chrome, no localhost server,
no benchmark run, no npm install in this round.

### Changed files in this round (diff against that snapshot)

`packages/axylo/src/cartesian/{reader,stacks,lookup,layout,scene}.ts`; new
`packages/axylo/test/cartesian/{n4-f10-reader,n4-audit}.test.ts`; `tests/dist/cartesian.browser.test.ts` (modified:
the N4 scenarios were rewritten, see 2); `bench/src/{cartesian,fixtures,multichart}.js`; new
`bench/src/adapters/axylo-cartesian.js`, `bench/src/cartesian-artifact.mjs`; `docs/rfcs/c4-1-cartesian-multiscale.md`;
this file. Not touched: `public.ts`, `core/**`, `dom/**`, `theme/**`, `finance/**`, `simplify/**`, `bench/build.mjs`,
`bench/run.mjs`, `bench/lib/**`, `bench/test/**`, `docs/02-product-spec.md`, `acceptance/matrix.json`. A `find -newer`
sweep outside these paths shows only files the test runs generate (`apps/docs/.cache/types/*`,
`tests/dist/fixtures/npm/{node_modules,.out,example}/**` from the packed suite's pack-and-install, and
`packages/axylo/dist` from `npm run build`).

### 1. F10 announcements (accessible summary)

- `cartesian/reader.ts` `text()` adds the core's sentence for incomplete stacks: `incompleteAt` ("{label}:
  incomplete at {positions}.", up to three positions) or `incompleteCount` ("{label}: {count} incomplete stacks."),
  read from `cartesianStacks(view, meta).incomplete` (the per-view cache the table, tooltip and scene use) over
  `visibleSlots` only. So it follows visibility (only visible, drawable components are in a stack; a hidden
  component is not a missing one, as in the core `buildStack`), the zoom window, and updates (a new view is a new
  cache key). A real zero is a value and completes its stack; null, gap and no-row are missing. Only the first
  three positions are formatted, so a 100,000-slot stack costs one pass, not 100,000 format calls.
- Why here: the core only says it for compact charts and reads `view.stack`, which the published Cartesian view
  does not carry (see 3 above), so without this a Cartesian summary never said it.
- All-missing slot (every component missing): tooltip total is `missing(SLOT_NULL)` ("No data") with no qualifier,
  exactly as `lookup/aligned.ts` does; the table x cell and the summary still say incomplete. Kept for core parity;
  F10's "marked incomplete in tooltip" is met by the table/summary there, not by the total — an owner may want
  "No data (incomplete)".
- Entirely missing but declared visible linear component (a field with no value anywhere): it stays drawable and
  visible (core normalization disables a series only for duplicate x, AX108; `view/index.ts` visible = drawable &&
  not hidden), so it is in its stack and every slot is incomplete. Tested, no code change needed.
- `stackTotalText` now reads the stack's two ends from the last cumulative arrays instead of re-summing.
- Room for the cap (no behaviour change): `lookup.ts` uses `data/search.ts lowerBound` (same lower-bound contract)
  instead of a private copy and `Array.findIndex` for the series key; `SLOT_VALUE` finiteness checks dropped in
  `lookup.ts`/`scene.ts` (`core/contracts.ts`: a SLOT_VALUE is always finite); `layout.ts placeRightTick` spreads
  the box; the reader reuses `withUnit`; `withStacks` folded into `cartesianTable`. A diagnostics refactor was tried
  and reverted (gzip grew by 25 B).
- Tests (`n4-f10-reader.test.ts`, 9): expected strings from the default messages and the fixture; real
  `reader.summary`, table cells, tooltip total and `lookup.datum` (the keyboard reading) for null, SLOT_GAP and
  SLOT_NO_ROW, real zero, all-missing slot, >3 positions, hidden component, zoom window, update, entirely missing
  component, and a fast-check property (announced positions = visible slots with a missing visible component, table
  marks agree). Against the snapshot's `reader.ts` (swapped in, then restored): 9 of 9 fail; on the candidate 9 pass.

### 2. Browser test (written and type-checked only; NOT run — Chrome is the Director's)

`tests/dist/cartesian.browser.test.ts` N4 block rewritten; the original C4.3 scenario is unchanged (it still has
six fixed `waitForTimeout`s, which this round did not touch). Paths were read from the source, not guessed:
plot = the scene clip rectangle (`svg.axylo-svg defs clipPath rect`, render/svg.ts; there is no `.axylo-plot`, which
the earlier version used), axis texts = `.axylo-text [data-role]`, keyboard = `.axylo-proxy` `aria-valuetext`
(core/focus.ts `valueText`, 'all' mode: rows plus "Total {total}"), cursor = `.axylo-overlay line` `x1`, tooltip =
`.axylo-tooltip, .axylo-readout` as in the finance test. Data marks are told apart by their `--axylo-series-*`
paint, because grid/tick rules can be batched into one path. State is awaited with `expect.poll` on DOM state.
- Dense: page and test share formulas (integer values; latency 0 at slot 1 and −5 at slot 2, peak 9000). Asserts
  the longest data path ≤ 4 × device columns + 8 at full range, after zoom and after restore; a real pointer over
  the full 100,000 points shows both series' values; AX171 exactly
  `{ field: 'latency', count: 2 }` and the note "Values not shown: 2"; zoomed to 21 minutes, keyboard Home/→/→ reads
  slots 0–2 with the fixture's raw values (`20 qty`, `100 ms`; `57 qty`, `0 ms (not plotted)`; `94 qty`,
  `-5 ms (not plotted)`), the pointer at each keyboard cursor x shows the same values, and table rows 0–2 hold the
  same raw values (`(not plotted — log)` on the log column); right-axis ticks and the title "Latency (ms)" sit right
  of the plot at 960 px, are gone at 320 px (AX175, summary "Secondary right axis (Latency (ms))"), come back at
  960 px, with no overlapping axis text in any of the three states.
- Signed stacks (860 px wide: the test context's viewport is 900 × 700, `tests/dist/browser.ts`, and the first and
  last slots sit on the plot edges, so pointer x is clamped one pixel inside the plot): bars a+b (left) and areas
  c+d (right). Geometry from the fixture: 3 + 2 rectangles (b null at m=3),
  one zero line shared by every rectangle edge (±1 px), heights proportional to 10, 5, 4, 3, 6 (±1.5 px); each area
  band on one side of the right axis's zero (read from its "0" tick label), at least one below. Totals by keyboard
  ("Total …"), pointer and spec wording: `10 and -3; 6`, `6 and -5; 3 (incomplete)`, `4 (incomplete); 5 and -2`;
  table x cells `1`, `2 (incomplete)`, `3 (incomplete)`; summary `m: incomplete at 2, 3.`
- Checked in Node through the same stages (scratch probe, then deleted): AX171 field/count, the note, 3,227 kept
  vertices for an 837 px plot, 19 vertices zoomed, tooltip/table texts for slot 1, the 320 px summary sentence and
  the axis titles match what the browser test expects. What only Chrome can show (DOM structure, real pointer
  picking, text boxes, `devicePixelRatio`) is unverified.

### 3. Benchmark wiring (bench/src only; Node-verified; no Chrome run)

- `bench/src/adapters/axylo-cartesian.js`: an ordinary adapter (`cartesianAdapter`) whose `load()` imports
  `../axylo/axylo-cartesian.bench.js` through a computed URL, so esbuild leaves the import alone and the adapter has
  no library code (observed: 14,270 B, against 13,112 B for `axylo-svg.js`). Every artifact contains it; with no
  Cartesian bundle in the artifact it reports "unavailable" with the import error.
- `bench/src/cartesian-artifact.mjs` (`node bench/src/cartesian-artifact.mjs [--source] [--out]`): `build()` makes
  the ordinary artifact in a staging directory, `readArtifact()` verifies it, its files are copied into a new empty
  directory, `axylo/axylo-cartesian.bench.js` is compiled from a source snapshot with scripts/build.mjs's
  `PRODUCTION` + `__BENCH__: 'true'`, its stylesheet plugin (stylesheet hash must equal the staging artifact's) and
  an external source map; a new manifest re-hashes every file, lists the bundle, unions the Axylo inputs (refusing if
  a shared input's hash differs), recomputes the source hash and records `derivedFrom` (staging id and manifest
  hash). Sealed read-only, verified with `readArtifact()`, staging removed. A sealed artifact is never edited.
- `--kind cartesian` (`multichart.js cartesianParams`; not added to `kinds`, so the stage-1b loops over root kinds
  are unchanged): first/zoom/hover, size `1xN` only, `--moves` for hover; `kindAvailability` refuses it for every
  library but Axylo, and the root Axylo adapters refuse it because their build has no `cartesian()`. The fixture is
  `fixtures.js cartesianFixture` (line+bar), so the runner's oracle (`lib/driver.mjs expectedFor` → `workloadData`)
  and the page build it from the same code.
- Observed in Node (scratch scripts): two derived artifacts built and verified (`readArtifact` OK), bundle exports
  `cartesian` and `validateCartesian`, `harnessDifferences(c1, c2, 'axylo-cartesian')` = `[]`, identical Cartesian
  bundle bytes; `workloadParams` → `{"size":"1x100000","gaps":false}` tag `1x100000` checksum `bfd6a33b` (one-line,
  equal to `cartesianFixture({ layout: 'line' })`) and `{"kind":"cartesian","size":"1x100000"}` tag
  `cartesian-1x100000` checksum `69a5994a`; the line+bar fixture's line column is byte-identical to the root
  fixture's; `2x10`, `--gaps` and `page` are refused with messages.
- For the Director (quiet window, not run here):
  - artifact: `node bench/src/cartesian-artifact.mjs --out <dir>`;
  - one-line matched pair, per workload: `node bench/run.mjs --artifact <dir> --baseline axylo-svg
    --candidate axylo-cartesian --workload first|zoom|hover --size 1x100000` (same fixture bytes on both sides);
  - dual-axis line + bar: `--kind cartesian`, drawn only by `axylo-cartesian`. Its real A/B is two builds of
    axylo/cartesian: `node bench/run.mjs --adapter axylo-cartesian --base <artifact A> --candidate <artifact B>
    --kind cartesian --workload …`. It has no matched root baseline; a separately recorded line-only session is a
    different fixture and must not be presented as matched-fixture proof for it.
  - What admission checks for `--kind cartesian`: the page's fixture checksum against the oracle's (`69a5994a`),
    then the root adapter's readback against `expectedView` and the held columns of both series. Whether a
    dual-axis chart's readback (its view's `yDomain` is the left axis's) satisfies that oracle is not known until a
    Chrome admission run; if it refuses, that is a finding to fix in the readback, not to waive.

### 4. Audit before sealing (`n4-audit.test.ts`, 3 tests)

Read `dense.ts` and the line/area builders again: nonpositive values on a log axis end the run before `position()`
(and `lastDrawnValue` skips them), a single value between breaks is isolated, A5's marker is the last drawn value in
`visibleSlots`, stacked edges are drawn only through the band's common vertices, and drawing, overlay and lookup use
`xSlotPixel` and `axisScaleOf` + `position`. No defect found; no code change. The local decimator's rationale
(simplify/index.ts measured at 132,090 B gzip-9 for this entry, over the cap) is kept in `dense.ts`'s header. New
tests: log breaks/isolated/A5 on the last positive value (AX171 count 3); the A5 marker equals the lookup anchor of
the same datum on a right log axis, and a nonpositive last value has no anchor; every stacked edge vertex is a
vertex of its band boundary.

### Observed in this round (commands and tails)

- `npm run typecheck` → exit 0.
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache` → `Test Files 126 passed (126)`,
  `Tests 2243 passed (2243)` (author candidate: 124 / 2231).
- `npx vitest run … packages/axylo/test/cartesian` → `Test Files 7 passed (7)`, `Tests 45 passed (45)` before the
  audit file; `n4-audit.test.ts` alone `Tests 3 passed (3)`.
- `npm run build` → exit 0.
- `npm_config_cache=<scratch> node --test acceptance/test/*.test.mjs` → `tests 71, pass 70, fail 0, skipped 1`;
  `npm_config_cache=<scratch> node acceptance/check.mjs` → exit 0 (without the variable it fails at
  `npm pack --dry-run`: read-only `~/.npm`).
- `cd bench && npm test` → `tests 121, pass 121, fail 0`.
- Size (esbuild consumer of `packages/axylo/dist/cartesian.js`: minify, esm, `conditions: ['production']`; bare
  import with `ignoreAnnotations`): `axylo/cartesian` 126,977 B gzip-9 (snapshot built the same way: 126,961; +16 B;
  cap 127,000), bare `import 'axylo/cartesian'` 0 B raw. `dist/axylo.js`, `dist/static.js` and
  `dist/axylo.iife.min.js` are byte-identical (`cmp`) to the snapshot's build: legacy root/static/IIFE tax exactly 0.
- Packed dist Node suite, `HOME=<scratch> npx vitest run --config tests/dist/vitest.config.ts --configLoader runner
  --no-cache --no-fsModuleCache` (no browser tests; `HOME` because scripts/pack.mjs strips `npm_*` variables and
  `~/.npm` is read-only): `Test Files 4 failed | 8 passed (12)`, `Tests 9 failed | 101 passed (110)`. The same
  command on a copy of the workspace with the snapshot's Cartesian files restored gives the same 9 failures with the
  same numbers, so all 9 are **baseline-only**, none is N4's: `isolation` ×2 (undeclared package not reachable in
  this sandbox), `licence` (tarball inventory), `subpaths` bare `axylo/finance` 23 B (finance's fence), and the
  three legacy caps (`line` 135,595 > 135,293, `everything` 158,539 > 158,096, IIFE 158,867 > 158,425 against
  b097f1a — root code outside N4), and `tree-shaking` line/histogram. The Cartesian cap and the bare
  `axylo/cartesian` checks pass in that run.

### Director verify after turn 4 (observed in the Director's log `verify/turn-4-opus-5.5-high__20261127T051320Z.log`)

- First Director verify: failed only on the existing formatter timing test (unrelated to N4).
- Second Director verify: typecheck and build exit 0; `Test Files 126 passed (126)`, `Tests 2243 passed (2243)`;
  acceptance `tests 71`, pass 70, `fail 0`, 1 existing skip (`acceptance/results/browser.json` missing); bench
  `tests 121`, `fail 0`; packed `tests/dist/subpaths.test.ts` selection `Tests 3 passed | 14 skipped`, Cartesian
  126,977 B gzip-9, bare `axylo/cartesian` 0 B.
- **Failure:** `tests/dist/cartesian.browser.test.ts` failed in `beforeAll` before any test ran (3 skipped). Chrome
  aborted (SIGABRT) at `process_singleton_posix.cc:315`: "Socket path too long:
  /home/…/axylo_p2_n4_cartesian_hardening/verify-21jc8ewo/tmp/tmpcukgo1za/com.google.Chrome.kKRpJx/SingletonSocket"
  (151 bytes; `sun_path` holds 107 plus the NUL). Chrome puts that socket in `$TMPDIR`, which the Director's
  sandbox nests deeply. Not an assertion failure; no Chrome result exists yet.

### Turn 5 repair (Chrome startup and the all-missing tooltip)

- `tests/dist/cartesian.browser.test.ts`: `launchWithShortTmpdir()` wraps the shared `launch()` (unchanged
  `tests/dist/browser.ts`). Only on Linux and only when `$TMPDIR/com.google.Chrome.XXXXXX/SingletonSocket` would be
  longer than 107 bytes, it creates `tests/dist/cartesian-chrome-tmp-XXXXXX` (inside the workspace, never `/tmp`),
  sets `TMPDIR` to its `/proc/self/cwd/<relative>` spelling (or its absolute path when that is short enough) only
  around the `launch()` call, and restores (or deletes) `TMPDIR` in `finally`. `afterAll` removes the directory in
  a `finally` after `closeBrowser()`, so it goes on success, on a launch error, and when no short spelling exists
  (that case throws a clear error instead of Chrome's abort). Normal runs with a short `TMPDIR` are unchanged.
  - Checked in the locked playwright-core 1.65.1 (`lib/coreBundle.js`): `_launchProcess` passes
    `options.env ?? process.env` (Chromium's `amendEnvironment` returns it unchanged) and `launchProcess` gives
    `spawn` no `cwd`, so Chrome inherits the worker's env and cwd; the profile and artifacts dirs are
    `mkdtemp(os.tmpdir() …)` at launch time and removed by Playwright on close.
  - Observed with Node 24.21.0 (scratch script, no browser): with that `TMPDIR`, `os.tmpdir()` returns the
    `/proc/self/cwd/…` spelling, `mkdtemp` under it lands in the workspace directory (`realpath` checked), a spawned
    child inheriting the env creates `com.google.Chrome.XXXXXX` in the same directory, the socket path is 94 bytes
    (also 94 for the Director's `…/verify-21jc8ewo/tree` cwd), `TMPDIR` was restored, and the directory was removed.
  - Inferred, not observed: Chrome reads `TMPDIR` without resolving it (Chromium's `base::GetTempDir`), so its
    socket path is the 94-byte spelling. Chrome was not launched here (worker rule).
- `packages/axylo/src/cartesian/stacks.ts`: an all-missing visible slot's tooltip total is now "No data
  (incomplete)" (F10: tooltip as well as table, keyboard and summary); the direct expectation in
  `packages/axylo/test/cartesian/n4-f10-reader.test.ts` changed from the unqualified value to the qualified one,
  following the spec, not the implementation. The core lookup (`lookup/aligned.ts`, not N4's) is unchanged.
- Observed: `tsc -p packages/axylo --noEmit` and `tsc -p tests/dist` exit 0; cartesian units `Tests 48 passed (48)`;
  full units `Test Files 126 passed (126)`, `Tests 2243 passed (2243)`; packed `subpaths.test.ts -t cartesian`
  `Tests 4 passed | 13 skipped`; `node scripts/size.mjs`: `axylo/cartesian` 126,974 B gzip-9 (cap 127,000).
  `dist/axylo.js`, `dist/static.js`, `dist/axylo.iife.min.js` are byte-identical (`cmp`) to a build with the
  stacks change reverted; only `dist/cartesian.js` differs.

### Director verify after turn 6 (observed in the Director's log `verify/turn-6-opus-5.5-medium__20261127T053707Z.log`)

This supersedes the earlier "pending" lists for Chrome and packed sizing.

- `npm run typecheck` and `npm run build`: passed.
- Unit tests: `Test Files 126 passed (126)`, `Tests 2243 passed (2243)`.
- Acceptance `node --test acceptance/test/*.test.mjs`: `tests 71`, pass 70, `fail 0`, 1 existing skip
  (`acceptance/results/browser.json` missing).
- `npm --prefix bench test`: `tests 121`, pass 121, `fail 0`.
- Packed `tests/dist/subpaths.test.ts -t "axylo/cartesian"`: `Tests 3 passed | 14 skipped (17)`; Cartesian
  126,974 B gzip-9 (cap 127,000); the selection includes `"import 'axylo/cartesian'" bundles to 0 raw bytes`, which
  passed (bare import 0 raw B).
- Real packed Chrome `AXYLO_BROWSER=1 … tests/dist/cartesian.browser.test.ts`: `Tests 3 passed (3)` — the C4.3
  scenario (bars + log line + dual y, L9 resize collapse), the 100,000-point bounded path with log omission note,
  pointer/keyboard/table datum agreement and 960 → 320 → 960 px collapse/restore, and the signed/incomplete stacks
  scenario. The turn-5 short-`TMPDIR` startup fix therefore worked in the Director's sandbox.
- `node scripts/size.mjs`: exit 0. Rows captured in the log: root `line only` 135,671, root `everything` 158,539,
  `axylo/static` line only 121,111, `axylo/static` everything 141,410 gzip-9 bytes — equal to the cycle's initial
  `bench/size-latest.json` measurements, so the legacy root/static tax is 0 B. `axylo/cartesian` row 126,974.
- That run rewrote `bench/size-latest.json`; the file was then restored byte for byte to the initial snapshot
  (`cmp` and sha256 `605bff8b…25be` equal to `runs/coordinators/axylo_p2_n4_cartesian_hardening/initial/`), so the
  report is not part of the change. `scripts/size.mjs` was not run again in the deliverable tree.

### Still pending

- RFC §8 post-Wave-2 quiet-window paired Chrome timings; no ratio exists yet. Build the artifact with
  `node bench/src/cartesian-artifact.mjs --out <dir>`, then:
  - same-fixture one-line comparison (the matched A/B for the §8 ratios): `node bench/run.mjs --artifact <dir>
    --baseline axylo-svg --candidate axylo-cartesian --workload first|zoom|hover --size 1x100000` (both sides draw
    fixture checksum `bfd6a33b`);
  - dual-axis line + bar (`--kind cartesian`, tag `cartesian-1x100000`, checksum `69a5994a`): drawn only by
    `axylo-cartesian`, so its A/B is two builds of `axylo/cartesian` (`--adapter axylo-cartesian --base <artifact A>
    --candidate <artifact B> --kind cartesian --workload …`). A root one-line session is a different fixture and is
    not matched-fixture proof for it; whether its §8 row compares against the one-line pair or is redefined is an
    owner decision. Its Chrome admission (dual-axis readback against `expectedView`) has not been run.
- Independent cross-provider review of this exact candidate.

## Repair after cross-provider review `sol-6.2-medium__20261127T054720Z` (Verdict: Merge after named fixes)

Bounded repair in the original fence. No edit to `public.ts`, `core/**`, `dom/**`, `theme/**`, `finance/**` or
contracts; benchmark changes only in `bench/src/**`; `bench/size-latest.json` untouched (sha256
`605bff8b…25be` before and after; `scripts/size.mjs` not run in this tree). No browser, Chrome or localhost in
this turn.

### 1. Benchmark admission uses real geometry (blocker 1)

- Traced: `run.mjs` admission probe → `lib/driver.mjs admit()` → `expectedFor()` (fixtures `workloadData`,
  `expectedView`, `heldColumns`, checksum) → `src/admission.js checkViews/checkView`.
- `src/cartesian.js`: the adapter keeps the root adapter's timing, readiness, zoom and hover code unchanged and
  replaces only the readback (`cartesianReadback`): series are matched to the fixture **by key** (the chart holds
  them bars first); the line's drawn evidence is the captured SVG stroke (`drawn: pixels`), never the shared root
  hook's `kept` (that hook reruns the root line simplifier); the bars are the painted SVG rectangles. Strokes and
  rectangles are read only in the untimed probe run (`probe === 'geometry'`); timed runs report `not-captured`.
- `src/fixtures.js expectedView`: Cartesian fixtures also carry `cartesian` (layout) and `names`. Checksums are
  unchanged (the checksum reads only columns and kind text).
- `src/admission.js`: `checkView` routes a Cartesian readback to `checkCartesianView`, and refuses a dual-axis
  fixture read without one. The line is admitted as a root line on its own left axis (that series' extent, the
  injected extreme, `checkDrawnPixels` on the real stroke); kept/indices readbacks are refused. New
  `checkBarRectangles`: count (window values plus at most 2 clipped neighbours), source-order placement at each
  slot's x, one zero baseline inside the plot on the side of each value's sign, every height proportional to its
  value (1.5 px), the tallest bar inside the plot and at least a quarter of it (domain not looser than 4x). The
  right axis's domain is not in the shared core hook (core is outside the fence), so heights are checked by
  proportion, not against a domain: stated limit.
- Regression `packages/axylo/test/cartesian/n4-bench-admission.test.ts`: the real Cartesian pipeline at the
  harness's 800 × 400 px chart, the adapter's own `cartesianOptions` and `cartesianReadback`, the runner's own
  `admit()` with the fixture checksum. Workloads `first`, `zoom` (final zoom window), `hover` of
  `--kind cartesian --size 1x100000`, and the one-line `first --size 1x100000`. Observed: all admitted; stroke
  ≤ 3,208 vertices; 100,000 rectangles at `first`. Refused: kept indexes, no stroke, stroke moved 25 px, bars not
  captured, 10 bars missing, bars shifted 20 px, bars 30 % short, bars off the baseline, series swapped, root
  readback for the dual-axis fixture.
- Not run: the packed Chrome admission (`run.mjs` probe) itself. Post-merge commands, unchanged:
  `node bench/src/cartesian-artifact.mjs --out <dir>` then
  `node bench/run.mjs --artifact <dir> --baseline axylo-svg --candidate axylo-cartesian --workload first|zoom|hover --size 1x100000`
  (one-line, checksum `bfd6a33b`) and the two-build `--adapter axylo-cartesian --kind cartesian` runs (checksum
  `69a5994a`). The DOM part of `cartesianReadback` (`svg.axylo-svg .axylo-scene > g rect`, as the root bar
  readback selects) is exercised in Node through a stand-in element only: inferred, not shown in Chrome.

Evidence classes for RFC §8 (none measured):
- **Frozen RFC §8 rows** (dual-axis line + bar vs root `first-1x100000`): the two sides draw different fixtures
  (`69a5994a` vs `bfd6a33b`); a ratio between them is not a matched-fixture result and is not claimed to satisfy §8.
  Which comparison answers those rows is an owner decision; ratios remain pending post-merge.
- **Same-fixture one-line overhead** (`axylo-svg` vs `axylo-cartesian`, `bfd6a33b`): the matched A/B of what the
  Cartesian entry adds on identical data.
- **Cartesian-to-Cartesian** (two builds, `--kind cartesian`): both artifacts must be built from trees whose
  `cartesian.ts` forwards the inner `__bench` hook (this N4 candidate or later). The pre-N4 façade exposes no hook,
  so a pre-N4 artifact is refused at admission (`NO_HOOK`); the compatible instrumented baseline is the merged N4
  commit itself.

### 2. Sparse threshold counts drawable values (blocker 2)

`cartesian/dense.ts keep()`: density is decided on the values that can be drawn after slot and log filtering
(one counting pass, the same predicate as the drawing, shared with `lastDrawnValue`), as `simplify/index.ts`
decides on its values. Overscan neighbours stay in the counted range, so near-clip geometry is unchanged; dense
F5 extrema and breaks are unchanged; columns stay borrowed. Regression (`n4-repair.test.ts`): six line values
beside 10,000 bar slots through public options, linear and log, no zoom and two zooms, dpr 1 and 2: all six
vertices drawn at their exact y; a dense line beside the same bars is still simplified.

### 3. Stacked-area stroke and focus on the signed boundary (blocker 3)

- `cartesian/scene.ts stackEdge`: each component's edge is drawn on each side of zero along that side's cumulative
  boundary, joined between two vertices only where both have a value and either is on that side. Reviewer case
  (lower 9; upper +3, −4, +3): edge `12 → 9 → 12` above zero and `0 → −4 → 0` below, no `12 → −4` segment; a
  missing value breaks both (`3, 3, null, 3, 3` gives runs of 2 and 2).
- `cartesian/stacks.ts drawnValue`: the one cumulative-boundary authority (the boundary on the side of the value's
  sign) used by `lookup.ts anchor` and `overlay.ts`. Observed: focus anchor and hover dot at +12 (x = 1) and −4
  (x = 2); `datum()` and the tooltip row read the raw `3` / `−4`.

### 4. Spec wording and citations

- `docs/02-product-spec.md`: F13 and AX172 say a valid pinned positive log domain is drawn as given without AX172
  (as `cartesian/axes.ts` returns it before the data-positivity test); AX181 also covers saturated aggregate
  volume, drawn at the top of the volume scale (`finance/layout.ts saturatedVolume`).
- `acceptance/matrix.json`: F13 (line, area, bar) and L9 (line, bar) now cite the packed Chrome tests in
  `tests/dist/cartesian.browser.test.ts` by their exact titles (Director turn 8: `Tests 3 passed (3)`); their
  pending notes are removed; L9 area keeps its pending note (no right-axis area fixture). F13 statement updated.

### 5. Size — within the cap

The three fixes first measured 127,176 B (+202 B: drawable count +31, signed stack edge +101, shared anchor/overlay
+76, by reverting one change at a time in scratch copies). Recovered by removing branches the Cartesian
composition cannot reach: it is a `'line'` composition (`cartesian.ts`), so every view it builds is aligned and its
layout projects onto xy or bands, never a ring. Removed: the donut/scatter no-op lookup (`lookup.ts`), the
donut/scatter guards of `layout.ts compute`, `overlay.ts`, `reader.ts` and `scene.ts`, the ring guard and
`TypeError` of `scale-ref.ts axisScaleOf` and the ring guards of `scene.ts`; each is a typed cast with a comment
saying why. The overlay's linear slot scan now asks the lookup (`lookup.slot`, the exact visible slot by binary
search, the same equality test). `mark-swatch.ts` is byte-identical to the initial candidate.

In-memory build of both trees with the N2 recipe (`node docs/progress/n2-size-and-bundle.mjs compare <initial
candidate src> packages/axylo/src .prism-cache/tmp/n2cmp`), observed:

```
  root line only (examples/first-chart/npm.ts)                  135671    135671 0
  root everything (export *)                                    158539    158539 0
  static line only (export { line } from 'axylo/static')        121111    121111 0
  static everything (export * from 'axylo/static')              141410    141410 0
  cartesian (export { cartesian } from 'axylo/cartesian')       126974    126990 +16
  axylo.css (file; the same text is embedded in every row)        3387      3387 0
```

Cartesian 126,990 B gzip-9 (cap 127,000; 10 B of margin). Legacy rows 0 B. Bare imports under `ignoreAnnotations`
(esbuild over the release `packages/axylo/dist`): `axylo`, `axylo/static`, `axylo/cartesian` 0 raw B;
`axylo/finance` 23 B (baseline, outside the fence). Packed Node check (`tests/dist/subpaths.test.ts -t
"axylo/cartesian"`, npm cache and HOME in `.prism-cache/tmp`): `Tests 3 passed | 14 skipped (17)`.

### Verification of this repair (observed in this turn)

- `npm run typecheck`: exit 0.
- `npx vitest run --configLoader runner --no-cache`: `Test Files 128 passed (128)`, `Tests 2270 passed (2270)`.
- `node --test acceptance/test/*.test.mjs`: tests 71, pass 70, fail 0, skipped 1 (`acceptance/results/browser.json`
  missing, as before).
- `bench`: `node --test test/*.test.mjs`: tests 121, pass 121, fail 0.
- `npm run build`: exit 0.
- Not run (no browser in this turn): `tests/dist/cartesian.browser.test.ts` in Chrome, `bench/run.mjs` admission in
  Chrome, quiet-window §8 timings.

## Repair: bar admission on the committed right-axis domain (review sol-6.2-medium__20261127T061324Z)

Blocker: `checkBarRectangles` checked bars only by proportion to the tallest bar, so every rectangle with width 0,
or every height halved on its baseline, was admitted.

- `packages/axylo/src/cartesian.ts`: in instrumented builds only (`__DEV__ || __BENCH__`, one guarded block), the
  composition's scene stage is wrapped to copy the layout's projection y axes (`type`, `domain`, `range`) it was
  drawn on; `chart.__bench` is the inner hook (via `Object.create`, so `ready`/`revision`/`memory` are unchanged)
  with `describe()` extended by `yAxes`. No core/contract/public change. The copy is taken when the scene is
  built, which is the layout the shown frame was drawn from.
- `bench/src/cartesian.js`: `cartesianReadback` records `cartesian.rightDomain` = `describe().yAxes[1].domain`.
- `bench/src/admission.js` `checkBarRectangles(…, yDomain)`: keeps the proportion checks and adds: domain is two
  finite numbers, increasing, containing 0 and the window's min/max values; each nonzero bar has width > 0 and
  height > 0; top and bottom each within `PX_TOLERANCE` (1.5 CSS px) of `py(max(v,0))` / `py(min(v,0))`, where
  `py(v) = plot.y + (d1 − v)/(d1 − d0) · plot.height`. A clipped overscan neighbour (outside the window) may instead
  match that mapping clamped to the plot. Legacy (root) admission is untouched.
- `packages/axylo/test/cartesian/n4-bench-admission.test.ts`: the simulated hook carries `yAxes` from the real
  projection; negative controls for zero-width bars, every bar half height (refused with the right-axis-mapping
  reason), and right domain absent / reversed / NaN / strings / not containing the values.

Ran and saw (this repair):
- `vitest run packages/axylo/test/cartesian` — 10 files, 75 tests passed (the real-admit first/zoom/hover 100k
  dual-axis and one-line cases are admitted under the new check).
- `npm run typecheck` — 0 errors. `npm --prefix bench test` — 121 pass, 0 fail.
- Size, in-memory (scratch script in `.prism-cache/tmp`, release `PRODUCTION` defines + minified stylesheet,
  consumer esbuild minify esm; not `scripts/size.mjs`): `axylo/cartesian` gzip-9 126,990 B (same-method baseline
  of the parent source 126,992 B; ≤ 127,000 cap), bare `import 'axylo/cartesian'` 0 B raw. No other entry imports
  `src/cartesian.ts`, so root and `axylo/static` deltas are 0 by construction (not re-measured in this repair).

Not verified here: the `__bench.describe().yAxes` hook in a real browser/bench artifact (no Chrome in worker
turns); packed-dist size via `scripts/size.mjs`. Pending post-merge: RFC §8 paired quiet-window Chrome
measurements (≤ 1.15× startup, ≤ 1.10× zoom/hover p95).
