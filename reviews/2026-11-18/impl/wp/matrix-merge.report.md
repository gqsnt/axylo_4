<!-- Author: agent a7e48ddd0321b1b1e, requested Claude Opus 5.5 xhigh; observed model in its transcript: claude-opus-5-5 (effort is not recorded in the transcript). It used seven Agent-tool workers with no model override; their model is not observed. Saved by the coordinator from the hand-back. -->

# Acceptance matrix re-merge against the current spec and tests

`acceptance/matrix.json` was re-merged row by row against `docs/02-product-spec.md`, as amended on 2026-11-18, and against the tests in the working tree at 71f2a02. The checker accepts it structurally. `acceptance/report.md` was regenerated with the checker's documented static command (`node acceptance/check.mjs --write`, no result files). It therefore matches the matrix and claims nothing from the old results. No test suite was run and no result file was touched.

## Checker, last lines

`node acceptance/check.mjs` exits 0. Before the merge it exited 1 with 99 structural problems.

```
- pass · 6
- fail · 0
- weak · 151
- no evidence · 0
- not run · 143
- cannot be verified here · 11
- not applicable · 265
```

`node --test acceptance/test/*.test.mjs`: 30 tests, 30 pass.

**The six "pass" cells are P6.** P6 cites only the packed size record, `bench/size-latest.json`, and the checker judges size records without provenance (defect 5).

**Every other cell that cites tests reads "not run" or "weak"** until results are recorded at this commit.

**The old result files, for information only.** The checker also accepts the matrix over the result files recorded at d8b4150 (80 pass, 23 fail, 132 weak, 65 not run, 11 cannot be verified, 265 not applicable), and `--release` exits 1 on their provenance. Those statuses describe an old tree and were not written to `report.md`.

**Reachable status** is what each cell reaches when every cited result passes:

| Reachable status | Cells |
|---|---:|
| pass when run | 117 |
| weak (a recorded gap, or only supporting citations) | 151 |
| not run (held by a `pending` reason) | 32 |
| cannot be verified here | 11 |
| not applicable | 265 |
| no evidence | 0 |

## How the merge was done

### 1. The structural problems

The 99 checker problems fell into three classes:
- citations of the removed React package (`packages/react/**`) in DX1, DX3, DX5, DX7 and DX8;
- tests renamed in `tests/dist` (licence, node, first-chart) in DX1, DX7, DX8, DX10 and DX11, plus the size entry "React adapter alone";
- one renamed Node title in T-reference-line.

Two more classes are invisible to the checker, and were checked separately:
- **Stale generated titles.** Three A2 toolbar titles still match their source template, but the template no longer generates them (they lack "Select range").
- **Titles that never run.** Four titles in `a1-names` and `i1-pointer` exist only because the static scanner expands loops through `if (type …)` blocks.

Every title cited from the two acceptance directories was confirmed against that directory's `EVIDENCE.json`, which holds the titles its last run reported. No test file in either directory has changed since that run. Titles elsewhere were derived from the loop values by hand.

### 2. Seven families

The 96 rows were split into seven families: F part A, F part B, L, I, A, C, and DX/P. One worker re-merged each family. Each worker read:
- the current spec row, and decision 0004 where it applies;
- the owner's decisions in `STATUS.md`;
- for every citation it kept or added, the test's assertions and the helpers they rest on, per chart type (type branches, compact kinds, the surface asserted on).

Each worker wrote its rows and a notes file.

### 3. Merging and checking

I merged the rows, then ran the checker and a scratch helper over the whole matrix. The helper checked:
- exact titles against `EVIDENCE.json`;
- no React, negative-control or engine citations, and no duplicates;
- the standard browser limit on every cell with browser evidence;
- no text that describes results.

I also confirmed these points by reading the code myself:
- The DX2 line normalizer test asserts row indexes that differ by form: wide row 1, long row 2, typed row 1 (`packages/axylo/test/data/normalize.test.ts:209`).
- The plot's point text is set as `aria-valuetext` (`packages/axylo/src/dom/interaction.ts:935`) and read from that attribute (`packages/axylo/test/browser/acceptance/util.ts:235`). This backs the A3 finding below.
- The forced-colours toolbar test asserts 24 × 24 CSS px for eleven controls (`packages/axylo/test/browser/a11y/axe.browser.test.ts:136`).
- The F3 per-code helper asserts the code set, level, chart name, fix text, a single print and the effect (`packages/axylo/test/acceptance/dx-diagnostics.test.ts:20`).
- The L1 bar twelve-label test forces neither truncation nor the note (`l-legibility.browser.test.ts:156`; `categoryProblems` at line 82).
- The `ancestors` given to `describe.each` tests in `tests/dist` match the suite names in the recorded `acceptance/results/dist*.json`.
- The generated titles in `theme/palette.test.ts`, `tests/dist/first-chart.browser.test.ts` and `tests/dist/flavours.browser.test.ts` are the ones their loops produce.

These are samples. The family notes say what each worker read.

### 4. Edits by another author during the merge

During the merge another author edited four cited test files for the engine port: `chart/interaction`, `chart/lifecycle`, `chart/review2` and `render/review.browser.test.ts`. The edits add `requireEngineFeature` for features only Chrome has, and make the CSP page safe for WebKit. No title changed, and no Chrome assertion in a cited test changed. The checker run after these edits still accepts the matrix.

## Rules applied across the matrix

### Statements

**Statements follow the current spec text.** 71 of the 96 statements changed, including 17 of the 22 F rows and every DX and P row. The amended parts are kept visible:

| Row | Amended part kept |
|---|---|
| F7 | value-axis scope; exact x span; compact reference clause |
| F8 | the slice limit counts slices with an arc; one fraction digit |
| F9 | 32 combinations; bar fill patterns |
| F10 | both totals for mixed signs |
| F12 | the note in every build |
| I1 | decision 0004 revision 3: strip, no readout below the L8 minimum, "+N more", Escape |
| I3 | no category-axis zoom |
| I4 | the Select range toggle |
| L8 | two-line summary with ellipsis |
| A3 | no screen-reader rehearsal |
| A5 | compact fill patterns |
| A9 | the WCAG citations |
| DX1 | by npm and by script tag |
| DX7 | 116 and 98 KiB |
| DX8 | create–destroy–create; CSP; text, not HTML; the selector error |
| P7 | 1.1 × the caller's two columns |

### Engines

- **No citation names an engine.** All browser evidence is therefore answered by Chrome results only.
- **Standard browser limit.** Every cell that cites a browser test has a `limits` text that starts: "Browser evidence: system Chrome, SVG renderer (the default); no Firefox or WebKit result is recorded yet." The acceptance suite refuses to run with the canvas renderer, and SVG is the default (decision 0002).
- **A6.** A6's own verification names three engines, so the missing engines are a `pending` reason: "No Firefox or WebKit result is recorded yet: the criterion asks for the viewport and text-spacing tests in three engines."
- **L1.** L1's "in real browsers" was read as "in a browser rather than a model", so L1 gets only the limit.

### A3 (owner's decision)

The `cannotVerify` text reads: "Not done by the owner's decision (2026-11-18): no screen-reader rehearsal is part of 1.0. What NVDA, VoiceOver or TalkBack speak, and whether every point or the table is reachable by swiping with a touch screen reader, have not been checked."

The cells read "cannot be verified here", which is neither failed nor pending. The owner's "do not block on it" would need a waiver, which the checker accepts for this status. I added none, because only the owner grants waivers.

### P1 to P8 (owner's decision)

- **P1–P5, P7 and P8** carry the `pending` text "Not measured yet: the benchmark harness in bench/ exists; the acceptance measurements wait for a quiet machine (STATUS.md, 2026-11-18).", plus each row's harness endpoint.
- **P6's limit is DX7**, so P6 cites the size record's "everything" and "line only" entries, as DX7 does.
- **P7 line** cites three tests as weak, for the parts they bound: the million-point store test and the two Chrome heap tests.
- **Removed:** the old benchmark citations of exploratory history files.

### Other rules

- **React.** React is gone from every row. DX8's framework sequence is now "create, destroy and create again on one element". DX1/compact became not applicable: a compact chart needs `compact: true` by definition.
- **Describe prefixes.** Exact titles replaced them in I1, I4, L3, L7, L8 and A10. One prefix remains, in DX10 (the per-example renders, which have no titles the checker can cite; defect 1).
- **Negative controls.** None is cited. The appendix notes say which helpers each family relies on and which of them have a control.
- **Kinds.** Three fast-check tests (F2, F4, F11) were relabelled from `unit` to `property`. The F8 Node formatter tests were relabelled from `browser` to `unit`: as `browser` they could never be answered by a Node run.

## What changed, by family

Counts are distinct citations per cell.

| Family | Rows | Kept | Added | Removed |
|---|---:|---:|---:|---:|
| F (F1–F12, T-dense, T-limit) | 22 | 430 | 188 | 28 |
| L (L1–L8, T-reference) | 13 | 151 | 43 | 17 |
| I (I1–I6, T-pointer, T-tooltip, T-zoom) | 21 | 94 | 78 | 51 |
| A (A1–A10, T-keyboard) | 15 | 243 | 64 | 16 |
| C (C1–C5) | 5 | 84 | 26 | 8 |
| DX | 12 | 208 | 178 | 275 |
| P | 8 | 1 | 8 | 11 |

### F family

- **F1** lost four lower-stage tests; the Node acceptance tests establish the same domain, AX110 and baseline.
- **F7** gained the zoom, reference, view and scene tests for each of its parts, and the compact reference test.
- **F3** cites a test per code per type that checks level and delivery. Its `gaps` list the delivery rules and the codes that have no per-type check.
- **F12** dropped the `tests/dist/text.browser.test.ts` citations, because that fixture is being changed.
- **The packed `validate()` probe** validates a line chart only, so it now supports F3 line only, as weak.

### L family

- **L8** cites the two current shrinking tests per type.
- **L1:** the Node reader-model tests moved to weak, because they model the canvas rather than painted text. The layout property test and the F3 AX143 test were added for the parts only they establish.
- **T-reference-line** dropped four unit citations; the acceptance tests establish every part.

### I family

- **I1** cites a test per part:
  - the 20 positions;
  - hovering the tooltip;
  - no control covered;
  - the 240 px and 140 px readout limits;
  - ten series and "+N more";
  - "No observation".

  Three line tests near the L8-minimum case are cited as weak.
- **I4** cites the Select range tests, the size test, the touch tests and the pinned-row tests. Its `cannotVerify` (no physical phone) is dropped, because the spec's own method is touch emulation; the emulation is now a limit.
- **Removed:** model-level and duplicate chart-suite tests in I1, I2, I3, I5, I6, T-pointer and T-tooltip.
- **Not cited:** twelve tests of decision 0004's mechanics (pin, sweep, the converse of rule 3b). They test the decision's mechanics, not a part of I1.

### A family

- **A2:** the three stale toolbar titles are replaced by the current ones, which include Select range.
- **A10:** the prefix is replaced by its exact titles, plus three a11y language tests.
- **A9** now cites the docs conformance tests.
- **A6** became applicable to compact, because a compact chart shows state messages and the C5 marker. It is weak there.
- **A5/donut** cites only the separator checks, which are all the amended row asks of slices.

### C family

- **C2** cites the compact per-code F3 tests and the AX141 and C5 browser tests, and lists its gaps per rule and per compact kind.
- **C1, C3, C5:** the Node model tests moved to weak.
- **Removed:** the `chart/render.browser.test.ts` corner test. It runs compact line only and reads DOM attributes.

### DX and P families

- **React:** every React citation is removed.
- **Renamed `tests/dist` titles** are replaced, with `ancestors` where the checker needs them (defect 2).
- **DX7 and P6** cite the size entries and the zero-dependency tests.
- **DX8** is cited part by part.
- **DX9** is "cannot be verified here". No release exists, so there is no previous release, no upgrade test and no API report.
- **DX12** is pending: the agent rehearsal has not been done, and no script exists for it.

## Status changes

"Reachable" compares what a cell could reach before (its old fields) with what it can reach now, assuming every cited result passes. 57 cells went down, 5 changed kind and 39 went up. Each recorded reason is the cell's own `gaps`, `cannotVerify`, `pending` or `notApplicable` text.

Five cells went up without such a text:
- **F10/compact:** its old gap described a missing result, not a missing check.
- **A5/donut:** the amended row asks only for the 1 px separators between slices, and those are measured.
- **DX2/line:** it gained `normalize.test.ts:209`, which compares two series in three forms with row indexes that differ by form.
- **DX10:** it lost its gap, because the docs suite now checks that every example has its own compile and render check. The checker cannot credit that test (defect 1), so in practice DX10 stays "not run".
- **P6:** it cites the size record.

### Cells whose reachable status went down (57)

- **C4** (compact): pass when run → weak. Recorded reason: As painted, the browser tests compare only the dash. That the two lines also differ in colour is asserted on the model (distinct paint bindings, compact line and area) and, as painted, for compact line only through the eight-series palette test; compact area has no painted colour comparison.
- **F2** (line, area, bar): pass when run → weak. Recorded reason: An absent step on a regular time (instant) axis is tested only at the data stage (test/data/review.test.ts, where it becomes a gap slot with AX105); no chart test draws one. Every drawn absent-step test uses a date axis.
- **F2** (scatter): pass when run → weak. Recorded reason: No test asserts that an explicit null on a scatter raises no diagnostic.
- **F2** (donut): pass when run → weak. Recorded reason: No test reads the tooltip of a null slice (it has no arc, so it can be reached only by keyboard).
- **F12** (line, area, bar, scatter): pass when run → weak. Recorded reason: No test checks the note for AX107 (a date that cannot be parsed leaves its row out); its tests check the summary's count only.
- **F10** (bar): pass when run → weak. Recorded reason: No test checks that a stacked bar's tooltip marks an incomplete stack; the table row and the value text are checked.
- **F8** (donut): pass when run → weak. Recorded reason: No test groups slices while a null slice is present: that a null slice is never grouped is checked only without grouping; a zero slice is checked to stay on its own when grouping happens.
- **F5** (area) and **T-dense-area** (area): pass when run → weak. Recorded reason: No test draws an area series with fewer rows beside a denser one (weekly beside daily), so the rule that such a slot does not break its line is untested on area. The one-in-a-million outlier and the alternating valid and missing fixtures run on line only.
- **F7** (line): pass when run → weak. Recorded reason: Without an author domain, no test asserts that the y range shown after an x zoom stays inside the automatic domain. The exact x span is tested on a numeric x only, not on a time series.
- **F7** (area): pass when run → weak. Recorded reason: Without an author domain, no test asserts that the y range shown after an x zoom stays inside the automatic domain. No test asserts that an area's continuous x spans exactly its data. Stack totals are shown to lie inside the domain, not that the domain ends at the first tick at or beyond them. No test puts a y reference band beside an area's data.
- **F7** (bar): pass when run → weak. Recorded reason: Without an author domain, no test asserts that the y range shown after an x zoom stays inside the automatic domain. The half-band x span is checked at the view stage on a numeric x only (regular and irregular steps), not on a time series. Stack totals are shown to lie inside the domain, not that the domain ends at the first tick at or beyond them.
- **F7** (scatter): pass when run → weak. Recorded reason: The first-tick ending of x is tested for a number x only; for a date x, view.test.ts asserts that the automatic domain spans exactly the dates, so the rule for a date or time x is not established. A declared percent or ratio scale is tested on y only. No test puts a y reference band beside a scatter's data.
- **F7** (compact): pass when run → weak. Recorded reason: For compact area and bar, that a reference leaves the domain unchanged is shown at the view stage only, that it leaves the description unchanged is not checked, and AX150 is checked at validation only. Whether a compact chart's automatic domain ends at a tick is not asserted: the tick check in f-domains.test.ts skips compact layouts. That a compact chart's x spans exactly its data is not tested.
- **A1** (compact): pass when run → weak. Recorded reason: For compact area and compact bar, no test checks the time-zone statement or unique ids: the instants, author-description, labelledBy and 24-chart tests run on compact line only.
- **A2** (line, area, donut): pass when run → weak. Recorded reason: The arrow keys are walked through the toolbar at full view only: Pause, which the streaming test finds inside the toolbar's one tab stop, is not reached with them.
- **A2** (bar): pass when run → weak. Recorded reason: As above, and a bar chart with a date or number x axis, where zoom applies, is not traversed in its zoomed state.
- **A2** (scatter): pass when run → weak. Recorded reason: As above, and hiding the focused series is tested on line, area and bar, not on scatter.
- **L2** (line, area, bar, scatter): pass when run → weak. Recorded reason: Only the text shown at rest is measured: the tooltip, the readout strip, the opened table, the notes and the state messages are not (axe-core covers some of them, in the light scheme only). No L2 fixture has a reference label, so text drawn inside a mark is not checked.
- **L2** (donut): pass when run → weak. Recorded reason: Only the text shown at rest is measured (as above).
- **L7** (compact): pass when run → weak. Recorded reason: Compact area and bar are checked only through the controller (Node). Their painted message and its place in the tile are not checked in a browser, and their internal-failure state is not checked at all.
- **A6** (compact): not applicable → weak. Recorded reason: No test applies the 320 CSS px viewport or the text-spacing overrides to a compact chart, whose visible text is a state message (loading, empty, error) or the corner marker of C5.
- **I3** (line): pass when run → weak. Recorded reason: On a date x only + is pressed; the buttons, the drag, the other keys, the pinch and the wheel are not exercised there.
- **I3** (area): pass when run → weak. Recorded reason: On a time x nothing is exercised, and on a date x only + is pressed.
- **I3** (bar): pass when run → weak. Recorded reason: A bar chart on a time x is not exercised.
- **I3** (scatter): pass when run → weak. Recorded reason: A scatter chart on a time or date x is not exercised.
- **T-zoom-line** (line): pass when run → weak. Recorded reason: On a category x, the browser test checks only that no zoom control is shown and that + raises no AX199. That +, the wheel or a drag leave the range unchanged is not asserted; the Node test shows that zoom() is refused.
- **T-zoom-area** (area): pass when run → weak. Recorded reason: On a time x an area is zoomed only through the Node controller's zoom(). On a category x, the same as for line.
- **T-zoom-bar** (bar): pass when run → weak. Recorded reason: On a time x a bar chart is zoomed only through the Node controller's zoom().
- **T-zoom-scatter** (scatter): pass when run → weak. Recorded reason: That zoom reaches x only (no control or gesture zooms y) is not asserted. The browser test zooms through zoom(), and its y check uses a window whose visible y extremes equal the full ones. On a time or date x a scatter is zoomed only in Node.
- **A8** (line): pass when run → weak. Recorded reason: Not scanned: a pinned tooltip, whose rows are buttons (decision 0004 rule 4).
- **A8** (area, scatter, donut): pass when run → weak. Recorded reason: Not scanned: a pinned tooltip, and the readout strip of a small plot (scanned on line only).
- **F9** (line, area): pass when run → weak. Recorded reason: No citable test reaches 32 series. The scene module's 32-combination cases (`scene.test.ts:731`) are registered from a variable list the scanner cannot expand, so they cannot be cited. The cited checks reach 24 (line) or twelve (area) series on the scene's marks, and nine painted.
- **L6** (line, area): pass when run → weak. Recorded reason: A measure (number) x is titled with its label and unit only in the controller model (Node), and its field-name fallback is not checked. A time (instant) x and a category x are not checked, only a date x.
- **L6** (bar): pass when run → weak. Recorded reason: A number x is titled only in the model, and its field-name fallback is not checked. A date or time x on a bar chart is not checked, only a category x.
- **L6** (scatter): pass when run → weak. Recorded reason: A time or date x on a scatter chart is not checked, only a number x.
- **C1** (compact): pass when run → weak. Recorded reason: The name from labelledBy is read from Chrome's tree for compact line only; for compact area and bar only the model is checked. Pointer input is tried only as a move to, and a click at, the centre of a tile; wheel, drag and touch are not tried in a browser.
- **DX5** (line): weak → not run (pending). Recorded reason: Not measured yet: the heap trend over 1,000 create–destroy cycles is P7's measurement (spec DX5, "Verified by"), which waits for a quiet machine.
- **DX5** (area, bar, scatter, donut, compact): weak → not run (pending). Recorded reason: As for line (pending). Also a gap: in a browser, the one-turn sequence, the rejected strict update and what destroy() releases are checked on line only; for this type they are checked only through the controller in Node.

### Cells whose reachable status changed kind (5)

- **A6** (line, area, bar, scatter, donut): cannot be verified here → not run (pending). Recorded reason: No Firefox or WebKit result is recorded yet: the criterion asks for the viewport and text-spacing tests in three engines. Native zoom is now a limit, because the 320 CSS px emulation is how WCAG 1.4.10 states reflow.

### Cells whose reachable status went up (39)

- **F10** (compact), **A5** (donut), **DX2** (line), **DX10** (all six types), **P6** (all six types): see the reasons above.
- **I4** (line, area, bar, scatter, donut): cannot be verified here → weak. The spec's own method is touch emulation. Remaining gaps:
  - The table's pager and jump field are hidden on the fixtures' one-page tables, so they are never measured.
  - Resume is never measured.
  - Reset zoom, Pan left and Pan right are measured on line only.
  - On number and date bars, only Select range is measured.
  - Pause and Resume, Pan, Reset, the pager and the jump field are not shown to work by touch. Further per-type touch gaps are in the cells.
- **A9** (all six types): no evidence → weak. The docs conformance tests are cited. Remaining gaps:
  - No test reads the generated page.
  - The WCAG A/AA list in `apps/docs/data/wcag.mjs` is hand-written and not compared with W3C's.
  - Publication with each release has no test.
- **DX1** (compact): weak → not applicable. A compact chart needs `compact: true` by definition.
- **DX9** (all six types): no evidence → cannot be verified here. No release exists (the package is 0.0.0).
- **DX12** (all six types): no evidence → not run (pending). The scripted agent rehearsal has not been run, and no script, prompts or trap fixtures exist for it.

## Gap list, most important first (31 items)

Each item is a criterion part, with its chart types, that no cited test establishes.

1. **A3, all full types: the channel.** The point's text reaches the accessibility API as the slider's value text (`aria-valuetext`, decision 0001), not through the focused element's accessible name or a polite live region, which is what the criterion names. The plot's name is the fixed "Chart plot", and A7's test asserts that a key press changes no live region. No test can establish A3 as written: the spec or the implementation has to change (an owner decision). Screen-reader speech and swiping are not done, by the owner's decision ("cannot be verified here").
2. **Compact area and compact bar in a browser.** In the browser acceptance suite, "compact" means compact line only. For compact area and bar nothing is checked as painted for:
   - F2: gaps, the "no data" mark, `missing: 'zero'` (C2);
   - L4 triggers (C2/L4);
   - I5 reduced motion and updates (C2/I5);
   - L2 marks; the L7 message and internal failure;
   - A1: the time-zone statement and unique ids;
   - A5 modes and palette; A7 live regions; F9 colours;
   - C1: labelledBy in the tree; C4: the painted colour (area).
3. **I1 area, bar, scatter and donut: a plot below the L8 minimum.** When reserving the strip would leave the plot under L8's minimum, pointing should highlight the datum with no readout. No test covers this. Line has weak support only. No test asserts a drawn highlight for any type.
4. **F3 delivery rules, per type.**
   - Errors printing in a production build: unit test only.
   - A code printing once per page across two charts: line, development build only.
   - Hints silent in production: line only.
   - `strict` on create and append: only update is checked per type.
   - Hints not throwing under strict: no chart test.
   - Late findings other than AX160 not throwing: not checked.
   - AX199 level, delivery and error state outside line: not checked.
   - AX141 outside line: seen only as raised.
   - Smaller codes: AX143 on line, area and scatter; AX132 on compact bar; a throwing tick formatter on area, bar and scatter.
   - Field and row indexes per type: only for AX102, AX103 and AX106.
5. **L2, every type: text outside the resting state.** The tooltip, readout strip, open table, notes, state messages and L8 fallback are not measured for size or contrast: never in the dark scheme, and in the light scheme only through axe-core. Text drawn over a mark is not checked.
6. **A9.** No test reads the generated conformance page. Untested:
   - the tests listed per criterion;
   - the author obligations and the section 3.8 limits;
   - uncited criteria shown as not covered;
   - the WCAG list against W3C's;
   - publication with each release.
7. **L1.**
   - Generated label sets are checked only in Node (the layout property test with a test measurer), not as painted text.
   - The browser's own text-only zoom is not run; the suite doubles the body font size instead.
   - The late font is checked at 480 and 1,280 px only.
   - L1 bar: neither the note nor AX143 is forced in a browser.
   - The full text of a truncated label in the tooltip is checked nowhere.
   - Line and area with an unordered category x are not checked.
8. **F7.**
   - Line, area, bar: without an author domain, nothing asserts the y range after an x zoom stays inside the automatic domain.
   - Area: the exact x span is not checked.
   - Area, bar, compact: nothing shows the domain ends at the first tick beyond the stack totals.
   - Scatter date or time x: the first-tick ending is not established; a unit test asserts the opposite.
   - Compact area and bar: the reference's lack of effect is checked below the controller only.
   - Area, scatter: no y reference band beside the data.
9. **I4.**
   - Sizes: the pager and jump field are never measured, nor is Resume; Reset and Pan are measured on line only; number and date bars have only Select range measured.
   - Touch: Pause and Resume, Pan, Reset, the pager and the jump field are not shown to work by touch, with more per type.
10. **A8.** No pinned tooltip is scanned (all full types). The readout strip is scanned on line only. A zoomed number or date bar is not scanned.
11. **A2.** Pause is not reached with the arrow keys (all full types). A zoomed number or date bar is not traversed. Scatter: focus after hiding the focused series is not tested.
12. **F2.**
   - Line, area, bar, compact: an absent step on a regular time (instant) axis is checked at the data stage only.
   - Scatter: that an explicit null raises no diagnostic is not checked.
   - Donut: the tooltip of a null slice is never read.
13. **F12 line, area, bar and scatter:** the note for AX107 is not checked.
14. **F9.**
   - Line, area and compact: 32 combinations; the only test uses an `it.each` the checker cannot cite (`scene.test.ts:731`).
   - Compact: painted colours are checked on compact line only, and never beyond eight series.
15. **F10 bar:** the "incomplete" mark in the tooltip is not checked.
16. **F8 donut:** a null slice while grouping happens is not checked.
17. **F6.**
   - The page's locale is checked in a browser on line only.
   - Default localized ticks, percent readouts and zoned times on a chart in non-en-US locales: formatter only.
   - A throwing tick formatter's fallback on area, bar and scatter: not checked on a chart.
18. **L4.**
   - A change to the `style` of `<html>`: untested.
   - A change of the contrast preference: untested.
   - The forced-colours switch: not timed to one frame.
   - `--axylo-background` against a computed color-scheme on a real chart: untested.
19. **L3.** A zero-sized (not hidden) container is not checked in a browser. A definite height changed at run time is not checked.
20. **L6: x-axis title variants.**
   - The field-name fallback for a number x is not checked.
   - A time x is not checked on line, area or scatter.
   - A category x is not checked on line or area.
   - A date or time x is not checked on bar.
21. **I3 and T-zoom.**
   - Axis kinds not exercised in a browser: area time x; bar time x; scatter time and date x.
   - Category x on line and area: that +, the wheel and a drag leave the range unchanged is not asserted.
   - T-zoom-scatter: "x only" is not asserted.
22. **I5, compact area and bar.**
   - No update trace.
   - No first render under reduced motion.
   - No 24-chart filter change.
   - The `traceMotion` truncation (defect 10) weakens every I5 and C2 motion comparison.
23. **A5.**
   - Bar: the in-group order of bars against the legend and tooltip order is not checked.
   - Compact area and bar: the contrast modes and the palette are untested.
   - Compact: no separator checks.
24. **A10.**
   - Messages keys `labelsHidden` and `value` are never shown with overrides.
   - `lang` is not checked on tooltip rows, table headers, the Jump field, state messages (non-line) or compact surfaces.
25. **A4 area, bar, scatter and donut:** the million-row jump runs on line only.
26. **A6.** Compact: no reflow or text-spacing test. Full types: no Firefox or WebKit result (pending).
27. **C1 and C4.** C1: no pointer input beyond a move and a click is tried on compact. C4: no painted colour difference is checked for compact area.
28. **DX.**
   - DX10: the per-example renders cannot be credited by the checker.
   - DX5, DX8: the lifecycle and the missing-target error are checked on line only for the other types.
   - DX3: no compile-time mistakes for area or compact, and partial ones for the others; no recorded test compiles `docs/api/examples.ts`.
   - DX6: no 24-tile page; the inherited page colour is not asserted; there is no spacing custom property.
   - DX4: field and rows are not checked per code; no message snapshots exist.
   - DX1: no snippet exists for the non-line types.
   - DX2: multi-series data is checked on line only.
29. **P1–P5, P7 and P8:** not measured. No workload exists for P4 on non-line types, for P7 on any non-line type, or for P8 on compact area and bar.
30. **DX9 and DX12.** DX9: there is no release. DX12: the rehearsal has not been done.
31. **All browser evidence is Chrome only.** No Firefox or WebKit result exists, and Safari, Edge and iOS are not run here.

## Not testable as written

### A rows

- **A3.** The channel ("accessible name or a polite live region") does not match the design the tests exercise (value text). Speech and touch-screen-reader swiping need a rehearsal, which is out of 1.0.
- **A9.** "Published with each release" is a release-process claim with no test surface.
- **A8.** "Any fixture in any state" is open-ended.
- **A2.** "Keys and roles fixed after the M1 spike" is a process note, not a property of the chart.
- **A5.**
  - "Repeats included" is unclear.
  - "In any mode" is open-ended.
  - It is unclear whether "a shape marker … repeated in legend and tooltip" reaches compact lines and areas.
- **A6.** "400% zoom" is stated by WCAG 1.4.10 as 320 CSS px, which the emulation meets. Recorded as a limit.

### L rows

- **L1.** Chrome has no text-only zoom. "In real browsers" is ambiguous about engines.
- **L5.** "`trend` at 720 px has none" conflicts with the sparse markers A5 keeps. The tests assert "not a marker on every point".
- **L3.** "In both directions" is ambiguous.
- **L6.** "Next to it" gives no distance.
- **L7.** "Announced once" can be observed only as live-region changes, not as speech.

### I rows

- **I1.** "Highlights the datum" is undefined (painted overlay, focus ring, or the `hover` event). "20 positions including all four edges" has no meaning at a donut's plot edges or for a sparse scatter.
- **I2.** The spec does not say whether I2 reaches the donut's slice list, whose entries select a slice and have no pressed state.
- **I4.** "Every interaction" is an open set. Whether the one-finger drag reaches compact charts is not said.
- **I5.** The first painted frame cannot be screenshotted at that frame. The suite compares markup and computed paint instead.
- **T-zoom-scatter.** What y does on an x zoom is not stated. `view.test.ts` re-fits y.

### F rows

- **F7.**
  - "Spans exactly its data" conflicts with containing x references.
  - It is unclear whether a scatter's temporal x ends at a tick.
  - "The zoomed view" on y is undefined, since zoom changes x only.
  - "Ends at the first tick" has no meaning on a compact chart, which draws no ticks.
- **F5 against F10.** It is open whether a no-row slot in a stacked area is a "missing component".
- **F2.** A scatter point without y and a null slice have no position, so only the table (and for donut, the keyboard) can say "No data".
- **F9.** "After which combinations repeat" can only pin the implementation's chosen cycle.
- **F12.** "Worded for any count" is a language judgement.
- **F6.** "Ticks may be compact" is permissive.
- **Section 3.5 against F12.** 3.5 says every warning shows the note, but F12 is narrower. AX110, AX130, AX140, AX141, AX150, AX151 and AX152 are warnings that show no note, and the tests follow F12.
- **F10.** On a compact chart the "tooltip, table and announcements" do not exist.

### C rows

- **C1.** "No pointer-only behaviour" is a negative over all pointer input.
- **C3.** "Any size" is unbounded.
- **C5.** "A small marker … in the corner" gives no size and no corner.
- **C2.** "No motion (I5)" is ambiguous.
- **C4 and AX131.** "Dash differences" does not fit compact bars, which get fill patterns.

### DX and P rows

- **DX7.** "Reconsidered only with a measured comparison" is a process rule.
- **DX9.** The deprecation and major-version rules are statements about release history.
- **DX11.** "At release" is a process step.
- **DX12.** "Passes the reader criteria" has no script.
- **DX5 and DX8.** "Releases everything" and "leaks nothing" are unbounded.
- **DX6.** "Spacing" has no custom property to refer to.
- **DX4.** No message snapshots exist.
- **DX10.** "In CI": the workflow has never run, because there is no remote.
- **DX1.** The snippet test counts only non-blank lines.
- **P1.** "Reference desktop" is undefined.

## Titles that promise more than their assertions

The matrix does not cite these tests for the part they overstate.

### Browser acceptance suite (`packages/axylo/test/browser/acceptance/`)

- **`type-matrix.browser.test.ts`**
  - **:358 T-dense:** a vertex may sit one device column either side. The table row it reads is never shown to be a dropped sample.
  - **:422 T-dense-bar:** asserts the bar count and the place of the tall bar only.
  - **:580 T-reference band** (line, area, scatter): the x domain is not read.
  - **:248 F10 area:** "the parts sit on their own sides of zero" is asserted for bar only.
  - **:275 T-zoom-scatter:** uses `zoom()`, not `+`. "The visible y extremes change" is false for its fixture.
- **`f2-gaps.browser.test.ts`**
  - **:104 `missing: 'zero'`:** for bar it asserts only that no other bar is taller than 1.5 px. For compact, the baseline check is skipped.
- **`f8-donut.browser.test.ts`**
  - **:140 "the ninth is what groups":** no ninth slice is added.
- **`l-legibility.browser.test.ts`**
  - **:112 L1, "no category label is lost":** checked for bar only.
  - **:156 L1 bar:** AX143 is asserted only if the note appears.
  - **:242 L2 donut and compact:** no hidden legend entry is measured. For compact, the 12 px check is vacuous.
  - **:434 L4:** `style` is changed on `<body>` only.
  - **:487 L4 forced colours:** only the run-time switch is tested.
  - **:662 L7, "announced exactly once":** announcements are de-duplicated with a `Set`.
  - **:698 L8 ellipsis:** asserted only if the sentence is cut, and no fixture cuts it.
  - **:346 L3, "at the shown size":** asserted as a plot wider than 300 px.
- **`i1-pointer.browser.test.ts`**
  - **:135 I1, 20 positions:** scatter and donut are not probed at the plot's edges. Donut's active mark is a 12 px square, not the slice.
  - **:796 I4 sizes:** the pager, jump field, Reset, Pan and Resume are never measured.
  - **:1012 I6:** the tooltip is not compared.
  - **:167:** "decision 0004 revision 2" should read revision 3 (cosmetic).
- **`a2-keyboard.browser.test.ts`**
  - **:260 A2 indicator, "painted 2 px wide":** the width is a computed style; only the 3:1 contrast is measured on painted pixels.
- **`a6-a10.browser.test.ts`**
  - **:143 A7 donut:** compares only the text without share and position.
  - **:459 A10:** two `Messages` keys are never shown.
- **`compact.browser.test.ts`**
  - **:43 C1, "nothing inside exposed":** text nodes inside the image are allowed.
  - **:64 C1, 40 tiles:** tile 39 lies below the viewport and is likely never pointed at (inferred, not run). Pixels are checked in the top 900 × 700 px only.
  - **:161 C2, null gap:** a bridging stroke would pass.
  - **:176 C3, "heights keep their order":** only the extremes are checked.
  - **:206 C4, "dash as well as colour":** compares the dash only.
- **`a5-not-colour-alone.browser.test.ts`**
  - **:113 A5 compact:** compares the dash only.

### Node acceptance suite (`packages/axylo/test/acceptance/`)

- **`f-domains.test.ts`**
  - **:64 F7 property:** for compact, the tick check is skipped and references are excluded. For line, area and bar, the zoom it checks is on x.
- **`dx-diagnostics.test.ts`**
  - **:155 AX130:** "assigns a secondary cue", but no cue is asserted.
  - **:198 AX131:** on compact bar it asserts patterns, not dashes (a misfit, not an overstatement).
- **`f-disclosure.test.ts`**
  - **:42 F12 throwing formatter:** nothing about the drawn marks.
- **`f-series.test.ts`**
  - **:6 F9:** "painted cues" are scene paint bindings, not pixels.
- **`reader-model.test.ts`**
  - **:122 A3:** x is checked as `toContain('2')`, which "Point 2 of 2" already satisfies.
  - **:230 I3:** asserts a flag; no control is looked at.
  - **:267 I1:** "No observation" is never produced.
- **`compact.test.ts`**
  - **:58 C2, "sorted final geometry":** the order is not checked.
- **`dx-controller.test.ts`**
  - **:21 DX2, "caller row indexes":** the bad row sits at the same index in every form.
  - **:81 DX5, "switch together":** text is not compared for donut; neither text nor lookup for compact.

### Chart, a11y and render browser suites (`packages/axylo/test/browser/`)

- **`chart/interaction.browser.test.ts`**
  - **:449 pinch:** the case without `zoom: 'touch'` never runs.
  - **:58:** "beside the active x" is not asserted.
  - **:138 donut:** the overlay is not checked.
- **`chart/final-hold.browser.test.ts`**
  - **:388:** strip versus no readout is not asserted. "Highlights" is the `hover` event.
- **`chart/data.browser.test.ts`**
  - **:121 L7:** the message is not located inside the plot.
- **`chart/lifecycle.browser.test.ts`**
  - **:374 heap trend:** compares two window means, not a slope.
- **`a11y/axe.browser.test.ts`**
  - **:57:** "series hidden" is not applied for `bars` and `parts`.
- **`render/pending-css.browser.test.ts`**
  - **:44:** only `--axylo-font-family` is asserted.

### Other Node tests and packed-distribution tests

- **`packages/axylo/test/core/closing.test.ts:49`:** AX160 is never asserted.
- **`tests/dist/licence.test.ts:91`:** asserts only that the notices file contains the string `axylo`.
- **`tests/dist/csp.browser.test.ts:106`:** tooltips are opened on line and bar only.

## Checker and helper defects (not edited)

1. **A describe prefix over an unexpandable `it.each` can never pass.** `titles.mjs` records `it.each(computed)('%s')` as a null-title case. This is by design, but it leaves no way to cite such suites:
   - DX10's per-example renders;
   - the docs diagnostics, site and options tests;
   - F9's `scene.test.ts:731` (a variable list), which cannot be cited at all.

   Possible fix: let a prefix declare a `cases` count for unresolved registrations, or write the lists inline.
2. **A title-only citation inside `describe.each` with computed rows never passes.** The static ancestors are `[]`, while the results carry the suite title. Workaround used: `ancestors` with the runtime suite names, in `tests/dist` licence, snippets, node, lifecycle, csp, text, flavours, isolation and types, even where the title appears in only one suite.
3. **`describe.each` with literal rows puts a test in every row's suite at once.** Its static ancestors become the union of all rows' suite names, for example `["stylesheet applied at run time","stylesheet linked by the page"]`, a path that never occurs at run time.
4. **The static scanner accepts titles that never run.** It expands loops through `if` blocks, and `registration` accepts any title that fits the template. Stale or never-run titles therefore pass the structural check. This merge found seven: three A2 toolbar titles and four conditional titles. Only a check against `EVIDENCE.json`, which the checker does not do, catches them.
5. **Size citations have no provenance.** P6 reads pass from `bench/size-latest.json`, which names no commit and is not compared with the current pack. The record is 4 bytes under the 116 KiB target, and the size cuts in progress will change it.
6. **`kind` is not checked against the file.**
   - A `browser` citation of a Node test would never be answered.
   - Fast-check use is not detected.
   - Run counts below the spec's 1,000 are not detected: `view.test.ts` uses 100 runs and the `layout.test.ts` scatter property 300. Both are cited only as weak.
7. **F3's registry rule reads AX codes from cited titles only.** A title that names a code satisfies it, whatever the test asserts.
8. **Results with a provenance error still set cell statuses in the table.** For example, the d8b4150 results give 80 passes; only the exit code and the line for each run show the mismatch. This is an observation, not necessarily a defect.
9. **The browser `EVIDENCE.json` has no `compactKinds`.** "Compact" in that suite is compact line only.
10. **Test helpers:**
    - `traceMotion` (`checks.ts:177`) cuts signatures longer than 200 characters to their length plus the last 120 characters, before I5 and C2 compare them.
    - `firstTicks` (`f-domains.test.ts:53`) asserts nothing for compact charts.
    - The negative control of the ±1-column `spikeColumn` tolerance moves the spike five columns, so a one-column error is not shown to be caught.

## Questions for the owner

1. **A3 channel:** admit the value text in the spec, or change the implementation?
2. **A3 waiver:** a waiver would carry "do not block on it"; none was added.
3. **I2:** does it reach the donut's slice list?
4. **I4:** does the one-finger drag clause reach compact charts?
5. **T-zoom-scatter:** what should y do on an x zoom?
6. **F7:** x references against "spans exactly its data"; ticks on a scatter's temporal x; y after an x zoom.
7. **A6/compact:** now applicable and weak. Should it be?
8. **L1:** does "real browsers" mean the engines of section 2.3?
9. **Section 3.5 against F12:** which warnings carry the reader's note?
10. **L5 against A5:** "`trend` has none" against the sparse markers.
11. **F5 against F10:** a no-row slot in a stacked area.
12. **C4 and AX131:** the wording for compact bar.

## Files

- `acceptance/matrix.json` (re-merged, 96 rows).
- `acceptance/report.md`, regenerated by `node acceptance/check.mjs --write` (static).
- The full notes of the seven families, with the per-criterion detail of every citation removed and added, were handed to the coordinator with this report.
