# Acceptance report

## Supplied Vitest runs

Suite counts include assertions outside the matrix. Each cell lists the reports with matching assertions, including partial evidence in weak cells.

- `acceptance/results/browser.json` · 899 passed assertions, 37 reported failures, 1 skipped or pending
  - Provenance: commit d8b41505a7ce919276d532f11c6af3d90fdfb933, dirty true, tree SHA-256 83e5cdffe90381f4453f5fe7317eb54f2717bab95d5689709d33f93ec45bd4ef, result SHA-256 6fd46f33b8a4c66cb0084c0dbf5448b10029eceb58e3910a02d34d9c45c116a8, 55 cited test hashes in the sidecar · provenance does not match the working tree
  - `packages/axylo/test/browser/acceptance/a2-keyboard.browser.test.ts` · A2 line: at every datum the keyboard reaches, the focus indicators (the plot's outline and the ring around the datum) are painted at least 2 px wide and 3:1 against their painted backdrop, and the tooltip covers neither them nor the focused datum (reading: no part of either indicator is covered)
  - `packages/axylo/test/browser/acceptance/a2-keyboard.browser.test.ts` · A2 area: at every datum the keyboard reaches, the focus indicators (the plot's outline and the ring around the datum) are painted at least 2 px wide and 3:1 against their painted backdrop, and the tooltip covers neither them nor the focused datum (reading: no part of either indicator is covered)
  - `packages/axylo/test/browser/acceptance/a2-keyboard.browser.test.ts` · A2 bar: at every datum the keyboard reaches, the focus indicators (the plot's outline and the ring around the datum) are painted at least 2 px wide and 3:1 against their painted backdrop, and the tooltip covers neither them nor the focused datum (reading: no part of either indicator is covered)
  - `packages/axylo/test/browser/acceptance/a2-keyboard.browser.test.ts` · A2 scatter: at every datum the keyboard reaches, the focus indicators (the plot's outline and the ring around the datum) are painted at least 2 px wide and 3:1 against their painted backdrop, and the tooltip covers neither them nor the focused datum (reading: no part of either indicator is covered)
  - `packages/axylo/test/browser/acceptance/a2-keyboard.browser.test.ts` · A2 donut: at every datum the keyboard reaches, the focus indicators (the plot's outline and the ring around the datum) are painted at least 2 px wide and 3:1 against their painted backdrop, and the tooltip covers neither them nor the focused datum (reading: no part of either indicator is covered)
  - `packages/axylo/test/browser/acceptance/a6-a10.browser.test.ts` · A7 bar: with the plot focused, a sliding window keeps focus on its datum: the value text is not rewritten while the datum stays (decision 0004), the numeric position follows it, eviction moves focus to the next datum once, and the next key reads the current count
  - `packages/axylo/test/browser/acceptance/a6-a10.browser.test.ts` · A10 area: every built-in string that a area chart shows is replaced through messages: each applicable key's own sentinel reaches a reader surface, and no built-in English is left
  - `packages/axylo/test/browser/acceptance/a6-a10.browser.test.ts` · A10 bar: every built-in string that a bar chart shows is replaced through messages: each applicable key's own sentinel reaches a reader surface, and no built-in English is left
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I1 line: moving slowly from the datum straight onto the tooltip (across the reading axis, decision 0004) keeps the same datum on show all the way, and the pointer then rests on the tooltip; Escape closes it until another datum
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I1 line: neither the tooltip nor the readout ever covers a control, whether shown for the pointer or for the keyboard (decision 0004: the readout has reserved space)
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I1 area: moving slowly from the datum straight onto the tooltip (across the reading axis, decision 0004) keeps the same datum on show all the way, and the pointer then rests on the tooltip; Escape closes it until another datum
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I1 area: neither the tooltip nor the readout ever covers a control, whether shown for the pointer or for the keyboard (decision 0004: the readout has reserved space)
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I1 bar: at 20 positions, the four edges included, what is there is shown by the type's picking rule within one frame of the move (95th percentile, counted in animation frames), inside the viewport, without covering the active mark
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I1 bar: moving slowly from the datum straight onto the tooltip (across the reading axis, decision 0004) keeps the same datum on show all the way, and the pointer then rests on the tooltip; Escape closes it until another datum
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I1 bar: neither the tooltip nor the readout ever covers a control, whether shown for the pointer or for the keyboard (decision 0004: the readout has reserved space)
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I1 scatter: moving slowly from the datum straight onto the tooltip (across the reading axis, decision 0004) keeps the same datum on show all the way, and the pointer then rests on the tooltip; Escape closes it until another datum
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I1 scatter: neither the tooltip nor the readout ever covers a control, whether shown for the pointer or for the keyboard (decision 0004: the readout has reserved space)
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I1 donut: moving slowly from the datum straight onto the tooltip (across the reading axis, decision 0004) keeps the same datum on show all the way, and the pointer then rests on the tooltip; Escape closes it until another datum
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I1 donut: neither the tooltip nor the readout ever covers a control, whether shown for the pointer or for the keyboard (decision 0004: the readout has reserved space)
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I4 line: every control is at least 24 × 24 CSS px: toolbar, legend, table pager, jump field, and the selectable rows of a shown tooltip
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I4 area: every control is at least 24 × 24 CSS px: toolbar, legend, table pager, jump field, and the selectable rows of a shown tooltip
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I4 bar: every control is at least 24 × 24 CSS px: toolbar, legend, table pager, jump field, and the selectable rows of a shown tooltip
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I4 scatter: every control is at least 24 × 24 CSS px: toolbar, legend, table pager, jump field, and the selectable rows of a shown tooltip
  - `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` · I4 donut: every control is at least 24 × 24 CSS px: toolbar, legend, table pager, jump field, and the selectable rows of a shown tooltip
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L1 line: after a font that loads late, the relaid-out text still neither overlaps nor is cut off nor leaves the figure (480 and 1280 px)
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L1 area: after a font that loads late, the relaid-out text still neither overlaps nor is cut off nor leaves the figure (480 and 1280 px)
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L1 scatter: after a font that loads late, the relaid-out text still neither overlaps nor is cut off nor leaves the figure (480 and 1280 px)
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L4 line: the marks have their new colours in the first frame after each trigger: a class, style or data-theme change on <html> or <body>, a prefers-color-scheme change, and the painted pixels follow
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L4 area: the marks have their new colours in the first frame after each trigger: a class, style or data-theme change on <html> or <body>, a prefers-color-scheme change, and the painted pixels follow
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L4 bar: the marks have their new colours in the first frame after each trigger: a class, style or data-theme change on <html> or <body>, a prefers-color-scheme change, and the painted pixels follow
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L4 scatter: the marks have their new colours in the first frame after each trigger: a class, style or data-theme change on <html> or <body>, a prefers-color-scheme change, and the painted pixels follow
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L4 donut: the marks have their new colours in the first frame after each trigger: a class, style or data-theme change on <html> or <body>, a prefers-color-scheme change, and the painted pixels follow
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L4 compact: the marks have their new colours in the first frame after each trigger: a class, style or data-theme change on <html> or <body>, a prefers-color-scheme change, and the painted pixels follow
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L8 scatter: shrinking the container's width 1 px at a time, the plot is drawn while it is at least 120 px and the fallback starts when it would be less: the title, a one-line summary that fits uncut, the table control, and AX142
  - `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts` · L8 donut: shrinking the container's width 1 px at a time, the plot is drawn while it is at least 120 px and the fallback starts when it would be less: the title, a one-line summary that fits uncut, the table control, and AX142
  - `packages/axylo/test/browser/acceptance/type-matrix.browser.test.ts` · T-pointer-scatter: two points equally near the pointer: the later row wins, whichever series it is (source order reversed, the other wins)
  - `packages/axylo/test/browser/acceptance/type-matrix.browser.test.ts` · T-dense-donut: no simplified drawing: eight slices, the smallest under 0.2 %, are each drawn at their angle in their colour
- `acceptance/results/dist-browser.json` · 28 passed assertions, 2 reported failures
  - Provenance: commit d8b41505a7ce919276d532f11c6af3d90fdfb933, dirty true, tree SHA-256 83e5cdffe90381f4453f5fe7317eb54f2717bab95d5689709d33f93ec45bd4ef, result SHA-256 2b91e8ab4490ffa90fd795945c974a6b99ad0b15e4792a620bcbe9ae09fbbd23, 55 cited test hashes in the sidecar · provenance does not match the working tree
  - `tests/dist/text.browser.test.ts` · every built-in string that reaches the page is the override, literally, and the dirty-input note reads as written
  - `tests/dist/text.browser.test.ts` · every built-in string that reaches the page is the override, literally, and the dirty-input note reads as written
- `acceptance/results/dist.json` · 106 passed assertions, 0 reported failures
  - Provenance: commit d8b41505a7ce919276d532f11c6af3d90fdfb933, dirty true, tree SHA-256 83e5cdffe90381f4453f5fe7317eb54f2717bab95d5689709d33f93ec45bd4ef, result SHA-256 095a347c07c723f5fa94f2259e3cab6d88b7115dd2fba86353fd913b8212c3cb, 55 cited test hashes in the sidecar · provenance does not match the working tree
- `acceptance/results/unit.json` · 1449 passed assertions, 1 reported failures
  - Provenance: commit d8b41505a7ce919276d532f11c6af3d90fdfb933, dirty true, tree SHA-256 83e5cdffe90381f4453f5fe7317eb54f2717bab95d5689709d33f93ec45bd4ef, result SHA-256 0eb7638bc4979eb35754c1ee550325e734d72e9bbc281ee2bfce7704a7a31a3d, 55 cited test hashes in the sidecar · provenance does not match the working tree
  - `packages/axylo/test/data/streaming-storage.test.ts` · bounds the retained typed-array backing after opening a million typed observations and appending

## Packed size measurement

- line only (examples/first-chart/npm.ts) · 288,819 minified JS bytes, 99.38 KiB gzipped, 25 KiB target · [bench/size-latest.json](../bench/size-latest.json)
- everything (export * from axylo) · 289,261 minified JS bytes, 99.47 KiB gzipped, 40 KiB target · [bench/size-latest.json](../bench/size-latest.json)
- script tag (axylo.iife.min.js + axylo.css) · 289,757 minified JS bytes, 103.53 KiB gzipped · [bench/size-latest.json](../bench/size-latest.json)
- React adapter alone (react, axylo external) · 2,375 minified JS bytes, 1.17 KiB gzipped, 2 KiB target · [bench/size-latest.json](../bench/size-latest.json)


## Status by chart type

- pass · 135
- fail · 42
- weak · 85
- no evidence · 18
- not run · 21
- cannot be verified here · 10
- not applicable · 265

The matrix contains individual test citations and applicability reasons. [acceptance/matrix.json](matrix.json)

| Criterion | Statement | line | area | bar | scatter | donut | compact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L1 | Text does not overlap or clip; a visible note appears if labels still do not fit. | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | weak (unit.json pass, browser.json pass) | fail (unit.json pass, browser.json fail/pass) | weak (browser.json pass) | not applicable |
| C4 | Multiple compact lines differ by dash as well as color; AX131 suggests one series per compact chart. | not applicable | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) |
| F1 | Bar and area value axes always include zero; a domain that excludes zero is widened and raises AX110. | not applicable | pass (unit.json pass) | pass (unit.json pass) | not applicable | not applicable | pass (unit.json pass, browser.json pass) |
| F2 | Missing values are never drawn as zero and never bridged unless the author asks; readouts say “No data”. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) |
| F3 | Input that cannot be plotted as given is reported, never guessed. | weak (unit.json pass, browser.json pass, dist.json pass) | weak (unit.json pass, browser.json pass, dist.json pass) | weak (unit.json pass, browser.json pass, dist.json pass) | weak (unit.json pass, browser.json pass, dist.json pass) | weak (unit.json pass, browser.json pass, dist.json pass) | weak (unit.json pass, browser.json pass, dist.json pass) |
| F12 | When warnings mean values were left out or changed, a note appears inside the figure and in the accessibility tree, in every build. | fail (unit.json pass, browser.json pass, dist-browser.json fail) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable |
| F10 | Stacks split positive and negative parts at zero and cover both totals. Mixed-sign readouts give both totals; single-sign readouts give one sum; missing components mark the stack incomplete. | not applicable | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable | not applicable | weak (unit.json pass) |
| F8 | Donut slices keep input order and run clockwise from 12 o’clock. Only positive slices count toward the eight-arc limit; zero and null stay listed separately, negatives error, and shares use at most one fraction digit. | not applicable | not applicable | not applicable | not applicable | fail (unit.json pass, browser.json fail/pass) | not applicable |
| F4 | Calendar dates read the same in every zone; instants name their zone; wall-clock times are shown as written. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable | pass (unit.json pass, browser.json pass) |
| F11 | Line, area and scatter draw in x order; duplicate x disables an aligned series, while scatter keeps coincident points. | pass (unit.json pass) | pass (unit.json pass) | pass (unit.json pass) | pass (unit.json pass) | not applicable | pass (unit.json pass, browser.json pass) |
| F5 | Dense drawing preserves the exact per-pixel extrema of each valid run and keeps every break. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | weak (unit.json pass) |
| T-dense-line | Simplified drawing when dense · F5 | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-dense-area | Simplified drawing when dense · F5 on cumulative sums | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-dense-bar | Simplified drawing when dense · No; more bars than pixels raises a hint | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-dense-donut | Simplified drawing when dense · No | not applicable | not applicable | not applicable | not applicable | fail (unit.json pass, browser.json fail) | not applicable |
| T-dense-scatter | Simplified drawing when dense · No in 1.0; above 50,000 points a hint says drawing may be slow | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| F7 | The zoomed view stays inside the author or automatic domain; the automatic domain contains data, references and stack totals. | pass (unit.json pass) | pass (unit.json pass) | pass (unit.json pass) | pass (unit.json pass) | not applicable | pass (unit.json pass) |
| F6 | Format numbers and dates for the page locale, separately for ticks and readouts; a throwing formatter falls back with a diagnostic. | weak (unit.json pass, browser.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) |
| A3 | The focused point conveys its text; touch screen readers can swipe to every point or reach the table in two gestures. | cannot be verified here (unit.json pass, browser.json pass) | cannot be verified here (unit.json pass, browser.json pass) | cannot be verified here (unit.json pass, browser.json pass) | cannot be verified here (unit.json pass, browser.json pass) | cannot be verified here (unit.json pass, browser.json pass) | not applicable |
| A1 | Every chart has an accessible name and generated summary, and chart element ids are unique. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) |
| A2 | At most two tab stops with the table closed; all points are reachable, the toolbar roves, and focus can leave. The indicator is at least 2 px and 3:1, clear of the tooltip. | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | not applicable |
| T-keyboard-line | Keyboard order · By x, then series | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-keyboard-area | Keyboard order · By x, then series | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-keyboard-bar | Keyboard order · By category, then series | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-keyboard-donut | Keyboard order · By slice order | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| T-keyboard-scatter | Keyboard order · By x, then y | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| A4 | View as table opens a normalized HTML table in the current range, with pagination or x jump, in a focusable scroll region. | pass (browser.json pass, unit.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | not applicable |
| A5 | Series are never distinguished by color alone; filled marks have separators and the palette meets contrast and distance thresholds. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) |
| L2 | Text is at least 12 CSS px and 4.5:1; marks, axis lines and focus indicators are at least 3:1 in light and dark. | pass (browser.json pass) | pass (browser.json pass) | pass (browser.json pass) | pass (browser.json pass) | pass (browser.json pass) | weak (browser.json pass) |
| L7 | Empty, loading, error and internal failures show a message in the plot; a change is announced once, politely. | pass (browser.json pass, unit.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) |
| L8 | Below 120 × 80 CSS px of plot, show the title, table control and first summary sentence on up to two lines with ellipsis as needed. Retain the full description and raise AX142. | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | not applicable |
| L3 | The chart follows its container; automatic height is 16:9 clamped to 160–480 CSS px; initially hidden charts draw when sized. | weak (browser.json pass, unit.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | not applicable |
| L4 | The chart follows the page color scheme; changes repaint within one frame and forced colors use system colors. | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) |
| A6 | Reflow at 320 CSS px and 400% zoom without two-dimensional scrolling; user text spacing does not clip. | cannot be verified here (browser.json pass) | cannot be verified here (browser.json pass) | cannot be verified here (browser.json pass) | cannot be verified here (browser.json pass) | cannot be verified here (browser.json pass) | not applicable |
| I1 | Datum-anchored tooltip appears within one frame at p95, fits the available plot and avoids controls. Hover preserves picking, pinning exposes row buttons, and Escape dismisses. Plots narrower than 240 CSS px or shorter than 140 CSS px reserve a two-line readout. | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | not applicable |
| T-pointer-line | Picking by pointer · Nearest x | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-pointer-area | Picking by pointer · Nearest x | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-pointer-bar | Picking by pointer · The band under the pointer | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-pointer-donut | Picking by pointer · The slice under the pointer | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| T-pointer-scatter | Picking by pointer · Nearest point within 24 px; ties go to the later row | not applicable | not applicable | not applicable | fail (unit.json pass, browser.json fail/pass) | not applicable | not applicable |
| T-tooltip-line | Tooltip content · Every visible series at that x | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-tooltip-area | Tooltip content · Every visible series at that x; a stack gives the total or both signed totals | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-tooltip-bar | Tooltip content · Every visible series in the picked category; a mixed-sign stack gives both signed totals | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-tooltip-donut | Tooltip content · Label, value, percentage | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| T-tooltip-scatter | Tooltip content · The point's series, x and y; coincident points listed, up to eight | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| I2 | Legend entries are pressed-state toggle buttons operable by click, Enter and Space. | pass (browser.json pass, unit.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| I3 | Zoom on time, date or numeric x uses controls, drag, keys or opt-in pinch; wheel zoom needs plot focus and preserves Ctrl/Meta. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| T-zoom-line | Zoom · Time, date and numeric x only; category x does not zoom in 1.0 | pass (browser.json pass, unit.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-zoom-area | Zoom · Time, date and numeric x only; category x does not zoom in 1.0 | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-zoom-bar | Zoom · Time, date and numeric x only; category x does not zoom in 1.0 | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-zoom-donut | Zoom · No | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| T-zoom-scatter | Zoom · Continuous x only in 1.0; y keeps its full range | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| I4 | Every interaction works by a single pointer and touch; controls measure at least 24×24 CSS px; one-finger drag scrolls the page. | fail (browser.json fail/pass) | fail (browser.json fail/pass) | fail (browser.json fail/pass) | fail (browser.json fail/pass) | fail (browser.json fail/pass) | not applicable |
| A7 | Data arriving does not speak; focus stays on the datum until it leaves the streaming window. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | fail (unit.json pass, browser.json fail/pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | weak (unit.json pass) |
| I6 | Append shows Pause/Resume; while paused, new rows are buffered and the view does not move. | pass (browser.json pass, unit.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable |
| I5 | No first-render animation; updates take at most 200 ms and reduced motion removes transitions. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) |
| A8 | axe-core reports no violations on any fixture in any state, including heading-order and scrollable-region-focusable. | pass (browser.json pass) | pass (browser.json pass) | weak (browser.json pass) | pass (browser.json pass) | pass (browser.json pass) | pass (browser.json pass) |
| A10 | Every built-in string can be replaced; built-in English is marked lang="en" on non-English pages. | fail (unit.json pass, browser.json pass, dist-browser.json fail) | fail (unit.json pass, browser.json fail/pass) | fail (unit.json pass, browser.json fail/pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) | weak (unit.json pass, browser.json pass) |
| A9 | A published WCAG 2.2 AA conformance table lists each applicable criterion, its test, author obligations and limits. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| F9 | Up to eight series use distinct colors. Above eight, AX130 is raised and series use distinct combinations, with up to 32 distinct bar cues. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable | weak (unit.json pass, browser.json pass) |
| T-limit-line | Limit that raises a diagnostic · Eight series | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-limit-area | Limit that raises a diagnostic · Eight series | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-limit-bar | Limit that raises a diagnostic · Eight series | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-limit-donut | Limit that raises a diagnostic · Eight slices with arcs (positive values) | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| T-limit-scatter | Limit that raises a diagnostic · Eight series | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| L6 | Title, subtitle and labelled axes with units belong to the chart; reference labels sit by their marks and axis titles stay clear of ticks. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | pass (browser.json pass, unit.json pass) | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable |
| T-reference-line | Reference lines and bands · Yes; included in the domain; listed in the summary and table caption | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-reference-area | Reference lines and bands · Yes | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| T-reference-bar | Reference lines and bands · Yes | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable |
| T-reference-donut | Reference lines and bands · No | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable |
| T-reference-scatter | Reference lines and bands · Yes | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) | not applicable | not applicable |
| L5 | Point markers appear only when adjacent points are at least 12 px apart and always for isolated points. | pass (unit.json pass, browser.json pass) | pass (unit.json pass, browser.json pass) | not applicable | not applicable | not applicable | not applicable |
| C1 | A compact chart is an image with a full text alternative, no tab stop and no pointer-only behavior. | not applicable | not applicable | not applicable | not applicable | not applicable | pass (browser.json pass, unit.json pass) |
| C2 | Compact keeps the fidelity rules for baseline, gaps, diagnostics, simplification, sorting, motion and page scheme. | not applicable | not applicable | not applicable | not applicable | not applicable | fail (unit.json pass, browser.json fail/pass) |
| C3 | Compact fills its container from 24×16 CSS px and is 32 px tall without a definite height. | not applicable | not applicable | not applicable | not applicable | not applicable | pass (unit.json pass, browser.json pass) |
| C5 | When values are left out, the compact description says so and a corner marker has a text equivalent. | not applicable | not applicable | not applicable | not applicable | not applicable | pass (browser.json pass, unit.json pass) |
| DX1 | The first chart takes ten lines or fewer via npm, script tag or React, using only data and fields. | pass (dist.json pass, dist-browser.json pass) | weak (browser.json pass, dist-browser.json pass) | weak (browser.json pass, dist-browser.json pass) | weak (browser.json pass, dist-browser.json pass) | weak (browser.json pass, dist-browser.json pass) | weak (dist-browser.json pass) |
| DX2 | Long rows, wide rows and typed columns produce the same normalized data and diagnostics with caller row indexes. | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | pass (unit.json pass) | weak (unit.json pass) |
| DX3 | Invalid typed calls fail to compile; their untyped equivalents raise AX101, AX106 or AX150. | weak (unit.json pass, dist.json pass) | weak (unit.json pass, dist.json pass) | weak (unit.json pass, dist.json pass) | weak (unit.json pass, dist.json pass) | weak (unit.json pass, dist.json pass) | weak (unit.json pass, dist.json pass) |
| DX4 | Diagnostics have stable codes, chart names, field and row indexes where appropriate, fixes and a documentation page per code. | weak (unit.json pass, dist-browser.json pass) | weak (unit.json pass, dist-browser.json pass) | weak (unit.json pass, dist-browser.json pass) | weak (unit.json pass, dist-browser.json pass) | weak (unit.json pass, dist-browser.json pass) | weak (unit.json pass, dist-browser.json pass) |
| DX5 | Update, append and zoom apply in order; validation is synchronous, one frame changes all visible state, and destroy cancels work. | weak (browser.json pass, unit.json pass) | weak (browser.json pass, unit.json pass) | weak (browser.json pass, unit.json pass) | weak (browser.json pass, unit.json pass) | weak (browser.json pass, unit.json pass) | weak (unit.json pass) |
| DX6 | CSS custom properties style charts; font and color are inherited, and a series name pins its color across charts. | weak (unit.json pass, browser.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) | weak (unit.json pass) |
| DX7 | Zero runtime dependencies; packed gzip targets including CSS are 40 KiB everything, 25 KiB line-only and 2 KiB React. | fail (size-latest.json fail, dist.json pass, unit.json pass) | fail (size-latest.json fail, dist.json pass) | fail (size-latest.json fail, dist.json pass) | fail (size-latest.json fail, dist.json pass) | fail (size-latest.json fail, dist.json pass) | fail (size-latest.json fail, dist.json pass) |
| DX8 | Works without a DOM at import, in React StrictMode and under strict CSP, inserts text safely, and names unmatched selectors. | fail (unit.json pass, dist.json pass, dist-browser.json fail/pass, browser.json pass) | weak (unit.json pass, dist.json pass, dist-browser.json pass) | weak (unit.json pass, dist.json pass, dist-browser.json pass) | weak (unit.json pass, dist.json pass, dist-browser.json pass) | weak (unit.json pass, dist.json pass, dist-browser.json pass) | weak (unit.json pass, dist.json pass, dist-browser.json pass) |
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

## What stands between this tree and a release

### Failing cells

- **Tooltip placement and focus clearance** · I1 (line, area, bar, scatter, donut) · A2 (line, area, bar, scatter, donut) · I4 (line, area, bar, scatter, donut). Decision 0004 revision 2 addresses the shared tooltip placement, hover and pinning path. The archive records occluded marks or controls, clipped or occluded focus indicators, hover persistence failures and rows around 17 px high. The old hover oracle also required the tooltip to receive the pointer. Revision 2 requires persistence over its rectangle while the plot receives moves, and measures row controls after pinning. The alignment and product fixes need fresh results. [docs/decisions/0004-tooltip-and-focused-text.md](../docs/decisions/0004-tooltip-and-focused-text.md) · [reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md](../reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md)
- **Late-font layout** · L1 (line, area, scatter). The late font leaves y ticks overlapping the axis title and clips a scatter label in the archived SVG fixtures. [reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md](../reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md)
- **Scheme repaint timing** · L4 (line, area, bar, scatter, donut, compact) · C2 (compact). After a class change on the root, the marks still have their original colors at the first frame. The C2 fidelity cell includes the L4 requirement. [reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md](../reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md)
- **Superseded summary oracle** · L8 (scatter, donut). Two-line summaries fail the archived one-line rule. The current spec allows up to two lines with an ellipsis and retains the full accessible description. The archived failures leave the revised rule unverified. [docs/02-product-spec.md](../docs/02-product-spec.md) · [reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md](../reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md)
- **Categorical stream focus** · A7 (bar). The archived sliding window rewrites value text when the same category datum moves within the window. [docs/decisions/0004-tooltip-and-focused-text.md](../docs/decisions/0004-tooltip-and-focused-text.md) · [reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md](../reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md)
- **Scatter tie break** · T-pointer-scatter (scatter). A reversed input order still picks the same series in the equidistant browser probe. The later caller row should win. [reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md](../reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md)
- **Thin donut slice** · T-dense-donut (donut) · F8 (donut). The 0.1% slice has an empty SVG path in the archived fixture. The regular eight-arc threshold, grouping and share-format checks pass. [reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md](../reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md)
- **Superseded message applicability** · A10 (area, bar). The archived full-chart checks require incompleteAt and incompleteCount. The alignment pass assigns those summary templates to compact stacks and uses incompleteStack on full stacks. Current per-key results are still needed. [packages/axylo/test/browser/acceptance/a6-a10.browser.test.ts](../packages/axylo/test/browser/acceptance/a6-a10.browser.test.ts)
- **Packed note serialization** · F12 (line) · A10 (line) · DX8 (line). Both packed text tests find the note’s text runs serialized as visible JSON. This corrupts the note and its custom See table text. The failing fixture is a line chart. [tests/dist/text.browser.test.ts](../tests/dist/text.browser.test.ts)
- **Packed gzip size** · DX7 (line, area, bar, scatter, donut, compact). Everything is 99.47 KiB against 40 KiB, line-only is 99.38 KiB against 25 KiB, and the React adapter is 1.17 KiB against 2 KiB. The analysis proposes 96, 80 and 2 KiB respectively. The owner has yet to approve a change. [bench/size-latest.json](../bench/size-latest.json) · [reviews/2026-11-18/impl/wp/size.analysis.md](../reviews/2026-11-18/impl/wp/size.analysis.md)

### Weak cells

- **L1** · Weak · bar · Fixed label sets and emulated text zoom cover the 240 px remedy. Generated browser label sets, native text zoom and the full text of truncated labels in the tooltip remain open.
  - Weak · donut · The SVG browser runs use fixed label sets. The generated browser label sets and native 200% text zoom remain open.
- **F2** · Weak · compact · All three compact kinds have model checks. The compact line has painted gap and zero checks. Compact area and bar still need their own rendered checks.
- **F3** · Weak · line, area, bar, scatter, donut · The model asserts diagnostic delivery, effects and drawn output for its cases. The registry still lacks a complete code-by-type check of level and reader outcome, including late diagnostics across types.
  - Weak · compact · Applicable Node registry fixtures run in compact line, area and bar. Painted contrast, DOM outcomes, and code-by-type coverage in every build still need browser evidence.
- **F10** · Weak · compact · The incomplete stack is checked in both compact summaries in the Node model. The new compact browser summary scenarios have no result in the archive.
- **F5** · Weak · compact · Node exercises dense line and cumulative area geometry at two device-pixel ratios. The rendered dense-column fixture covers full charts.
- **F6** · Weak · line · The browser changes document language and checks the summary number. Ticks, tooltip, table and focused value text are localized in the Node model and still need comparison in that browser workflow.
  - Weak · area, bar, scatter, donut, compact · The Node models verify locale-appropriate strings and formatter fallback. The recorded browser checks do not compare all localized reader surfaces against the page locale.
- **A4** · Weak · area, bar, scatter, donut · Ordered headers and rows, paging or jumping, and the 24-chart layout pass for the tested fixtures. The million-row browser jump is exercised only for line.
- **A5** · Weak · bar · Painted seams and 32 color/pattern combinations are checked. The default two-series fixture does not establish distinct non-color identities for ordinary bars.
  - Weak · donut · Painted seams and the eight-color palette are checked. No assertion identifies donut slices without color by associating them with their text.
  - Weak · compact · Compact bar texture and compact stroke dashes are checked. The color-vision and sampled palette runs use compact line, leaving compact area and bar unscored.
- **L2** · Weak · compact · Painted contrast is sampled from a compact line. The compact area and bar have no equivalent light/dark painted-contrast result.
- **L8** · Weak · line, area, bar · The archive brackets 120 × 80 CSS px with a one-line summary oracle. The revised two-line ellipsis and retained full accessible description need a fresh result.
- **L3** · Weak · line, area, bar, scatter, donut · Resized horizontal geometry, auto-height flow and hidden reveal are checked. An independent height resize at constant width still needs a geometry-and-hit-target check.
- **A7** · Weak · compact · The committed model stays quiet across appends in all three compact variants. No compact browser live-region mutation or 24-stream run is recorded.
- **I5** · Weak · compact · The compact line, area and bar traces cover first render. The recorded update deadline uses a compact line, and the 24-chart filter workload is exercised on full charts.
- **A8** · Weak · bar · Axe checks state-asserted category bars, including hidden series and a scrollable table. The zoomed continuous-axis bar still needs a scan.
- **A10** · Weak · scatter, donut · The per-key sentinel audit covers its exercised states. Examples left open include the hidden-label note, fallback value label and strings exercised only in particular layouts. A10 language checks cover the named Chrome surfaces.
  - Weak · compact · The archive exercised compact line. The alignment pass moves incomplete-stack summary templates to compact area and bar and adds those fixtures. Await their results.
- **F9** · Weak · compact · Rendered eight-color checks use compact line only, and the twelve-series case checks model bindings rather than distinct rendered combinations in every compact variant.
- **DX1** · Weak · area, bar, scatter, donut, compact · Only the line has documented first-chart snippets proven in all three packed installation modes.
- **DX2** · Weak · line, area, bar, scatter, compact · The fixture compares one logical series and one bad row. Multiple-series layouts and diagnostics whose caller indexes differ by form remain unchecked.
- **DX3** · Weak · line · Packed fixtures check bad line fields, wide y with series and an inapplicable option. The typed text-value failure is exercised on bar, rather than along with the line runtime case.
  - Weak · area, bar, scatter, donut, compact · Packed type fixtures check specific counterexamples for selected types. The full set of applicable typed and untyped counterparts is unverified for this type.
- **DX4** · Weak · line, area, bar, scatter, donut, compact · Runtime diagnostics are sampled, with registry cases under F3. A documentation page and verified link for every code are still missing.
- **DX5** · Weak · line, area, bar, scatter, donut, compact · Sequences and cancellation are checked. Heap retention over 1,000 create–destroy cycles remains unmeasured under P7.
- **DX6** · Weak · line, area, bar, scatter, donut, compact · The model checks named colors against a changing series set. No 24-tile test establishes cross-chart color stability together with inherited font and color and documented CSS font and spacing overrides.
- **DX8** · Weak · area, bar, scatter, donut, compact · Packed CSP pages draw these charts and Node runs without DOM globals. React StrictMode replay and hydration are exercised only on Line.
- **DX10** · Weak · line · The three first-chart examples compile or run as applicable. The rest of the runnable documentation has no corresponding CI build and render.
  - Weak · area, bar, scatter, donut, compact · Packed consumer fixtures compile calls, without a CI build and render of the runnable documentation examples.

### No evidence

- **A9** · line, area, bar, scatter, donut, compact · A published WCAG 2.2 AA conformance table lists each applicable criterion, its test, author obligations and limits.
- **DX9** · line, area, bar, scatter, donut, compact · Follow semantic versioning and the deprecation policy; previous documented examples still compile and run.
- **DX12** · line, area, bar, scatter, donut, compact · A coding agent uses published docs to make a first chart that passes reader criteria on trap fixtures.

### Not run

P1–P8 have a harness in `bench/`. Acceptance measurements await a quiet machine. [bench/README.md](../bench/README.md)

- **P1** · line · No valid acceptance measurement. Earlier first-chart comparisons were exploratory.
- **P2** · line · No valid acceptance measurement at both point counts. See decision 0002 for limits of the comparisons.
- **P3** · line · No valid acceptance measurement of the specified task and presented-frame pacing workload.
- **P4** · line, area, bar, scatter · No valid measurement of p95 input-to-matching-frame latency.
- **P5** · line · No valid acceptance measurement. The earlier 24-chart run showed fallback text and drew no marks.
- **P6** · line, area, bar, scatter, donut, compact · The separate packed size measurement under DX7 exceeds the spec. The P6 acceptance benchmark still awaits its recorded run.
- **P7** · line · The store unit probe retained 24,750,128 B against a 16,000,000 B bound after one million points and an append. P7 still needs its owned-bytes and 1,000-cycle post-collection measurements.
  - area, bar, scatter, donut, compact · No valid owned-bytes and 1,000-cycle heap measurement. The earlier dashboard memory run was voided.
- **P8** · compact · No valid 40-tile main-thread measurement.

### Cannot be verified here

- **A3** · line, area, bar, scatter, donut · Decision 0001 calls for rehearsals with NVDA in Chrome and Firefox, VoiceOver in macOS and iOS Safari, and TalkBack in Chrome. Chrome AX identifies the focused slider. Its value text comes from the DOM.
- **A6** · line, area, bar, scatter, donut · Chrome emulates 400% at 320 × 256 CSS px and DPR 4 and checks text spacing. Native browser zoom and the Firefox and Safari/WebKit engine runs remain outstanding.
- **I4** · line, area, bar, scatter, donut · Chrome/CDP exercises tap, scroll and control targets. Native physical-phone interaction remains outstanding.
- **GPU** · Hardware rasterization needs a headed, GPU-backed run. [docs/decisions/0002-mark-renderer.md](../docs/decisions/0002-mark-renderer.md)

## Evidence limits by cell

- System Chrome/SVG. The 200% text-size fixture doubles inherited CSS font size. Fixed-pixel text is unaffected. **L1 (area, bar, line, scatter, donut)**
- Browser acceptance evidence uses the SVG renderer in system Chrome. **C4 (compact) · F1 (compact) · F2 (area, bar, compact, donut, line, scatter) · F3 (area, bar, compact, donut, line, scatter) · F12 (area, bar, donut, line, scatter) · F10 (area, bar) · F8 (donut) · F4 (area, bar, compact, line, scatter) · F11 (compact) · F5 (area, line) · T-dense-line (line) · T-dense-area (area) · T-dense-bar (bar) · T-dense-donut (donut) · T-dense-scatter (scatter) · A3 (area, bar, donut, line, scatter) · A1 (area, bar, compact, donut, line, scatter) · T-keyboard-line (line) · T-keyboard-area (area) · T-keyboard-bar (bar) · T-keyboard-donut (donut) · T-keyboard-scatter (scatter) · A4 (area, bar, donut, scatter) · L7 (line, area, bar, compact, donut, scatter) · L8 (area, bar, donut, line, scatter) · L3 (line, area, bar, donut, scatter) · L4 (area, bar, compact, donut, line, scatter) · T-pointer-line (line) · T-pointer-area (area) · T-pointer-bar (bar) · T-pointer-donut (donut) · T-pointer-scatter (scatter) · T-tooltip-line (line) · T-tooltip-area (area) · T-tooltip-bar (bar) · T-tooltip-donut (donut) · T-tooltip-scatter (scatter) · I2 (line, area, bar, scatter) · I3 (area, bar, line, scatter) · T-zoom-line (line) · T-zoom-area (area) · T-zoom-bar (bar) · T-zoom-donut (donut) · T-zoom-scatter (scatter) · I4 (line, area, bar, scatter, donut) · I6 (line, area, bar, donut, scatter) · A8 (line, area, bar, scatter, donut, compact) · A10 (area, bar, compact, donut, line, scatter) · F9 (area, bar, compact, line, scatter) · T-limit-line (line) · T-limit-area (area) · T-limit-bar (bar) · T-limit-donut (donut) · T-limit-scatter (scatter) · L6 (bar, area, donut, line, scatter) · T-reference-line (line) · T-reference-area (area) · T-reference-bar (bar) · T-reference-donut (donut) · T-reference-scatter (scatter) · L5 (area, line) · C1 (compact) · C2 (compact) · C3 (compact) · C5 (compact)**
- System Chrome/SVG. Chrome confirms the focused accessible slider and its numeric value. The test reads its value text from the DOM. **A2 (area, bar, donut, line, scatter)**
- System Chrome/SVG. The typed-column million-row jump sample covers line; the 24-tile and ordered content checks cover the regular fixtures. **A4 (line)**
- System Chrome/SVG. OKLab distances use sampled painted colors, including analytic and 8-bit simulations of the three color-vision deficiencies. The grayscale crossing-line check classifies marker shapes. Following the traces is a human judgment. **A5 (area, bar, compact, donut, line, scatter)**
- System Chrome/SVG. Text color is computed against sampled background pixels. Mark, axis and focus contrast use available painted samples. **L2 (line, area, bar, scatter, donut, compact)**
- System Chrome/SVG. The 400% condition is emulated with a 320 × 256 CSS-pixel viewport at device-pixel ratio 4. **A6 (line, area, bar, scatter, donut)**
- System Chrome/SVG. Probe timing is counted in page animation frames. Use P4 for the 100,000-point input-to-matching-frame budget. **I1 (area, bar, donut, line, scatter)**
- System Chrome/SVG. Live-region mutations, range numeric value and DOM value-text stability are observed. Speech still requires the screen-reader rehearsal. **A7 (area, bar, donut, line, scatter)**
- System Chrome/SVG. Motion is traced on the page clock with animations enabled. The multi-chart deadline uses the supplied fixture and machine. **I5 (area, bar, compact, donut, line, scatter)**
- The spec still requires 40 KiB everything, 25 KiB line-only and 2 KiB React, CSS included. Proposed 96/80/2 KiB targets await the owner’s decision. **DX7 (line, area, bar, scatter, donut, compact)**
- The inventory, licence, package origins and detected headers are checked. Unmarked third-party code copied into source cannot be detected by these tests. **DX11 (line, area, bar, scatter, donut, compact)**

## Evidence that exists but was not run for this report

These files have citations with required assertions missing or skipped in the supplied results.

- L8/line, L8/area, L8/bar · [packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts](../packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts)

## Scope of this evidence review

The four coordinator reports describe d8b4150. The release check rejects their provenance against the working tree. The results can locate failures and evidence gaps in the recorded tree. Changed assertions and concurrent fixes need a fresh build and run.

The citation uses a describe prefix and chart-specific case prefix for I1 and I4 in i1-pointer, L8 in l-legibility, and A10 in a6-a10. These suites are the units of evidence for the revisions to hover and pinning, reserved readout mode, the small-plot summary, and message applicability. Historical failures remain visible. New or materially changed checks need fresh results even when the registration still has the same title.

The browser acceptance suite measures SVG in system Chrome. The 200% text-size and 400% page-zoom fixtures use emulation. Firefox, Safari/WebKit, real phone touch, spoken output and screen-magnifier rehearsal are outside these runs. The packed distribution checks exercise Chrome and esbuild, with the recorded CSP and fixture isolation guards.

Applicability uses continuous x for zoom in 1.0. Category line, area and bar check absent zoom controls and a no-op public zoom call. Scatter preserves its y range. I2 applies to series toggles. F8’s donut legend lists static slices. C4 applies dashes to compact strokes and takes the compact bar texture check from A5.

The million-row table jump and the three ten-line packed snippets exercise line. F10’s compact evidence uses the summary in place of full-chart readouts. The recorded P7 store assertion is a precursor to the full benchmark, which also requires post-collection lifecycle data.

## Status changes from the previous report

The baseline is the checked-in report before the re-merge. The separate coordinator checker log stopped at structural citation errors.

| Status | Before | After |
| --- | ---: | ---: |
| pass | 5 | 135 |
| fail | 13 | 42 |
| weak | 129 | 85 |
| no evidence | 18 | 18 |
| not run | 132 | 21 |
| cannot be verified here | 15 | 10 |
| not applicable | 264 | 265 |

- **weak → fail (20)** · The archive now supplies affirmative failures, including stronger legibility, repaint, tooltip, compact scheme and message assertions.
  - L1 (line, area, scatter) · L8 (scatter, donut) · L4 (line, area, bar, scatter, donut, compact) · I1 (line, area, bar, scatter, donut) · A10 (line, area, bar) · C2 (compact)
- **not run → pass (100)** · Current registered assertions match the d8b4150 reports, including the strengthened per-type rendering, exact content, diagnostics, geometry and packed-consumer checks.
  - C4 (compact) · F1 (area, bar, compact) · F2 (line, area, bar, scatter, donut) · F12 (area, bar, scatter, donut) · F4 (line, area, bar, scatter, compact) · F11 (compact) · T-dense-bar (bar) · T-dense-scatter (scatter) · A1 (line, area, bar, scatter, donut, compact) · T-keyboard-line (line) · T-keyboard-area (area) · T-keyboard-bar (bar) · T-keyboard-donut (donut) · T-keyboard-scatter (scatter) · A5 (line, area, scatter) · L7 (line, area, bar, scatter, donut, compact) · T-pointer-line (line) · T-pointer-area (area) · T-pointer-bar (bar) · T-pointer-donut (donut) · T-tooltip-line (line) · T-tooltip-area (area) · T-tooltip-bar (bar) · T-tooltip-donut (donut) · T-tooltip-scatter (scatter) · I2 (line, area, bar, scatter) · T-zoom-line (line) · T-zoom-area (area) · T-zoom-bar (bar) · T-zoom-donut (donut) · T-zoom-scatter (scatter) · A7 (line, area, scatter) · I6 (line, area, bar, scatter, donut) · A8 (line, area, scatter, donut) · F9 (line, area, bar, scatter) · T-limit-line (line) · T-limit-area (area) · T-limit-bar (bar) · T-limit-donut (donut) · T-limit-scatter (scatter) · L6 (line, area, bar, scatter, donut) · T-reference-line (line) · T-reference-area (area) · T-reference-bar (bar) · T-reference-donut (donut) · T-reference-scatter (scatter) · C1 (compact) · C3 (compact) · C5 (compact) · DX1 (line) · DX11 (line, area, bar, scatter, donut, compact)
- **not run → fail (10)** · The restored citations expose historical focus clearance, scatter tie, thin slice, bar streaming and packed note failures.
  - F12 (line) · T-dense-donut (donut) · A2 (line, area, bar, scatter, donut) · T-pointer-scatter (scatter) · A7 (bar) · DX8 (line)
- **fail → pass (6)** · The strengthened Node domain and stack assertions pass, and the rendered stack tests confirm both mixed-sign totals.
  - F10 (area, bar) · F7 (line, area, bar, scatter)
- **weak → pass (24)** · The combined suites close gaps in device-column extrema and breaks, modeled domains, the 24-tile table and million-row jump, painted contrast, full zoom controls, donut focus identity, frame-traced motion, compact axe states and marker spacing.
  - F5 (line, area) · T-dense-line (line) · T-dense-area (area) · F7 (compact) · A4 (line) · L2 (line, area, bar, scatter, donut) · I3 (line, area, bar, scatter) · A7 (donut) · I5 (line, area, bar, scatter, donut) · A8 (compact) · L5 (line, area)
- **not run → not applicable (1)** · I2 is applied to series visibility controls. The donut’s static legend is covered by F8.
  - I2 (donut)
- **cannot be verified here → fail (5)** · The archived target-size assertions failed in Chrome. Physical-phone verification is still open.
  - I4 (line, area, bar, scatter, donut)

## Negative controls

All 11 browser acceptance controls passed in the recorded run. They validate test helpers and carry no criterion citation. [Browser negative controls](../packages/axylo/test/browser/acceptance/negative-controls.browser.test.ts)

- **Separator measurement** · Compares painted clearance to a 1 px same-angle control and flags 0.5 px or touching edges, including diagonal edges.
- **Painted-color sampler** · Detects very faint or covered marks.
- **Grayscale marker classification** · Flags three identical marker shapes.
- **Text geometry** · Detects overlapping labels, clipped labels and a 1.1 px overlap between lines.
- **Table comparison** · Detects reordered headers and swapped cell values.
- **Summary sentence checker** · Detects a removed range sentence.
- **Focused value-text helper** · Rejects lost focus and a control exposed as a text field.
- **Tooltip occlusion checker** · Detects a tooltip moved onto the active bars.
- **Motion trace** · Detects a 1 s entry fade and a 600 ms update transition.
- **Painted reference sampler** · Detects a removed or transparent reference line.
- **Dense spike-column checker** · Detects a spike shifted by five device-pixel columns.
- **Readout layout comparison** · A new control in the alignment pass flags a strip that claims space only while a datum is shown. The archive predates this assertion.

