# Family f-a: F1, F2, F4, F5, F7, F11, T-dense-line, T-dense-area, T-dense-bar, T-dense-donut, T-dense-scatter

Rows file: `.matrix-merge-scratch/rows/f-a.json` (11 rows, in matrix order). `node .matrix-merge-scratch/validate.mjs .matrix-merge-scratch/rows/f-a.json` prints `(checker: 0 problems in these rows; 99 in other rows, not shown)` and `OK: 11 rows, no problems found by this helper`. The checker throws on the other rows' problems, so the helper printed no per-cell statuses. I worked the statuses out by hand with `cellFor`'s order. "not run" below means evidence only and no gaps, which becomes pass once results are recorded.

Every cell that cites a browser test now has a `limits` text that starts with the required sentence. This replaces "Browser acceptance evidence uses the SVG renderer in system Chrome."

## Changes by criterion

### F1
- Statement: the current text. Bar and area value axes include zero. An author domain that excludes zero is widened to zero and raises AX110.
- Applicability: unchanged (area, bar, compact). I made the not-applicable reasons specific: line and scatter are not under a rule for bar and area value axes, and a donut has no value axis.
- Removed from area and bar, because the Node acceptance tests establish the same things through the controller (domain, AX110 and the baseline in the scene), per brief rule 5:
  - `test/scale/domain.test.ts` "with includeZero always contains zero, author domain or not"
  - `test/view/view.test.ts` "widens area/bar author domains to zero and reports AX110"
  - `test/scene/scene.test.ts` "uses a zero baseline for an unstacked area backed by a borrowed Float32 column"
  - `test/scene/scene.test.ts` "uses projected zero as the baseline and represents missing and zero bars separately"
- Kept: the F1 property (1,000 runs over values from -100 to 100, with or without an excluding author domain) and the 82–97 fixture test, for area, bar, compact area and compact bar. Also the browser C2 compact area and bar test (value / 97 above the baseline).
- Limits: Node scope. Only vertical bars are run; no horizontal bar chart is tested. Compact: the browser sentence; the AX110 case is Node only. A compact line is not under F1.

### F2
- Statement: the current text, with every part.
- Kind corrected: "F2 line: a generated absent daily step and the same explicit null produce the same gap" uses `fc.assert`, so it is `property` (it was `unit`).
- Citations otherwise unchanged. All of them were re-read; per-surface details are below.
- Gaps added:
  - line, area, bar: an absent step on a regular time (instant) axis is tested only at the data stage.
  - scatter: no test asserts that an explicit null raises no diagnostic.
  - donut: no test reads the tooltip of a null slice.
  - compact: rewritten. Only compact line is drawn in Chrome. The generated-index property runs on compact area only. The time-axis gap applies here too.
- Reader surfaces by type:
  - line, area, bar: Chrome reads the tooltip's text, the table cells from the accessibility tree and the plot's value text. Node reads the tooltip model, the table model and `valueText`.
  - scatter: the point is not drawn and the keyboard skips it (Chrome "of 4", Node walk). Only the table says "No data" (Chrome and Node).
  - donut: the table says "No data" in Chrome and Node. The keyboard reading of null and absent slices is checked in Node only. The tooltip is not checked.
  - compact: no tooltip, table or keyboard, so not applicable.

### F4
- Statement: the current text: three types, never mixed silently; zone in the tooltip heading and the description; AX111, AX112; a bare number is never an instant.
- Kind corrected: "F4 line: generated instants around DST and the year boundary preserve elapsed time and local readouts" is `property` (it was `unit`).
- Added for line: `test/browser/chart/data.browser.test.ts` "the dates fixture as date strings gives identical tick text in UTC, America/Los_Angeles and Asia/Kolkata". It is the only test that runs in real viewer zones (Playwright `timezoneId`). It covers calendar dates only.
- Kept: the nine Node tests for each type (compact runs line, area and bar), plus "A1 <type>: the summary of instants states the time zone they are shown in".
- Limits added:
  - In Node, the viewer's zone is set by the test host, and the tooltip heading is read from the tooltip model.
  - The A1 browser test uses an author `timeZone` (Asia/Kolkata), not the viewer's zone.
  - Compact checks the zone in its description only.

### F5
- Statement: the current text, including the slot rule, cumulative sums and "exact values come from the data".
- Not-applicable reasons now cite the section 3.6 cells: bar, a hint (AX132); scatter, a hint above 50,000 points; donut, no.
- Citations: unchanged after re-reading.
- Gaps added for area: no weekly-beside-daily test on area, and the one-in-a-million and alternating fixtures run on line only. Compact gaps rewritten: no slot-rule test, no browser test of a dense compact chart.
- Limits:
  - Node reads the kept samples per device-pixel column at DPR 1 and 2 and over three windows. Tied extremes come from the repeating generated backgrounds.
  - Node's dense areas are always stacked.
  - The browser check allows one device-pixel column either side, and does not show that the table row it reads (50,001) was dropped.

### T-dense-line, T-dense-area, T-dense-bar, T-dense-donut, T-dense-scatter
- Statements: unchanged; they match the section 3.6 cells word for word.
- Not-applicable reasons reworded. The compact reason now points to section 3.7 (C2).
- Citations: unchanged after re-reading.
- T-dense-area gets the same gap as F5 area.
- Limits added:
  - bar: vertical bars on a category axis only; Chrome checks the hint's level, the count and the tall bar's place.
  - donut: thin slices are checked by where their path starts.
  - scatter: the count and six sampled points in Chrome; the threshold in Node.

### F7
- Statement: the amended text, with each part: precedence on value axes; x spans its data plus half a band; contents of the automatic domain; first tick; compact reference; percent/ratio; nothing from a label.
- Kept: the F7 extents property and the percent/ratio tests (all five types), the reference-extreme property (line, area, bar, scatter) and F10 stack properties (area, bar).
- Added:
  - Node `type-matrix.test.ts` "T-zoom-<type> <type>: numeric, time and calendar-date fields support zoom on x…" (line, area, bar, scatter). It asserts that an author y domain [0, 10] is unchanged after an x zoom, the only test of the precedence rule on the y axis.
  - Node "T-reference-<type> <type>: a line and band extend the appropriate domains…" (four types): a y line and an x band are contained.
  - Browser "T-reference-<type>: a reference line outside the data is included in the domain…" (four types; reads the reported y domain), and for bar the band variant (a y band [150, 180]).
  - `core/final-review.test.ts` "a line on x 1.1 to 8.9 spans exactly its data (x is not a value axis)" (line x span) and "a scatter on x 1.1 to 8.9: the x domain ends at its first and last drawn ticks…" (scatter x first tick).
  - `view/view.test.ts` "resolves references against the frame kind and includes value bands and lines in the domain" (line, y band; view stage).
  - `scene/scene.test.ts` "centers whole continuous bars … (horizontal false)" (x span [-0.5, 3.5]) and "pads irregular bar endpoints by their own neighbour spacing…" ([-1, 11.5]), for the half band on bars.
  - Browser "T-zoom-scatter: x only in 1.0…" (with its `registration`): the automatic y domain is unchanged by an x zoom.
  - Compact:
    - `acceptance/compact.test.ts` "C1 compact line: a reference has no effect on the domain or the description and is reported as not applicable". It was uncited in coverage.txt; it runs compact line only.
    - `diagnostics/registry.test.ts` "AX150 reports the reference option once on compact area/bar" (validation stage).
    - F10 compact area and bar (stack totals).
  - Weak: `layout.test.ts` "for any automatic numeric x domain and any width…" (scatter; 300 runs). `view.test.ts` "keeps compact area/bar domains independent of references" (100 runs, view stage).
- Removed: none.
- Gaps: all five cells. See the gap list.

### F11
- Statement: the current text.
- Kind corrected: "F11 scatter: generated unsorted and duplicate rows keep their x, y and caller row order" is `property` (it was `unit`).
- Citations: unchanged after re-reading.
- Limits added:
  - The Node scene uses a three-point shuffled fixture, not `trend`.
  - For bar, only the duplicate-x rule applies (the ordering sentence names line, area and scatter).
  - Compact: Chrome compares the SVG for all three kinds.

## Cells whose status went down or up

None went up. "Before" is what the old fields could reach.

| Cell | Before | Now | Reason |
|---|---|---|---|
| F2 line, area, bar | evidence only (pass once run) | weak | No chart test draws an absent step on a regular time (instant) axis. The spec names "time or date"; every drawn test uses a date axis. |
| F2 scatter | evidence only | weak | Nothing asserts that an explicit null is silent on scatter: no codes are checked in the scatter gap tests. |
| F2 donut | evidence only | weak | The tooltip of a null slice is never read. |
| F2 compact | weak | weak | Gaps rewritten: compact area and bar are not drawn in Chrome; the property runs on compact area only; the time-axis gap. |
| F5 area, T-dense-area | evidence only | weak | The weekly-beside-daily slot rule is never run on area. The one-in-a-million and alternating fixtures are line only. |
| F5 compact | weak | weak | Gaps rewritten: no slot-rule test, no rendered dense compact chart. |
| F7 line | evidence only | weak | Without an author domain, the y range after an x zoom is not shown to stay inside the automatic domain. The x span is tested on a numeric x only. |
| F7 area | evidence only | weak | As line, plus: no test of an area's x span; nothing shows the domain ends at the first tick beyond the stack totals; no y band. |
| F7 bar | evidence only | weak | As line, plus the stack-total tick. The half-band span is checked at the view stage on a numeric x. |
| F7 scatter | evidence only | weak | The first-tick rule is tested on a number x only; a unit test asserts that a date x spans exactly its data. Percent/ratio is tested on y only. No y band. |
| F7 compact | evidence only | weak | Compact area and bar: the reference's lack of effect is shown at the view stage only, the description is not checked, and AX150 only at validation. The first-tick check is skipped for compact layouts. No x-span test. |

Unchanged, evidence only: all cells of F1, F4 and F11; F5 line; T-dense-line, T-dense-bar, T-dense-donut and T-dense-scatter.

## No evidence (gap list), most important first

1. **F7 line, area, bar**: without an author domain, the y range shown after an x zoom is never asserted to lie inside the automatic domain. The line view refits y to the visible data (view.test.ts), so the claim depends on that refit.
2. **F7 scatter**: the first-tick ending on a date or time x. `view.test.ts` "rounds numeric scatter x outward…" asserts that a date x spans exactly its dates, and `core/axes.ts` applies the first-tick rule to a number x only. Either the spec or the implementation needs a word (see below).
3. **F7 area**: no test that an area's continuous x spans exactly its data. Line has one (numeric). Bar has one at the view stage (numeric, regular and irregular steps). No test runs a time series on any of them.
4. **F7 compact area and bar**: no controller-level test that a reference leaves the domain and the description unchanged. Only line has one. AX150 is checked at the validation stage only, and the view-stage property has 100 cases.
5. **F2 line, area, bar, compact**: an absent step on a regular time (instant) axis, drawn. Only the data stage covers it (`test/data/review.test.ts` "places a missing midnight in %s and reports AX111"). Its tuple `it.each` title cannot be cited, because the scanner expands scalar lists only.
6. **F2 compact area and bar**: nothing is drawn in Chrome: gaps, the isolated point, and the compact bar's "no data" mark. The Node scene is the only evidence.
7. **F5 area (and T-dense-area)**: the weekly-beside-daily slot rule. The one-in-a-million outlier and the alternating valid and missing fixtures (line only).
8. **F5 compact**: the slot rule; no browser test draws a dense compact chart.
9. **F7 area, bar, compact**: nothing shows that the domain ends at the first tick at or beyond the stack totals (F10 asserts only that they are covered).
10. **F7 compact**: whether the automatic domain ends at a tick (the helper skips compact layouts); a compact chart's x span.
11. **F7 area, scatter**: a y reference band. Line has one at the view stage; bar has one in Chrome.
12. **F7 scatter**: a declared percent or ratio scale on x.
13. **F2 donut**: the tooltip of a null slice reached by keyboard.
14. **F2 scatter**: that an explicit null raises no diagnostic.

Recorded as limits, not gaps:
- F4: only calendar dates (line ticks) are run in real browser viewer zones. Instants in the viewer's default zone are checked with the zone supplied by the Node host.
- F1: no horizontal bar chart is run.
- F11: line, area and scatter order is checked on the scene, not painted.

## Not testable as written (or ambiguous)

1. **F7, x span against reference containment.** The spec says that a continuous x of line, area or bar "spans exactly its data", and that the automatic domain contains "the reference lines and bands the chart draws". For an x reference beyond the data, the two conflict. The tests assert that the x domain reaches the reference:
   - f-domains extents: `x.domain[1] >= 8`
   - type-matrix T-reference: `x.domain[1] >= 6`
   - view/review "includes x lines and bands in the automatic extent": [-3, 8] for line
   I read "its data" as "its data and x references, without tick padding".
2. **F7, a scatter's date or time x.** "Both axes of scatter" are value axes, but the first-tick rule is implemented and tested for a number x only, and a unit test asserts the opposite for dates. The spec should say whether a temporal x on scatter ends at a tick.
3. **F7, "the zoomed view" on y.** Zoom changes x only in 1.0, so on line, area and bar the y "zoomed view" can only mean the y range after an x zoom. The spec does not say whether y refits. Line refits to the visible data (view.test.ts); scatter keeps the full y (browser T-zoom-scatter).
4. **F7, compact "ends at the first tick".** A compact chart draws no ticks, so the rule has no visible meaning there. The tests do not assert it.
5. **F5, slot rule in a stacked area.** "A slot a series merely has no row for does not break its line" may conflict with F10, "a missing component is drawn with zero height and the stack is marked incomplete". It is open whether a no-row slot in a stack is a missing component.
6. **F2, scatter and donut readouts.** A scatter point without y has no position, and a null slice has no arc. Only the table (and, for donut, the keyboard) can say "No data". I treated the scatter tooltip and announcement as not reachable. I kept the donut tooltip as a gap, because the keyboard reaches the slice.

## Titles that promise more than their assertions

- `test/browser/acceptance/type-matrix.browser.test.ts:358`, "T-dense-<type>: … each drawn in their own device-pixel column and nowhere else; … a sample the drawing dropped is in the table":
  - `spikeColumn` accepts a vertex within one device-pixel column either side, and reads SVG path vertices, not pixels.
  - The table row read (50,001) is never shown to be one the drawing dropped.
- `type-matrix.browser.test.ts:422`, "T-dense-bar: … every bar is still drawn, each where its category is": it asserts the count (2,000) and the place of the one tall bar only.
- `type-matrix.browser.test.ts:580`, "T-reference-<type>: a reference band outside the data is included in the domain…", for line, area and scatter: the x band is only checked to lie right of the plot's middle. The x domain is not read, so a band drawn beyond the plot would pass. The bar band variant and every line variant do read the y domain.
- `test/acceptance/f-domains.test.ts:64`, "F7 <type>: for any generated extents the automatic domain includes data and references and the zoom stays inside its governing domain":
  - For compact, references are excluded by design and the first-tick check is skipped.
  - For line, area and bar, the zoom checked is on x, which the amended F7 no longer places under the precedence rule.
- `test/browser/acceptance/f2-gaps.browser.test.ts:104`, "F2 <type>: with missing: 'zero' … drawn at zero, on the zero baseline":
  - For bar, it asserts only that no bar other than five is taller than 1.5 px. That a zero bar is drawn at days 2 and 4 is checked in Node.
  - For compact line, it asserts that the two zeros are the lowest vertices, not where the baseline is.

## Checker or helper defects

- **Kind not checked.** The old matrix labelled three fast-check tests as `unit` (F2 line generated absent step, F4 line generated instants, F11 scatter generated rows). The checker does not compare `kind` with a test's use of fast-check, and it does not see run counts below the spec's 1,000:
  - `view.test.ts` "keeps compact %s domains independent of references": fast-check's default of 100 runs.
  - `layout.test.ts` scatter x property: 300 runs.
- **`firstTicks` is silently vacuous for compact.** In `test/acceptance/f-domains.test.ts:53`, `firstTicks` returns without asserting when the layout kind is not `plot` (every compact chart) or the data is constant. Two F7 tests therefore assert nothing about ticks for compact.
- **The spike-column control does not test the tolerance.** `checks.ts` `spikeColumn` tolerates ±1 device column. Its negative control ("T-dense-line: negative control: the spike-column check reports a spike moved five columns away") moves the spike five columns at DPR 1, so a one-column error is not shown to be caught.
- **validate.mjs prints no statuses on errors.** It prints per-cell statuses only when the checker succeeds. With the 99 problems in other rows, it printed none, so I worked out the statuses by hand.
- **Negative-control coverage of the helpers these rows rely on.**
  - Covered: `spikeColumn` and `strokeRuns` (T-dense-line control), `readTable` and `compareTable` (A4 control), `valueText` (A2 control).
  - Not covered by any control: the local `vertices` and `inkIn` in f2-gaps, the missing-bar patch comparison, `shapes`, `plotGeometry`, `ring`, `resolveColors`, compact `datumPoints` and the `__bench.describe()` domains.
