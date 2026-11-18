<!-- Author: Claude Opus 5.5 (high), agent a61d95e46b3f0f3aa; saved by the coordinator -->

## Strengthening of the browser acceptance tests: report (nothing committed)

All 13 items are done. The acceptance suite passes on all three engines: Chrome 601 of 601, Firefox and WebKit 422 passed with 179 not run each, and no failures anywhere. No strengthened assertion exposed a product defect.

**Titles:**
- 42 new titles (listed below).
- One title is replaced, T-zoom-scatter, because its old claim contradicts the amended F7.
- Every other existing title is unchanged.

**Controls:**
- The 3 new negative-control tests, the run-time negative controls inside items 6 and 13, and 13 mutation checks.
- Each mutation check was a temporary copy of the test with one defect put in. Every one of them made its test fail, and all copies are deleted.

I did not edit `packages/axylo/src`, the checker or `matrix.json`. The `.scratch-strengthen/` directory is removed.

### First priority, items 1–11: what each test now asserts, and its control
1. **L7 "announced exactly once"**
   - The recorder (now `recordAnnouncements` / `announced` in `util.ts`) counts every announcement without de-duplication. One announcement means one live region changing within one observer batch; the same text put into a region twice counts twice. Only one recorder runs at a time.
   - The test now checks all four state changes: loading → ready, ready → error, error → ready (newly checked) and ready → internal failure. Each must be announced exactly once, politely.
   - Controls: negative control "L7 line: negative control: the announcement count reports the same message… twice… as two announcements". Mutation: the same text put into the live region a second time makes the test fail.
2. **I6.** After Pause, with the table closed and a tooltip shown, two appends change nothing: marks, summary, value text, the tooltip's text and its rectangle. Two more appends with the table open also change nothing. Resume then applies all five buffered rows exactly once. Mutation: without Pause, the test fails at "paused, table closed, tooltip shown".
3. **I2.** The legend lists the series in fixture order. For every entry, a click, Enter, Space and Space again each toggle that entry's pressed state and that series' marks. Every other entry stays pressed, and every other series keeps its exact mark count. Mutation: a click that also hides a second series makes the test fail.
4. **C5.** The marker's `title` is exactly `Values not shown: 3.`, and the description contains that sentence. Compact has no table, so there is no "See table." Mutation: setting `title` to "See table." makes the test fail.
5. **A7**
   - The live-region watcher now also covers `role="log"` and `role="status"` regions whose politeness is implicit.
   - The focused text is read after each append, not once after two.
   - Line, area, bar and scatter: the text is never rewritten, and the numeric position is 1 and then 0.
   - Donut: the slice is the same, its share is the share of the current window total (from SPEND and the appended slices), and its "Point k of N" agrees with the numeric value. Decision 0004 rule 2 counts the share as part of how the slice reads.
   - Mutation: a text change inside an existing `role="log"` region is caught.
6. **T-zoom-scatter, renamed.**
   - New fixture: its y extremes sit at x 90 and 100 only, so any zoom that leaves the right end out shows the refit.
   - Pressing `+` narrows x. The y domain then holds every value in view and is narrower than the full domain, as amended F7 requires.
   - The toolbar holds only x controls.
   - Shift+ArrowUp and Shift+ArrowDown change neither domain.
   - Two drags over the same x span, one short and one tall, give the same y domain.
   - Mutation: with an author y domain, the "fitted again" check fails.
7. **C2 compact line, null gap.** No stroke segment may pass over x = 2 or x = 4, using a new `bridges()` helper in `checks.ts`. Control: negative control "C2 compact line: negative control: the gap check reports a stroke joined across the gap".
8. **F8 "the ninth is what groups".** A ninth slice is now added. It raises AX121, draws 8 slices, keeps the seven largest in order, shows "Other (2)" with 3 EUR, and the table lists all nine categories. Mutation: with eight slices, the test fails.
9. **A8**
   - Each message state now holds only when its own message is shown (texts set through `messages`).
   - The values-left-out case requires the F12 note on full charts and the corner marker on compact ones.
   - New test per full type: a pinned tooltip, the readout strip hovered, and the strip pinned, each checked to hold before the axe scan.
   - Mutation: checking loading against the empty text reports "the state was not entered".
10. **T-tooltip-area.** After a series is hidden, the rows are exactly the visible series. On the stacked area that is the visible row plus a total of that row alone. Mutation: the stale two-series total makes the test fail.
11. **A1**
    - "Visually hidden" now means the title paints nothing: hiding it changes no pixel of the figure (new `paintedPixels()` in `util.ts`).
    - Ids are checked again with all 24 tables open, and the axe scan runs with them open.
    - Control: negative control "A1 line: negative control: the hidden-title check counts the pixels of a title that a clip-path clipping nothing leaves visible".

### Second priority
**Item 12, compact area and compact bar.**
- New in `fixtures.ts`: `Kind`, `optionsForKind`, `summaryClausesKind`, `KIND_WORD` and `compactKind`; new in `util.ts`: `createKind`.
- Now run over compact line, area and bar:
  - **A1:** all seven tests.
  - **L7:** both tests.
  - **F2:**
    - gaps and the same gap on a date axis: compact area added;
    - `missing: 'zero'`: compact area and compact bar added;
    - new "F2 compact bar: a missing bar shows a 'no data' mark…".
  - **A5:**
    - dash under contrast modes: compact area added;
    - new "A5 compact bar" in default, more-contrast and forced-colours modes: neighbouring series differ by fill pattern (`barPatterns()` in `checks.ts`);
    - "A5 compact" now also requires different colours.
  - **C4:** bars must differ by fill pattern (DOM) as well as painted texture; lines must have different colours as well as dashes.
- Already covered for all three kinds: C1–C5, I5 motion and L4 scheme (the C2 tests).
- Mutations: one pattern on all bars, and one colour on both lines, each make their test fail.
- **EVIDENCE.json:** 601 entries, regenerated from the Chrome run. Every compact entry has a `compactKind`: line 42, area 26, bar 26.

**Item 13, I1 below the L8 minimum.** New test per full type:
- The plot is about 100 px high, so it is in readout mode but stays at least 80 px high. No strip is reserved.
- Pointing shows no readout and no floating tooltip.
- The overlay (`.axylo-overlay`) is empty before pointing, draws marks overlapping the datum's active marks, and is empty again when the pointer leaves.
- The keyboard reading gives values and "Point k of N", and the table control is present.
- Mutation: an emptied overlay makes the test fail.

**What is left:** nothing of item 12's named criteria. Not attempted because they were not listed: compact A6, C1 "nothing inside exposed", and C3 checking only the extreme heights.

### Product findings
None failing. One observation for the interaction author:
- Below roughly a 170 px plot, clicking a line chart in readout mode does not pin.
- The pinned row and its buttons do not fit the two-line strip, so the pin ends, as decision 0004 allows, and the strip stays hover text without buttons. Bar charts pin at the same width.
- The code is `src/dom/tooltip.ts:423–437` (the strip fit) and `src/dom/interaction.ts:840–846` (the pin ends).
- My A8 strip states therefore use a 260 px figure, whose plot is about 200 px; the donut uses 200 px.

### New titles (for the matrix's author)
- A1 compact area / compact bar, 7 each: the same titles as compact line, with "compact area" or "compact bar".
- L7 compact area / compact bar: "empty data shows its message…" and "loading, an author error and an internal failure… announced exactly once…".
- F2 compact area: the gaps title, the same-gap-on-a-date-axis title, and the `missing: 'zero'` title.
- F2 compact bar: the `missing: 'zero'` title, and "F2 compact bar: a missing bar shows a 'no data' mark at the baseline, distinct from a zero bar (C2)".
- A5 compact area: "under prefers-contrast: more three lines differ by dash, pairwise" and "under forced-colors: active three lines differ by dash, pairwise".
- A5 compact bar: "by default / under prefers-contrast: more / under forced-colors: active neighbouring bar series differ by fill pattern, with no legend to tell them apart".
- A8 {line, area, bar, scatter, donut}: "axe-core reports no violations on the whole landmarked page with a pinned tooltip, with the readout strip shown, and with the strip pinned, each state checked to hold before the scan".
- I1 {line, area, bar, scatter, donut}: "where reserving the strip would leave the plot under 80 px, none is reserved and pointing shows no readout and no floating tooltip; the datum under the pointer is still highlighted (the overlay draws it, and clears when the pointer leaves) and its values are in the keyboard reading and the table".
- Negative controls:
  - "L7 line: negative control: the announcement count reports the same message put into a live region twice, in two updates, as two announcements";
  - "C2 compact line: negative control: the gap check reports a stroke joined across the gap";
  - "A1 line: negative control: the hidden-title check counts the pixels of a title that a clip-path clipping nothing leaves visible".
- **Replaced:**
  - Old: "T-zoom-scatter: x only in 1.0: + narrows the x range, controls are offered, and the y axis keeps the full data range though the visible y extremes change".
  - New: "T-zoom-scatter: x only in 1.0: + narrows the x range, controls are offered, the y axis is fitted again to the values in view (F7), and no control, key or drag zooms y on its own".

### Counts (acceptance suite, shared build c79c0bdbe6f5ee40, unchanged during the runs)

| Engine | Passed | Failed | Not run | Duration |
|---|---|---|---|---|
| Chrome 158 | 601 | 0 | 0 | 485.56 s |
| Firefox 159 | 422 | 0 | 179 | 587.82 s |
| WebKit 27.2 (Playwright, not Safari) | 422 | 0 | 179 | 557.31 s |

- Why tests are not run, on both Firefox and WebKit: 169 need the browser's own accessibility tree through CDP, and 10 need multi-point or moving touch.
- `tsc -p packages/axylo` shows no errors in test/browser.
- Results and logs: `acceptance/results/strengthen-c79c0bd/` (`cr`, `firefox` and `webkit`, `.json` and `.txt` each; `dist.hash`).

**Changed files** (in `packages/axylo/test/browser/acceptance/`): `EVIDENCE.json`, `a1-names`, `a5-not-colour-alone`, `a6-a10`, `compact`, `f2-gaps`, `f8-donut`, `i1-pointer`, `l-legibility`, `negative-controls`, `type-matrix` (each `.browser.test.ts`), and `checks.ts`, `fixtures.ts`, `util.ts`.
