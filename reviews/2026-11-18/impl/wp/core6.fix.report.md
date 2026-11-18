<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a1d73b9f46c46814f, resumed. Saved by the coordinator from the hand-back. -->

## Chart core, sixth pass: report

Nothing is committed. The browser acceptance suite (SVG) is at 538 of 551, up from 899/37 failures across all suites at d8b4150. The 13 that still fail are three groups: a test-procedure limit, a conflict between the decision's geometry and the test path, and a browser timing limit. Each is explained below with a suggested way out. I did not swap the shared `dist`: old-code checks used the privately built 0e5aa29 bundle through my `AXYLO_BUNDLE` switch.

### Decision 0004 revision 2, implemented as written
- **`src/dom/tooltip.ts`, rewritten.**
  - **Placement:** the position comes from the datum alone: the box of its active marks, enlarged by the ring's reach (`RING_REACH` = 9 px).
  - **Candidates:** above, below, right, left; horizontal bars right, left, above, below; donut tries the hole first. A candidate is valid only wholly inside the plot rectangle (inset 4 px, clear of the plot outline), the viewport and every clipping ancestor, overlapping neither the box nor any control of the figure.
  - **Rule 6:** rows are dropped into "+N more"; if nothing is valid with one row, the candidate that overlaps the box least is used, inside the plot.
  - **Hovered vs pinned:** a hovered tooltip has `pointer-events: none` and text rows; a pinned one takes events and its rows are buttons of at least 24 × 24 px.
  - **`strip()`:** running text "x: series value; …; +N more" fitted to two lines; entries become 24 px buttons when pinned.
- **`src/dom/interaction.ts`.**
  - **Pinning:** a click pins, as a tap already did. A pinned tooltip ignores moves until Escape, a click elsewhere, a keyboard move, or its datum leaving.
  - **Holding on scatter and donut:** the datum is held while the pointer is inside the rectangle its tooltip had (computed in the plot's own move handler).
  - **Readout mode:** a class on the figure; the strip and the axis area under the plot count as hoverable.
- **`src/core/controller.ts`, readout mode by layout.** The plot rectangle without the strip, laid out in the plot's whole column (`room`, from `chart.ts` `measure()`), is under 240 × 140. One more condition: the plot must keep the L8 minimum of 80 px beside the strip.
  - Without that condition, the 24 tiles of 340 × 200 in I5 fell into the too-small fallback and drew nothing.
  - With it, L8 by height and I5 both pass.
  - The decision does not depend on the strip, so it does not oscillate.
- **Figure and CSS:** the readout element now sits in the plot's column under the plot (`figure.ts`). The strip is two reserved lines (`css.ts`, figure section).
- **Rings are drawn inside the plot's box** (`core/focus.ts` `buildOverlay`), so the ring at the last point and at the top of a donut is painted. The A2 focus-indicator tests pass.

### Other items
- **A7 bar:** the category remap now remaps the text's own datum too, so a sliding window no longer rewrites it. New test fails on 0e5aa29 and passes now.
- **JSON in the page:** the source was `note.dataset.segments = JSON.stringify(runs)` in `figure.ts`. That comparison is now kept in memory. The distribution browser run passes (30/30).
- **L1 late font:** the cause was that `FontFace.load()` followed by `document.fonts.add()` never fires `loadingdone`. A font probe in the text layer is watched with a ResizeObserver; when it changes size, the fonts are invalidated and everything is laid out again (`chart.ts`, `css.ts`). The L1 late-font tests pass.
- **L8 short summary:** first sentence, at most two lines, ellipsis beyond (line clamp in `css.ts`). L8 tests pass.
- **L4:** theme changes are now resolved and written inside the observer's callback, with the canvas still repainted once through the scheduler. The class, style and data-theme triggers pass on all six kinds.
- **Wiring from the scene and lookup author:**
  - `buildLookup` gets the device pixel ratio, and on scatter it is in the lookup's cache key.
  - The donut focus outline uses `donutGeometry`'s adjusted angles.
  - T-pointer-scatter and T-dense-donut pass.
- **Item 5:** the reader's `seriesNotDrawnSentence` and runs were wired in pass 5 and still are. **AX143** passes `chartType`, `xKind` and `horizontal`.
- **Item 6:** `focus.ts` takes the total from the lookup's tooltip model and computes no net total.

### Still failing (13), and why
1. **I1 "readout mode … 139 px high", 5 types.** Entering readout mode reserves the strip, so the plot jumps from about 140 px straight to about 92 px; no plot height exists in between. The test's bisection (`plotTo`) stops on whichever side it probed last, and here it is the 140.07 px side. At 139 px the library is in readout mode. The width bracket passes. This needs a test change: for example, report the last readout-side height of the bisection.
2. **I1 bar hover.** The fixture's bars reach within about 40 px of the plot top, so neither "above" nor "below" fits. The tooltip goes beside the box, and the straight path crosses into the next band at step 1 ("rows changed"). Under rule 3 only an approach across the reading axis keeps the datum.
3. **I1 donut hover.** "Hole first" puts the tooltip in the hole. The straight path from the Travel slice crosses the Rent slice (steps 10–18) and the empty hole before entering the rectangle. The tooltip shown last on the way was Rent's, which is narrower, so at step 24 the pointer is outside Rent's rectangle and nothing is held. Rule 3 holds a datum only inside its tooltip's rectangle.
4. **L4, 6 kinds: only the `prefers-color-scheme` part fails.** Probe: after `emulateMedia({colorScheme:'dark'})`, `matchMedia(...).matches` is already true in the next rAF, but Chrome dispatches the `change` event one frame later. No JavaScript can resolve the theme earlier. A fix for charts with `color-scheme: light dark` would be for theme resolution (`src/theme`, not mine) to write `light-dark(light, dark)` values, which the browser switches by itself. Otherwise the test would need to wait two frames.

For items 2 and 3 I need your decision: change the test path, or change the decision (for example, no "hole first" on donut, or a hold along the path).

### Expectations of my own tests changed for revision 2
These now assert the revised rules:
- **The tooltip's position:**
  - "four plot edges" no longer requires the pointer to be outside the tooltip; it asserts the tooltip does not move while the datum is unchanged.
  - The scale(2) test checks the tooltip stays inside the plot instead of centred on the bar.
- **Pinning and rows:**
  - A click pins; a hovered row is text, and a pinned row is the button that selects.
  - The hover-event sequence is adjusted for click-pinning.
  - The coincident-count test accepts rows plus "+N more" adding up to nine.
- **Readout mode:**
  - The narrow-tile and axe readout tests use a 220 px tile, since readout mode now starts below 240 px.
  - The readout text may end in "+N more".

There is also a new L4 first-frame test in `test/browser/chart/theme.browser.test.ts`. It passes on old code too, so it is a guard only.

### Edits outside `src/core` and `src/dom`
- **`src/theme/css.ts`** (figure section only): tooltip, strip, choice buttons, font probe, summary line clamp.
- **No layout changes.** I tried a `minimum` option in `src/layout` during the pass, then removed it, and `src/layout` and `test/layout` match HEAD. The final full run happened before that removal, with the option present but unused.

### Runs (last lines)
- **Type check:** exit 0.
- **`npx vitest run packages/axylo/test --exclude '**/acceptance/**'`:** `Test Files 1 failed | 45 passed (46)`, `Tests 1 failed | 775 passed (776)`. The one failure is the kept memory test in `data/streaming-storage`.
- **My browser directories, SVG:** `Test Files 13 passed (13)`, `Tests 187 passed (187)`.
- **My browser directories, canvas:** `Test Files 13 passed (13)`, `Tests 187 passed (187)`.
- **`AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser/acceptance` (SVG):** `Test Files 2 failed | 11 passed (13)`, `Tests 13 failed | 538 passed (551)`.
- **`AXYLO_BROWSER=1 npx vitest run --config tests/dist/vitest.config.ts`:** `Test Files 4 passed (4)`, `Tests 30 passed (30)`.

Logs are `r1-*.txt` in `/tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/core-fix/`.

