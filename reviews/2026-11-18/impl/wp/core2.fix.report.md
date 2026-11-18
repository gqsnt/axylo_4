<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a1d73b9f46c46814f, resumed. Saved by the coordinator from the hand-back. -->

## Report: second fix pass (interaction and accessibility review, 22 findings) plus the later requests

Most of it is done and tested against the real browser with both renderers. Two of my tests fail for reasons outside my files, and several items are only partly done (listed below). Nothing is committed, and I did not touch contracts.ts, public.ts, palette.ts, bench/ or the data module.

### What I changed
- **Interaction layer (`dom/interaction.ts`, rewritten):**
  - Every listener on the chart's own elements is tied to one abort signal, so destroy removes them all.
  - The plot's slider is compared with the frame on screen after each commit; its bounds, value and text are rewritten where they differ (finding 4).
  - On a sliding category axis, focus, pin, dismissal and hover are moved to the same category's new place; a category that left the window moves to the next surviving one (finding 2).
  - An empty zoomed window keeps the plot focusable with the `-`, `0` and Shift+arrow keys, plus Zoom out and Reset (finding 3). Each control is offered for what it can actually do; Resume, the table and the donut slice list stay available in empty states.
  - Navigation keys go through the lookup rather than the browser's own range arithmetic; a direct value change from assistive technology (`input` or `change`) moves to that exact position (finding 6).
  - Keyboard: scatter keeps the chosen series after a series switch, and coincident points show as one target (finding 7).
  - Single-pointer paths (finding 8): a tap selects, a tooltip row can be clicked to select that series, and the zoom buttons zoom around the clicked or focused datum.
  - Zoom limits (finding 9): one minimum window for every gesture, Zoom in marked unavailable when it can't narrow, and the wheel only consumed when it actually zooms.
  - Gestures (finding 10): one pointer owns a drag; Escape cancels and consumes it; lost capture and window blur also end it; taps right after a pinch are ignored; pinch on horizontal bars now anchors correctly.
  - A pinned tooltip is checked against the displayed frame and dropped when its datum leaves (finding 11).
  - The narrow-tile readout can be reached and hovered; a touch-pinned readout lets taps through to the buttons under it (finding 13). A tooltip dismissed with Escape shows again after the keyboard moves away and back.
  - Donut: the focused slice is marked in the slice list (also for a zero slice with no arc), and the focus ring is drawn inside the plot (finding 14).
  - The open table now takes the plot's place at the plot's size, and the plot under it is inert (finding 15).
  - Focus is restored after the legend reorders, and handed back to the chart when the table goes away (finding 17).
  - "Jump to" accepts grouped numbers like "200,000" and dates as the table shows them (finding 18).
  - Built-in English on the plot and in state announcements is marked `lang="en"` on a foreign-language page (finding 19).
- **Tooltip (`dom/tooltip.ts`):** stays clear of the active mark, the pointer and the focus ring. It stays inside every clipping ancestor. When no side fits, it uses the readout rather than covering the mark.
- **Toolbar and table:** the toolbar marks unavailable buttons and gives focus back after a reorder. The table's page count stays silent while data arrives (finding 16).
- **Swatches:** line swatches switch to the contrast dash where the lines do (finding 22). Area swatches now draw the series' marker on the chip (palette reviewer's A5 defect); bar chips are unchanged.
- **`core/focus.ts`:** all-series value text uses what the tooltip shows, including the stack total once (finding 7). It also adds strictly ordered, finite zoom windows, the zoom-in availability check and stepping within one scatter series.
- **`core/axes.ts`:** the layout cache key now includes the drawn axis titles, so a unit change redraws the title (finding 20).
- **`core/controller.ts`:**
  - While paused, the shown frame's rows are kept aside, so the store can drop everything older than its newest revision; `keep` now bounds a paused stream (finding 5).
  - The note's language follows only the sentences it shows.
  - The bench `describe()` now reports, for line charts, the row indexes the simplified drawing kept, plus the renderer kind.
- **CSS (figure section):** table overlay, passive readout, focus ring drawn inside the plot, current legend slice, swatch dash switching, clickable tooltip rows.

### Behaviour changes that required changing existing assertions
- **Tab order with the table open:** now the table region (and its pager), then the toolbar; the covered plot is no longer a stop.
- **Keyboard order:** an x that only a hidden series observes is now reachable and reads "No observation", as the lookup counts it. The old test said it was skipped; I reversed it, with the finding cited in the test.
- **Donut "Other":** with ten slices, nine have a value, so seven are drawn and the rest are "Other (2)"; the zero slice H is listed on its own with no arc. I followed the view module's reading of F8 here; it is a reading, not something the spec states outright.
- **Zoom out at full view:** shown but marked unavailable, so the toolbar doesn't reflow.

### Ran and saw
- **Typecheck:** passes.
- **Node core tests:** 86 passed.
- **Owned browser directories:**
  - SVG: `Tests 2 failed | 157 passed (159)`.
  - Canvas: `Tests 3 failed | 156 passed (159)`.
- **`npm test`:** 1 failure, the data module's 1M-value timing test (not mine).
- **`npm run test:browser`:** `Tests 2 failed | 267 passed | 1 skipped (270)`. That run came before the final changes (`zoomOut` gating, the hover, swatch and separator tests); the owned-directory runs above came after.

**The failures:**
- **Theme dark-toggle test (both renderers):** caused by the uncommitted palette edit. New LIGHT series 1 `#4395ea` and DARK `#1c73c5` differ by at most 39 per channel, inside the test's tolerance of 40, so the dark pixels count as light. It passed with the committed palette.
- **New separator test, canvas only:** the seam between stacked bars falls across two half-tone rows (`100.168.237`, `251.230.212`), so no pixel is the background colour, which A5 requires. SVG draws a crisp seam. This needs pixel snapping in `render/canvas.ts` or `scene/bars.ts`, neither of which I own; I left the test failing.

**Reproduction on 156f414:** I built 156f414 separately and ran the new browser tests against it.
- 24 of the 30 tests in the second-pass file failed, each for the reviewer's reason.
- The 6 that already passed: the three paused-chart tests (finding 1 was fixed by the first pass; Node tests also cover it), the Reset control, the accessibility-tree slider test, and the clipped card.
- The benchmark agent's 10,000-point hover test also failed on 156f414 and passes now.

### Benchmark agent's hover question
Reproduced on 156f414. The readout named only 1000, 3051, 5307 and 7563, matching the 4 distinct indices the agent saw.

**Cause: the library, not the harness.** The old tooltip sat 12 px to the right of the active mark. Each rightward move of about 14 px landed on the tooltip, so the plot got `pointerleave` into the tooltip and kept the old datum until the pointer passed the tooltip.

**Fixed:** the tooltip now keeps at least 22 px clear of the pointer. All 40 moves now read the nearest datum (within one index at this density), and all 40 are distinct.

**Remaining limit:** a single move larger than the tooltip's clearance can still land on the hoverable tooltip, so a sweep of fewer, larger steps would stall again. Making the tooltip ignore the pointer entirely would conflict with WCAG 1.4.13 "hoverable"; that is your decision.

### Findings
| # | Reproduced on 156f414 | Fixed | Test |
|---|---|---|---|
| 1 paused order | no (first pass fixed it) | yes | review2 "finding 1" ×3; controller "review 2, finding 1" |
| 2 category identity | yes | yes | review2 "finding 2" ×2 |
| 3 empty-zoom recovery | yes | yes | review2 "finding 3" ×3 |
| 4 stale range | yes | yes | review2 "finding 4" ×2, "the plot as Chrome exposes it" |
| 5 keep retention | yes (Node, paused) | yes | controller "review 2, finding 5"; "stores retire" |
| 6 stale key intent | yes | yes | review2 "finding 6" |
| 7 keyboard vs pointer | not run on 156f414 | yes | focus2 "finding 7"; focus.test (reversed case) |
| 8 single pointer | yes | partly: no pan buttons | review2 "single-pointer", "selectable tooltip row" |
| 9 zoom limits | yes | yes, except category zoom | review2 "finding 9"; focus2 "finding 9" |
| 10 gestures | yes (Escape) | yes; pinch arithmetic not tested | review2 "finding 10" |
| 11 pinned survives | test written after the fix; not run on 156f414 | yes | review2 "finding 11" |
| 12 placement | yes (pointer) | partly: not transforms or scroll | review2 tooltip ×2 |
| 13 readout | yes | yes | review2 "finding 13" ×2 |
| 14 donut focus | yes | yes | review2 "finding 14" |
| 15 table overflow | yes | yes | review2 "finding 15"; keyboard (order) |
| 16 table speaks | yes | yes | review2 "finding 16" |
| 17 focus on render | yes ×2 | yes | review2 "finding 17" ×2 |
| 18 jump to | yes | yes; visible error text needs a message key | review2 "finding 18" |
| 19 language | yes | partly | review2 "finding 19" |
| 20 unit key | not run on 156f414 | yes | focus2 "finding 20" |
| 21 test strength | yes (by inspection) | partly | axe "states the fixture loop does not reach"; keyboard (intersection) |
| 22 swatch dash | yes | yes | review2 "finding 22" |

**Coordinator extras:**
- Listeners removed on destroy: done ("teardown" test).
- Click after hover reaches the plot: done ("tooltip stays clear" test).
- Accessibility tree assertions: done where Chrome exposes the value. Chrome's tree still reports the number, not `aria-valuetext`, so value text is read from the attribute and the test says so.
- Donut "Other" and donut legend tests strengthened from fixture values.
- Area swatch markers: done.
- Bar patterns in swatches: done.
- Contrast dash compared with the plotted path: done (SVG only).
- 1 px separator measured on pixels: done; fails on canvas, as above.

### Not done or not observable
- **Grayscale crossing-lines check (A5):** not done; telling three lines apart by marker in grayscale needs a person to look.
- **Single-click pan buttons:** need message keys (`panLeft`/`panRight`). Until then, zoom around a clicked datum is the non-drag way to move the window.
- **Ordinal zoom for category line and area:** needs a band scale with an offset in layout and scale. Category zoom stays off.
- **Tooltip under CSS transforms and re-placement on scroll:** a scroll re-place was added but neither is tested.
- **Visible "Jump to" error text:** needs a message key.
- **Navigation instructions on the range:** need a message key.
- **Summary language marking:** the generated summary mixes built-in text with series names, so it is not marked.
- **Screen reader rehearsal and the A9 conformance table:** not done.
- **Possible conflict with A7:** the focused range now rewrites its text when its position changes (for example "Point 1 of 2" after an append). Some screen readers may speak that; it needs rehearsal.

### Contract changes needed
- `Messages` (in `public.ts`) would need new keys: `panLeft`, `panRight`, a "Jump to" not-found/example text, and plot navigation instructions.
- Nothing else.

