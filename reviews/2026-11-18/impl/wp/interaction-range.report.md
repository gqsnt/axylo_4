<!-- Author: Claude Opus 5.5 (high), agent aa0e6fca8e4a6224b; observed model in transcript: claude-opus-5-5; saved by the coordinator -->

The two-click "Select range" toggle is built and its own tests pass, but it causes two regressions in my suites that need your decision. It adds a toolbar row in narrow tiles, and a 220 × 300 trend tile then loses its readout strip. Nothing is committed and `dist` was not touched.

## Decision needed: narrow tiles lose their readout

Four tests fail on SVG and on canvas, private bundle.

**Two are new, caused by the toggle:**
- `chart/interaction.browser.test.ts` › "in a 220 px wide tile (readout mode) the same content is shown in the strip under the plot"
- `a11y/axe.browser.test.ts` › "trend paused, zoomed, in the narrow readout and in the internal-error state…" (it asserts the strip is visible)

At 220 px wide the toolbar wraps onto one more line. I measured the trend chart in a 220 × 300 tile:

| | Toolbar height | Plot height | Readout |
|---|---|---|---|
| Before (HEAD) | 80 px | 185.5 px | strip |
| With the toggle | 108 px | 157.5 px | none |

With the smaller plot, the controller decides the strip would leave the plot under L8's 80 px, so it shows no readout at all (rule 5 'none'). That is the controller's rule working correctly on the new layout. Small tiles that showed a strip before now show no readout at all.

I did not resize those fixtures, because that would hide the effect. The acceptance suite may have narrow tiles that cross this line too; I could not run it, since `dist` is busy. The options as I see them:
- **(a) Accept it** and move the two fixtures to 220 × 330.
- **(b) Shorten the toggle's footprint** in narrow toolbars (CSS only).
- **(c) Something else you prefer.**

Tell me which.

**The other two failures are not this change:**
- "works with the stylesheet applied through ensureStyles" fails whenever `AXYLO_BUNDLE` is used: the bundle switch always links the stylesheet. It passes against `dist`.
- The forced-colors test lists every toolbar control in order; I added "Select range" after "Zoom in" to its list, and it now passes.

## What was built

- **Where it appears:** a `<button>` with `aria-pressed`, labelled by `messages.selectRange`, right after Zoom in. It uses the existing toolbar item, so it is one tab stop and at least 24 × 24 px. It appears where Zoom in does and drag-to-zoom works (numeric, date and time x axes with zoom on), never on category axes, donut, compact charts or with `zoom: false`.
- **Behaviour while pressed:**
  - The next two plot clicks (mouse, touch tap or pen) set the two ends, in either order.
  - The ends go through the same zoom request a drag uses. The drag's clamping and minimum-width rule is now one pure function, `rangeWindow` in `core/focus.ts`, shared by both.
  - The first end is marked 2 px wide with the drag selection's own element, and is redrawn after a redraw.
  - A click outside the plot area is ignored. A click on the plot neither pins nor selects.
  - After the second click the toggle releases itself, even when the span was too narrow to zoom.
- **Cancelling:** pressing it again, Escape, or a redraw without zoom (or without a plot) releases it and clears the first end.
- **Escape order:** drag, then the pressed toggle, then a tooltip or pin, then single-series mode, then the page.
- **Decision 0004:** one addendum sentence under rule 4, also naming the Escape position.
- **A6–A10 acceptance test:** the `WHERE` entry is now `selectRange: ['line', 'area', 'scatter']`, the types that show Zoom in there. I changed only that entry.
- **Controller:** no change needed; the toolbar items are built in `dom/interaction.ts`. No contract change.

## Files

- `packages/axylo/src/dom/interaction.ts`
- `packages/axylo/src/core/focus.ts` (`rangeWindow`, `pixelOf`)
- `docs/decisions/0004-tooltip-and-focused-text.md` (addendum line)
- `packages/axylo/test/core/focus-range.test.ts` (new)
- `packages/axylo/test/browser/chart/final-range.browser.test.ts` (new)
- `packages/axylo/test/browser/a11y/axe.browser.test.ts` (forced-colors list)
- `packages/axylo/test/browser/acceptance/a6-a10.browser.test.ts` (the `WHERE` entry only)

`test/browser/chart/scale.browser.test.ts` is untracked in my directory but is not mine.

## What I ran (private bundle via `AXYLO_BUNDLE`, since removed)

| Run | Last lines |
|---|---|
| `npm run typecheck` | clean |
| `test/core` + `test/messages` | Test Files 15 passed, Tests 222 passed |
| `final-range.browser.test.ts` | Tests 14 passed |
| Same file on a HEAD build plus your message key | 10 failed, 4 passed (the 4 "absent on …" tests pass trivially there) |
| Escape-order mutation (toggle checked after the tooltip) | caught by the Escape test |
| chart + a11y, SVG | Test Files 3 failed, 16 passed; Tests 4 failed, 250 passed (254), before the forced-colors list fix |
| chart + a11y, canvas | same: 4 failed, 250 passed (254) |
| forced-colors test after the fix | 1 passed |

The 14 tests in `final-range` cover:
- the button element, `aria-pressed` and 24 × 24 size;
- absent on category bar, donut, compact and `zoom: false`; present on scatter and a time line;
- clicks at 20 then 60, and at 60 then 20, both give [20, 60] within one CSS px, with the mark between clicks, no select or pin, the toggle released, and the next click pinning again;
- the too-narrow case;
- touch taps;
- pen clicks (CDP `pointerType: 'pen'`);
- the three cancel paths;
- the Escape order: toggle, tooltip, single mode, page.

## Size

- **Not done:** `node scripts/size.mjs`, because it packs `dist`, which you asked me to leave alone.
- **Measured instead:** a production rebuild of HEAD versus the working tree, esbuild minified with the release's `PRODUCTION` defines and minified stylesheet, gzip level 9:
  - everything: 113,793 B before, 114,074 B after, **+281 B gzipped**
  - line only: 95,679 B before, 95,975 B after, **+296 B gzipped**
- The absolute numbers come from my rebuild, not from the packed rows, so only the differences are comparable.

## Not done or not verified

- The narrow-tile readout regression above.
- `size.mjs`.
- The acceptance suite and the A10 entry against `dist`.
- The test files have not been re-run on the shared build.
- A drag made while the toggle is pressed still zooms as a drag and leaves the toggle pressed; the brief did not specify this case.
