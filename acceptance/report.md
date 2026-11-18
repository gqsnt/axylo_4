# Acceptance report

## Supplied Vitest runs

Suite counts include assertions outside the matrix. Each cell lists the reports with matching assertions, including partial evidence in weak cells.

- `acceptance/results/unit.json` · 1216 passed assertions, 1 reported failures, 12 skipped or pending
  - `packages/react/test/dist.test.ts` · Suite failed without a failing assertion result (spawnSync node EPERM)
- `acceptance/results/browser.json` · 729 passed assertions, 5 reported failures, 1 skipped or pending
  - `packages/axylo/test/browser/acceptance/compact.browser.test.ts` · C4 compact bar: two series differ by more than colour, and AX131 suggests one series per compact chart
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L1 line: at widths 240, 320, 480, 720, 1280, 1920 px (200 % text-only zoom) no text overlaps other text (1 px), none is outside the figure, tick labels are pairwise distinct, and no category label is hidden without the note
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L1 area: at widths 240, 320, 480, 720, 1280, 1920 px (200 % text-only zoom) no text overlaps other text (1 px), none is outside the figure, tick labels are pairwise distinct, and no category label is hidden without the note
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L1 scatter: at widths 240, 320, 480, 720, 1280, 1920 px (200 % text-only zoom) no text overlaps other text (1 px), none is outside the figure, tick labels are pairwise distinct, and no category label is hidden without the note
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L1 donut: at widths 240, 320, 480, 720, 1280, 1920 px (200 % text-only zoom) no text overlaps other text (1 px), none is outside the figure, tick labels are pairwise distinct, and no category label is hidden without the note
- `acceptance/results/dist.json` · 83 passed assertions, 0 reported failures
- `acceptance/results/dist-browser.json` · 18 passed assertions, 0 reported failures

## Packed size measurement

- line only (examples/first-chart/npm.ts) · 282,947 minified JS bytes, 97.61 KiB gzipped, 25 KiB target · [bench/size-latest.json](../bench/size-latest.json)
- everything (export * from axylo) · 283,389 minified JS bytes, 97.75 KiB gzipped, 40 KiB target · [bench/size-latest.json](../bench/size-latest.json)
- script tag (axylo.iife.min.js + axylo.css) · 283,869 minified JS bytes, 101.83 KiB gzipped · [bench/size-latest.json](../bench/size-latest.json)
- React adapter alone (react, axylo external) · 2,375 minified JS bytes, 1.17 KiB gzipped, 2 KiB target · [bench/size-latest.json](../bench/size-latest.json)


## Status by chart type

- pass · 117
- fail · 11
- weak · 128
- no evidence · 18
- not run · 21
- cannot be verified here · 15
- not applicable · 266

The matrix contains individual test citations and applicability reasons. [acceptance/matrix.json](matrix.json)

| Criterion | Statement | line | area | bar | scatter | donut | compact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L1 | Text does not overlap or clip; a visible note appears if labels still do not fit. | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | weak (unit.json pass, browser.json pass) | fail (unit.json pass, browser.json fail/pass) | fail (browser.json fail/pass) | not applicable |
| C4 | Multiple compact lines differ by dash as well as color; AX131 suggests one series per compact chart. | not applicable | not applicable | not applicable | not applicable | not applicable | fail (unit.json pass, browser.json fail/pass) |
| F1 | Bar and area value axes always include zero; a domain that excludes zero is widened and raises AX110. | not applicable | pass (unit.json pass) | pass (unit.json pass) | not applicable | not applicable | pass (unit.json pass, browser.json pass) |
| F2 | Missing values are never drawn as zero and never bridged unless the author asks; readouts say “No data”. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) |
| F3 | Input that cannot be plotted as given is reported, never guessed. | weak (unit.json pass, browser.json pass, dist.json pass) | weak (unit.json pass, browser.json pass, dist.json pass) | weak (unit.json pass, browser.json pass, dist.json pass) | weak (unit.json pass, browser.json pass, dist.json pass) | weak (unit.json pass, browser.json pass, dist.json pass) | weak (unit.json pass, browser.json pass, dist.json pass) |
| F12 | When warnings mean values were left out or changed, a note appears inside the figure and in the accessibility tree, in every build. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable |
| F10 | Stacks place positive and negative values on their own sides of zero; missing components mark the stack incomplete. | not applicable | weak (unit.json pass) | weak (unit.json pass) | not applicable | not applicable | weak (unit.json pass) |
| F8 | Donut slices keep order, start at 12 o’clock and run clockwise; nulls, zeros, negatives and excess slices have distinct outcomes. | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| F4 | Calendar dates read the same in every zone; instants name their zone; wall-clock times are shown as written. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable | pass (unit.json pass, browser.json pass) |
| F11 | Line, area and scatter draw in x order; duplicate x disables an aligned series, while scatter keeps coincident points. | pass (unit.json pass) | pass (unit.json pass) | pass (unit.json pass) | pass (unit.json pass) | not applicable | pass (unit.json pass, browser.json pass) |
| F5 | Dense drawing preserves the exact per-pixel extrema of each valid run and keeps every break. | pass (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | weak (unit.json pass) |
| T-dense-line | Simplified drawing when dense · F5 | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-dense-area | Simplified drawing when dense · F5 on cumulative sums | not applicable | weak (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-dense-bar | Simplified drawing when dense · No; more bars than pixels raises a hint | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-dense-donut | Simplified drawing when dense · No | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| T-dense-scatter | Simplified drawing when dense · No in 1.0; above 50,000 points a hint says drawing may be slow | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| F7 | The zoomed view stays inside the author or automatic domain; the automatic domain contains data, references and stack totals. | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | not applicable | weak (unit.json pass) |
| F6 | Format numbers and dates for the page locale, separately for ticks and readouts; a throwing formatter falls back with a diagnostic. | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) |
| A3 | The focused point conveys its text; touch screen readers can swipe to every point or reach the table in two gestures. | cannot be verified here (unit.json pass, browser.json pass) | cannot be verified here (unit.json pass, browser.json pass) | cannot be verified here (unit.json pass, browser.json pass) | cannot be verified here (unit.json pass, browser.json pass) | cannot be verified here (unit.json pass, browser.json pass) | not applicable |
| A1 | Every chart has an accessible name and generated summary, and chart element ids are unique. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) |
| A2 | At most two tab stops with the table closed; every point is reachable, the toolbar roves, and focus can leave the chart. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable |
| T-keyboard-line | Keyboard order · By x, then series | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-keyboard-area | Keyboard order · By x, then series | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-keyboard-bar | Keyboard order · By category, then series | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-keyboard-donut | Keyboard order · By slice order | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| T-keyboard-scatter | Keyboard order · By x, then y | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| A4 | View as table opens a normalized HTML table in the current range, with pagination or x jump, in a focusable scroll region. | weak (browser.json pass, unit.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | not applicable |
| A5 | Series are never distinguished by color alone; filled marks have separators and the palette meets contrast and distance thresholds. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) |
| L2 | Text is at least 12 CSS px and 4.5:1; marks, axis lines and focus indicators are at least 3:1 in light and dark. | weak (browser.json pass) | weak (browser.json pass) | weak (browser.json pass) | weak (browser.json pass) | weak (browser.json pass) | weak (browser.json pass) |
| L7 | Empty, loading, error and internal failures show a message in the plot; a change is announced once, politely. | pass (browser.json pass, unit.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) |
| L8 | Below a readable plot size of 120×80 CSS px, show the title, summary and table control and raise AX142. | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | not applicable |
| L3 | The chart follows its container; automatic height is 16:9 clamped to 160–480 CSS px; initially hidden charts draw when sized. | weak (browser.json pass, unit.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | not applicable |
| L4 | The chart follows the page color scheme; changes repaint within one frame and forced colors use system colors. | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) |
| A6 | Reflow at 320 CSS px and 400% zoom without two-dimensional scrolling; user text spacing does not clip. | cannot be verified here (browser.json pass) | cannot be verified here (browser.json pass) | cannot be verified here (browser.json pass) | cannot be verified here (browser.json pass) | cannot be verified here (browser.json pass) | not applicable |
| I1 | Pointing shows the correct readout within a frame at p95; it stays in view, avoids the mark and supports hover, fallback and Escape. | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | not applicable |
| T-pointer-line | Picking by pointer · Nearest x | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-pointer-area | Picking by pointer · Nearest x | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-pointer-bar | Picking by pointer · The band under the pointer | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-pointer-donut | Picking by pointer · The slice under the pointer | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| T-pointer-scatter | Picking by pointer · Nearest point within 24 px; ties go to the later row | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| T-tooltip-line | Tooltip content · Every visible series at that x | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-tooltip-area | Tooltip content · Every visible series at that x, plus the stack total | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-tooltip-bar | Tooltip content · Every series in that category | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-tooltip-donut | Tooltip content · Label, value, percentage | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| T-tooltip-scatter | Tooltip content · The point's series, x and y; coincident points listed, up to eight | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| I2 | Legend entries are pressed-state toggle buttons operable by click, Enter and Space. | pass (browser.json pass, unit.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| I3 | Zoom works by controls, drag, keyboard and opt-in pinch; the wheel respects focus and Ctrl/Meta. | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | not applicable | not applicable |
| T-zoom-line | Zoom · Yes | pass (browser.json pass, unit.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-zoom-area | Zoom · Yes | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-zoom-bar | Zoom · On time, date and numeric x only | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-zoom-donut | Zoom · No | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| T-zoom-scatter | Zoom · Yes, both axes later; x only in 1.0 | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| I4 | Every interaction works by a single pointer and touch; controls measure at least 24×24 CSS px; one-finger drag scrolls the page. | cannot be verified here (browser.json pass) | cannot be verified here (browser.json pass) | cannot be verified here (browser.json pass) | cannot be verified here (browser.json pass) | cannot be verified here (browser.json pass) | not applicable |
| A7 | Data arriving does not speak; focus stays on the datum until it leaves the streaming window. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | not applicable |
| I6 | Append shows Pause/Resume; while paused, new rows are buffered and the view does not move. | pass (browser.json pass, unit.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable |
| I5 | No first-render animation; updates take at most 200 ms and reduced motion removes transitions. | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) |
| A8 | axe-core reports no violations on any fixture in any state, including heading-order and scrollable-region-focusable. | pass (browser.json pass) | pass (browser.json pass) | weak (browser.json pass) | pass (browser.json pass) | pass (browser.json pass) | weak (browser.json pass) |
| A10 | Every built-in string can be replaced; built-in English is marked lang="en" on non-English pages. | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) |
| A9 | A published WCAG 2.2 AA conformance table lists each applicable criterion, its test, author obligations and limits. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| F9 | Up to eight series have distinct colors; above eight each keeps a distinct cue and AX130 is raised. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable | weak (unit.json pass) |
| T-limit-line | Limit that raises a diagnostic · Eight series | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-limit-area | Limit that raises a diagnostic · Eight series | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-limit-bar | Limit that raises a diagnostic · Eight series | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-limit-donut | Limit that raises a diagnostic · Eight slices | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| T-limit-scatter | Limit that raises a diagnostic · Eight series | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| L6 | Title, subtitle and labelled axes with units belong to the chart; reference labels sit by their marks and axis titles stay clear of ticks. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable |
| T-reference-line | Reference lines and bands · Yes; included in the domain; listed in the summary and table caption | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-reference-area | Reference lines and bands · Yes | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-reference-bar | Reference lines and bands · Yes | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-reference-donut | Reference lines and bands · No | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| T-reference-scatter | Reference lines and bands · Yes | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| L5 | Point markers appear only when adjacent points are at least 12 px apart and always for isolated points. | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| C1 | A compact chart is an image with a full text alternative, no tab stop and no pointer-only behavior. | not applicable | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) |
| C2 | Compact keeps the fidelity rules for baseline, gaps, diagnostics, simplification, sorting, motion and page scheme. | not applicable | not applicable | not applicable | not applicable | not applicable | weak (unit.json pass, browser.json pass) |
| C3 | Compact fills its container from 24×16 CSS px and is 32 px tall without a definite height. | not applicable | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) |
| C5 | When values are left out, the compact description says so and a corner marker has a text equivalent. | not applicable | not applicable | not applicable | not applicable | not applicable | pass (browser.json pass, unit.json pass) |
| DX1 | The first chart takes ten lines or fewer via npm, script tag or React, using only data and fields. | pass (dist.json pass, dist-browser.json pass) | weak (dist.json pass, browser.json pass, dist-browser.json pass) | weak (dist.json pass, browser.json pass, dist-browser.json pass) | weak (dist.json pass, browser.json pass, dist-browser.json pass) | weak (dist.json pass, browser.json pass, dist-browser.json pass) | weak (dist.json pass, dist-browser.json pass) |
| DX2 | Long rows, wide rows and typed columns produce the same normalized data and diagnostics with caller row indexes. | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | pass (unit.json pass) | weak (unit.json pass) |
| DX3 | Invalid typed calls fail to compile; their untyped equivalents raise AX101, AX106 or AX150. | weak (unit.json pass/skipped, dist.json pass) | weak (unit.json pass/skipped, dist.json pass) | weak (unit.json pass/skipped, dist.json pass) | weak (unit.json pass/skipped, dist.json pass) | weak (unit.json pass/skipped, dist.json pass) | weak (unit.json pass/skipped, dist.json pass) |
| DX4 | Diagnostics have stable codes, chart names, field and row indexes where appropriate, fixes and a documentation page per code. | weak (unit.json pass, dist-browser.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) |
| DX5 | Update, append and zoom apply in order; validation is synchronous, one frame changes all visible state, and destroy cancels work. | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass) |
| DX6 | CSS custom properties style charts; font and color are inherited, and a series name pins its color across charts. | weak (unit.json pass, browser.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) |
| DX7 | Zero runtime dependencies and provisional minified+gzipped size targets, CSS included. | fail (dist.json pass, size-latest.json fail, unit.json skipped) | fail (dist.json pass, size-latest.json fail) | fail (dist.json pass, size-latest.json fail) | fail (dist.json pass, size-latest.json fail) | fail (dist.json pass, size-latest.json fail) | fail (dist.json pass, size-latest.json fail) |
| DX8 | Works without a DOM at import, in React StrictMode and under strict CSP, inserts text safely, and names unmatched selectors. | pass (unit.json pass/skipped, dist-browser.json pass, dist.json pass, browser.json pass) | weak (unit.json pass/skipped, dist-browser.json pass, dist.json pass) | weak (unit.json pass/skipped, dist-browser.json pass, dist.json pass) | weak (unit.json pass/skipped, dist-browser.json pass, dist.json pass) | weak (unit.json pass/skipped, dist-browser.json pass, dist.json pass) | weak (unit.json pass/skipped, dist-browser.json pass, dist.json pass) |
| DX9 | Follow semantic versioning and the deprecation policy; previous documented examples still compile and run. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| DX10 | Every runnable documentation example is compiled and rendered in CI from the packed distribution. | weak (dist.json pass, dist-browser.json pass) | weak (dist.json pass) | weak (dist.json pass) | weak (dist.json pass) | weak (dist.json pass) | weak (dist.json pass) |
| DX11 | Everything is MIT licensed, with third-party notices verified at release. | pass (dist.json pass) | pass (dist.json pass) | pass (dist.json pass) | pass (dist.json pass) | pass (dist.json pass) | pass (dist.json pass) |
| DX12 | A coding agent uses published docs to make a first chart that passes reader criteria on trap fixtures. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| P1 | Trend (3×120) first render · median main-thread task time of 20 runs. | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| P2 | One typed-column series of 100,000 and 1,000,000 points · median first-render main-thread task time. | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| P3 | Append at 60 Hz in a 600-point window · median task time per update and frames later than 25 ms. | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| P4 | Pointer across a 100,000-point chart · p95 input to the matching readout frame. | not run | not run | not run | not run | not applicable | not applicable |
| P5 | Create 24 trend charts · median total main-thread task time. | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| P6 | Download · exact minified and gzipped bytes, CSS included. | not run | not run | not run | not run | not run | not run |
| P7 | Measure owned bytes beyond one million caller points and heap trends over 1,000 create–destroy cycles after collection. | not run (browser.json pass) | not run | not run | not run | not run | not run |
| P8 | Create 40 compact charts · median total main-thread task time. | not applicable | not applicable | not applicable | not applicable | not applicable | not run |

## Coverage gaps in reader priority order

- **L1** · Fail · line, area, scatter, donut
  - Weak · line, area, scatter, donut · The 200% text-only case fails in Chrome. Node checks ordinary modeled plot labels where present. Generated labels and font-load layout remain unverified.
  - Weak · bar · Chrome checks fixed fixtures across widths, text spacing and 200% text. Generated labels through all remedies and a late-loading font with the same end-to-end geometry assertions remain unverified.
- **C4** · Fail · compact
- **F2** · Weak · compact · Model checks all three variants. Rendered gap checks exercise line and area, leaving the compact bar’s missing-versus-zero mark unchecked.
- **F3** · Weak · line, area, bar, scatter, donut · The model asserts diagnostic delivery, effects and drawn output for its cases. The registry still lacks a complete code-by-type check of level and reader outcome, including late diagnostics across types.
  - Weak · compact · Most registry cases exercise compact line. The suite lacks the same code, level and reader-outcome coverage for compact area and bar.
- **F10** · Weak · area, bar · The controller verifies mixed-sign geometry and exact incomplete values in reader models. Browser separator checks do not exercise an incomplete stack in the displayed tooltip, table or focused text.
  - Weak · compact · Mixed-sign and missing geometry are checked in the model for both variants. The summary includes incomplete, with no rendered accessibility-tree check for that case.
- **F5** · Weak · area · The model checks cumulative extrema and gaps and SVG reaches the outlier. Only line proves a discarded sample is still reachable by keyboard and table.
  - Weak · compact · Model extrema tests exercise compact line and stacked area at two DPRs. No dense compact fixture verifies the rendered result.
- **T-dense-area** · Weak · area · Cumulative extrema and the outlier are checked. No area test reads a discarded sample through the keyboard and table.
- **F7** · Weak · line, area, bar, scatter · The reference-driven value-domain check tests the positive end. It does not prove the first enclosing tick at both ends of all applicable domains.
  - Weak · compact · The compact case uses line, and the exact tick-boundary test only runs with full charts.
- **F6** · Weak · line, area, bar, scatter, donut, compact · Localized model strings, independent tick formatting where applicable and formatter fallback are checked. No browser test establishes locale selection from the page and the localized output across the reader surfaces.
- **A4** · Weak · line · The browser checks one neighboring chart, leaving the 24-chart layout workload unverified.
  - Weak · area, bar, scatter, donut · Browser pagination and jump reach row 229. The 24-chart layout and million-row jump workload are unverified for this type.
- **A5** · Weak · bar · Separation and the palette are checked. The default two-series fixture does not establish a series-specific cue beyond color and separation.
  - Weak · donut · Slice separation and the palette are checked. No assertion identifies each slice without color by mapping it to its text.
  - Weak · compact · Rendered palette and dash checks use compact line. Compact bar fails the non-color cue check recorded under C4.
- **L2** · Weak · line, area, bar, scatter, donut · Light and dark computed colors, font sizes and focus contrast are sampled. Text painted inside marks and its actual pixel background are unverified.
  - Weak · compact · The fixture has no visible chart text, axes or focus. Its computed mark colors are checked against the resolved background, without a rendered-pixel contrast check.
- **L8** · Weak · line, area, bar, scatter, donut · The model and Chrome check fallback content and AX142. The browser only checks summary visibility, leaving the one-line requirement unverified.
- **L3** · Weak · line, area, bar, scatter, donut · Width changes, automatic height and a hidden start are checked. The chart height response to an independent resize and the title/control/table flow are unverified.
- **L4** · Weak · line, area, bar, scatter, donut, compact · The DOM exercises one body class toggle (sampled after two frame callbacks) and initial forced-colors. It does not prove the one-frame bound for runtime media, html/body inline style and data-theme changes.
- **I1** · Weak · line, area, bar, scatter · Placement, pointer input and Escape pass sampled checks. The suites do not measure p95 input-to-readout latency or verify hover persistence along a pointer path.
  - Weak · donut · Placement and Escape are sampled. The donut has no forced narrow readout test or p95 input-to-readout measurement.
- **I3** · Weak · line, area, bar, scatter · The four mechanisms are exercised. The click sequence never activates Zoom out, and the wheel guard checks Ctrl only.
- **A7** · Weak · donut · The browser checks live-region quiet and focus identity. The focused accessible name/value stability case excludes donut.
- **I5** · Weak · line, area, bar, scatter, donut, compact · Chrome first-render and reduced-motion snapshots provide partial evidence. The update test allows 300 ms and there is no 24-chart filter run at the specified 200 ms.
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

- **A3** · line, area, bar, scatter, donut · The model checks identity, value and position. Chrome checks aria-valuetext after real key presses. A3 still needs focused accessibility-tree snapshots and rehearsals with NVDA/Chrome, NVDA/Firefox, VoiceOver/macOS Safari, VoiceOver/iOS and TalkBack/Chrome.
- **A6** · line, area, bar, scatter, donut · Chrome checks 320 CSS px and text-spacing overrides. Firefox and Safari results are absent, and the Chrome fixture uses a narrow viewport rather than actual 400% browser zoom.
- **I4** · line, area, bar, scatter, donut · Chrome touch emulation provides tap, scroll and target-size evidence. Real phones are needed for native touch behavior.
- **GPU** · Hardware rasterization needs a headed, GPU-backed run. Archived headless Chrome renderer comparisons cannot establish GPU performance. [docs/decisions/0002-mark-renderer.md](../docs/decisions/0002-mark-renderer.md)

## Evidence that exists but was not run for this report

These files have citations with missing or skipped assertions in the supplied results.

- DX3/line, DX3/area, DX3/bar, DX3/scatter, DX3/donut, DX3/compact, DX7/line, DX8/line, DX8/area, DX8/bar, DX8/scatter, DX8/donut, DX8/compact · [packages/react/test/dist.test.ts](../packages/react/test/dist.test.ts)

