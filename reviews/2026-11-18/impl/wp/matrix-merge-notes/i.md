# Family i: I1–I6, T-pointer, T-tooltip, T-zoom

Rows: I1, T-pointer-{line,area,bar,donut,scatter}, T-tooltip-{line,area,bar,donut,scatter}, I2, I3, T-zoom-{line,area,bar,donut,scatter}, I4, I6, I5 (matrix order). Output: `.matrix-merge-scratch/rows/i.json`. Validation: `OK: 21 rows, no problems found by this helper` (the checker reports 0 problems in these rows and 99 in other rows). No test was run. The statuses below are static and worked out by hand from `cellFor`. The helper prints statuses only when the whole merged matrix passes the checker, which it did not, because of other rows.

Every browser cell's `limits` starts with the required sentence. No `engine`, `waivers`, `pending` or React or negative-control citation is used. Every title from the two acceptance directories was resolved from that directory's `EVIDENCE.json`. Titles from other files were resolved from the source. `registration` was added wherever the scanner holds the title only as a template.

## Changes by criterion

### I1
- **Statement**: rewritten to the amended row. It covers the picking rule within one frame at p95, every visible series at the nearest x and "No observation" versus "No data" (line, area and bar), the viewport, the active mark, controls, hovering the tooltip, eight rows plus "+N more", readout mode at < 240 or < 140 px, no readout where the strip would leave the plot under L8's minimum, and Escape until a different datum.
- **Applicability**: unchanged (all full types; compact not applicable, per 3.7 and C1).
- **Removed**:
  - The describe-wide prefix `I1 tooltip under the pointer` (with 9/9/9/7/6 cases). It is replaced by exact titles, one or more per part.
  - Node `I1 {line,area,bar}: a pointer readout has eight rows, a remaining count and distinct missing text`. It is a model-level stand-in for rendered text, and the browser covers every part it touches. Its title also promises more than it asserts (see below).
  - Node `I1 {scatter,donut}: picking a visible mark provides the same value as the keyboard tooltip model`. It only checks model-level picking.
- **Added (evidence)**, per type:
  - 20 positions
  - can itself be hovered (it also asserts Escape until a different datum)
  - never overlaps a control
  - readout mode at the 240 px width limit and at the 140 px height limit
  - ten series (line, area, bar, scatter)
  - "No observation" (line, area, bar)
  - `T-tooltip-<type>` browser test, for "visible" (line, area, bar)
  - line only: final-closing `a legend button beside the plot with a 32 px outline…` (a control's painted outline)
- **Added (weak, line)**:
  - chart/scale `a strip two lines of 40 px text tall would leave the plot under 80 px…`
  - final-hold `stepping the card's height…`
  - core/final-review `boundary: exactly 80 px left beside the strip…`
  - These three are the only tests near the L8-minimum case, and all of them run a line.
- **Not cited, on purpose**: 12 of the uncited I1 titles in coverage.txt.
  - `a hovered tooltip is text, not controls…` ×5 (pin mechanics, decision 0004 rule 4)
  - `a hovered tooltip never stalls picking…` ×3 (rule 3)
  - `rule 3b converse…` ×2 (bar)
  - `a fast sweep that never rests…` ×2
  - These test decision 0004's mechanics, not a part of the I1 criterion.
- **Texts**:
  - The old gaps ("needs results from the decision 0004 revision 2 assertions") described results. They are replaced by the parts not established.
  - Limits now state how latency is counted, the 300 ms rest before hovering the tooltip, where the probes lie for scatter and donut, and how controls are taken.

### T-pointer-*
- Statements are the 3.6 cells. They are unchanged except for the separator wording.
- **Removed**: lookup unit tests (`aligned.test.ts`, `donut.test.ts`, `scatter.test.ts`). The Node acceptance test and the browser test establish each cell's rule.
- **Kept**: Node `type-matrix.test.ts` and browser `type-matrix.browser.test.ts` citations (bar: vertical and horizontal; scatter: radius and tie).
- **Compact** reason made specific: no tooltip, no pointer-only behaviour.

### T-tooltip-*
- **line**: lookup `reads values, absent observations…` removed. Node and browser kept.
- **area**:
  - Statement is now "Every visible series at that x, plus the stack total" (3.6: "Same, plus the stack total").
  - Node, browser (stacked) and the F10 area browser test are kept. The last one checks what the stack total reads for a mixed-sign stack.
- **bar**:
  - Statement is now "Every series in that category", which is the 3.6 cell. The old "a mixed-sign stack gives both signed totals" is not in the cell.
  - The F10 bar citation is removed (it belongs to F10).
- **donut**: lookup `picks the parts fixture…` removed (it is a picking test).
- **scatter**:
  - The lookup picking test is removed.
  - The lookup `finds coincident points across a cell boundary…` test moved to `weak`, with a reason. It is the only test of grouping across the spatial index's cell boundary.

### I2
- **Statement**: the spec text.
- **Applicability**: donut is kept not applicable after a re-check. The reason now says what the code does: a donut has one series, and its legend is F8's slice list, whose entries are `button.axylo-legend-choice` elements that select a slice, with no `aria-pressed` and `tabIndex = -1` (`src/dom/interaction.ts` `donutSliceList`). The reason also says the spec does not settle this (see "Not testable as written").
- **Removed**:
  - Node `I2 <type>: toggling a legend key removes that series…` ×4. These are model effects (marks, picking, table), not the button, its pressed state or the keys.
  - chart/interaction `toggles by click, Enter and Space…` (line). It repeats the acceptance test.
- **Kept**: acceptance `I2 <type>` ×4.

### I3
- **Statement**: the amended row (the four ways, the wheel rule).
- **Applicability**: unchanged. Donut is not applicable (3.6 "No") and compact is not applicable (3.7).
- **Removed**: Node `I3 <type>: touch is opt-in and disabling zoom hides controls…` ×4. They assert the model's `zoom` flag only. Opting in to touch is covered by the browser pinch tests.
- **Added (line)**: five chart/interaction tests on the `trend` fixture (a time x): the buttons, the drag, the keyboard, the wheel and the pinch with `zoom: 'touch'`.
- **Gaps (new)**: axis kinds no browser test exercises.
  - line: date x, only `+`
  - area: time x not at all, and date x only `+`
  - bar: time x
  - scatter: time and date x
- **Limits**: which axis kinds and ways run, and that pinch goes through CDP touch events.

### T-zoom-*
- **Statements**: line, area and bar are "On time, date and numeric x only (no category zoom in 1.0)". Donut is "No". Scatter is "Yes, both axes later; x only in 1.0". The old scatter statement "y keeps its full range" is not in the spec, and `view.test.ts` shows the opposite at model level (see below).
- **line**:
  - Removed: chart/interaction `Zoom in and out are single clicks…`. It is now cited in I3.
  - Added: `I3 line: from the keyboard…` (numeric x) and chart/interaction `keyboard: + and - zoom…` (time x).
  - The category citations are kept.
  - Gap: no user input on a category line is shown to leave the range alone.
- **area**:
  - Removed: `view/review.test.ts` `fits a monthly area between observations with the zero baseline`. It is about the y domain under zoom (F1/F7), not about which axes zoom.
  - Added: `I3 area: from the keyboard…`.
  - Gaps: time x only in Node, and category input as for line.
- **bar**:
  - Removed: snapshot `bar: zoom(['B','C'])…` and chart/interaction category. The T-zoom-bar browser test and the Node tests cover these, and do more.
  - Gap: time x only in Node.
- **donut**: unchanged citations. The limits now say that a drag and a pinch are not tried.
- **scatter**:
  - Removed: `view/view.test.ts` `keeps scatter ranges per series and uses only the points inside zoom for the value domain`. It asserts `yDomain` [2, 4] for the points inside the zoom. That is the y re-fitted to the visible points, which is F7 matter and contradicts the old statement.
  - Added: `I3 scatter: from the keyboard…`.
  - Gaps: "x only" is not asserted, and time and date x run only in Node.

### I4
- **Statement**: the amended row (Select range two-click addendum).
- **Applicability**: unchanged. Compact is not applicable, and the reason now says that no test drags over a compact chart.
- **cannotVerify removed** for every cell. The spec's own method is "Touch emulation; size checks", so a physical phone is not part of the criterion. The emulation is now in `limits`: taps through Playwright's touchscreen on a hasTouch page, the drag through CDP, and no physical device.
- **Removed**: the describe-wide prefix `I4 single pointer, touch and target size`. It is replaced by exact titles.
- **Added**:
  - per type: the size test, the touch test, `I4 <type>: Select range…` (bar: number and date axis) and `I3 <type>: by single clicks only` (single-click zoom and pan)
  - line also: a11y/axe `every control and the focus indicator are visible in forced colors…` (measures the zoomed, streaming toolbar: Pan left, Pan right, Reset zoom, Pause)
  - line also: final-range `by touch: tap the toggle, then two taps on the plot`
  - line also: review5 `tooltip rows pinned by a tap are buttons…`
- **Gaps (new)**: per type, which controls are not measured and which interactions are not operated by touch (see the gap list).

### I5
- **Statement**: the spec text.
- **Applicability**: all six types.
- **Removed**: Node `I5 <type>` for full types (model frames only; the browser covers them).
- **Kept (compact)**: Node `I5 compact` moved to `weak`, with a reason. It is model-level for compact line, area and bar.
- **Added (compact)**: compact.browser `C2 compact {line,area,bar}: no motion (I5)…`.
- **Compact gap text corrected**. The old text said that compact line, area and bar traces cover first render, but no such trace was cited, and the I5 compact tests trace a compact line only. The new gap: compact area and bar get first render only without a motion preference and for 1.5 s, and no browser update. The 24-chart change runs on full charts only.
- **Limits**: state the surfaces, which are the per-frame markup and computed-paint signature, which may be truncated. The 0.1% pixel comparison is between about 2.5 s and 500 ms later, not first frame against 2.5 s.

### I6
- **Statement**: the spec text.
- **Removed**:
  - Node `I6 <type>` ×5 (model).
  - chart/interaction `a pause control appears after append…` (line). It repeats the acceptance test.
- **Kept**: acceptance `I6 <type>` ×5.
- **Limits**: what the paused snapshot compares, with the table open over the plot.

## Cells whose status went down or up

Static status, before (old fields) and now. "Pass once run" means evidence only, with no gaps; with no results for this commit it reads "not run".

| Cell | Before | Now | Why |
|---|---|---|---|
| I1 line, area, bar, scatter, donut | weak | weak | Same status. The old gap described results. The new gap is the L8-minimum case (no readout, the datum highlighted); donut also has the whole-slice cover |
| I3 line, area, bar, scatter | pass once run | **weak** | The time, date and numeric axis kinds are not all exercised for each type (see gaps) |
| T-zoom-line, T-zoom-area | pass once run | **weak** | On a category x, only "no controls", "no AX199 after +" and the model's refusal of zoom() are asserted. Area also: time x only in Node |
| T-zoom-bar | pass once run | **weak** | Time x only in Node |
| T-zoom-scatter | pass once run | **weak** | "x only" is not asserted: the y check uses a window whose visible y extremes equal the full ones, and the zoom goes through the API. Time and date x run only in Node |
| I4 line, area, bar, scatter, donut | cannot be verified here | **weak** | cannotVerify was dropped, because the spec's method is emulation. The cells are weak because the size test misses the pager, the jump field, Resume and the zoomed-only controls, and touch covers only some interactions |
| I5 compact | weak | weak | Gap text corrected; C2 traces added; Node test moved to weak |
| T-pointer ×5, T-tooltip ×5, I2 ×4, T-zoom-donut, I5 full ×5, I6 ×5 | pass once run | pass once run | Citations cleaned and texts rewritten; no change of status |

## No evidence (gap list)

Most important first. Each item is a criterion part, per chart type, that no test establishes.

1. **I1, area, bar, scatter and donut: the plot whose strip would leave it under L8's 80 px.** In that case pointing must highlight the datum and show no readout. No test of any kind runs these types in that case. Line has partial support only: no strip and no floating tooltip (chart/scale), no floating tooltip and a hover event when under 140 px (final-hold), and the Node layout's 80 px boundary. No test asserts a visible highlight for any type.
2. **I4, all types, sizes.**
   - The table's pager and its jump field are never measured. The fixtures' tables have one page, so `pager.hidden = count <= 1` (`src/dom/table.ts`), and the size test skips hidden elements.
   - Resume is never measured.
   - Reset zoom, Pan left and Pan right (shown only while zoomed) are measured only on a line (a11y/axe, forced colours).
   - Bar: the size test uses the category fixture, so on number and date bars only Select range is measured.
3. **T-zoom-scatter**: that zoom changes x only, and no control or gesture zooms y.
4. **I4, touch.** The tests tap the plot, the legend toggle, Zoom in and the table control. Reset and Hide table are tapped without any assertion. Not shown to work by touch, per type:
   - line: Pause and Resume, Pan, Reset, the pager, the jump field
   - area and scatter: also Select range and the pinned tooltip's rows
   - bar: zoom on a number or date bar, Pause and Resume, pinned rows, the pager, the jump field
   - donut: the slice list's entries, the pinned row, Pause and Resume, the pager, the jump field
5. **T-zoom-line and T-zoom-area, category x**: that `+`, the wheel or a drag leaves the range unchanged in the browser. Only bar has this test.
6. **I3, axis kinds**:
   - line date x: only `+` is pressed
   - area: time x not exercised; date x only `+`
   - bar: time x not exercised
   - scatter: time and date x not exercised
7. **T-zoom-area, T-zoom-bar, T-zoom-scatter**: zoom on a time x, and on a date x for scatter, runs only through the Node controller's `zoom()`.
8. **I5, compact area and bar**:
   - no browser trace of an update
   - first render under reduced motion not traced
   - first render traced for 1.5 s, not 2.5 s
   - the 24-chart filter change is not run on compact charts
9. **I1 donut**: that the tooltip leaves the whole active slice uncovered. The 20-position test checks the 12 px square under the pointer only.
10. **I1, all except line** (recorded as a limit, not a gap): a control's painted focus outline is checked only once, on a line (final-closing).

## Not testable as written

- **I2 and the donut.** I2 says "Legend entries are toggle buttons". F8 calls the donut's slice list "the legend". A2 places "legend toggles" in the toolbar, and a donut has one series, so there is nothing to toggle. The code makes the donut's entries buttons that select a slice, without a pressed state. As written, I2 either does not reach the donut (my reading, recorded as not applicable with that reason) or the donut cannot meet it. An owner question.
- **I4, "every interaction works … by touch"** is an open set. A test can only sample it. The row would be checkable if it named the interactions: plot tap and pin, legend toggle, each toolbar control, Select range, pinned rows, table pager and jump field.
- **I4, "a one-finger drag on a chart scrolls the page"** reads as if it reaches compact charts. Section 3.7 and C1 leave compact with no controls or pointer behaviour, so the row is recorded as not applicable to compact. No test drags over a compact chart.
- **I5's method, "first frame equals the frame at 2.5 s within a 0.1% pixel tolerance."** A harness cannot take a screenshot of the first painted frame at that frame, because screenshots are asynchronous. The suite compares each frame's markup and computed paint instead, plus pixels between about 2.5 s and 3 s.
- **T-zoom-scatter, "x only in 1.0"** does not say what the y axis does when x is zoomed. F7 has value axes fit inside the automatic domain. `view.test.ts` shows y re-fitted to the points inside the zoom, while the browser test's title says "the y axis keeps the full data range". The spec should say which one holds.
- **I1, "highlights the datum"** (below L8's minimum) does not say what counts as a highlight: a painted overlay, the focus ring, or only the `hover` event. The only test reads the event.
- **I1's method, "Hover at 20 positions including all four edges"**, has nothing to show at the plot's edges for a donut, which picks nothing outside the ring, or for a sparse scatter. The test probes the ring and the points instead.

## Titles that promise more than their assertions

- `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts:135`, `I1 ${type}: at 20 positions, the four edges included, … without covering the active mark`.
  - Scatter: the probes are on and up to 12 px from five points, clamped 1 px inside the plot.
  - Donut: the probes lie on the ring at 85% of the radius. Neither type is probed along the plot's edges.
  - Donut: "the active mark" is checked as a 12 × 12 px square at the pointer, not the slice.
- `i1-pointer.browser.test.ts:796`, `I4 ${type}: every control is at least 24 × 24 CSS px: toolbar, legend, table pager, jump field, …`.
  - The pager and jump field are hidden on these one-page tables, and `measure` skips hidden elements, so they are never measured.
  - Reset zoom, Pan left, Pan right and Resume are never shown during the test.
  - The bar fixture has no zoom controls.
- `i1-pointer.browser.test.ts:1012`, `I6 ${type}: … nothing a reader gets moves (marks, summary, value text, tooltip, open table) …`. The snapshot holds the scene, the description, the value text and the table. The tooltip is not compared, and with the table open the plot is inert, so no tooltip can show.
- `i1-pointer.browser.test.ts:167`, `I1 ${type}: the tooltip can itself be hovered (decision 0004 revision 2, rule 3b)`. Rule 3b belongs to revision 3. This is cosmetic.
- `packages/axylo/test/browser/acceptance/type-matrix.browser.test.ts:275`, `T-zoom-scatter: x only in 1.0: + narrows the x range, controls are offered, and the y axis keeps the full data range though the visible y extremes change`.
  - For scatter the test calls `charts[0].zoom([12, 22])`, not `+`.
  - In [12, 22] the visible y values are 90–140, the same as the full range, as the test's own comment says. So "the visible y extremes change" is false for this fixture, and the y check cannot tell a kept range from a re-fitted one.
- `packages/axylo/test/browser/chart/interaction.browser.test.ts:449`, `with zoom: 'touch' a pinch zooms through the public path; without it the chart leaves pinch to the page`. Only the `zoom: 'touch'` case runs. The default case's `touch-action: manipulation` is asserted in the previous test, and no pinch is sent without the option.
- `interaction.browser.test.ts:58`, `at each of the four plot edges it stays inside the viewport and beside the active x`. "Beside the active x" is not asserted; the test asserts the viewport and that the box does not move. Not cited.
- `interaction.browser.test.ts:138`, `a donut slice shows label, value and percentage; the overlay outlines it`. It asserts the label and "46.2%"; on this fixture the value and the share are the same text. The overlay is not checked. Not cited.
- `packages/axylo/test/acceptance/reader-model.test.ts:230`, `I3 ${type}: touch is opt-in and disabling zoom hides controls`. It asserts the committed `zoom` flag. No control is looked at.
- `reader-model.test.ts:267`, `I1 ${type}: a pointer readout has eight rows, a remaining count and distinct missing text`. It asserts eight rows, two more, and a "No data" row. "No observation" is not produced or checked, so nothing is shown to be distinct.
- `packages/axylo/test/browser/chart/final-hold.browser.test.ts:388`, `… wherever the plot is shorter than 140 px, pointing shows the strip or no readout, never a floating tooltip, and still highlights`. Strip versus no readout is not asserted for any step, and "highlights" is the `hover` event, not something drawn. Cited as weak with that reason.

## Checker or helper defects

- **`traceMotion` truncates signatures** (`packages/axylo/test/browser/acceptance/checks.ts:177`). Signatures longer than 200 characters are returned as their length plus their last 120 characters. `settledAt` is computed on the full signatures, but the I5 first-render and reduced-motion assertions, and the C2 compact no-motion assertions, compare the truncated ones frame by frame. A change that keeps the length and lies outside the last 120 characters, such as a mid-markup coordinate of equal length, is not seen. The `animated` flag still catches CSS and Web animations, and the library has no animation code, so the risk is to the test's power, not a known miss. It is stated in the I5 limits.
- **`validate.mjs` prints cell statuses only when the whole merged matrix passes the checker.** With problems in other families' rows it prints none, so the statuses here were derived by hand.
- **Helpers my rows rely on that the negative controls cover**:
  - `covered` (I1 bar: the occlusion check reports a tooltip moved over the active bars)
  - `figureLayout` (I1 line: a strip that takes room only while a datum is shown)
  - `traceMotion` (I5 line: an entry animation, and an update transition longer than 200 ms)
- **Helpers with no negative control**: `inOrder`/`says` (tooltip text order), `cssSize` (I4) and `plotSides`/`plotTo` (readout limits).
