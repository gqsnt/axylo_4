<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent aa0e6fca8e4a6224b. Saved by the coordinator from the hand-back. -->

## Needs from other authors (exact)

**Controller (`src/core/chart.ts` `measure()`, around line 184).** It still treats any plot scale within 2% of 1 as 1. Under `scale(1.015)` on an ancestor, the layout then believes the plot is 1.5% wider than it is, so the marks overflow and are clipped. Picking stays correct in my layer, because I map against the marks as drawn. The fix is to divide by the computed size: `width = rect.width / k`, with `k = rect.width / parseFloat(getComputedStyle(plot).width)`, and the same for height. Treat `|k − 1| < 1e-5` as 1. That tolerance is only the rounding of the computed value to six significant digits ("341.531px" for 341.53125); it is not a transform. Without it, a point drawn exactly on the plot's top edge is picked as outside. That is what emptied T-tooltip-scatter in an intermediate build (`src/dom/mapping.ts` has the same snap).

**Controller, finding 12.** I added `readoutMode?: 'floating' | 'strip' | 'none'` to `ControlsState`. `readoutOf()` in `dom/interaction.ts` is the only place it is read: it uses `readoutMode`, else the old `readout` boolean. 'none' means no floating tooltip, no strip and no pin; the datum is still highlighted. The controller's cast can now be dropped.

**Public messages (`public.ts`, fixed), C2-8.** Arbitrary drag ranges still have no non-dragging equivalent (WCAG 2.5.7). The smallest answer is two clicks, and that needs a labelled control. The change: add one `Messages` key, for example `selectRange: 'Select range'`, for a toolbar toggle; while it is on, the next two plot clicks set the range's two ends through the same `requestZoom` path. I did not add it because it changes the public interface.

**Lookup.** Nothing needed. Overflow rows are built plain in `alignedRows` (focus.ts), as the data agent asked. Bar swatches now use `barPattern` from `scene/bars.ts`.

## Results

Last lines of each run, on the shared tree built with `npm run build`:

| Run | Result |
|---|---|
| `npm run typecheck` | clean |
| `npx vitest run packages/axylo/test/core` | Test Files 13 passed, Tests 207 passed |
| chart + a11y, SVG | Test Files 17 passed, Tests 235 passed |
| chart + a11y, canvas | Tests 1 failed, 234 passed (235) |
| acceptance, SVG | Test Files 13 passed, **Tests 555 passed (555)** |

- **The canvas failure** was the P7 memory test in `lifecycle.browser.test.ts`: non-code heap grew 98,556 B against a 65,536 B limit. It passed in the earlier full canvas run and in two reruns of that test alone, and it also passes on the old bundle. I take it as noise under load from the other agents, not a leak.
- **An earlier acceptance run had one failure** (A1 compact: `window.Axylo` undefined): another agent rebuilt `dist` (deleted and rewritten) during that run. The file passed 46/46 on its own, and the full rerun above was 555/555.

## The state machine (`dom/interaction.ts`, `shown`)

- **States:** `none`, `keyboard`, `hover(target | null)`, `held(target, from, rect, anchor, presentation)`, `pinned(ref, target)`.
- **A pointer move:**
  - pinned: nothing changes.
  - hover: becomes held when the pointer rested 250 ms within 2 viewport px on the same datum and that datum's content is on show.
  - held: stays while the pointer is inside the hull of the resting point and the content's rectangle (`placement.insideCorridor`). Otherwise it picks afresh on that same move.
  - A pointer that has not rested is never held. There are no per-kind holds left; the scatter/donut rectangle hold is gone.
- **`commit` reconciles before presenting:**
  - A pin keeps its chosen `DatumRef`: rows are rebuilt from that ref's anchor, and the pin ends when the ref is gone, hidden or not drawn, or the presentation is 'none'.
  - A hold ends when the datum's viewport anchor, the presentation or the content rectangle changes, and the pointer is picked again at once.
  - A hover is picked again from the pointer's viewport position.
  - A switch between floating and strip, a rebuild, `clear()`, Escape, leaving the plot's column, scrolling, or opening the table also ends the hold.
- **Activation:** a click or tap always picks afresh at the event point. It pins only where the presentation can pin, sets focus, then selects. Empty space selects nothing and ends a pin. Enter uses `focus`.
- **Escape:** one window capture listener spends Escape on a drag or any tooltip on show (`preventDefault` plus `stopImmediatePropagation`). Otherwise the proxy takes it for single mode, otherwise it goes to the page.
- **Dismissal** is remembered by datum: the x, the slice, or the group's first point; a group that gains coincident points still matches it.
- **Focus** is established in `commit` (the first datum when the proxy is focused and focus is null). State text clears the text cache. Whether the text is rewritten is decided by `datumReading` (identity, values and templates), not by subtracting the position sentence.
- **Placement** is pure (`dom/placement.ts`). Validity is checked against the visible plot (plot ∩ viewport ∩ each clipping ancestor's padding box less scrollbar, per axis), every control and every keyboard ring, with a shift along the free axis. The hole is tested on all four corners against r0 − 5, and only ring strokes count there. The last resort never covers a control or a ring; if nothing works, nothing floats. The tooltip's maximum size is the visible plot.
- **Mapping:** one function (`dom/mapping.ts`), fractional sizes; the limit for rotated, skewed and mirrored ancestors is documented in its comment.

## The 16 findings

"Old" means the test was run against a bundle built from the pre-pass source (HEAD), through `AXYLO_BUNDLE`. Test files are in `packages/axylo/test/browser/chart/` and `packages/axylo/test/core/`.

| # | Fixed | Test | Fails on old |
|---|---|---|---|
| 1 | yes | final-hold, finding 1 (Q3 to Q4, then click gives Q4's exact row; scatter B under A's tooltip; donut hole selects nothing) | yes, all 3 |
| 2 | yes | final-pin, finding 2 (active element, value text, ring, tooltip and Enter checked together) | yes |
| 3 | yes: the slice list has roving keys while the plot is not ready (one tab stop) | final-pin, finding 3 | yes |
| 4 | yes | focus-placement (reviewer's arithmetic table, fallback, property test); final-pin clipped card with hit-tests | Node tests: the old function was DOM-bound, so I could not run it; the reviewer's recorded outputs are the counterexamples. The card test passes on old. |
| 5 | yes | final-hold, finding 5 (dense edge line, horizontal bar to strip, isolated scatter point to strip, no-rest converse) | yes, the first 3 |
| 6 | yes: pinned content exposed to the AX tree; pinned "+N more" is a button that pages through the rows; the strip keeps at least one row | final-pin (AX buttons, ten coincident rows, narrow strip) | AX and paging yes; narrow strip no |
| 7 | yes: rows keyed by identity, moved only when out of place | final-pin, press across an append | yes |
| 8 | yes | final-hold, finding 8 (stream commit, resize into the strip, with pin and keyboard) | stream commit yes; the other two no |
| 9 | yes | final-pin, finding 9 (pin ends when A is hidden; dismissal survives coincident B) | yes, both |
| 10 | yes | Node ring test; final-pin single-mode union | yes (browser) |
| 11 | yes | focus-placement, hole cases | Node only, as for #4 |
| 12 | controller's; my side is `readoutOf` | final-hold, rule 5 (a plot under 140 px never floats) | yes, mostly through the controller's part |
| 13 | yes, except rotation and mirroring, which are documented as unsupported | final-pin, `scale(1.015)` and non-uniform scale | 1.015 yes; non-uniform no |
| 14 | yes | final-pin, translated `pointOf` with an idle append; focus-reading | yes |
| 15 | yes | final-hold, modal dialog with pin and single mode (Escape 3 times); a page listener does not see a spent Escape | yes, both |
| 16 | yes | final-hold, `tooltip: false` | yes |

## Earlier partials

| Finding | Fixed | Test | Fails on old |
|---|---|---|---|
| C2-7 | yes: overflow rows plain, the total qualified once | focus-reading | yes (2 or 3 "incomplete") |
| C2-8 | tap now sets the Zoom-in anchor; arbitrary ranges not done (see top) | final-partials | yes |
| C2-17 | yes: focus inside the toolbar, table, field, pager or list goes to the figure on unbuild | final-partials (toolbar, jump field) | yes, both |
| C2-18 | yes: column's own digits, grouping, decimal and unit; trailing text rejected; displayed dates round-trip; wall time kept | focus-placement (Node grammar); final-partials | yes (browser) |
| C2-19 | proxy language follows the value template; table "No data" cells and the " (incomplete)" suffix tagged; donut missing value tagged | final-partials | yes, all 3 |
| C3-6 | yes | final-hold, C3-6 | yes |
| C3-7 | yes (`pinchWidth`) | focus-placement; final-partials pinch | yes |
| C3-9 | yes, covered by #3, #6 and #7 | as those | as those |

On C2-19's limit: a hidden labelling element would give the name its own language, but axe's label-title-only rule fails a control named only by hidden text, so the name keeps `aria-label`. The name, the role description and the value text therefore share the proxy's single language.

## The ten mutations

Each was applied to a scratch copy of the source, built into a private bundle and run against the named test.

| Mutation | Caught by |
|---|---|
| 1 | finding-1 test |
| 2 | finding-3 test |
| 3 | finding-2 test |
| 4 | Node rule-6 tests (2 fail) |
| 5 | finding-8 stream-commit test |
| 6a (pin buttons hidden from AX) | AX buttons test |
| 6b (pressed row replaced) | press-across-append test |
| 7 (visible text one move behind) | final-hold mutation 7 (strides 1, 7, 23, both directions) |
| 8 (touch tap on the second strip button selects the first) | final-pin mutation 8 |
| 9 (`change` listener removed) | change-only test |
| 10 (area markers of series 7 and 8 swapped in the scene) | final-pin mutation 10 |

Not covered: the second half of mutation 4, a strip clipped entirely by an ancestor.

## Changes to existing tests (both follow revision 3)

- review2 "strip can be hovered": a 300 ms rest is now required first.
- review2 "card that clips": now accepts the 'none' readout for a 97 px plot, and its title was reworded.

## Files

- New:
  - `src/dom/placement.ts`
  - `src/dom/mapping.ts`
  - `test/core/focus-placement.test.ts`
  - `test/core/focus-reading.test.ts`
  - `test/browser/chart/final-util.ts`
  - `test/browser/chart/final-hold.browser.test.ts`
  - `test/browser/chart/final-pin.browser.test.ts`
  - `test/browser/chart/final-partials.browser.test.ts`
- Rewritten: `src/dom/interaction.ts`, `src/dom/tooltip.ts`.
- Edited:
  - `src/dom/pointer.ts`
  - `src/dom/table.ts` (cell language runs)
  - `src/core/focus.ts`
  - `src/theme/css.ts` (structure section only: strip height is two of its own line heights; tooltip overflow)
  - `test/browser/chart/review2.browser.test.ts`
- The scratch directory has been removed. Nothing is committed.

## What remains

- Two-click range selection (needs the message key above).
- Rotated, skewed or mirrored ancestors stay out of scope.
- A clipped strip is not tested.
- Dates typed with zone abbreviations other than UTC or GMT are accepted only in ISO form.
- The pinned tooltip container has no group name (there is no message for one).
- The optional "prepare tooltip and value text before the frame's first write" was not done.
- No screen reader was used. All accessibility claims here are DOM and Chrome AX-tree assertions only.
