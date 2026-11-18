# Acceptance report

## Supplied Vitest runs

Suite counts include assertions outside the matrix. Each cell lists the reports with matching assertions, including partial evidence in weak cells.

- `acceptance/results/node-acceptance.json` · 661 passed assertions, 7 reported failures
  - Provenance: commit 6d4342fa137f263a718797f238324776088a663c, dirty true, tree SHA-256 ed502d76572ee51e815452f89003302c8bbe3a4e1fb2e1331310b96268d9b9ae, result SHA-256 3066c2889a3ef72dbe700bd176ad0535fb5ab28336df79ff80667450f42f50da, 55 cited test hashes in the sidecar, working tree changed during run · release requires an unchanged working tree during the run
  - `packages/axylo/test/acceptance/f-domains.test.ts` · F7 line: for any generated extents the automatic domain includes data and references and the zoom stays inside its governing domain
  - `packages/axylo/test/acceptance/f-domains.test.ts` · F7 area: for any generated extents the automatic domain includes data and references and the zoom stays inside its governing domain
  - `packages/axylo/test/acceptance/f-domains.test.ts` · F7 bar: for any generated extents the automatic domain includes data and references and the zoom stays inside its governing domain
  - `packages/axylo/test/acceptance/f-domains.test.ts` · F7 scatter: for any generated extents the automatic domain includes data and references and the zoom stays inside its governing domain
  - `packages/axylo/test/acceptance/f-donut.test.ts` · F8 donut: zero and null slices count toward the eight-slice limit without gaining arcs
  - `packages/axylo/test/acceptance/f-stacks.test.ts` · F10 area: a missing area component has zero height and the reader is told which stack is incomplete
  - `packages/axylo/test/acceptance/f-stacks.test.ts` · F10 bar: a missing bar component has zero height and the reader is told which stack is incomplete

## Packed size measurement

- line only (examples/first-chart/npm.ts) · 288,819 minified JS bytes, 99.38 KiB gzipped, 25 KiB target · [bench/size-latest.json](../bench/size-latest.json)
- everything (export * from axylo) · 289,261 minified JS bytes, 99.47 KiB gzipped, 40 KiB target · [bench/size-latest.json](../bench/size-latest.json)
- script tag (axylo.iife.min.js + axylo.css) · 289,757 minified JS bytes, 103.53 KiB gzipped · [bench/size-latest.json](../bench/size-latest.json)
- React adapter alone (react, axylo external) · 2,375 minified JS bytes, 1.17 KiB gzipped, 2 KiB target · [bench/size-latest.json](../bench/size-latest.json)


## Status by chart type

- pass · 5
- fail · 13
- weak · 129
- no evidence · 18
- not run · 132
- cannot be verified here · 15
- not applicable · 264

The matrix contains individual test citations and applicability reasons. [acceptance/matrix.json](matrix.json)

| Criterion | Statement | line | area | bar | scatter | donut | compact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L1 | Text does not overlap or clip; a visible note appears if labels still do not fit. | weak | weak | weak | weak | weak | not applicable |
| C4 | Multiple compact lines differ by dash as well as color; AX131 suggests one series per compact chart. | not applicable | not applicable | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) |
| F1 | Bar and area value axes always include zero; a domain that excludes zero is widened and raises AX110. | not applicable | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not applicable | not applicable | not run (node-acceptance.json pass) |
| F2 | Missing values are never drawn as zero and never bridged unless the author asks; readouts say “No data”. | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| F3 | Input that cannot be plotted as given is reported, never guessed. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| F12 | When warnings mean values were left out or changed, a note appears inside the figure and in the accessibility tree, in every build. | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not applicable |
| F10 | Stacks place positive and negative values on their own sides of zero; missing components mark the stack incomplete. | not applicable | fail (node-acceptance.json fail/pass) | fail (node-acceptance.json fail/pass) | not applicable | not applicable | weak (node-acceptance.json pass) |
| F8 | Donut slices keep order, start at 12 o’clock and run clockwise; nulls, zeros, negatives and excess slices have distinct outcomes. | not applicable | not applicable | not applicable | not applicable | fail (node-acceptance.json fail/pass) | not applicable |
| F4 | Calendar dates read the same in every zone; instants name their zone; wall-clock times are shown as written. | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not applicable | not run (node-acceptance.json pass) |
| F11 | Line, area and scatter draw in x order; duplicate x disables an aligned series, while scatter keeps coincident points. | pass (node-acceptance.json pass) | pass (node-acceptance.json pass) | pass (node-acceptance.json pass) | pass (node-acceptance.json pass) | not applicable | not run (node-acceptance.json pass) |
| F5 | Dense drawing preserves the exact per-pixel extrema of each valid run and keeps every break. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | not applicable | not applicable | not applicable | weak (node-acceptance.json pass) |
| T-dense-line | Simplified drawing when dense · F5 | weak (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-dense-area | Simplified drawing when dense · F5 on cumulative sums | not applicable | weak (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-dense-bar | Simplified drawing when dense · No; more bars than pixels raises a hint | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable |
| T-dense-donut | Simplified drawing when dense · No | not applicable | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable |
| T-dense-scatter | Simplified drawing when dense · No in 1.0; above 50,000 points a hint says drawing may be slow | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable |
| F7 | The zoomed view stays inside the author or automatic domain; the automatic domain contains data, references and stack totals. | fail (node-acceptance.json fail/pass) | fail (node-acceptance.json fail/pass) | fail (node-acceptance.json fail/pass) | fail (node-acceptance.json fail/pass) | not applicable | weak (node-acceptance.json pass) |
| F6 | Format numbers and dates for the page locale, separately for ticks and readouts; a throwing formatter falls back with a diagnostic. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| A3 | The focused point conveys its text; touch screen readers can swipe to every point or reach the table in two gestures. | cannot be verified here (node-acceptance.json pass) | cannot be verified here (node-acceptance.json pass) | cannot be verified here (node-acceptance.json pass) | cannot be verified here (node-acceptance.json pass) | cannot be verified here (node-acceptance.json pass) | not applicable |
| A1 | Every chart has an accessible name and generated summary, and chart element ids are unique. | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) |
| A2 | At most two tab stops with the table closed; every point is reachable, the toolbar roves, and focus can leave the chart. | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not applicable |
| T-keyboard-line | Keyboard order · By x, then series | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-keyboard-area | Keyboard order · By x, then series | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-keyboard-bar | Keyboard order · By category, then series | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable |
| T-keyboard-donut | Keyboard order · By slice order | not applicable | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable |
| T-keyboard-scatter | Keyboard order · By x, then y | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable |
| A4 | View as table opens a normalized HTML table in the current range, with pagination or x jump, in a focusable scroll region. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | not applicable |
| A5 | Series are never distinguished by color alone; filled marks have separators and the palette meets contrast and distance thresholds. | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | weak (node-acceptance.json pass) | not run (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| L2 | Text is at least 12 CSS px and 4.5:1; marks, axis lines and focus indicators are at least 3:1 in light and dark. | weak | weak | weak | weak | weak | weak |
| L7 | Empty, loading, error and internal failures show a message in the plot; a change is announced once, politely. | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) |
| L8 | Below a readable plot size of 120×80 CSS px, show the title, summary and table control and raise AX142. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | not applicable |
| L3 | The chart follows its container; automatic height is 16:9 clamped to 160–480 CSS px; initially hidden charts draw when sized. | weak | weak | weak | weak | weak | not applicable |
| L4 | The chart follows the page color scheme; changes repaint within one frame and forced colors use system colors. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| A6 | Reflow at 320 CSS px and 400% zoom without two-dimensional scrolling; user text spacing does not clip. | cannot be verified here | cannot be verified here | cannot be verified here | cannot be verified here | cannot be verified here | not applicable |
| I1 | Pointing shows the correct readout within a frame at p95; it stays in view, avoids the mark and supports hover, fallback and Escape. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | not applicable |
| T-pointer-line | Picking by pointer · Nearest x | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-pointer-area | Picking by pointer · Nearest x | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-pointer-bar | Picking by pointer · The band under the pointer | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable |
| T-pointer-donut | Picking by pointer · The slice under the pointer | not applicable | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable |
| T-pointer-scatter | Picking by pointer · Nearest point within 24 px; ties go to the later row | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable |
| T-tooltip-line | Tooltip content · Every visible series at that x | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-tooltip-area | Tooltip content · Every visible series at that x, plus the stack total | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-tooltip-bar | Tooltip content · Every series in that category | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable |
| T-tooltip-donut | Tooltip content · Label, value, percentage | not applicable | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable |
| T-tooltip-scatter | Tooltip content · The point's series, x and y; coincident points listed, up to eight | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable |
| I2 | Legend entries are pressed-state toggle buttons operable by click, Enter and Space. | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run | not applicable |
| I3 | Zoom works by controls, drag, keyboard and opt-in pinch; the wheel respects focus and Ctrl/Meta. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | not applicable | not applicable |
| T-zoom-line | Zoom · Yes | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-zoom-area | Zoom · Yes | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-zoom-bar | Zoom · On time, date and numeric x only | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable |
| T-zoom-donut | Zoom · No | not applicable | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable |
| T-zoom-scatter | Zoom · Yes, both axes later; x only in 1.0 | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable |
| I4 | Every interaction works by a single pointer and touch; controls measure at least 24×24 CSS px; one-finger drag scrolls the page. | cannot be verified here | cannot be verified here | cannot be verified here | cannot be verified here | cannot be verified here | not applicable |
| A7 | Data arriving does not speak; focus stays on the datum until it leaves the streaming window. | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| I6 | Append shows Pause/Resume; while paused, new rows are buffered and the view does not move. | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not applicable |
| I5 | No first-render animation; updates take at most 200 ms and reduced motion removes transitions. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| A8 | axe-core reports no violations on any fixture in any state, including heading-order and scrollable-region-focusable. | not run | not run | weak | not run | not run | weak |
| A10 | Every built-in string can be replaced; built-in English is marked lang="en" on non-English pages. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| A9 | A published WCAG 2.2 AA conformance table lists each applicable criterion, its test, author obligations and limits. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| F9 | Up to eight series have distinct colors; above eight each keeps a distinct cue and AX130 is raised. | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not applicable | weak (node-acceptance.json pass) |
| T-limit-line | Limit that raises a diagnostic · Eight series | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-limit-area | Limit that raises a diagnostic · Eight series | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-limit-bar | Limit that raises a diagnostic · Eight series | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable |
| T-limit-donut | Limit that raises a diagnostic · Eight slices | not applicable | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable |
| T-limit-scatter | Limit that raises a diagnostic · Eight series | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable |
| L6 | Title, subtitle and labelled axes with units belong to the chart; reference labels sit by their marks and axis titles stay clear of ticks. | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not run (node-acceptance.json pass) | not applicable |
| T-reference-line | Reference lines and bands · Yes; included in the domain; listed in the summary and table caption | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-reference-area | Reference lines and bands · Yes | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-reference-bar | Reference lines and bands · Yes | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable | not applicable |
| T-reference-donut | Reference lines and bands · No | not applicable | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable |
| T-reference-scatter | Reference lines and bands · Yes | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) | not applicable | not applicable |
| L5 | Point markers appear only when adjacent points are at least 12 px apart and always for isolated points. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | not applicable | not applicable | not applicable | not applicable |
| C1 | A compact chart is an image with a full text alternative, no tab stop and no pointer-only behavior. | not applicable | not applicable | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) |
| C2 | Compact keeps the fidelity rules for baseline, gaps, diagnostics, simplification, sorting, motion and page scheme. | not applicable | not applicable | not applicable | not applicable | not applicable | weak (node-acceptance.json pass) |
| C3 | Compact fills its container from 24×16 CSS px and is 32 px tall without a definite height. | not applicable | not applicable | not applicable | not applicable | not applicable | not run |
| C5 | When values are left out, the compact description says so and a corner marker has a text equivalent. | not applicable | not applicable | not applicable | not applicable | not applicable | not run (node-acceptance.json pass) |
| DX1 | The first chart takes ten lines or fewer via npm, script tag or React, using only data and fields. | not run | weak | weak | weak | weak | weak |
| DX2 | Long rows, wide rows and typed columns produce the same normalized data and diagnostics with caller row indexes. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | pass (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| DX3 | Invalid typed calls fail to compile; their untyped equivalents raise AX101, AX106 or AX150. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| DX4 | Diagnostics have stable codes, chart names, field and row indexes where appropriate, fixes and a documentation page per code. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| DX5 | Update, append and zoom apply in order; validation is synchronous, one frame changes all visible state, and destroy cancels work. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| DX6 | CSS custom properties style charts; font and color are inherited, and a series name pins its color across charts. | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| DX7 | Zero runtime dependencies and provisional minified+gzipped size targets, CSS included. | fail (size-latest.json fail) | fail (size-latest.json fail) | fail (size-latest.json fail) | fail (size-latest.json fail) | fail (size-latest.json fail) | fail (size-latest.json fail) |
| DX8 | Works without a DOM at import, in React StrictMode and under strict CSP, inserts text safely, and names unmatched selectors. | not run (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) | weak (node-acceptance.json pass) |
| DX9 | Follow semantic versioning and the deprecation policy; previous documented examples still compile and run. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| DX10 | Every runnable documentation example is compiled and rendered in CI from the packed distribution. | weak | weak | weak | weak | weak | weak |
| DX11 | Everything is MIT licensed, with third-party notices verified at release. | not run | not run | not run | not run | not run | not run |
| DX12 | A coding agent uses published docs to make a first chart that passes reader criteria on trap fixtures. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| P1 | Trend (3×120) first render · median main-thread task time of 20 runs. | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| P2 | One typed-column series of 100,000 and 1,000,000 points · median first-render main-thread task time. | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| P3 | Append at 60 Hz in a 600-point window · median task time per update and frames later than 25 ms. | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| P4 | Pointer across a 100,000-point chart · p95 input to the matching readout frame. | not run | not run | not run | not run | not applicable | not applicable |
| P5 | Create 24 trend charts · median total main-thread task time. | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| P6 | Download · exact minified and gzipped bytes, CSS included. | not run | not run | not run | not run | not run | not run |
| P7 | Measure owned bytes beyond one million caller points and heap trends over 1,000 create–destroy cycles after collection. | not run | not run | not run | not run | not run | not run |
| P8 | Create 40 compact charts · median total main-thread task time. | not applicable | not applicable | not applicable | not applicable | not applicable | not run |

## Coverage gaps in reader priority order

- **L1** · Weak · line, area, bar, scatter, donut · Browser checks use fixed fixtures. Generated labels, late fonts and any historical text-zoom failures require a current browser run.
- **F2** · Weak · compact · Model checks all three variants. Rendered gap checks exercise line and area, leaving the compact bar’s missing-versus-zero mark unchecked.
- **F3** · Weak · line, area, bar, scatter, donut · The model asserts diagnostic delivery, effects and drawn output for its cases. The registry still lacks a complete code-by-type check of level and reader outcome, including late diagnostics across types.
  - Weak · compact · Applicable Node registry fixtures run in compact line, area and bar. Painted contrast, DOM outcomes, and code-by-type coverage in every build still need browser evidence.
- **F10** · Fail · area, bar
  - Weak · area, bar · Per-cell signs, zero and missing values exercise both sides and the axis bounds. The reader model currently yields only the algebraic total for the mixed-sign fixture.
  - Weak · compact · Node checks both sides and missing height for both compact variants. The incomplete summary has no current rendered accessibility-tree check.
- **F8** · Fail · donut
  - Weak · donut · The zero/null limit fixture checks whether every input slice counts. The current implementation counts only slices with arcs.
- **F5** · Weak · line · Node proves simplification on both device-pixel ratios and several zooms, including a dropped sample accessible by keyboard and table. Browser evidence for the current tree is pending.
  - Weak · area · Node checks simplified cumulative boundaries, gaps on the component stroke and keyboard/table access to a dropped area sample. The cited browser test uses an unstacked outlier fixture.
  - Weak · compact · Node checks simplified line and cumulative area geometry at two device-pixel ratios. Dense compact rendering in a browser is unverified.
- **T-dense-line** · Weak · line · Node proves simplification on both device-pixel ratios and several zooms, including a dropped sample accessible by keyboard and table. Browser evidence for the current tree is pending.
- **T-dense-area** · Weak · area · Node checks simplified cumulative boundaries, gaps on the component stroke and keyboard/table access to a dropped area sample. The cited browser test uses an unstacked outlier fixture.
- **F7** · Fail · line, area, bar, scatter
  - Weak · line, area, bar, scatter · Both automatic ends are compared with the first enclosing drawn ticks, including small declared percent and ratio maxima. Zoom is modeled in Node.
  - Weak · compact · All compact variants check data/reference extent and exact 4% or 0.04 bounds. Compact has no drawn ticks or zoom.
- **F6** · Weak · line, area, bar, scatter, donut, compact · Localized model strings, independent tick formatting where applicable and formatter fallback are checked. No browser test establishes locale selection from the page and the localized output across the reader surfaces.
- **A3** · Weak · line, area, bar, scatter, donut · Chrome can verify the focused accessibility-tree name and live-region text after each key. Current evidence checks DOM state and modeled readout text.
- **A4** · Weak · line · The browser checks one neighboring chart, leaving the 24-chart layout workload unverified.
  - Weak · area, bar, scatter, donut · Browser pagination and jump reach row 229. The 24-chart layout and million-row jump workload are unverified for this type.
- **A5** · Weak · bar · Separation and the palette are checked. The default two-series fixture does not establish a series-specific cue beyond color and separation.
  - Weak · donut · Slice separation and the palette are checked. No assertion identifies each slice without color by mapping it to its text.
  - Weak · compact · Rendered palette and dash checks use compact line. Compact bar fails the non-color cue check recorded under C4.
- **L2** · Weak · line, area, bar, scatter, donut · Light and dark computed colors, font sizes and focus contrast are sampled. Text painted inside marks and its actual pixel background are unverified.
  - Weak · compact · The fixture has no visible chart text, axes or focus. Its computed mark colors are checked against the resolved background, without a rendered-pixel contrast check.
- **L8** · Weak · line, area, bar, scatter, donut · The Node model varies width, container height and caption height. A browser must establish the one-line summary and controls in the resulting figure.
- **L3** · Weak · line, area, bar, scatter, donut · Width changes, automatic height and a hidden start are checked. The chart height response to an independent resize and the title/control/table flow are unverified.
- **L4** · Weak · line, area, bar, scatter, donut, compact · The DOM exercises one body class toggle (sampled after two frame callbacks) and initial forced-colors. It does not prove the one-frame bound for runtime media, html/body inline style and data-theme changes.
- **I1** · Weak · line, area, bar, scatter · Placement, pointer input and Escape pass sampled checks. The suites do not measure p95 input-to-readout latency or verify hover persistence along a pointer path.
  - Weak · donut · Placement and Escape are sampled. The donut has no forced narrow readout test or p95 input-to-readout measurement.
- **I2** · Pending · donut · Donut has a legend under F8 and the toggle rule does not exempt slices. Click, Enter, Space and the pressed state need a donut legend test.
- **I3** · Weak · line, area, bar, scatter · The four mechanisms are exercised. The click sequence never activates Zoom out, and the wheel guard checks Ctrl only.
- **A7** · Weak · donut · The browser checks live-region quiet and focus identity. The focused accessible name/value stability case excludes donut.
  - Weak · compact · A quiet append is verified in all three Node variants. Browser live-region and 24-chart checks are pending. The point-focus requirement applies where the chart has point navigation.
- **I5** · Weak · line, area, bar, scatter, donut · The current browser tests check first render, reduced motion and a 24-chart filter against the 200 ms budget. Current browser results are pending.
  - Weak · compact · Current browser citations cover first render and the 200 ms update case in the tested compact fixture. A 24-chart compact filter run is unverified.
- **A8** · Weak · bar · Checks axe across the listed states for categorical bars. The continuous-axis bar’s zoomed state is outside these fixtures.
  - Weak · compact · The axe fixtures exercise compact line. Compact area and bar are unverified across the same states.
- **A10** · Weak · line, area, bar, scatter, donut, compact · The tests supply every known override but scan only selected English strings and surfaces in the tested states. Per-message coverage, including unvisited controls and states, is incomplete.
- **A9** · No evidence · line, area, bar, scatter, donut, compact · A published WCAG 2.2 AA conformance table lists each applicable criterion, its test, author obligations and limits.
- **F9** · Weak · compact · Rendered eight-color checks use compact line only, and the twelve-series case checks model bindings rather than distinct rendered combinations in every compact variant.
- **L5** · Weak · line, area · Dense, sparse and isolated examples are checked. They do not straddle the provisional 12 px cutoff.
- **C2** · Weak · compact · Baseline, sorted geometry, dirty data and static behavior are covered. Dense rendered compact strokes, compact bar gap styling and live scheme transitions for all three variants remain open.
- **DX1** · Weak · area, bar, scatter, donut, compact · Only the line has documented first-chart snippets proven in all three packed installation modes.
- **DX2** · Weak · line, area, bar, scatter, compact · The fixture compares one logical series and one bad row. Multiple-series layouts and diagnostics whose caller indexes differ by form remain unchecked.
- **DX3** · Weak · area, bar, scatter, donut, compact · Packed type fixtures check specific counterexamples for selected types. The full set of applicable typed and untyped counterparts is unverified for this type.
  - Weak · line · Packed fixtures check bad line fields, wide y with series and an inapplicable option. The typed text-value failure is exercised on bar, rather than along with the line runtime case.
- **DX4** · Weak · line, area, bar, scatter, donut, compact · Runtime diagnostics are sampled, with registry cases under F3. A documentation page and verified link for every code are still missing.
- **DX5** · Weak · line, area, bar, scatter, donut, compact · Sequences and cancellation are checked. Heap retention over 1,000 create–destroy cycles remains unmeasured under P7.
- **DX6** · Weak · line, area, bar, scatter, donut, compact · The model checks named colors against a changing series set. No 24-tile test establishes cross-chart color stability together with inherited font and color and documented CSS font and spacing overrides.
- **DX7** · Fail · line, area, bar, scatter, donut, compact
- **DX8** · Weak · area, bar, scatter, donut, compact · Packed CSP pages draw these charts and Node runs without DOM globals. React StrictMode replay and hydration are exercised only on Line.
- **DX9** · No evidence · line, area, bar, scatter, donut, compact · Follow semantic versioning and the deprecation policy; previous documented examples still compile and run.
- **DX10** · Weak · line · The three first-chart examples compile or run as applicable. The rest of the runnable documentation has no corresponding CI build and render.
  - Weak · area, bar, scatter, donut, compact · Packed consumer fixtures compile calls, without a CI build and render of the runnable documentation examples.
- **DX12** · No evidence · line, area, bar, scatter, donut, compact · A coding agent uses published docs to make a first chart that passes reader criteria on trap fixtures.
- **P1** · Pending · line · No valid acceptance measurement. Earlier first-chart comparisons were exploratory.
- **P2** · Pending · line · No valid acceptance measurement at both point counts. See decision 0002 for limits of the comparisons.
- **P3** · Pending · line · No valid acceptance measurement of the specified task and presented-frame pacing workload.
- **P4** · Pending · line, area, bar, scatter · No valid measurement of p95 input-to-matching-frame latency.
- **P5** · Pending · line · No valid acceptance measurement. The earlier 24-chart run showed fallback text and drew no marks.
- **P6** · Pending · line, area, bar, scatter, donut, compact · No valid P6 budget run is recorded. The available packed size measurement and target verdict are under DX7.
- **P7** · Pending · line, area, bar, scatter, donut, compact · No valid owned-bytes and 1,000-cycle heap measurement. The earlier dashboard memory run was voided.
- **P8** · Pending · compact · No valid 40-tile main-thread measurement.

## What cannot be verified here

- **A3** · line, area, bar, scatter, donut · Record the screen-reader rehearsal on NVDA with Chrome and Firefox, VoiceOver with macOS Safari and iOS, and TalkBack with Chrome, including touch gesture reachability.
- **A6** · line, area, bar, scatter, donut · Chrome checks 320 CSS px and text-spacing overrides. Firefox and Safari results are absent, and the Chrome fixture uses a narrow viewport rather than actual 400% browser zoom.
- **I4** · line, area, bar, scatter, donut · Chrome touch emulation provides tap, scroll and target-size evidence. Real phones are needed for native touch behavior.
- **GPU** · Hardware rasterization needs a headed, GPU-backed run. Archived headless Chrome renderer comparisons cannot establish GPU performance. [docs/decisions/0002-mark-renderer.md](../docs/decisions/0002-mark-renderer.md)

## Evidence that exists but was not run for this report

These files have citations with missing or skipped assertions in the supplied results.

- L1/line, L1/area, L1/bar, L1/scatter, L1/donut, F3/line, F3/area, F3/bar, F3/scatter, F3/donut, L2/line, L2/area, L2/bar, L2/scatter, L2/donut, L2/compact, L7/line, L7/area, L7/bar, L7/scatter, L7/donut, L7/compact, L8/line, L8/area, L8/bar, L8/scatter, L8/donut, L3/line, L3/area, L3/bar, L3/scatter, L3/donut, L4/line, L4/area, L4/bar, L4/scatter, L4/donut, L4/compact, L6/line, L6/area, L6/bar, L6/scatter, L6/donut, L5/line, L5/area, C2/compact · [packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts](../packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts)
- L1/line · [packages/axylo/test/browser/render/review.browser.test.ts](../packages/axylo/test/browser/render/review.browser.test.ts)
- C4/compact, F1/compact, F11/compact, C1/compact, C2/compact, C3/compact, C5/compact · [packages/axylo/test/browser/acceptance/compact.browser.test.ts](../packages/axylo/test/browser/acceptance/compact.browser.test.ts)
- F1/area, F1/bar · [packages/axylo/test/scale/domain.test.ts](../packages/axylo/test/scale/domain.test.ts)
- F1/area, F1/bar, T-zoom-scatter/scatter, T-limit-line/line, T-limit-donut/donut, T-reference-line/line · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts)
- F1/area, F1/bar, T-reference-line/line, T-reference-bar/bar · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts)
- F2/line, F2/area, F2/bar, F2/scatter, F2/donut, F2/compact, C2/compact · [packages/axylo/test/browser/acceptance/f2-gaps.browser.test.ts](../packages/axylo/test/browser/acceptance/f2-gaps.browser.test.ts)
- F3/line, F3/area, F3/bar, F3/scatter, F3/donut, F3/compact, A5/line, A5/area, A5/bar, A5/scatter, A5/donut, A5/compact, F9/line, F9/area, F9/bar, F9/scatter · [packages/axylo/test/browser/acceptance/a5-not-colour-alone.browser.test.ts](../packages/axylo/test/browser/acceptance/a5-not-colour-alone.browser.test.ts)
- F3/line, F3/area, F3/bar, F3/scatter, F3/donut, F3/compact, DX8/line, DX8/area, DX8/bar, DX8/scatter, DX8/donut, DX8/compact · [tests/dist/node.test.ts](../tests/dist/node.test.ts)
- F12/line, F12/area, F12/bar, F12/scatter, F12/donut · [packages/axylo/test/browser/acceptance/f12-note.browser.test.ts](../packages/axylo/test/browser/acceptance/f12-note.browser.test.ts)
- F8/donut · [packages/axylo/test/browser/acceptance/f8-donut.browser.test.ts](../packages/axylo/test/browser/acceptance/f8-donut.browser.test.ts)
- F4/line, F4/area, F4/bar, F4/scatter, F4/compact, A1/line, A1/area, A1/bar, A1/scatter, A1/donut, A1/compact, C1/compact · [packages/axylo/test/browser/acceptance/a1-names.browser.test.ts](../packages/axylo/test/browser/acceptance/a1-names.browser.test.ts)
- F5/line, F5/area, T-dense-line/line, T-dense-area/area, T-dense-bar/bar, T-dense-donut/donut, T-dense-scatter/scatter, T-keyboard-line/line, T-keyboard-area/area, T-keyboard-bar/bar, T-keyboard-donut/donut, T-keyboard-scatter/scatter, T-pointer-line/line, T-pointer-area/area, T-pointer-bar/bar, T-pointer-donut/donut, T-pointer-scatter/scatter, T-tooltip-line/line, T-tooltip-area/area, T-tooltip-bar/bar, T-tooltip-donut/donut, T-tooltip-scatter/scatter, T-zoom-line/line, T-zoom-area/area, T-zoom-bar/bar, T-zoom-donut/donut, T-zoom-scatter/scatter, F9/line, F9/area, F9/bar, F9/scatter, T-limit-line/line, T-limit-area/area, T-limit-bar/bar, T-limit-donut/donut, T-limit-scatter/scatter, L6/line, L6/area, L6/bar, L6/scatter, T-reference-line/line, T-reference-area/area, T-reference-bar/bar, T-reference-donut/donut, T-reference-scatter/scatter · [packages/axylo/test/browser/acceptance/type-matrix.browser.test.ts](../packages/axylo/test/browser/acceptance/type-matrix.browser.test.ts)
- A3/line, A3/area, A3/bar, A3/scatter, A3/donut, A2/line, A2/area, A2/bar, A2/scatter, A2/donut · [packages/axylo/test/browser/acceptance/a2-keyboard.browser.test.ts](../packages/axylo/test/browser/acceptance/a2-keyboard.browser.test.ts)
- T-keyboard-line/line, T-pointer-line/line, T-tooltip-line/line · [packages/axylo/test/lookup/aligned.test.ts](../packages/axylo/test/lookup/aligned.test.ts)
- T-keyboard-line/line · [packages/axylo/test/browser/a11y/keyboard.browser.test.ts](../packages/axylo/test/browser/a11y/keyboard.browser.test.ts)
- A4/line, I2/line, T-zoom-line/line, I6/line, L6/bar, T-reference-bar/bar · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts)
- A4/line, A4/area, A4/bar, A4/scatter, A4/donut · [packages/axylo/test/browser/acceptance/a4-table.browser.test.ts](../packages/axylo/test/browser/acceptance/a4-table.browser.test.ts)
- L7/line · [packages/axylo/test/browser/chart/data.browser.test.ts](../packages/axylo/test/browser/chart/data.browser.test.ts)
- L3/line, P7/line · [packages/axylo/test/browser/chart/lifecycle.browser.test.ts](../packages/axylo/test/browser/chart/lifecycle.browser.test.ts)
- A6/line, A6/area, A6/bar, A6/scatter, A6/donut, A7/line, A7/area, A7/bar, A7/scatter, A7/donut, A8/line, A8/area, A8/bar, A8/scatter, A8/donut, A8/compact, A10/line, A10/area, A10/bar, A10/scatter, A10/donut, A10/compact · [packages/axylo/test/browser/acceptance/a6-a10.browser.test.ts](../packages/axylo/test/browser/acceptance/a6-a10.browser.test.ts)
- I1/line, I1/area, I1/bar, I1/scatter, I1/donut, I2/line, I2/area, I2/bar, I2/scatter, I3/line, I3/area, I3/bar, I3/scatter, I4/line, I4/area, I4/bar, I4/scatter, I4/donut, I6/line, I6/area, I6/bar, I6/scatter, I6/donut, I5/line, I5/area, I5/bar, I5/scatter, I5/donut, I5/compact, C2/compact · [packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts](../packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts)
- T-pointer-donut/donut, T-tooltip-donut/donut · [packages/axylo/test/lookup/donut.test.ts](../packages/axylo/test/lookup/donut.test.ts)
- T-pointer-scatter/scatter, T-tooltip-scatter/scatter · [packages/axylo/test/lookup/scatter.test.ts](../packages/axylo/test/lookup/scatter.test.ts)
- T-zoom-area/area, T-reference-line/line · [packages/axylo/test/view/review.test.ts](../packages/axylo/test/view/review.test.ts)
- A8/line, A8/area, A8/bar, A8/scatter, A8/donut · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts)
- T-limit-line/line · [packages/axylo/test/core/controller.test.ts](../packages/axylo/test/core/controller.test.ts)
- C1/compact, C5/compact · [packages/axylo/test/browser/chart/render.browser.test.ts](../packages/axylo/test/browser/chart/render.browser.test.ts)
- DX1/line, DX1/area, DX1/bar, DX1/scatter, DX1/donut, DX1/compact, DX10/line · [tests/dist/snippets.test.ts](../tests/dist/snippets.test.ts)
- DX1/line, DX8/line, DX8/area, DX8/bar, DX8/scatter, DX8/donut, DX8/compact, DX10/line · [tests/dist/first-chart.browser.test.ts](../tests/dist/first-chart.browser.test.ts)
- DX1/area, DX1/bar, DX1/scatter, DX1/donut, DX5/line, DX5/area, DX5/bar, DX5/scatter, DX5/donut, DX8/line · [packages/react/test/browser/react.browser.test.ts](../packages/react/test/browser/react.browser.test.ts)
- DX1/area, DX1/bar, DX1/scatter, DX1/donut, DX1/compact, DX8/line, DX8/area, DX8/bar, DX8/scatter, DX8/donut, DX8/compact · [tests/dist/csp.browser.test.ts](../tests/dist/csp.browser.test.ts)
- DX3/line, DX3/area, DX3/bar, DX3/scatter, DX3/donut, DX3/compact, DX10/area, DX10/bar, DX10/scatter, DX10/donut, DX10/compact · [tests/dist/types.test.ts](../tests/dist/types.test.ts)
- DX3/line, DX3/area, DX3/bar, DX3/scatter, DX3/donut, DX3/compact, DX7/line, DX8/line, DX8/area, DX8/bar, DX8/scatter, DX8/donut, DX8/compact · [packages/react/test/dist.test.ts](../packages/react/test/dist.test.ts)
- DX4/line · [tests/dist/flavours.browser.test.ts](../tests/dist/flavours.browser.test.ts)
- DX5/line, DX5/area, DX5/bar, DX5/scatter, DX5/donut, DX5/compact · [packages/react/test/patch.test.ts](../packages/react/test/patch.test.ts)
- DX6/line · [packages/axylo/test/browser/render/pending-css.browser.test.ts](../packages/axylo/test/browser/render/pending-css.browser.test.ts)
- DX7/line, DX7/area, DX7/bar, DX7/scatter, DX7/donut, DX7/compact, DX11/line, DX11/area, DX11/bar, DX11/scatter, DX11/donut, DX11/compact · [tests/dist/licence.test.ts](../tests/dist/licence.test.ts)

