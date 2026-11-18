<!-- Author: Claude Opus 5.5 (high), agent aa0e6fca8e4a6224b; saved by the coordinator -->

## Closing fix pass (interaction): all seven items fixed

The six items from the brief, plus the long-value tooltip defect the distribution tests found, are fixed. Each has a test in `packages/axylo/test/browser/chart/final-closing.browser.test.ts`. On a private build of HEAD (e0b1239) all 13 of those tests fail; with the fixes they pass. Nothing is committed and no probe or scratch files are left.

The distribution suite (`tests/dist`) was **not run**: it packs `packages/axylo/dist`, and an isolated copy would need a real `node_modules`, which cannot be installed without the network. Please run it after the next shared build; expect the four scatter tick-label failures you mentioned, which belong to the layout author.

## Per item

1. **I4 (strip row clipped by a card).**
   - **Test:** "two short series pinned on one strip line, a card that clips just after the first row" (the card is narrowed, then an append makes the chart redraw).
   - **Old code:** the second button was cut off by the card. That second button was in fact the "+1 more" pager: the old check read the pager before the loop created it.
   - **Fix:** inside the row-reduction loop, every displayed row and the "+N more" are checked against the strip's box clipped by its ancestors. Otherwise the strip is not shown. (`src/dom/tooltip.ts`)
2. **I5 (wide outline).**
   - **Test:** "a legend button beside the plot with a 32 px outline, focused". The datum at the plot's right edge has its tooltip pushed toward that button.
   - **Old code:** the tooltip covered the outline.
   - **Fix:** a control's obstacle rectangle grows by its computed outline width plus any positive offset, scaled, or by the 3 px focus allowance, whichever is larger. (`src/dom/interaction.ts`)
3. **R1 (press across floating to strip).**
   - **Test:** press Q3's floating row, shrink into readout mode while holding, release over the Q3 strip button.
   - **Old code:** no selection.
   - **Fix:** a press now records the row's key, and on release the row with that key is looked up in whichever presentation is showing. The click that follows is swallowed only for that same row's pointer click. (`src/dom/tooltip.ts`)
4. **Pager repeating page one.**
   - **Test:** pin at 0.8 px, append eight points at 0 px and the latest at 0.4 px, then "+N more".
   - **Old code:** page two repeated rows from page one, the pinned point among them.
   - **Fix:** the pinned target and the keyboard target are now the lookup's own pick, unchanged, whenever `lookup.has(pick, ref)` holds; otherwise the ref alone. The pinned ref is tracked separately. This deletes the code that put another group's count on the pinned ref. (`src/dom/interaction.ts`)
5. **Changing `x.format`.**
   - **Test:** focus Q1, change the format to "Quarter Q1".
   - **Old code:** the value text kept "Q1".
   - **Fix:** the reading compared for all-series mode now holds both the raw x and the formatted x. (`src/core/focus.ts`)
6. **R9 (snapped range end).**
   - **Test:** a chart scaled 0.5; Select range from the whole pixel left of the plot to its middle.
   - **Old code:** no zoom.
   - **Fix:** a point snapped onto the edge is also clamped onto the edge in layout pixels, so roundoff cannot put it just outside. (`src/dom/interaction.ts`)
7. **Long value text hid the tooltip (distribution report).** Eight tests: line and area, each with a 60-letter unit, a twelve-word unit, and a long format plus unit; a short-unit case; a strip case.
   - **Old code:** all seven long-text cases failed (tooltip or strip hidden). The short-unit case passed and still passes: value and unit stay on one line.
   - **Fix, floating tooltip:**
     - Values stay `nowrap` while they fit.
     - A tooltip that overflows gets a class that lets values wrap anywhere.
     - One row is always placed even if it is still cut, with title and row first.
     - The area stack total is present.
   - **Fix, strip:** three tries in order — as written; with wrapping; then one row cut to one line with an ellipsis. The "+N more" must be wholly visible or the strip is not shown, which keeps round 3's long-title test passing. (`src/dom/tooltip.ts`, `src/theme/css.ts`)

## Runs (private builds, removed afterwards)

| Run | Result |
|---|---|
| `npm run typecheck` | clean |
| `npx vitest run packages/axylo/test/core` | 17 files, 266 passed |
| chart + a11y, SVG | 1 failed, 315 passed (316) |
| chart + a11y, canvas | 1 failed, 311 passed, 4 skipped (316) |
| `final-*` on Firefox | 109 passed, 4 skipped (113) |
| `final-*` on WebKit | 109 passed, 4 skipped (113) |

- The one failure on SVG and canvas is the known `ensureStyles` artefact under `AXYLO_BUNDLE`.
- The canvas skips are SVG-only tests; the Firefox and WebKit skips are CDP-only tests.

## Size

Release-settings rebuild, HEAD against HEAD plus my files, gzipped:

| Build | HEAD | With my files | Difference |
|---|---|---|---|
| Everything | 118,264 B | 118,475 B | +211 B |
| Line only | 98,950 B | 99,205 B | +255 B |

## Files

- `src/dom/interaction.ts`
- `src/dom/tooltip.ts`
- `src/core/focus.ts`
- `src/theme/css.ts`
- `test/browser/chart/final-closing.browser.test.ts` (new)

## Not done

- The `tests/dist` run (above).
- The I6 remainder stays a documented limit, as the brief says.
