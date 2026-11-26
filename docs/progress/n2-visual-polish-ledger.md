# Cycle N2 — Visual System, Theme & Responsive Layout Polish (Wave 1, Track A)

**Date:** 2026-11-26
**Fence:** `packages/axylo/src/{theme,dom,layout}/**`, `packages/axylo/src/cartesian.ts` (swatch wiring only),
`apps/docs/**`, `packages/axylo/test/browser/**`, `docs/progress/n2-*`.
No edits to `core/contracts.ts`, `public.ts`, `src/cartesian/**`, finance files, root configuration, dependencies or acceptance files.

Evidence labels used below:
- **observed (author)**: the author ran it in this workspace (Node only; worker turns may not launch a browser);
- **observed (Director, Chrome)**: the Director's real-Chrome run, relayed to the author with its tail;
- **inferred**: read from the source, not executed.

## Current verification (read this first)

**observed (Director, Chrome)** on parent `opus-5.5-medium__20261126T191124Z`, exit 0. Tail:
`Test Files  3 passed (3)` / `Tests  86 passed (86)` / `Duration  47.49s`. The configured Director gate ran exactly
three files, whose test counts match the source:

| file | tests |
|---|---:|
| `packages/axylo/test/browser/chart/n2-visual-responsive.browser.test.ts` | 78: matrix 63, F-RESP-1 4, swatches 6 (legend per scheme 3, hidden outline, tooltip rows, bar→area update), bundle scan 1, narrow strip 3 (three 220 px charts), matrix summary 1 |
| `packages/axylo/test/browser/chart/c3-journeys.browser.test.ts` | 6 |
| `apps/docs/test/theme.browser.test.ts` | 2 (light, dark) |

That run covers the 960 → 360 → 960 F-RESP-1 transition (focus, roving tabindex and toggles carried over) and the
three 220 px strips. It passed after the fixes for the Director's earlier runs, which failed 43, then 8, then 1 test
(history below).

**observed (author, Node)**, unchanged since then: `npm run typecheck` pass; `npm test` 113 files / 2,102 tests pass;
`npm run build` pass; bytes −4 B root line only, −4 B static line only, −3 B static everything (§6).

**Not run:** the full existing browser suite (`packages/axylo/test/browser`, `apps/docs/test`), baseline and candidate
screenshots, a baseline (pre-N2) Chrome control run, real 400 % native zoom (emulated, §5), and manual AT (§9).
Commands for these are in §7.

**This ledger update was docs-only** (no code, CSS, test, script or config change). The Director gate will rerun to
bind the Chrome evidence to the eventual accepted candidate.

Defects below are **inferred from source** unless stated; the only baseline behaviour seen in Chrome is the earlier
candidate runs' failures relayed by the Director. No pre-N2 baseline was run in Chrome in this cycle.

## Repair history (historical: each round's cause and fix; superseded Chrome results)

### Third repair round (after the Director's third Chrome run)

**Observed by the Director, not by this author:** 3 browser files, 85 passed and 1 failed. Docs painted colours 2/2,
N2 matrix 63/63 (every donut `keyboard Home` case included). The one failure: `line · light · 360: a 220 px chart
answers in the strip`, all four steps `readout shows no value`. The strip mounted with its pager and first row.

| failure | root cause (inferred from source) | fix |
|---|---|---|
| narrow strip: `readout shows no value` | In the cut pass the row was `flex: 1` (basis 0 %) and the title before it is `width: 100%`. Flex line collection can put a zero-size item at the end of the title's full line, so the row landed on line one with no width, and only the `; ` and pager went to line two. `withinStrip` accepted the zero-width rect, but the value check did not. | `theme/css.ts`: the row is `flex: 1 1px` (grow 1, shrink 1, basis 1px). A positive size cannot fit on the full title line, so the row joins the pager on line two. Its cap (`max-content`), the pinned button's `min-width`/`min-height` 24px (`.axylo-tooltip-choice`, 0,2,0, a different property), its `display: flex` (0,3,0, later than the readout's `inline-flex` rule), the two-line-height strip, the DOM and focus/pin code are all unchanged. |

Bytes (observed): the fix alone gave −2 / −2 / **+2** (root line only / static line only / static everything).
Offset: `.axylo .axylo-legend-list > li` now shares the identical `.axylo-tooltip-series` rule (`display: inline-flex;
align-items: center; gap: 0.375em; min-width: 0`) and gains `overflow-wrap: anywhere`. That is neutral because the
slice `li` holds only its button, which sets `overflow-wrap: anywhere` itself (inferred). Between the old and new
places, the only rules matching that `li` set the outline. The selector keeps its 0,2,1 specificity. Result
**−4 / −4 / −3** (§6). Tried and rejected (gzip larger): `1 1 1px`, `1 .1px`, `1 0.1px`, `1 1pt`, `1 1ch`, `1 1%`,
`1 1q`, `1 1em`, `1 2px` and `1 4px` (still +1 or +2 on static everything), and reordered declarations.
Suite and fixture unchanged (the value / pager checks and the 220 px long localized fixture are kept).
This round's fix is the candidate that passed the current Chrome run (above).

### Second repair round (after the Director's second Chrome run)

**Observed by the Director, not by this author:** the real-Chrome verify of the previous candidate exited 1 with
exactly 8 failures. Six matrix cases, all `keyboard Home → no tooltip` on the donut at `360` and `320x4` in light,
dark and forced (donut pointer steps, keyboard End and every 960 case passed); the narrow strip case
`line · light · 360` (`pointer on line start / line end, keyboard Home / End: no readout`, while its readout-mode
and geometry checks passed); and the matrix summary. The donut fix was confirmed by the third run (matrix 63/63); the strip fix
needed the third round.

| failure | root cause (inferred from source) | fix |
|---|---|---|
| donut `keyboard Home → no tooltip` at 360 / 320x4 | Home focuses the first slice, 46.2 %, from 12 o'clock to about 166°. Its keyboard ring (`ringRect`, `core/focus.ts`) is the outline of that sector's bounding box, so it covers the right half of the ring and nearly the whole plot height. It also crosses the hole's centre, so the hole spot is refused (the outline would be covered). The one-row tooltip with long French/German/Japanese text keeps its natural width, about 210–260 px, which fits neither above, below nor beside the ring in a plot about 336 px wide. Pointer steps have no ring, keyboard End's 3.3 % slice has a small one, and at 960 the free column is wide enough. So only this case failed. | `DomTooltip.show` (`dom/tooltip.ts`): when the last pass (one row) cannot be placed and a keyboard ring is present, the row is tried **once** more, with its maximum width set to the wider free column beside the ring (`max(ring.x − visible.x, visible.right − ring.right)`, floored, at least 49 px and narrower than the usual maximum). The same loop body then remeasures it, wraps it if it overflows (`axylo-tooltip-wrap`) and places it by the same `placeTooltip` → `fallbackPlacement` rules. Those rules never overlap the ring rectangle, which includes the painted outline and its surround, or the controls, and the overflow check still refuses cut content (L1). The hole-first and side order are untouched whenever the normal fit succeeds. Pointer paths never reach the retry, because they have no ring. The changed maximum is written to `#maxWidth`, so the next `show` restores the usual one and drops the width cache. |
| narrow strip `line · light · 360`: no readout at all | In the last (cut) pass the one row was `inline-flex; max-width: 100%`, so with a long label it took the whole of line two. The `; ` separator and `+2 more` pager then wrapped onto a third line. `withinStrip` saw the pager outside the two reserved lines and the whole strip was hidden. | Cut pass only (`theme/css.ts`): the strip is a wrapping flex container (`white-space: pre`, so each `; ` separator, now an anonymous flex item, keeps its space). The title takes line one (`width: 100%`). The row is `flex: 1` from a zero basis, capped at `max-content`, so it only takes what the total and pager leave on line two. The value is `flex: none` and keeps its width. The label takes the ellipsis, and the value is ellipsized too if it alone is wider than the row. The strip keeps its height (two line heights), DOM, text, aria meaning, row buttons (`min-height`/`min-width` 24 px kept) and pager. Passes 0 and 1 are unchanged, and pass 2 only runs where the old code hid the strip. No JS was added. |

Suite: the strip branch of `tooltipProblems` now also requires the strip's first value (non-zero width) and, if
there is one, its pager inside the strip, so the named regression fails on a missing value or a pager off the strip.
Every other fixture, expected value and threshold is unchanged. Not added: an assertion on the painted keyboard
outline (the overlay paints it as SVG marks, and no stable selector exists yet). The placement rules already exclude it,
by construction (inferred).

Placement check (**inferred**, Node, estimated 360 px geometry, not Chrome): with the ring rectangle of a 0–166°
sector, `placeTooltip` and `fallbackPlacement` both return `null` for 260 × 46 and 210 × 46, and `fallbackPlacement`
returns `{ x: 12, y: 104, side: 'above' }` for the 162 px column at 80 px tall (`.prism-cache/tmp/sim.ts`).

Bytes (observed, §6): the new code cost +63 B (JS) and +45 B (CSS) on root line only. These behaviour-neutral
consolidations, each measured, more than offset it:
- `withinStrip(el, box)` computes its right and bottom edges itself;
- the floating heading's `fontVariantNumeric = 'tabular-nums'` inline style moved into the shared
  `.axylo-tooltip-title, .axylo-tooltip-total, .axylo-readout-total` rule (weight 600 and tabular digits). The
  strip's heading now also gets tabular digits. A page's own unlayered CSS can now override the heading's digits. If it does,
  the existing `ResizeObserver` check drops the width cache, as it does for any other font change;
- the `#floatingTitle` helper inlined;
- the cut spans share the strip title's ellipsis rule, and the value's `flex: none` shares the swatch's (the
  descendant `span` keeps specificity 0,3,1, so the value keeps `overflow: hidden`);
- the title's `width: 100%` shares the tooltip choice's rule;
- dead declarations removed: `display: inline` on `.axylo-readout-entry` (a span is inline, and no other rule in
  the layer sets its display), `pointer-events: none` on the font probe (`visibility: hidden`, and inherited from
  `.axylo-text`) and `display: block` on `.axylo-svg` (absolute positioning blockifies it);
- `.axylo-plot { overflow: hidden }` folded into `.axylo .axylo-plot` (no other rule in the layer sets the plot's overflow).

Handed to N3 (manual): see §9.

### First repair round (after the Director's Chrome run)

**Observed by the Director, not by this author** (relayed by the supervisor; the full log was not retained): the
Chrome verification exited 1 with 43 failures. The 1,600-character tail named: the donut matrix cases
`forced · 360` and `forced · 320x4` failing on `no axis rule` (a donut has no axes), and
`an update that keeps a series and changes its mark redraws its swatch` (expected `area`, received `bar`).
The other failures are not known here.

What the round changed (details in §3–§6):

| finding | kind | root cause | fix |
|---|---|---|---|
| bar → area update keeps the bar swatch | product defect | `#renderControls` (`dom/interaction.ts`) returns early when `collectControlInputs` gives the same inputs; those hashed series key, label, visibility and cue only, so a mark change never reached `buildControlItems` or the toolbar's signature | `SeriesSwatch.key?(index, view)` (`dom/interaction-types.ts`), pushed per series into the control inputs; the Cartesian swatch's key is its paint index and drawing key (mark, caps, centre marker) |
| donut cases fail on `no axis rule` | suite defect | `paintProblems` required an axis for every kind | axes required only where the kind has them (`AXES`) |
| forced colours checked only the axis | suite defect | `paintProblems` returned early in forced colours | forced cases check every text, axis, series paint and the focus ring: system colours (L4), contrast against Canvas |
| colours parsed by a regex | suite defect | `rgba()` accepted `rgb()/rgba()` only and skipped `url(`/`color(` silently | every colour is read back through a 2D canvas in the page; an unreadable value is a problem |
| donut and scatter never pointed at | suite defect | the pointer steps were skipped for donut and scatter; one answer anywhere was enough | pointer anchors on the drawn marks for every kind (§5), and every step must answer in the mode rule 5 gives |
| one overflowing tooltip row placed cut | product defect | `DomTooltip.show` (`dom/tooltip.ts`): on the last pass (one row) an overflow that wrapping did not cure fell through to `placeTooltip`/`fallbackPlacement`, so the box was placed at its maxima with `overflow: hidden`, cutting text (L1) | that row is not shown (`if (over) continue;` on the last pass ends the loop; written `continue; break` before the second round, same behaviour); the datum keeps its highlight, keyboard reading and table row, as I1 says for a plot that cannot hold a readout |
| a failing case leaked its browser context | suite defect | `closePage` ran only after the last assertion | the matrix closes its page before asserting; every other test is released by an `afterEach` |
| root bundle +75 B / static +68 B / +74 B | budget | §6 | §6 (that round: −18 / −16 / −12 B; current −4 / −4 / −3 B) |

## 1. Docs painted-colour test (`apps/docs/test/theme.browser.test.ts`)

**Root cause (inferred from source).** The test reads the gridline paint with
`svg.axylo-svg line[style*="--axylo-grid"]`. The SVG renderer has not drawn gridlines as `<line>` elements since rule
batching: `SvgRenderer.draw` (`src/render/svg.ts`, `ruleRunEnd` / `updateRules`) merges each run of
consecutive `grid` (and `tick`) rules with the same paint, width and dash into one `<path>`, painted through
`color: var(--axylo-grid, var(--axylo-default-grid))` and `stroke: currentColor`. In the test's chart (four days,
several y gridlines), every gridline belongs to such a run, so the selector matches nothing. `--axylo-grid` reads
`'missing'`, `toEqual` fails, and it fails the same way in both schemes, which is the two failures recorded since C1.

**Which values were affected.** Only `--axylo-grid`, as far as the source shows. The axis lines and the reference rule are still single `<line>` rules (axis and reference roles are never batched). The series selectors already accepted `<path>`. The subtitle and focus-ring reads are CSS properties of HTML elements. No production divergence was found: the batched path paints with the same token expression as a single grid `<line>` (`paintOf` → `TOKEN_BINDINGS`), and `theme/css.ts` emits the same `--axylo-default-grid` values that `readThemeDefaults` reads from `dist/axylo.css`. Production code is unchanged for this item.

**Fix (test instrumentation only).** The test now reads axis, grid and reference through one helper. It takes every stroked
`line`, `path` or `rect` whose style names the token (filled-only shapes such as a reference band are left out) and requires exactly one computed stroke among them. It reports `'missing'` when there is no such shape and `'mixed: …'` when they disagree. The seven expected
values, the strict `toEqual` against the packed stylesheet in both schemes, and the light/dark contexts are
unchanged. A missing mark, a transparent stroke (`rgba(0, 0, 0, 0)` ≠ the expected `rgb(...)`), a wrong token or
the wrong scheme still fails. The check is stricter than before: before, only the first matching element counted; now every matching shape must agree.

**Verification.** observed (Director, Chrome): both cases pass on the candidate. The baseline failure mode
(`'--axylo-grid': 'missing'` in both schemes) is inferred, not re-run in Chrome this cycle (§7 has the command).

## 2. F-RESP-1: `legend: 'right'` on a narrow container

**Change (`src/theme/css.ts`, CSS only, no JS).** A figure that holds the rail (`.axylo-figure:has(.axylo-controls-side)`)
becomes a named size container (`container: axylo / inline-size`). Under `@container axylo (width <= 480px)` the body
stacks (`flex-direction: column`), so the side slot, which the DOM places after the plot's column, becomes a strip under
the plot (and under the readout strip, when there is one). The rail's own rules (margin, `max-width: 40%`, `overflow: auto`, column toolbar and slice list) now apply only under `@container axylo not (max-width: 480px)` (the exact complement; the range form `width <= 480px` was 3 B larger at gzip -9 and means the same). Below the threshold the slot takes the
same base styles as `legend: 'bottom'`: a `0.5em` top margin, wrapping row toolbar, row slice list and full width.

Why this shape:
- **Same nodes, same order.** No DOM move, so focus, roving tabindex, `aria-pressed`, toggles, the donut slice list
  and table behaviour are untouched by construction. The open table still covers only the plot's column (it lives in `.axylo-stage`).
- **No oscillation.** The query reads the figure's inline size. The figure's width comes from the chart root, and the legend's position does not change it (the legend lives inside the figure). Moving the legend changes the plot's size and the layout re-runs through the existing ResizeObserver, but the switch has no width feedback.
- **Container, not viewport.** No media query: a 400 px chart in a 960 px page stacks, and a 600 px chart keeps its rail whatever the viewport.
- **Only rail charts are contained.** Charts without `legend: 'right'` get no containment at all.

**Known trade-offs (inferred).** Size containment means a rail figure contributes no intrinsic inline size to a shrink-to-fit parent (an `inline-block` or `flex` item with no width). Before, the legend's width leaked into such a parent. Charts in that situation already had a 0-width plot (the plot's spacer is `width: 100%`), so nothing usable is lost, but the reviewer should know. Layout containment also makes the figure a stacking context. The tooltip is placed inside the plot's visible box (decision 0004 rule 6), so it never needed to paint above content outside the figure.

**Also fixed (deliverable 4, same area):** a donut slice's "current" outline (`li.axylo-legend-current`, 1 px outside) was
clipped by the rail's `overflow: auto`. In the rail it is now drawn inside (`outline-offset: -2px`), as the rail's buttons
already were.

**Docs:** `apps/docs/pages/options.md`, `legend` row, now says that `'right'` falls back under the plot at 480 px or less.

**Verification:** observed (Director, Chrome), 4/4: `n2-visual-responsive.browser.test.ts` → *F-RESP-1* block:
960 → 360 → 960 on one instance (beside → below → beside, focus kept on the same entry, Enter/Space toggle
`aria-pressed`, ArrowRight/Left roving, Tab/Shift+Tab escape). It also covers 400 px vs 600 px containers in a 960 px page,
the exact 480/481 px threshold, a fixed 320 px height at 360 px, and a donut slice list at 360 px in forced colours.
Every step also asserts no clipped or overlapping text, all chrome inside the container, the caption above the plot, no legend entry over the plot, and no tick or axis title under a legend entry.

## 3. Mark-aware Cartesian legend and tooltip swatches

**Cause.** `cartesian.ts` passed `swatch: lineSwatch`, so every layer (bar, area, range, error bar) showed a line swatch in both the legend and the tooltip (the shared interaction uses the composition's swatch for both).

**Change.**
- `src/dom/mark-swatch.ts` (new, imported only by `src/cartesian.ts`): `createMarkSwatch(stateRef)` reads each series'
  mark from `meta.seriesByField` by the series' own field in the committed view (not by position). One function,
  `drawingOf`, gives the series' paint index and drawing, and both the swatch and its key are built from it:
  - line → the shared `lineSwatch` (dash + marker);
  - bar → plain filled square, no pattern (Cartesian bars draw none);
  - area → region at fill-opacity 0.22 under a 2 px full-colour edge carrying the series' dash, with the
    `axylo-swatch-line` class so the contrast dash switches exactly where the marks' does;
  - range → a band at fill-opacity 0.22, no edge;
  - errorBar → a whisker with caps (unless `capWidth: 0`), plus the centre marker when the layer has `y`.
  A range or error bar is one mark in one colour, its centre's, else its low field's (`seriesPaint(centerIdx ?? lowIdx)`). Hidden series are outlines of the same shape (I2).
- Shared hooks (root bundle): `SwatchSpec.shape?: { key, draw(svg, spec) }` (`dom/swatch.ts`): `createSwatch` calls it
  in place of the built-in shapes. `SeriesSwatch` gets the committed `view` as a fourth argument and an optional
  `key(index, view)` (`dom/interaction-types.ts`); root swatches have no key.
- **Cache invalidation (first repair round).** `collectControlInputs(d, out, tableOpen, rangeOn, closer, swatch)` pushes
  `swatch.key?.(i, view)` after each series' cue, so `#renderControls`' `sameKey` sees a mark, interval colour, cap
  or centre-marker change and rebuilds the items. The toolbar's item signature (`dom/toolbar.ts`) is now
  `JSON.stringify([label, struck, symbol, swatch])`: every swatch field is plain data and a shape is named by its
  `key` (its `draw` function is dropped by JSON), so a spec that draws differently always gives a different text;
  equal specs built with another field order could differ, which costs a redraw, never a stale swatch. Unchanged
  root charts: the key is absent (`undefined` on every render, so `sameKey` still matches), and a redraw happens only
  when the inputs change, as before. Focus: the toolbar keeps buttons by item key and only replaces content, and
  `#renderControls` already restores focus after a redraw (unchanged). Rollback: the swatch and its key read
  `stateRef.meta` at call time, which `cartesian.ts` restores on a strict rejection, so the next comparison
  matches the old inputs again.
- **Tooltip rows (inferred from source).** The tooltip's swatch cache (`#swatches`) is cleared whenever the
  committed view changes, and `#syncRow` replaces a row's swatch when the spec object differs. A mark change always
  changes the translated carrier (`__mark` in `cartesian/options.ts`), so the controller re-encodes into a new
  frame and view, and the tooltip, when shown, swaps the swatch on that same commit. No change was needed.

**Verification.**
- observed (author, Node): `packages/axylo/test/browser/chart/n2-mark-swatch.test.ts`, 8/8. Added in the first repair round: `the cached control
  inputs change when a layer changes mark, interval colour, caps or centre` drives `collectControlInputs` with the
  real `createMarkSwatch` over metas parsed from options (bar→area, `capWidth: 0`, centre removed) and checks that
  `sameKey` sees each change and matches again after the meta is rolled back. Mutation check: with the
  `swatch.key?.(i, view)` push removed, that test fails (`bar to area: expected true to be false`); restored.
- observed: `dom/mark-swatch.ts` code is absent from `dist/axylo.js`, `dist/static.js` and `dist/axylo.iife.min.js`, and present in `dist/cartesian.js` (`grep -c axylo-swatch-whisker`: 0 / 0 / 0 / 1).
- observed (Director, Chrome): legend marks and colours in light, dark and forced; hollow state and restore; tooltip row swatches; the bar→area update (6/6); the bundle scan inside the browser suite (1/1).

**Handoff to N5:** the interval layers still contribute one legend entry per carrier field (low, high, centre), and
toggling one field hides only part of the mark (interval legend leakage). N2 keeps the existing visibility semantics and only draws the right mark for each entry.

## 4. Visual hierarchy, tooltip and strip legibility

Read against L1–L4, L8, I1 and decision 0004 (inferred unless stated):
- **Fixed: a cut tooltip** (Repair history, first round). The earlier version of this ledger said a single row that cannot fit "is not shown
  rather than clipped"; the source did the opposite on its last pass. It now does what that sentence said.
- **Fixed: the rail's clipped slice outline** (§2).
- Tooltip placement is clamped to `plot ∩ visible viewport` (`interaction.ts` → `placement.ts`, rule 6); `maxWidth`/`maxHeight` follow the visible plot; content wraps (`axylo-tooltip-wrap`) before rows are dropped.
- Strip readout: two reserved lines, title cut with an ellipsis, rows wrap then cut (`axylo-readout-wrap` / `-cut`). Unchanged; the suite now drives it with a truly narrow plot (§5).
- Tokens: the default palette meets L2 on its own background (`theme/palette.ts`). The suite measures painted text, marks, axes and the focus outline (§5).
- Not changed on purpose: tick/title font sizes and spacing. Changing them moves every measured layout and existing
  fixture (`L1` fit, too-small thresholds) and no defect has been observed that pays for it: the passing Chrome
  matrix checks contrast, size, containment and overlap, not taste. A type-scale review is handed to N3 (§9).

## 5. Browser suite `packages/axylo/test/browser/chart/n2-visual-responsive.browser.test.ts`

It runs against the built bundles: `dist/axylo.iife.js` via the shared `chartPage`, and `dist/cartesian.dev.js` as an ES module served by page route.
- **Matrix, 63 cases:** {line, area, bar, histogram, scatter, donut, mixed Cartesian} × {light, dark, forced colours + `prefers-contrast: more`} × {960 CSS px, 360 CSS px, 320 × 256 CSS px at device scale factor 4}.
  - **Why 320 @ ×4 is 400 % zoom:** Chrome's page zoom divides the CSS viewport by the zoom factor and multiplies the device pixel ratio by it. A 1280 × 1024 window at 400 % therefore lays out in 320 × 256 CSS px at DPR 4: the WCAG 1.4.10 reflow width (L1/A6).
  - Long French, German and Japanese titles, subtitles, series, axis and category labels (one language per scheme, so each kind and width sees all three).
  - **Marks**, from the shipped SVG groups (`render/svg.ts`, `scene/*.ts`, `cartesian/scene.ts`): bars are `<rect>`s in a
    `<g>` painted through `color`; lines and whiskers stroked paths; areas at the scene's declared fill-opacity
    (0.25, or 0.8 stacked) with their stroked edge; Cartesian areas/bands at 0.22; points and donut slices solid filled paths.
    Paint is the computed (inherited) value, and the opacity that reaches the screen multiplies colour alpha,
    fill/stroke-opacity and every ancestor's opacity.
  - **Paint (L2, L4):** every colour is read back through a canvas (any serialization, system colours included); an
    unreadable one fails. Light/dark: text ≥ 4.5:1 against the first opaque background behind it and ≥ 12 px; solid
    marks, axes and the focus outline ≥ 3:1; translucent fills and gridlines exempt; no painted shape transparent
    (background knockouts excepted). Forced: the same thresholds against Canvas, and every text, axis, series
    paint and the focus ring must be a system colour. Axes are required only for kinds that have them (not donut).
  - **Readout (I1, decision 0004 rule 5):** pointer anchors on drawn marks, found with `isPointInFill` or the path's own
    geometry: first and last bar, both ends of the first series line, the leftmost and rightmost point marker,
    the largest and smallest donut slice; then keyboard Home and End. The expected answer follows rule 5 from the
    data area (the keyboard proxy is placed on it): the strip in readout mode, else the floating tooltip with a data
    area of at least 240 × 140, else none (and never floating). Every step must answer in that mode with a title and a
    row, every text inside its box (a designed ellipsis cut excepted, whose cutting element must be in the strip),
    no floating overflow, text contrast and size, inside the viewport and the plot (floating) or the viewport's width
    and the container (strip: the page may scroll vertically at 320 px).
  - Also: text whole, inside the figure and non-overlapping (`textBoxes`/`overlaps`); tick labels where there are axes;
    chrome inside the container, no horizontal page scroll, caption above the plot, legend clear of it; Tab/Shift+Tab with no trap.
  - **Compact diagnostics:** each case fails with one line (`kind·scheme·size: first four problems | +N`). The last test,
    *N2 matrix summary*, fails with `N run, M failing` and one line per problem category (numbers, quotes and colours
    folded) with the cases it hit, so a short log tail names what is left.
- **Narrow strip (new):** line · light · 360, Cartesian · dark · 360 and bar · forced · 320×4, in a 220 px wide
  container with a fixed height, a short title and no legend: rule 5 must give the strip, and the strip must hold the long labels by its own wrap/cut rules.
- **F-RESP-1:** §2. **Cartesian swatches:** §3. **Bundle scan:** §3.
- Contexts: the matrix closes its page before asserting; any other test that fails early is released by `afterEach`.

Opt-in screenshots: `AXYLO_N2_SHOTS=<dir>` writes `<kind>-<scheme>-<size>.png`, `strip-*.png`, `legend-right-*.png` and `cartesian-swatches-*.png` (repeatable command in §7). The Director gate did not set it, so no screenshot has been generated or inspected yet.

## 6. Bundle size (DX7) — observed

Recipe: `docs/progress/n2-size-and-bundle.mjs` builds a `src` tree the way `scripts/build.mjs` builds dist (same esbuild
settings, `PRODUCTION` defines, the stylesheet minified by that tree's own `minify.ts` and embedded as a literal),
then bundles each consumer row (esbuild, minify, es2022) and gzips it at level 9. `compare <base-src> <src>` builds
both trees into `.prism-cache/tmp/n2-size/compare/{base,candidate}` and prints the deltas (exit 1 if a budget row grows).
Check (observed): the recipe's `axylo.js` and `axylo.css` are byte-identical to `npm run build`'s `dist/axylo.js` and
`dist/axylo.css` (`cmp`), and `static.js` / `cartesian.js` match in size. No `npm pack`.

Baseline = the pre-N2 sources: this workspace's `src` with `theme/`, `dom/`, `layout/` and `cartesian.ts` replaced by
the untouched Wave-1 copies (identical in every sibling workspace checked, e.g. `runs/work/hydrog-39e496`). It
reproduces the original table exactly (135,240 / 120,674 / 140,959 B).

| row (consumer bundle, CSS embedded) | baseline gzip-9 B | candidate gzip-9 B | Δ |
|---|---:|---:|---:|
| root line only (`examples/first-chart/npm.ts`) | 135,240 | 135,236 | **−4** |
| root everything (`export *`) | 158,087 | 158,076 | −11 |
| static line only | 120,674 | 120,670 | **−4** |
| static everything | 140,959 | 140,956 | **−3** |
| cartesian | 124,166 | 125,038 | +872 |
| `axylo.css` file | 3,275 | 3,316 | +41 |

Current candidate (observed, table above, third repair round; the docs-only update did not touch measured files).
History: the second round's candidate measured −6 / −4 / −2. The recipe's `axylo.css` and `axylo.js` are
byte-identical (`cmp`) to this round's `npm run build`.

Second repair round (historical, observed, same reconstructed baseline). The first round's candidate measured −18 / −16 / −12. The two fixes alone took root line only to +90
(JS +63, CSS +45). The consolidations listed under the second repair round brought it to −6 / −4 / −2. The recipe's `axylo.css` and `axylo.js`
are byte-identical (`cmp`) to this round's `npm run build` output.

Where the bytes went (root line only, observed by building each step): the candidate as first sealed was +75; the
cache fix added +12 (+87). Then, in this order:
- three focus-outline rules folded into the shared one (`li.axylo-legend-current`, `.axylo-table-scroll:focus-visible`,
  `.axylo-jump-field:focus-visible`: same declarations, each selector keeps its specificity, and no rule between
  their old and new places sets their outline): −9 (+78);
- the toolbar item's swatch part as JSON (`dom/toolbar.ts`, §3), measured together with
  `.axylo-jump-field[aria-invalid="true"]` folded into the pressed control's `border-width: 2px` rule (its 0,3,0
  specificity still beats the field's own 0,2,0 border): −68 (+10);
- the whole item signature as one JSON array (label, struck, symbol, swatch; unambiguous whatever the label holds, so
  the length prefix is no longer needed): −22 (−12);
- the container queries written as `(max-width: 480px)` / `not (max-width: 480px)`, which mean the same as
  `width <= 480px` / `width > 480px`: −3 (−15);
- the tooltip overflow fix (first repair round): −3 (−18).
Tried and rejected because gzip got larger: folding the caption's margin into `controls-top` (+2) and the title's weight into the tooltip title's (+6).
Not used: removing `-webkit-appearance: none` (−2; it is dead in the engines of spec 2.3, but it is not a consolidation and was not needed).
The Cartesian swatch drawings add 0 B to the root and static bundles: the module is not in them (§3).

## 7. Commands for the Coordinator / Director (real Chrome)

```bash
npm run typecheck && npm test && npm run build
# size: a pre-N2 src tree, then the paired comparison (no pack). From a git checkout with the baseline commit:
mkdir -p .prism-cache/n2-baseline
git archive <baseline-sha> packages/axylo/src | tar -x -C .prism-cache/n2-baseline
node docs/progress/n2-size-and-bundle.mjs compare .prism-cache/n2-baseline/packages/axylo/src packages/axylo/src
# docs painted colours (both schemes)
AXYLO_BROWSER=1 npx vitest run apps/docs/test/theme.browser.test.ts
# N2 suite (+ c3 journeys = the Director gate), then the full existing browser suite (not yet run)
AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser/chart/n2-visual-responsive.browser.test.ts packages/axylo/test/browser/chart/c3-journeys.browser.test.ts
AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser apps/docs/test
# candidate screenshots
AXYLO_BROWSER=1 AXYLO_N2_SHOTS=docs/progress/screenshots/n2/candidate npx vitest run packages/axylo/test/browser/chart/n2-visual-responsive.browser.test.ts
# baseline screenshots and baseline failures (expected: swatch, F-RESP-1, tooltip-overflow and bundle-scan cases fail)
mkdir -p .prism-cache/n2-baseline-bundle
node docs/progress/n2-size-and-bundle.mjs bundle .prism-cache/n2-baseline/packages/axylo/src .prism-cache/n2-baseline-bundle
AXYLO_BROWSER=1 AXYLO_BUNDLE=$PWD/.prism-cache/n2-baseline-bundle AXYLO_N2_SHOTS=docs/progress/screenshots/n2/baseline \
  npx vitest run packages/axylo/test/browser/chart/n2-visual-responsive.browser.test.ts
```
Inside a sandbox with a read-only, symlinked `node_modules`, add `--configLoader native --no-cache` (or `--configLoader runner`) to `vitest run`.

## 8. Status

| item | status |
|---|---|
| typecheck (`npm run typecheck`) | observed (author) pass |
| unit tests (`npm test`) | observed (author) pass: 113 files, 2,102 tests (`vitest run --configLoader runner`) |
| `npm run build` | observed (author) pass |
| size table | observed (author): −4 / −4 / −3 B on the budget rows (root line only / static line only / static everything) |
| Director Chrome gate (3 files) | observed (Director, Chrome): 86/86, exit 0 (N2 suite 78, c3 journeys 6, docs painted colours 2) |
| full existing browser suite (final-closing, final-pin, final-round3, split-seams, …) | **not run**. The cut-pass CSS only applies where the old code hid the strip, and the donut retry only runs where the old code showed no tooltip (inferred) |
| baseline (pre-N2) Chrome control run | not run (§7) |
| screenshots (baseline and candidate) | not generated (`AXYLO_N2_SHOTS`, §5 and §7) |
| real 400 % native zoom, real forced colours, manual AT | not run; N3 (§9) |
| evidence binding | the gate reruns on the eventual accepted candidate; this update was docs-only |

## 9. Deferred to N3 (manual AT and interaction)

- Screen readers (NVDA + Firefox, JAWS + Chrome, VoiceOver macOS/iOS, TalkBack): a `legend: 'right'` chart crossing 480 px. The DOM and reading order do not change, but announcing the moved strip needs a person.
- Real Windows High Contrast / forced colours (this suite emulates `forced-colors: active`), and real 400 % browser zoom (emulated by the CSS viewport + DPR equivalence above).
- Touch: tapping legend entries in the narrow strip, the cut strip's pager and pinned row, and `TAP_TIME` / pin re-tap (F-RESP-3/4, still open).
- Screen reader and magnifier pass over the donut's narrowed keyboard tooltip (left of a large slice's ring at 360 px / 400 %), and a visual check that it reads well where it covers the other slices.
- Whatever the full browser suite or the screenshots show that is a product defect outside N2's fence, and the design questions of type scale and spacing.
- Translucent range-band swatch contrast in forced colours (it matches the mark's 0.22 fill-opacity; whether the mark itself needs more is an N5 marks question).

## 8. Fourth repair round (four independent-review blockers) — observed vs. not yet run

1. **F-RESP-1 intrinsic width.** Root cause: `.axylo-figure:has(.axylo-controls-side) { container: axylo / inline-size }`
   applied inline-size containment to the figure, so the figure contributed 0 to a shrink-to-fit target (an auto-width
   `display: inline-block` chart that took its width from a long title or the controls collapsed). Fix (`theme/css.ts`):
   the container is now the plot/rail row, `.axylo-body:has(> .axylo-controls-side:not([hidden]))`; the caption and
   controls outside it keep giving the figure its width. A container cannot restyle itself, so the row gets
   `flex-wrap: wrap`; at ≤ 480 px every row item takes `flex: 1 100%` (the strip on its own line under the plot, same
   nodes, same order, so focus / roving / pressed state carry over as before); above 480 px the stage's basis is 0 so
   the rail never wraps. Pure CSS: no observer, no JS decision, no feedback loop (the row's width does not depend on
   the legend's place). Known difference (inferred, not measured): in a definite-height chart ≤ 480 px the flex lines
   share free height (`align-content: normal`), where the old column gave it all to the plot.
2. **Donut dominant slice.** `dom/tooltip.ts` one-row keyboard path: after the existing side-column retry, up to two
   bounded hole-width retries (`1.41·rx`, then `1.73·rx`, the second wider and shorter because wrapping grows the
   height); acceptance is still `holeSpot`'s ellipse / ring-stroke / controls test, so the hole-first policy,
   ring and controls clearance and containment are unchanged.
3. **Cut strip with stacked total.** `withinStrip` now also checks the total in the fit guard. The strip total is
   split into a label span and a number text node (same `textContent`, `lang` on the label); in the cut layout the
   total is a `flex: 1 1px; max-width: max-content` item like a row, its label ellipsizes and its number sets its
   least width, so it stays on line two with the first value and pager. Non-cut strip and floating tooltip
   markup/rules are untouched (the new rules are scoped to `.axylo-readout-cut`).
4. **Error-bar swatch, centre hidden.** `dom/mark-swatch.ts`: the centre marker (and the drawing key) is dropped while
   `view.visible[centre]` is false; interval paint (centre colour) and hollow semantics are unchanged.
   Node test added in `test/browser/chart/n2-mark-swatch.test.ts` (hide → whisker only, key changes, show → marker back).

New Chrome regressions (in `n2-visual-responsive.browser.test.ts`, describe "N2 repair regressions"): inline-block
auto-width `legend 'bottom' → 'right'` update; dominant 90/10 donut keyboard Home at 360 px; 220 px stacked bar strip
with an overwide localized `messages.total` (total box and number inside the strip, ≤ 2 line heights, first value,
pager in bounds and ≥ 24×24). **Not run in this worker turn** (browser suites are reserved for the Director);
typecheck covers them.

Observed in this turn: `npm run typecheck` pass; `npx vitest run --configLoader runner`: 113 files, 2103 tests passed;
`npm run build` pass; recipe `axylo.css` / `axylo.js` byte-identical (`cmp`) to `dist`.

**Bundle (observed, `compare` against the exact Prism initial snapshot
`runs/coordinators/axylo_p2_n2_visual_responsive/initial/packages/axylo/src`):**

| row | initial gzip-9 B | candidate gzip-9 B | Δ |
|---|---:|---:|---:|
| root line only | 135,241 | 135,362 | **+121** |
| root everything | 158,084 | 158,220 | +136 |
| static line only | 120,675 | 120,813 | **+138** |
| static everything | 140,961 | 141,082 | **+121** |
| cartesian | 124,168 | 125,181 | +1,013 |
| `axylo.css` | 3,275 | 3,350 | +75 |

**Budget NOT met (open obstacle).** The pre-repair candidate measured −5 / −5 / −5 against this snapshot. Measured
cost of the fixes on root line only: hole retry ≈ +54 → +41 after compaction, total split ≈ +21, CSS (row container,
wrap rules, cut-total rules) ≈ +60. No further safe consolidation was found within the time box; previous rounds
already took the cheap ones (§6). Dropping `:not([hidden])` would save 4 B but leave a former rail's row contained.

## Repair (Director's 3 Chrome failures): donut 90/10 pointer/Home, 220 px stacked strip; size

Changes:
- `src/dom/tooltip.ts`: a one-row floating tooltip with no side column now retries inside the hole whenever a hole
  exists (`shown === 1 && h`), not only when a keyboard ring is present, so the pointer path gets the same retry as
  Home. Two bounded widths, 1.41 r then 1.6 r (was 1.73 r); `holeTry < 2` keeps it non-cyclic. Side retry and
  `placeTooltip` validation are unchanged.
- `src/theme/css.ts`: `min-width: 0` on the cut strip's total/entry flex items. Before, the total label's nowrap
  min-content width set the total's least width and pushed the pager off line two. The number is still a whole
  anonymous flex item.
- New browser case: donut 90/10 at 360 px in a 425 px tall chart, with the same labels. It checks pointer
  (`tooltipProblems`) and keyboard Home, and asserts the chart is not `tooSmall`. The existing 63 auto-height cases
  are untouched.

Evidence I ran myself (sandbox, no browser):
- `npm run typecheck`: clean. `npx vitest run --configLoader runner`: 113 files, 2103 tests passed. `npm run build`: OK.
- `npm run size` cannot run here (`npm pack` hits EROFS on ~/.npm). I measured instead with the same esbuild settings
  (minify, esm, es2022, production condition, gzip 9) against the rebuilt `packages/axylo` through a symlink:
  line only 135362 (+121 vs 135241), static line 120813 (+138 vs 120675), cartesian 125181, everything 158218.
  **The size target of <= 0 B is NOT met.** I did not find a safe consolidation inside this time box.
- Not verified: every Chrome case, including the three failures and the third (truncated) one. Fixed-height narrow
  legend wrap was not assessed. Chrome is left for the Director.

### Final repair turn — floating tooltip one-row retry (source only, browser NOT re-run)
- Root cause: `show()` did `if (over) continue` for every row count, so a wrapped single row that overflowed ended the loop before the ring-column / hole-width retries ran, and a failed narrow retry skipped the remaining hole width.
- Fix (`src/dom/tooltip.ts`): overflow `continue`s only while `shown > 1`; at one row an overflowing box is marked `clipped`, never placed (no `placeTooltip`/`fallbackPlacement`), and falls through to the narrower retries. A retry width equal to the current maximum is skipped, so widths cannot repeat. `placement.ts` hole/ring validation is unchanged.
- Verified: `npx tsc -p packages/axylo --noEmit` clean; Node `vitest` 108 files / 1855 tests pass. Not verified: the Director's donut pointer / keyboard Home and auto-height browser failures, the third failing test, root/static gzip (+121/+138 B still recorded, not re-measured). Not done: compact donut hole presentation, ellipse chord sizing, CSS containment review.

### Follow-up dispatch — compact donut hole row (NOT implemented)
- Requested: a bounded one-row donut presentation for hole fitting (value + compact title, full text kept for AT), sized from the real hole ellipse.
- Status: **not done** in this turn (218 s budget). No source change. The planned design is below for the next author.
- Plan: in `src/dom/tooltip.ts` `show()`, after both `holeTry` widths fail at `shown === 1`, run one more pass only when the single row's series label equals `model.title`. That pass mounts the value and drops the repeated label, so the title appears once. It keeps the full title as the element's accessible text (`aria-label`/description). Width comes from the ellipse chord: for a measured height `H`, `w = 2·rx·sqrt(1 − (H/2/ry)²)`, which matches `holeSpot`'s test. It never clips. If the row still does not fit, the existing `clipped`/no-show path applies. Pinned selection, normal tooltip and ring/outline avoidance are unchanged because `placeTooltip`/`holeSpot` still decide.
- Open design choice: the spec has not confirmed whether dropping the repeated series label (as opposed to truncating it) is allowed. It needs a spec/owner ruling before landing.
- Still open: the Director's 3 Chrome failures (donut 90/10 pointer and Home, and a third case), legacy root/static gzip over budget (+121/+138 B, last recorded and not re-measured; no consolidation attempted).
