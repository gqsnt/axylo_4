# Acceptance report

Static coverage only. No Vitest reports supplied.

## Status by chart type

- pass · 0
- fail · 0
- no evidence · 251
- not run · 38
- cannot be verified here · 21
- not applicable · 266

| Criterion | Statement | line | area | bar | scatter | donut | compact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Bar and area value axes always include zero; a domain that excludes zero is widened and raises AX110. | not applicable | not run | not run | not applicable | not applicable | no evidence |
| F2 | Missing values are never drawn as zero and never bridged unless the author asks; readouts say “No data”. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| F3 | Input that cannot be plotted as given is reported, never guessed. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| F12 | When warnings mean values were left out or changed, a note appears inside the figure and in the accessibility tree, in every build. | no evidence | no evidence | no evidence | no evidence | no evidence | not applicable |
| F10 | Stacks place positive and negative values on their own sides of zero; missing components mark the stack incomplete. | not applicable | no evidence | no evidence | not applicable | not applicable | no evidence |
| F8 | Donut slices keep order, start at 12 o’clock and run clockwise; nulls, zeros, negatives and excess slices have distinct outcomes. | not applicable | not applicable | not applicable | not applicable | no evidence | not applicable |
| F4 | Calendar dates read the same in every zone; instants name their zone; wall-clock times are shown as written. | no evidence | no evidence | no evidence | no evidence | not applicable | no evidence |
| F11 | Line, area and scatter draw in x order; duplicate x disables an aligned series, while scatter keeps coincident points. | no evidence | no evidence | no evidence | no evidence | not applicable | no evidence |
| F5 | Dense drawing preserves the exact per-pixel extrema of each valid run and keeps every break. | no evidence | no evidence | not applicable | not applicable | not applicable | no evidence |
| T-dense-line | Simplified drawing when dense · F5 | no evidence | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-dense-area | Simplified drawing when dense · F5 on cumulative sums | not applicable | no evidence | not applicable | not applicable | not applicable | not applicable |
| T-dense-bar | Simplified drawing when dense · No; more bars than pixels raises a hint | not applicable | not applicable | no evidence | not applicable | not applicable | not applicable |
| T-dense-donut | Simplified drawing when dense · No | not applicable | not applicable | not applicable | not applicable | no evidence | not applicable |
| T-dense-scatter | Simplified drawing when dense · No in 1.0; above 50,000 points a hint says drawing may be slow | not applicable | not applicable | not applicable | no evidence | not applicable | not applicable |
| F7 | The zoomed view stays inside the author or automatic domain; the automatic domain contains data, references and stack totals. | no evidence | no evidence | no evidence | no evidence | not applicable | no evidence |
| F6 | Format numbers and dates for the page locale, separately for ticks and readouts; a throwing formatter falls back with a diagnostic. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| A3 | The focused point conveys its text; touch screen readers can swipe to every point or reach the table in two gestures. | cannot be verified here | cannot be verified here | cannot be verified here | cannot be verified here | cannot be verified here | not applicable |
| A1 | Every chart has an accessible name and generated summary, and chart element ids are unique. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| A2 | At most two tab stops with the table closed; every point is reachable, the toolbar roves, and focus can leave the chart. | no evidence | no evidence | no evidence | no evidence | no evidence | not applicable |
| T-keyboard-line | Keyboard order · By x, then series | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-keyboard-area | Keyboard order · By x, then series | not applicable | no evidence | not applicable | not applicable | not applicable | not applicable |
| T-keyboard-bar | Keyboard order · By category, then series | not applicable | not applicable | no evidence | not applicable | not applicable | not applicable |
| T-keyboard-donut | Keyboard order · By slice order | not applicable | not applicable | not applicable | not applicable | no evidence | not applicable |
| T-keyboard-scatter | Keyboard order · By x, then y | not applicable | not applicable | not applicable | no evidence | not applicable | not applicable |
| A4 | View as table opens a normalized HTML table in the current range, with pagination or x jump, in a focusable scroll region. | not run | no evidence | no evidence | no evidence | no evidence | not applicable |
| A5 | Series are never distinguished by color alone; filled marks have separators and the palette meets contrast and distance thresholds. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| L1 | Text does not overlap or clip; a visible note appears if labels still do not fit. | cannot be verified here | no evidence | no evidence | no evidence | no evidence | not applicable |
| L2 | Text is at least 12 CSS px and 4.5:1; marks, axis lines and focus indicators are at least 3:1 in light and dark. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| L7 | Empty, loading, error and internal failures show a message in the plot; a change is announced once, politely. | not run | no evidence | no evidence | no evidence | no evidence | no evidence |
| L8 | Below a readable plot size of 120×80 CSS px, show the title, summary and table control and raise AX142. | no evidence | no evidence | no evidence | no evidence | no evidence | not applicable |
| L3 | The chart follows its container; automatic height is 16:9 clamped to 160–480 CSS px; initially hidden charts draw when sized. | not run | no evidence | no evidence | no evidence | no evidence | not applicable |
| L4 | The chart follows the page color scheme; changes repaint within one frame and forced colors use system colors. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| A6 | Reflow at 320 CSS px and 400% zoom without two-dimensional scrolling; user text spacing does not clip. | cannot be verified here | cannot be verified here | cannot be verified here | cannot be verified here | cannot be verified here | not applicable |
| I1 | Pointing shows the correct readout within a frame at p95; it stays in view, avoids the mark and supports hover, fallback and Escape. | no evidence | no evidence | no evidence | no evidence | no evidence | not applicable |
| T-pointer-line | Picking by pointer · Nearest x | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-pointer-area | Picking by pointer · Nearest x | not applicable | no evidence | not applicable | not applicable | not applicable | not applicable |
| T-pointer-bar | Picking by pointer · The band under the pointer | not applicable | not applicable | no evidence | not applicable | not applicable | not applicable |
| T-pointer-donut | Picking by pointer · The slice under the pointer | not applicable | not applicable | not applicable | not applicable | not run | not applicable |
| T-pointer-scatter | Picking by pointer · Nearest point within 24 px; ties go to the later row | not applicable | not applicable | not applicable | not run | not applicable | not applicable |
| T-tooltip-line | Tooltip content · Every visible series at that x | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-tooltip-area | Tooltip content · Every visible series at that x, plus the stack total | not applicable | no evidence | not applicable | not applicable | not applicable | not applicable |
| T-tooltip-bar | Tooltip content · Every series in that category | not applicable | not applicable | no evidence | not applicable | not applicable | not applicable |
| T-tooltip-donut | Tooltip content · Label, value, percentage | not applicable | not applicable | not applicable | not applicable | not run | not applicable |
| T-tooltip-scatter | Tooltip content · The point's series, x and y; coincident points listed, up to eight | not applicable | not applicable | not applicable | not run | not applicable | not applicable |
| I2 | Legend entries are pressed-state toggle buttons operable by click, Enter and Space. | not run | no evidence | no evidence | no evidence | not applicable | not applicable |
| I3 | Zoom works by controls, drag, keyboard and opt-in pinch; the wheel respects focus and Ctrl/Meta. | no evidence | no evidence | no evidence | no evidence | not applicable | not applicable |
| T-zoom-line | Zoom · Yes | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-zoom-area | Zoom · Yes | not applicable | not run | not applicable | not applicable | not applicable | not applicable |
| T-zoom-bar | Zoom · On time, date and numeric x only | not applicable | not applicable | no evidence | not applicable | not applicable | not applicable |
| T-zoom-donut | Zoom · No | not applicable | not applicable | not applicable | not applicable | no evidence | not applicable |
| T-zoom-scatter | Zoom · Yes, both axes later; x only in 1.0 | not applicable | not applicable | not applicable | not run | not applicable | not applicable |
| I4 | Every interaction works by a single pointer and touch; controls measure at least 24×24 CSS px; one-finger drag scrolls the page. | cannot be verified here | cannot be verified here | cannot be verified here | cannot be verified here | cannot be verified here | not applicable |
| A7 | Data arriving does not speak; focus stays on the datum until it leaves the streaming window. | no evidence | no evidence | no evidence | no evidence | no evidence | not applicable |
| I6 | Append shows Pause/Resume; while paused, new rows are buffered and the view does not move. | not run | no evidence | no evidence | no evidence | no evidence | not applicable |
| I5 | No first-render animation; updates take at most 200 ms and reduced motion removes transitions. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| A8 | axe-core reports no violations on any fixture in any state, including heading-order and scrollable-region-focusable. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| A10 | Every built-in string can be replaced; built-in English is marked lang="en" on non-English pages. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| A9 | A published WCAG 2.2 AA conformance table lists each applicable criterion, its test, author obligations and limits. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| F9 | Up to eight series have distinct colors; above eight each keeps a distinct cue and AX130 is raised. | no evidence | no evidence | no evidence | no evidence | not applicable | no evidence |
| T-limit-line | Limit that raises a diagnostic · Eight series | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-limit-area | Limit that raises a diagnostic · Eight series | not applicable | no evidence | not applicable | not applicable | not applicable | not applicable |
| T-limit-bar | Limit that raises a diagnostic · Eight series | not applicable | not applicable | no evidence | not applicable | not applicable | not applicable |
| T-limit-donut | Limit that raises a diagnostic · Eight slices | not applicable | not applicable | not applicable | not applicable | not run | not applicable |
| T-limit-scatter | Limit that raises a diagnostic · Eight series | not applicable | not applicable | not applicable | no evidence | not applicable | not applicable |
| L6 | Title, subtitle and labelled axes with units belong to the chart; reference labels sit by their marks and axis titles stay clear of ticks. | no evidence | no evidence | no evidence | no evidence | no evidence | not applicable |
| T-reference-line | Reference lines and bands · Yes; included in the domain; listed in the summary and table caption | not run | not applicable | not applicable | not applicable | not applicable | not applicable |
| T-reference-area | Reference lines and bands · Yes | not applicable | no evidence | not applicable | not applicable | not applicable | not applicable |
| T-reference-bar | Reference lines and bands · Yes | not applicable | not applicable | not run | not applicable | not applicable | not applicable |
| T-reference-donut | Reference lines and bands · No | not applicable | not applicable | not applicable | not applicable | no evidence | not applicable |
| T-reference-scatter | Reference lines and bands · Yes | not applicable | not applicable | not applicable | no evidence | not applicable | not applicable |
| L5 | Point markers appear only when adjacent points are at least 12 px apart and always for isolated points. | no evidence | no evidence | not applicable | not applicable | not applicable | not applicable |
| C1 | A compact chart is an image with a full text alternative, no tab stop and no pointer-only behavior. | not applicable | not applicable | not applicable | not applicable | not applicable | no evidence |
| C2 | Compact keeps the fidelity rules for baseline, gaps, diagnostics, simplification, sorting, motion and page scheme. | not applicable | not applicable | not applicable | not applicable | not applicable | no evidence |
| C3 | Compact fills its container from 24×16 CSS px and is 32 px tall without a definite height. | not applicable | not applicable | not applicable | not applicable | not applicable | no evidence |
| C4 | Multiple compact lines differ by dash as well as color; AX131 suggests one series per compact chart. | not applicable | not applicable | not applicable | not applicable | not applicable | no evidence |
| C5 | When values are left out, the compact description says so and a corner marker has a text equivalent. | not applicable | not applicable | not applicable | not applicable | not applicable | not run |
| DX1 | The first chart takes ten lines or fewer via npm, script tag or React, using only data and fields. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| DX2 | Long rows, wide rows and typed columns produce the same normalized data and diagnostics with caller row indexes. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| DX3 | Invalid typed calls fail to compile; their untyped equivalents raise AX101, AX106 or AX150. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| DX4 | Diagnostics have stable codes, chart names, field and row indexes where appropriate, fixes and a documentation page per code. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| DX5 | Update, append and zoom apply in order; validation is synchronous, one frame changes all visible state, and destroy cancels work. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| DX6 | CSS custom properties style charts; font and color are inherited, and a series name pins its color across charts. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| DX7 | Zero runtime dependencies and provisional minified+gzipped size targets, CSS included. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| DX8 | Works without a DOM at import, in React StrictMode and under strict CSP, inserts text safely, and names unmatched selectors. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| DX9 | Follow semantic versioning and the deprecation policy; previous documented examples still compile and run. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| DX10 | Every runnable documentation example is compiled and rendered in CI from the packed distribution. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| DX11 | Everything is MIT licensed, with third-party notices verified at release. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| DX12 | A coding agent uses published docs to make a first chart that passes reader criteria on trap fixtures. | no evidence | no evidence | no evidence | no evidence | no evidence | no evidence |
| P1 | Trend (3×120) first render · median main-thread task time of 20 runs. | cannot be verified here | not applicable | not applicable | not applicable | not applicable | not applicable |
| P2 | One typed-column series of 100,000 and 1,000,000 points · median first-render main-thread task time. | cannot be verified here | not applicable | not applicable | not applicable | not applicable | not applicable |
| P3 | Append at 60 Hz in a 600-point window · median task time per update and frames later than 25 ms. | cannot be verified here | not applicable | not applicable | not applicable | not applicable | not applicable |
| P4 | Pointer across a 100,000-point chart · p95 input to the matching readout frame. | not run | not run | not run | not run | not applicable | not applicable |
| P5 | Create 24 trend charts · median total main-thread task time. | cannot be verified here | not applicable | not applicable | not applicable | not applicable | not applicable |
| P6 | Download · exact minified and gzipped bytes, CSS included. | not run | not run | not run | not run | not run | not run |
| P7 | Measure owned bytes beyond one million caller points and heap trends over 1,000 create–destroy cycles after collection. | cannot be verified here | not run | not run | not run | not run | not run |
| P8 | Create 40 compact charts · median total main-thread task time. | not applicable | not applicable | not applicable | not applicable | not applicable | not run |

## Coverage gaps in reader priority order

- **F1** · Bar and area value axes always include zero; a domain that excludes zero is widened and raises AX110.
  - No evidence · compact
  - Weak · compact · unit · [packages/axylo/test/view/review.test.ts](../packages/axylo/test/view/review.test.ts) · reports AX130, AX131 and AX110 only when their conditions newly apply · Checks AX110 for a compact area with an author domain, but does not inspect its baseline or exercise compact bars.
- **F2** · Missing values are never drawn as zero and never bridged unless the author asks; readouts say “No data”.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · unit · [packages/axylo/test/data/normalize.test.ts](../packages/axylo/test/data/normalize.test.ts) · represents seven explicit nulls and seven deleted daily rows with the same disallowed joins · Compares slot tags and diagnostics but does not compare the drawn gaps or readouts.
  - Weak · line · unit · [packages/axylo/test/data/normalize.test.ts](../packages/axylo/test/data/normalize.test.ts) · imputes zero for absent fields, nulls, gaps, and no row, with no invented provenance · Checks stored zero imputation without checking drawn marks and all readouts.
  - Weak · line · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · packs the exact projected vertices and a pen lift, and shows the isolated value · Checks one fixture’s gap and isolated mark but does not exercise deleted steps, zero imputation or accessible readouts.
  - Weak · line · unit · [packages/axylo/test/lookup/aligned.test.ts](../packages/axylo/test/lookup/aligned.test.ts) · reads values, absent observations, and explicit nulls in series order · Checks missing and unobserved tooltip values but does not check table cells or announcements.
  - Weak · area · unit · [packages/axylo/test/simplify/simplify.test.ts](../packages/axylo/test/simplify/simplify.test.ts) · preserves each boundary’s own extremes and pairs matching endpoints across breaks · Checks supplied breaks in area boundaries but does not check how missing rows or imputation produce those breaks.
  - Weak · bar · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · uses projected zero as the baseline and represents missing and zero bars separately · Distinguishes missing from zero at the baseline, but does not check step imputation or missing-value readouts.
  - Weak · scatter · unit · [packages/axylo/test/data/normalize.test.ts](../packages/axylo/test/data/normalize.test.ts) · sorts scatter points by x then y and retains provenance while omitting invalid points · Checks invalid and missing rows at normalization, but does not exercise the declared zero-imputation path.
  - Weak · donut · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · lists zero and null entries with no arcs and leaves an all-zero ring empty · Checks that null does not produce an arc but does not check “No data” in reader-facing text.
  - Weak · compact · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · draws compact paths without axes, references, or regular markers but keeps isolated points · Exercises compact line gaps only and does not check missing compact bar or area marks.
- **F3** · Input that cannot be plotted as given is reported, never guessed.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · browser · [packages/axylo/test/browser/chart/data.browser.test.ts](../packages/axylo/test/browser/chart/data.browser.test.ts) · describe prefix “dirty input (spec 3.5, F12)” · Checks three dirty-input codes and the note, but does not cover the full diagnostic registry and drawing outcomes.
  - Weak · area, bar · unit · [packages/axylo/test/core/validate.test.ts](../packages/axylo/test/core/validate.test.ts) · validate reports the combined dirty fixture as AX102, AX103 and AX106, once each · Checks three codes through validate without asserting drawing or disclosures.
  - Weak · scatter, donut · unit · [packages/axylo/test/core/validate.test.ts](../packages/axylo/test/core/validate.test.ts) · validate works for scatter and donut · Checks one diagnostic for each type without verifying other applicable codes or what the reader sees.
  - Weak · compact · browser · [packages/axylo/test/browser/chart/render.browser.test.ts](../packages/axylo/test/browser/chart/render.browser.test.ts) · with values left out, the description says so and a corner marker appears; there is no note element · Asserts the omission disclosure for a dirty compact line without checking the registry’s codes and drawing outcomes.
- **F12** · When warnings mean values were left out or changed, a note appears inside the figure and in the accessibility tree, in every build.
  - No evidence · line, area, bar, scatter, donut
  - Weak · line · browser · [packages/axylo/test/browser/chart/data.browser.test.ts](../packages/axylo/test/browser/chart/data.browser.test.ts) · describe prefix “dirty input (spec 3.5, F12)” · Checks the omission count in development and production, but never changes a value through a warning and checks the changed-value note.
  - Weak · line · unit · [packages/axylo/test/reader/index.test.ts](../packages/axylo/test/reader/index.test.ts) · keeps disclosures before the author description and joins both visible notes · Checks the text of both notices for one supplied disclosure, but does not exercise the changed-value warning in a built chart’s accessibility tree.
  - Weak · line · browser · [packages/axylo/test/browser/chart/review.browser.test.ts](../packages/axylo/test/browser/chart/review.browser.test.ts) · a throwing tick formatter shows its note on the frame that found it; a working one removes AX160 and the note · Checks a changed-value note in the figure but not its accessibility-tree entry or the production build.
- **F10** · Stacks place positive and negative values on their own sides of zero; missing components mark the stack incomplete.
  - No evidence · area, bar, compact
  - Weak · area · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · accumulates on separate sides in series order and marks an incomplete stack · Checks stack totals, bounds and incomplete flags, but does not exercise the reader-facing tooltip, table and announcement together.
  - Weak · area · unit · [packages/axylo/test/lookup/aligned.test.ts](../packages/axylo/test/lookup/aligned.test.ts) · formats stacked totals and preserves the incomplete marker for announcements · Checks a formatted tooltip and datum for a synthetic incomplete stack, but does not exercise live announcements.
  - Weak · area · unit · [packages/axylo/test/reader/index.test.ts](../packages/axylo/test/reader/index.test.ts) · marks an incomplete stack in its row header without changing the series cells · Checks the table model row without rendering the table or delivering an announcement.
  - Weak · bar · property · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · matches visible components of generated long-form stacks, including gaps and absent rows · Checks 1,000 stack models including missing components but does not exercise the tooltip, table or announcements.
- **F8** · Donut slices keep order, start at 12 o’clock and run clockwise; nulls, zeros, negatives and excess slices have distinct outcomes.
  - No evidence · donut
  - Weak · donut · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · describe prefix “donut slices” · Checks slice geometry, grouping and diagnostics in the view but does not verify the negative and all-zero figure states or “No data” in the rendered legend.
  - Weak · donut · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · the donut legend is a list of six entries with value and percentage, in slice order, not buttons · Uses six non-null entries, and each displayed value and share has the same text so one missing field could pass.
  - Weak · donut · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · a donut with more than eight slices lists "Other" with its count, and a zero slice without an arc · Asserts only that an entry starts with “Other (”; neither the count nor the zero slice’s geometry is asserted.
  - Weak · donut · unit · [packages/axylo/test/reader/index.test.ts](../packages/axylo/test/reader/index.test.ts) · presents grouped donut categories separately in the table and together in the summary · Checks the table model for all categories using a pregrouped view, without opening the grouped chart’s table.
- **F4** · Calendar dates read the same in every zone; instants name their zone; wall-clock times are shown as written.
  - No evidence · line, area, bar, scatter, compact
  - Weak · line · browser · [packages/axylo/test/browser/chart/data.browser.test.ts](../packages/axylo/test/browser/chart/data.browser.test.ts) · the dates fixture as date strings gives identical tick text in UTC, America/Los_Angeles and Asia/Kolkata · Checks calendar ticks in three zones but does not assert local instant text and named zones for all instant forms.
  - Weak · line · unit · [packages/axylo/test/data/normalize.test.ts](../packages/axylo/test/data/normalize.test.ts) · handles wall-clock text and explicit offsets without using the viewer zone for parsing · Checks temporal parsing and hints, but does not inspect the tooltip or heading text produced by each chart.
- **F11** · Line, area and scatter draw in x order; duplicate x disables an aligned series, while scatter keeps coincident points.
  - No evidence · line, area, bar, scatter, compact
  - Weak · line · unit · [packages/axylo/test/data/normalize.test.ts](../packages/axylo/test/data/normalize.test.ts) · sorts shuffled input and preserves original row indexes · Checks sorted normalized positions rather than identical drawing for shuffled trend input.
  - Weak · line · unit · [packages/axylo/test/data/normalize.test.ts](../packages/axylo/test/data/normalize.test.ts) · preserves the first row and disables every affected wide series for duplicate x · Asserts AX108 and disabled flags for wide line data, without checking the drawn marks or long-form case.
  - Weak · scatter · unit · [packages/axylo/test/data/review.test.ts](../packages/axylo/test/data/review.test.ts) · keeps scatter points sharing x or both coordinates, ordered by x then y · Proves coincident points are retained in the sorted frame but does not check that they are drawn in that order.
- **F5** · Dense drawing preserves the exact per-pixel extrema of each valid run and keeps every break.
  - No evidence · line, area, compact
  - Weak · line · unit · [packages/axylo/test/simplify/simplify.test.ts](../packages/axylo/test/simplify/simplify.test.ts) · keeps a million-slot outlier at multiple plot widths and device ratios · Checks a million-slot outlier at two DPRs, but does not check whether a sample dropped from the stroke stays reachable in the table and by keyboard.
  - Weak · line · property · [packages/axylo/test/simplify/simplify.test.ts](../packages/axylo/test/simplify/simplify.test.ts) · agrees with a series-wide oracle for column extrema, range edges and device pixels · Checks 600 generated datasets instead of the required 1,000 and does not exercise exact readouts.
  - Weak · area · unit · [packages/axylo/test/simplify/simplify.test.ts](../packages/axylo/test/simplify/simplify.test.ts) · preserves each boundary’s own extremes and pairs matching endpoints across breaks · Checks a small example of paired area boundaries, but not dense end-to-end stack sums or reachability of dropped samples.
  - Weak · compact · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · draws compact paths without axes, references, or regular markers but keeps isolated points · Checks a short compact line and does not verify dense extrema in compact lines and stacked areas.
- **T-dense-line** · Simplified drawing when dense · F5
  - No evidence · line
  - Weak · line · property · [packages/axylo/test/simplify/simplify.test.ts](../packages/axylo/test/simplify/simplify.test.ts) · agrees with a series-wide oracle for column extrema, range edges and device pixels · Checks 600 generated datasets instead of 1,000 and does not verify exact readouts of omitted stroke samples.
- **T-dense-area** · Simplified drawing when dense · F5 on cumulative sums
  - No evidence · area
  - Weak · area · unit · [packages/axylo/test/simplify/simplify.test.ts](../packages/axylo/test/simplify/simplify.test.ts) · preserves each boundary’s own extremes and pairs matching endpoints across breaks · Checks an example of paired boundaries, without verifying dense cumulative stacks across zooms and device ratios.
- **T-dense-bar** · Simplified drawing when dense · No; more bars than pixels raises a hint
  - No evidence · bar
  - Weak · bar · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · draws every subpixel band with at least a CSS pixel of width · Confirms subpixel marks are retained but does not check the required hint.
- **T-dense-donut** · Simplified drawing when dense · No
  - No evidence · donut
- **T-dense-scatter** · Simplified drawing when dense · No in 1.0; above 50,000 points a hint says drawing may be slow
  - No evidence · scatter
  - Weak · scatter · unit · [packages/axylo/test/lookup/scatter.test.ts](../packages/axylo/test/lookup/scatter.test.ts) · examines only nearby cells on a 200,000-point pick · Measures picking work rather than unchanged drawing or the over-50,000-point diagnostic.
- **F7** · The zoomed view stays inside the author or automatic domain; the automatic domain contains data, references and stack totals.
  - No evidence · line, area, bar, scatter, compact
  - Weak · line · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · uses the author x extent and keeps the zoom width on either side · Checks zoom precedence but does not check value-scale thresholds, reference extents and tick limits together.
  - Weak · area · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · accumulates on separate sides in series order and marks an incomplete stack · Checks both stack totals in the axis extent without checking zoom precedence or percent/ratio thresholds.
  - Weak · bar · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · rounds a small maximum normally and includes full scale only above the percent threshold · Checks percent but not the ratio rule or domain precedence on bars.
  - Weak · scatter · unit · [packages/axylo/test/view/review.test.ts](../packages/axylo/test/view/review.test.ts) · includes x lines and bands in the automatic extent, including on scatter · Checks x-reference extents but not the combined author, automatic and zoomed limits with value-scale options.
  - Weak · compact · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · keeps category bars and compact charts on their full x ranges · Checks that one compact line ignores zoom but does not verify domain calculation for compact areas and bars.
- **F6** · Format numbers and dates for the page locale, separately for ticks and readouts; a throwing formatter falls back with a diagnostic.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · browser · [packages/axylo/test/browser/chart/data.browser.test.ts](../packages/axylo/test/browser/chart/data.browser.test.ts) · a custom formatter that throws falls back to the default, raises AX160 when found, and is never thrown · Checks a throwing tick formatter but does not check the requested locales across tick labels, tooltip, table and announcements.
  - Weak · line · unit · [packages/axylo/test/format/number.test.ts](../packages/axylo/test/format/number.test.ts) · describe prefix “readout format (spec F6)” · Checks localized readout strings and formatter fallback without asserting that the chart passes the page locale to all reader surfaces.
  - Weak · line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · opens from the toolbar with a caption, headers with units and row headers; pages of 100; closing removes it · Checks a table value with a unit but does not compare tick and readout precision or test multiple page locales.
  - Weak · donut · unit · [packages/axylo/test/lookup/donut.test.ts](../packages/axylo/test/lookup/donut.test.ts) · formats slice percentages through the supplied formatter regardless of the legacy locale argument · Checks an injected percentage formatter but does not verify default locale formatting or thrown-formatter fallback.
- **A3** · The focused point conveys its text; touch screen readers can swipe to every point or reach the table in two gestures.
  - Weak · line · browser · [packages/axylo/test/browser/a11y/keyboard.browser.test.ts](../packages/axylo/test/browser/a11y/keyboard.browser.test.ts) · reads every series at x, narrows to one with Down, reaches the ends, pages by a tenth, and selects · Checks Chrome focus and the DOM value text on several keys, but cannot establish what screen readers say or how touch gestures work.
- **A1** · Every chart has an accessible name and generated summary, and chart element ids are unique.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · browser · [packages/axylo/test/browser/chart/render.browser.test.ts](../packages/axylo/test/browser/chart/render.browser.test.ts) · a chart without title or labelledBy gets a generated name and AX140 · Checks the generated name and AX140 in one build only.
  - Weak · line · browser · [packages/axylo/test/browser/chart/render.browser.test.ts](../packages/axylo/test/browser/chart/render.browser.test.ts) · 24 charts on one page: no duplicate ids, each its own name · Checks unique line-chart ids and authored names without inspecting ranges, per-series statistics or the accessible description.
  - Weak · line · unit · [packages/axylo/test/reader/index.test.ts](../packages/axylo/test/reader/index.test.ts) · summarizes three visible series within the shown range and includes the reference position in the summary and caption · Checks a reader-model summary with ranges and series extrema but there is no browser assertion on the full accessible summary across builds.
  - Weak · bar, area, scatter, donut, compact · browser · [packages/axylo/test/browser/chart/render.browser.test.ts](../packages/axylo/test/browser/chart/render.browser.test.ts) · describe prefix “the other chart types” · Asserts the title linkage and a nonempty description with the fixture, but does not verify generated naming, full summary or unique IDs for this type.
- **A2** · At most two tab stops with the table closed; every point is reachable, the toolbar roves, and focus can leave the chart.
  - No evidence · line, area, bar, scatter, donut
  - Weak · line · browser · [packages/axylo/test/browser/a11y/keyboard.browser.test.ts](../packages/axylo/test/browser/a11y/keyboard.browser.test.ts) · describe prefix “tab order (spec A2)” · Checks line tab order, roving and a table-open path, but does not verify reachability of every datum and ring visibility.
  - Weak · line · browser · [packages/axylo/test/browser/a11y/keyboard.browser.test.ts](../packages/axylo/test/browser/a11y/keyboard.browser.test.ts) · the focus ring is at least 2 px in the focus color and is drawn only for keyboard focus · Compares tooltip and ring areas but does not check actual intersection or obscuring across positions and themes.
  - Weak · scatter · unit · [packages/axylo/test/lookup/scatter.test.ts](../packages/axylo/test/lookup/scatter.test.ts) · walks partial ranges with hidden series and duplicate x and y in fixture order · Checks the lookup order over 60 inputs, but does not drive keyboard focus or measure tab stops or the indicator.
  - Weak · donut · unit · [packages/axylo/test/lookup/donut.test.ts](../packages/axylo/test/lookup/donut.test.ts) · includes zero and missing slices in keyboard order, with no drawn anchor · Checks model stepping over two arcless slices, without exercising the DOM keyboard or focus indicator.
- **T-keyboard-area** · Keyboard order · By x, then series
  - No evidence · area
- **T-keyboard-bar** · Keyboard order · By category, then series
  - No evidence · bar
- **T-keyboard-donut** · Keyboard order · By slice order
  - No evidence · donut
  - Weak · donut · unit · [packages/axylo/test/lookup/donut.test.ts](../packages/axylo/test/lookup/donut.test.ts) · includes zero and missing slices in keyboard order, with no drawn anchor · Checks two adjacent end-of-ring steps, without testing a full walk in slice order.
- **T-keyboard-scatter** · Keyboard order · By x, then y
  - No evidence · scatter
  - Weak · scatter · unit · [packages/axylo/test/lookup/scatter.test.ts](../packages/axylo/test/lookup/scatter.test.ts) · walks partial ranges with hidden series and duplicate x and y in fixture order · Checks the lookup order over 60 inputs, but does not verify that the actual keyboard path walks the same order.
- **A4** · View as table opens a normalized HTML table in the current range, with pagination or x jump, in a focusable scroll region.
  - No evidence · area, bar, scatter, donut
  - Weak · area · unit · [packages/axylo/test/reader/index.test.ts](../packages/axylo/test/reader/index.test.ts) · marks an incomplete stack in its row header without changing the series cells · Checks one table-model row but does not open an HTML table, page it or measure its scroll region.
  - Weak · scatter · unit · [packages/axylo/test/reader/index.test.ts](../packages/axylo/test/reader/index.test.ts) · merges scatter rows in x then y order including hidden series · Checks table-model row merging but does not drive the HTML table or its controls.
  - Weak · donut · unit · [packages/axylo/test/reader/index.test.ts](../packages/axylo/test/reader/index.test.ts) · presents grouped donut categories separately in the table and together in the summary · Checks table-model rows and headers but does not verify the HTML table, focusable region or page geometry.
- **A5** · Series are never distinguished by color alone; filled marks have separators and the palette meets contrast and distance thresholds.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · browser · [packages/axylo/test/browser/chart/theme.browser.test.ts](../packages/axylo/test/browser/chart/theme.browser.test.ts) · an author color with poor contrast raises AX141 after theme resolution, and strict does not throw for it · Checks AX141 for a custom color but not the default eight colors’ pairwise difference under simulated color-vision deficiencies.
  - Weak · line · browser · [packages/axylo/test/browser/render/theme.browser.test.ts](../packages/axylo/test/browser/render/theme.browser.test.ts) · both renderers switch to the contrast dash; canvas through the resolved theme, svg through CSS · Checks a contrast dash on a renderer fixture without checking that each of multiple series is distinguishable in the plot and its readouts.
  - Weak · line, area, bar, scatter, donut, compact · unit · [packages/axylo/test/theme/palette.test.ts](../packages/axylo/test/theme/palette.test.ts) · describe prefix “default palette (spec A5” · Checks the shipped palette’s simulated contrast and distances, without testing the chart’s rendered marks or non-color cues.
  - Weak · area · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · shares exact packed boundaries between adjacent stacked areas on both sides of zero · Checks common edges in the packed scene but does not verify a rendered background separator or identity markers in readouts.
  - Weak · bar · browser · [packages/axylo/test/browser/render/review.browser.test.ts](../packages/axylo/test/browser/render/review.browser.test.ts) · a patterned bar differs from a plain bar of the same color in both renderers, and the renderers agree · Checks an author-independent renderer pattern on two marks, but not the default grouped and stacked chart cues and separators.
  - Weak · scatter · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · offsets scatter marker shapes every eight series · Checks a marker shape across palette cycles but not palette distances or whether all cues are visible in plot and readouts.
  - Weak · donut · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · uses the slice palette slots and a muted Other with a one-pixel gap · Checks scene separator width but not rendered separator pixels or color-vision simulation.
  - Weak · compact · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · gives compact series distinct normal dashes and raises AX131 · Checks two compact line dash styles without testing rendered cues for the other compact variants.
- **L1** · Text does not overlap or clip; a visible note appears if labels still do not fit.
  - No evidence · area, bar, scatter, donut
  - Weak · line · browser · [packages/axylo/test/browser/render/review.browser.test.ts](../packages/axylo/test/browser/render/review.browser.test.ts) · text: after text-spacing overrides and after a late font, relaid-out labels land on their boxes and nothing is clipped · Checks a standalone text layer at one size but not generated real charts, text-only zoom or the hidden-label note.
  - Weak · bar · property · [packages/axylo/test/layout/layout.test.ts](../packages/axylo/test/layout/layout.test.ts) · checks every layout kind, minimum plots and label attribution across generated sizes · Tests layout boxes with injected metrics, without testing real fonts, browser intersection or the visible note.
- **L2** · Text is at least 12 CSS px and 4.5:1; marks, axis lines and focus indicators are at least 3:1 in light and dark.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · toggles by click, Enter and Space; a hidden series leaves marks, tooltip and keyboard but stays in the table · Checks the contrast of a hidden legend entry in one scheme but does not cover all text, marks, axes and focus in both schemes.
  - Weak · compact · unit · [packages/axylo/test/theme/palette.test.ts](../packages/axylo/test/theme/palette.test.ts) · describe prefix “default palette (spec A5” · Checks palette and token contrast before rendering, without checking compact marks against their actual inherited background.
- **L7** · Empty, loading, error and internal failures show a message in the plot; a change is announced once, politely.
  - No evidence · area, bar, scatter, donut, compact
  - Weak · scatter · unit · [packages/axylo/test/core/controller.test.ts](../packages/axylo/test/core/controller.test.ts) · a scatter window with no point shows the empty state, and its zoom can still be reset · Checks the empty reader model only, without loading, error, internal failure or live announcement coverage.
  - Weak · donut · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · lists zero and null entries with no arcs and leaves an all-zero ring empty · Checks that no arcs are drawn for zero data without asserting a figure message or announcement.
  - Weak · compact · unit · [packages/axylo/test/core/controller.test.ts](../packages/axylo/test/core/controller.test.ts) · an all-invalid chart keeps the reader note in its empty state (F12), and the compact marker (C5) · Checks an empty compact line summary but not loading/error alternatives or announcement behavior for compact variants.
- **L8** · Below a readable plot size of 120×80 CSS px, show the title, summary and table control and raise AX142.
  - No evidence · line, area, bar, scatter, donut
  - Weak · line · unit · [packages/axylo/test/core/controller.test.ts](../packages/axylo/test/core/controller.test.ts) · stepping the container one pixel at a time through the boundary, both ways, switches once and never alternates · Checks height-based fallback stability but not the title, summary, table control and AX142 together.
  - Weak · line · browser · [packages/axylo/test/browser/chart/review.browser.test.ts](../packages/axylo/test/browser/chart/review.browser.test.ts) · stepping a container one pixel at a time through the L8 boundary switches once, at the same height both ways · Checks that the line summary changes visibility at a stable boundary but does not assert table access, title and AX142.
- **L3** · The chart follows its container; automatic height is 16:9 clamped to 160–480 CSS px; initially hidden charts draw when sized.
  - No evidence · area, bar, scatter, donut
- **L4** · The chart follows the page color scheme; changes repaint within one frame and forced colors use system colors.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · browser · [packages/axylo/test/browser/chart/theme.browser.test.ts](../packages/axylo/test/browser/chart/theme.browser.test.ts) · toggling a dark class repaints within a frame, without rebuilding the scene (svg) · Asserts a one-frame repaint on one class change, without exercising all supported class, style, data-theme and media transitions on a chart.
  - Weak · line · browser · [packages/axylo/test/browser/render/theme.browser.test.ts](../packages/axylo/test/browser/render/theme.browser.test.ts) · describe prefix “forced colors (emulated)” · Checks forced system colors in a renderer harness but does not exercise switching a public chart into and out of the mode.
  - Weak · compact · browser · [packages/axylo/test/browser/chart/render.browser.test.ts](../packages/axylo/test/browser/chart/render.browser.test.ts) · describe prefix “the other chart types” · Renders a compact line but does not change the page scheme and compare the marks.
- **A6** · Reflow at 320 CSS px and 400% zoom without two-dimensional scrolling; user text spacing does not clip.
  - Weak · line · browser · [packages/axylo/test/browser/render/review.browser.test.ts](../packages/axylo/test/browser/render/review.browser.test.ts) · text: after text-spacing overrides and after a late font, relaid-out labels land on their boxes and nothing is clipped · Checks a standalone text layer under spacing overrides but does not check full-figure reflow at 320 px or 400% zoom.
- **I1** · Pointing shows the correct readout within a frame at p95; it stays in view, avoids the mark and supports hover, fallback and Escape.
  - No evidence · line, area, bar, scatter, donut
  - Weak · line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · between two days shows every series at the nearer one, within one frame · Checks one pointer move, so it cannot establish 95th-percentile input-to-readout latency.
  - Weak · line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · at each of the four plot edges it stays inside the viewport and beside the active x · Checks four edge positions and exclusion of the active x, without proving that the tooltip avoids the full active mark.
  - Weak · line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · can be hovered without closing, and Escape closes it until the pointer reaches another x · Checks hover and dismissal for one line fixture without testing the readout timing requirement.
  - Weak · line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · in a 260 px wide tile the same content is shown in the fixed readout under the plot · Checks fixed placement and series names but does not compare the full fixed readout with the floating one.
  - Weak · line · unit · [packages/axylo/test/lookup/aligned.test.ts](../packages/axylo/test/lookup/aligned.test.ts) · reads values, absent observations, and explicit nulls in series order · Checks sparse-series wording in the lookup but not screen placement, hover behavior or fallback on the sparse fixture.
  - Weak · area · unit · [packages/axylo/test/lookup/aligned.test.ts](../packages/axylo/test/lookup/aligned.test.ts) · formats stacked totals and preserves the incomplete marker for announcements · Checks a lookup stack tooltip but does not drive a pointer, measure latency or check placement and fallback.
  - Weak · bar · unit · [packages/axylo/test/lookup/aligned.test.ts](../packages/axylo/test/lookup/aligned.test.ts) · picks a horizontal bar by y and returns the grouped mark bounds · Checks a horizontal bar’s lookup and anchor without checking the rendered readout or timing.
  - Weak · scatter · unit · [packages/axylo/test/lookup/scatter.test.ts](../packages/axylo/test/lookup/scatter.test.ts) · picks the nearest point within 24 px and breaks a tie by later source row · Checks nearest-point lookup without measuring rendered readout timing or verifying Escape and fallback.
  - Weak · donut · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · a donut slice shows label, value and percentage; the overlay outlines it · Checks one slice’s readout and overlay without the timing distribution, viewport edges, hover and Escape.
- **T-pointer-area** · Picking by pointer · Nearest x
  - No evidence · area
- **T-pointer-bar** · Picking by pointer · The band under the pointer
  - No evidence · bar
  - Weak · bar · unit · [packages/axylo/test/lookup/aligned.test.ts](../packages/axylo/test/lookup/aligned.test.ts) · picks a horizontal bar by y and returns the grouped mark bounds · Checks a horizontal pick at each band center, where a nearest-category rule could also pass; it does not test band edges, inter-band gaps or vertical bars.
- **T-tooltip-area** · Tooltip content · Every visible series at that x, plus the stack total
  - No evidence · area
  - Weak · area · unit · [packages/axylo/test/lookup/aligned.test.ts](../packages/axylo/test/lookup/aligned.test.ts) · formats stacked totals and preserves the incomplete marker for announcements · Asserts one stack total and the missing component but does not check every series in the tooltip or exclude a hidden series.
- **T-tooltip-bar** · Tooltip content · Every series in that category
  - No evidence · bar
- **I2** · Legend entries are pressed-state toggle buttons operable by click, Enter and Space.
  - No evidence · area, bar, scatter
- **I3** · Zoom works by controls, drag, keyboard and opt-in pinch; the wheel respects focus and Ctrl/Meta.
  - No evidence · line, area, bar, scatter
  - Weak · line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · Zoom in and out are single clicks around the centre; Reset appears only while zoomed; the zoom event carries the range · Uses Enter to activate Reset rather than proving that every path works by single clicks.
  - Weak · line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · the wheel does nothing while the plot is not focused (the page scrolls), zooms when it is, and never with Ctrl · Checks focused and unfocused scrolling in Chrome and uses synthetic events for the Ctrl/Meta paths, without exercising actual browser zoom shortcuts.
  - Weak · line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · with zoom: 'touch' a pinch zooms through the public path; without it the chart leaves pinch to the page · Exercises opted-in emulated pinch only; the default pinch behavior in the title is not exercised.
  - Weak · area · unit · [packages/axylo/test/view/review.test.ts](../packages/axylo/test/view/review.test.ts) · fits a monthly area between observations with the zero baseline · Checks the view after a requested range, without trying the visible controls or other input paths.
  - Weak · bar · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · a category bar chart has no zoom controls; a donut has none · Checks that category bars lack a Zoom in button, but does not exercise any continuous-axis bar zoom path.
  - Weak · scatter · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · keeps scatter ranges per series and uses only the points inside zoom for the value domain · Checks view filtering in a zoomed scatter plot but does not drive input methods or wheel gating.
- **T-zoom-bar** · Zoom · On time, date and numeric x only
  - No evidence · bar
  - Weak · bar · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · a category bar chart has no zoom controls; a donut has none · Despite the title this test constructs only a category bar, and it never tries time, date or numeric x.
- **T-zoom-donut** · Zoom · No
  - No evidence · donut
  - Weak · donut · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · the donut legend is a list of six entries with value and percentage, in slice order, not buttons · Confirms there is no zoom toolbar control, without trying the zoom handle or other zoom inputs.
- **I4** · Every interaction works by a single pointer and touch; controls measure at least 24×24 CSS px; one-finger drag scrolls the page.
  - Weak · line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · a tap pins the tooltip and a tap elsewhere dismisses it; a one-finger vertical drag scrolls the page · Checks emulated taps and page scroll but does not exercise the other controls on a real phone.
  - Weak · line · browser · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts) · every control and the focus indicator are visible in forced colors; nothing animates under reduced motion · Checks line toolbar control sizes but not all table controls or touch paths.
- **A7** · Data arriving does not speak; focus stays on the datum until it leaves the streaming window.
  - No evidence · line, area, bar, scatter, donut
  - Weak · line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · 24 charts appending for two seconds change no live region · Counts live-region mutations while none of the streaming charts has focus.
  - Weak · line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · keyboard focus stays on its datum until it leaves the window, then resolves forward · Checks focused value continuity and eviction but does not count live-region mutations while focused.
- **I6** · Append shows Pause/Resume; while paused, new rows are buffered and the view does not move.
  - No evidence · area, bar, scatter, donut
  - Weak · scatter · unit · [packages/axylo/test/core/controller.test.ts](../packages/axylo/test/core/controller.test.ts) · while paused, scatter and donut validate appended rows when append is called · Exercises scatter buffering through the controller without checking for a Pause/Resume control in the figure.
- **I5** · No first-render animation; updates take at most 200 ms and reduced motion removes transitions.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · browser · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts) · every control and the focus indicator are visible in forced colors; nothing animates under reduced motion · Samples CSS motion state after setup and zoom, without comparing first and later pixels in both settings or timing the 24-chart update.
- **A8** · axe-core reports no violations on any fixture in any state, including heading-order and scrollable-region-focusable.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · browser · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts) · trend: default, table open, tooltip shown, series hidden · Runs default, tooltip, hidden-series and table states, but omits zoomed, paused and error-recovery states.
  - Weak · line · browser · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts) · dirty: default, table open, tooltip shown, series hidden · Checks the named fixture once per applicable default/interactive state, without exercising state changes.
  - Weak · line · browser · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts) · empty: default, table open, tooltip shown, series hidden · Checks the named fixture once per applicable default/interactive state, without exercising state changes.
  - Weak · line · browser · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts) · loading: default, table open, tooltip shown, series hidden · Checks the named fixture once per applicable default/interactive state, without exercising state changes.
  - Weak · line · browser · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts) · error: default, table open, tooltip shown, series hidden · Checks the named fixture once per applicable default/interactive state, without exercising state changes.
  - Weak · area · browser · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts) · stacked: default, table open, tooltip shown, series hidden · Checks four basic states without testing zoomed or paused states.
  - Weak · bar · browser · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts) · bars: default, table open, tooltip shown, series hidden · Checks the single-series category fixture only, without grouped, stacked, hidden-series or continuous-axis bar states.
  - Weak · scatter · browser · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts) · scatter: default, table open, tooltip shown, series hidden · Checks basic interaction states but does not cover zoomed, paused or empty-view scatter.
  - Weak · donut · browser · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts) · parts: default, table open, tooltip shown, series hidden · Checks only the ordinary parts fixture, without grouped, all-zero or error states.
  - Weak · compact · browser · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts) · compact: default, table open, tooltip shown, series hidden · Checks the default compact line without dirty, compact bar or compact area fixtures.
- **A10** · Every built-in string can be replaced; built-in English is marked lang="en" on non-English pages.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · browser · [packages/axylo/test/browser/a11y/axe.browser.test.ts](../packages/axylo/test/browser/a11y/axe.browser.test.ts) · describe prefix “language (spec A10)” · Checks a zoom label and loading message overrides and selected language tags, without exercising all built-in strings.
- **A9** · A published WCAG 2.2 AA conformance table lists each applicable criterion, its test, author obligations and limits.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line, area, bar, scatter, donut, compact · document · [acceptance/README.md](README.md) · The acceptance checker validates named test references, but no published WCAG-by-success-criterion conformance table is present.
- **F9** · Up to eight series have distinct colors; above eight each keeps a distinct cue and AX130 is raised.
  - No evidence · line, area, bar, scatter, compact
  - Weak · line · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · assigns a unique normal color/dash pair to each of 12 series and warns once · Checks dash and shape identities and AX130, but infers color from a palette index rather than checking the actual colors.
  - Weak · area · unit · [packages/axylo/test/view/review.test.ts](../packages/axylo/test/view/review.test.ts) · reports AX130, AX131 and AX110 only when their conditions newly apply · Checks the diagnostic at nine series without checking the active colors and mark cues.
  - Weak · bar · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · assigns each palette cycle its own bar pattern (stacked false) · Checks bar pattern/slot assignments but not the actual colors and threshold diagnostic.
  - Weak · scatter · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · offsets scatter marker shapes every eight series · Checks marker changes without comparing actual colors or checking the series-limit diagnostic.
  - Weak · compact · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · gives compact series distinct normal dashes and raises AX131 · Checks two line dashes and AX131, but not the eight-series color limit or AX130 in all compact variants.
- **T-limit-area** · Limit that raises a diagnostic · Eight series
  - No evidence · area
  - Weak · area · unit · [packages/axylo/test/view/review.test.ts](../packages/axylo/test/view/review.test.ts) · reports AX130, AX131 and AX110 only when their conditions newly apply · Checks that nine series raise AX130 but does not test eight series without the warning.
- **T-limit-bar** · Limit that raises a diagnostic · Eight series
  - No evidence · bar
  - Weak · bar · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · assigns each palette cycle its own bar pattern (stacked false) · Checks a palette cycle without checking the ninth-series diagnostic.
- **T-limit-scatter** · Limit that raises a diagnostic · Eight series
  - No evidence · scatter
  - Weak · scatter · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · offsets scatter marker shapes every eight series · Checks marker changes without asserting the ninth-series diagnostic.
- **L6** · Title, subtitle and labelled axes with units belong to the chart; reference labels sit by their marks and axis titles stay clear of ticks.
  - No evidence · line, area, bar, scatter, donut
  - Weak · line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · axis titles: time and category x untitled unless labelled; number x and value axes titled with units · Checks axis strings but not their separation from ticks or visible title and subtitle together.
  - Weak · bar · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · the bars fixture shows its "Target" reference label next to the line at 90 · Checks a visible target label alongside a bar-chart reference, without asserting subtitle or axis-title overlap.
  - Weak · donut · browser · [packages/axylo/test/browser/chart/render.browser.test.ts](../packages/axylo/test/browser/chart/render.browser.test.ts) · describe prefix “the other chart types” · Checks the donut name but does not assert that an authored subtitle appears with the title.
- **T-reference-area** · Reference lines and bands · Yes
  - No evidence · area
  - Weak · area · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · draws a 1.5 px dashed reference rule over area marks · Draws a dashed rule on an area chart without exercising reference bands.
- **T-reference-donut** · Reference lines and bands · No
  - No evidence · donut
- **T-reference-scatter** · Reference lines and bands · Yes
  - No evidence · scatter
  - Weak · scatter · unit · [packages/axylo/test/view/review.test.ts](../packages/axylo/test/view/review.test.ts) · includes x lines and bands in the automatic extent, including on scatter · Checks that lines and bands extend the domain without checking their scatter marks or reader output.
- **L5** · Point markers appear only when adjacent points are at least 12 px apart and always for isolated points.
  - No evidence · line, area
  - Weak · line · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · uses the minimum spacing for markers and always keeps the last joined point · Checks one sparse/dense spacing example but does not exercise the 12 px boundary or the specified sparse and trend fixtures.
  - Weak · area · unit · [packages/axylo/test/simplify/simplify.test.ts](../packages/axylo/test/simplify/simplify.test.ts) · preserves each boundary’s own extremes and pairs matching endpoints across breaks · Checks an isolated area source index without testing regular marker density in an actual area scene.
- **C1** · A compact chart is an image with a full text alternative, no tab stop and no pointer-only behavior.
  - No evidence · compact
  - Weak · compact · browser · [packages/axylo/test/browser/chart/render.browser.test.ts](../packages/axylo/test/browser/chart/render.browser.test.ts) · describe prefix “the other chart types” · Checks the image role, authored name and nonempty summary of one compact line, without generated names, all summary fields or multiple tiles.
  - Weak · compact · browser · [packages/axylo/test/browser/a11y/keyboard.browser.test.ts](../packages/axylo/test/browser/a11y/keyboard.browser.test.ts) · a compact chart adds no tab stop (spec C1) · Checks tab stops for one compact line, without the 40-tile test or asserting no pointer-only behavior.
- **C2** · Compact keeps the fidelity rules for baseline, gaps, diagnostics, simplification, sorting, motion and page scheme.
  - No evidence · compact
  - Weak · compact · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · draws compact paths without axes, references, or regular markers but keeps isolated points · Only checks gap-related geometry for one compact line; it does not cover all compact fidelity rules or the other variants.
- **C3** · Compact fills its container from 24×16 CSS px and is 32 px tall without a definite height.
  - No evidence · compact
  - Weak · compact · browser · [packages/axylo/test/browser/chart/render.browser.test.ts](../packages/axylo/test/browser/chart/render.browser.test.ts) · describe prefix “the other chart types” · Checks the 32 px default for one compact line but does not resize to the 24×16 minimum or exercise the other compact types.
  - Weak · compact · unit · [packages/axylo/test/layout/layout.test.ts](../packages/axylo/test/layout/layout.test.ts) · returns too-small, compact, and unmeasured layouts · Checks the plot box at 24×16 in layout, without checking the actual figure and marks at that size.
- **C4** · Multiple compact lines differ by dash as well as color; AX131 suggests one series per compact chart.
  - No evidence · compact
  - Weak · compact · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · gives compact series distinct normal dashes and raises AX131 · Checks distinct dash settings and AX131 but does not assert distinct colors or render two compact lines.
  - Weak · compact · browser · [packages/axylo/test/browser/render/review.browser.test.ts](../packages/axylo/test/browser/render/review.browser.test.ts) · C4: a non-solid normal dash is drawn in normal mode by both renderers, and the contrast dash differs · Draws an injected dash in a renderer fixture without verifying a two-series compact chart or AX131.
- **DX1** · The first chart takes ten lines or fewer via npm, script tag or React, using only data and fields.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · document · [docs/api/examples.ts](../docs/api/examples.ts) · Includes a typed starter example but does not render the npm, script-tag and React snippets from a packed distribution.
- **DX2** · Long rows, wide rows and typed columns produce the same normalized data and diagnostics with caller row indexes.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · unit · [packages/axylo/test/data/normalize.test.ts](../packages/axylo/test/data/normalize.test.ts) · produces equal aligned values and slots from long, wide and typed inputs · Checks three equivalent inputs for one data fixture and one mixed numeric diagnostic, without applying the equivalence check to the other data and diagnostics fixtures.
- **DX3** · Invalid typed calls fail to compile; their untyped equivalents raise AX101, AX106 or AX150.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · document · [docs/api/examples.ts](../docs/api/examples.ts) · Shows compile-time examples but does not run untyped equivalents or assert the three runtime codes.
  - Weak · line · unit · [packages/axylo/test/core/validate.test.ts](../packages/axylo/test/core/validate.test.ts) · validate raises AX140 without a title or labelledBy, and AX101 for a misspelled field · Checks AX101 for a typo but does not assert AX106 and AX150 for the counterpart invalid calls.
  - Weak · donut · document · [packages/react/test/types.check.tsx](../packages/react/test/types.check.tsx) · Checks invalid donut props through TypeScript but has no runtime counterpart for them.
- **DX4** · Diagnostics have stable codes, chart names, field and row indexes where appropriate, fixes and a documentation page per code.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line, area, bar, scatter, donut, compact · unit · [packages/axylo/test/diagnostics/registry.test.ts](../packages/axylo/test/diagnostics/registry.test.ts) · describe prefix “diagnostic registry” · Checks registry levels and messages for selected inputs, without checking all fields and fixes or a documentation page and live link per code.
- **DX5** · Update, append and zoom apply in order; validation is synchronous, one frame changes all visible state, and destroy cancels work.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · browser · [packages/axylo/test/browser/chart/lifecycle.browser.test.ts](../packages/axylo/test/browser/chart/lifecycle.browser.test.ts) · update({ data }), append and zoom in one turn are drawn once and end in the expected state · Checks draw count and final data/range but does not observe marks, labels, hit testing and accessible readout together across the commit.
  - Weak · line · browser · [packages/axylo/test/browser/chart/lifecycle.browser.test.ts](../packages/axylo/test/browser/chart/lifecycle.browser.test.ts) · a rejected strict update throws and leaves the previous chart intact · Checks rollback and synchronous throwing for update on one chart without testing the rest of the commit contract.
  - Weak · scatter · unit · [packages/axylo/test/core/controller.test.ts](../packages/axylo/test/core/controller.test.ts) · scatter \[10, 20\] + 5 with keep 2 keeps the latest two x positions \[10, 20\] and raises AX151 · Checks the outcome of one append rather than update/append/zoom ordering or atomic presentation.
- **DX6** · CSS custom properties style charts; font and color are inherited, and a series name pins its color across charts.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · browser · [packages/axylo/test/browser/render/theme.browser.test.ts](../packages/axylo/test/browser/render/theme.browser.test.ts) · colors: { Direct: "var(--brand)" } stays live in SVG: changing --brand recolors with no draw call · Checks one pinned color in a renderer harness but does not compare named series across a 24-chart page or verify font and spacing inheritance.
  - Weak · donut · unit · [packages/axylo/test/core/controller.test.ts](../packages/axylo/test/core/controller.test.ts) · Empty: 0 before Sales: 4 with Sales pinned: the theme binds the pin to the palette slot the Sales arc uses · Checks the slice color binding on one figure without testing cross-chart pins or the CSS contract.
- **DX7** · Zero runtime dependencies and provisional minified+gzipped size targets, CSS included.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line, area, bar, scatter, donut, compact · document · [scripts/size.mjs](../scripts/size.mjs) · Measures local source bundles and counts CSS if present, without measuring the packed distribution or auditing runtime dependencies.
  - Weak · line, area, bar, scatter, donut, compact · unit · [packages/react/test/size.test.ts](../packages/react/test/size.test.ts) · production build is at most 2 KiB gzipped · Checks the local React bundle size only; it does not check the packed bytes or dependency contract.
- **DX8** · Works without a DOM at import, in React StrictMode and under strict CSP, inserts text safely, and names unmatched selectors.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · unit · [packages/axylo/test/core/validate.test.ts](../packages/axylo/test/core/validate.test.ts) · imports without a DOM and exports the five chart functions and validate · Imports the source entry in Node but does not exercise the packed artifact or the browser requirements.
  - Weak · line · browser · [packages/react/test/browser/react.browser.test.ts](../packages/react/test/browser/react.browser.test.ts) · setup, cleanup, setup leaves one chart; unmount leaves nothing behind · Checks StrictMode lifecycle for a line chart; that scenario does not check CSP or insertion of untrusted text.
  - Weak · line · browser · [packages/axylo/test/browser/render/review.browser.test.ts](../packages/axylo/test/browser/render/review.browser.test.ts) · DX8: text layer, renderers and styles work under a Content Security Policy without unsafe-inline, served with real headers · Exercises lower-level renderers using a real CSP header but never creates a public chart under that policy.
  - Weak · area, bar, scatter, donut · unit · [packages/axylo/test/core/validate.test.ts](../packages/axylo/test/core/validate.test.ts) · imports without a DOM and exports the five chart functions and validate · Checks only that the export is a function in a source import, without chart-specific StrictMode, CSP or safe text assertions.
- **DX9** · Follow semantic versioning and the deprecation policy; previous documented examples still compile and run.
  - No evidence · line, area, bar, scatter, donut, compact
- **DX10** · Every runnable documentation example is compiled and rendered in CI from the packed distribution.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line · document · [docs/api/examples.ts](../docs/api/examples.ts) · Has compile-only examples, without a packed-distribution run of every runnable documentation example.
- **DX11** · Everything is MIT licensed, with third-party notices verified at release.
  - No evidence · line, area, bar, scatter, donut, compact
  - Weak · line, area, bar, scatter, donut, compact · document · [packages/axylo/package.json](../packages/axylo/package.json) · Declares MIT in package metadata but does not verify notices or that release artifacts carry the license.
- **DX12** · A coding agent uses published docs to make a first chart that passes reader criteria on trap fixtures.
  - No evidence · line, area, bar, scatter, donut, compact
- **P6** · Download · exact minified and gzipped bytes, CSS included.
  - Weak · line, area, bar, scatter, donut, compact · document · [scripts/size.mjs](../scripts/size.mjs) · Does not measure the packed distribution, script-tag and React entries with CSS together.
- **P7** · Measure owned bytes beyond one million caller points and heap trends over 1,000 create–destroy cycles after collection.
  - Weak · line · browser · [packages/axylo/test/browser/chart/lifecycle.browser.test.ts](../packages/axylo/test/browser/chart/lifecycle.browser.test.ts) · objects other than compiled code do not grow from cycle 300 to cycle 1,000 · Checks retained objects across 1,000 chart lifecycles, without the one-million-point owned memory measurement or a linked history file.

## Evidence and applicability

### F1

- area, bar · property · [packages/axylo/test/scale/domain.test.ts](../packages/axylo/test/scale/domain.test.ts) · with includeZero always contains zero, author domain or not
- area · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · widens area author domains to zero and reports AX110
- area · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · uses a zero baseline for an unstacked area backed by a borrowed Float32 column
- bar · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · widens bar author domains to zero and reports AX110
- bar · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · uses projected zero as the baseline and represents missing and zero bars separately
- line, scatter · Not applicable · Only bars and areas have this baseline or stack rule.
- donut · Not applicable · Donut uses slices, without Cartesian axes.

### F2


### F3


### F12

- compact · Not applicable · Compact has a corner marker and description instead of the F12 note (C5).

### F10

- line · Not applicable · Line has no stacked variant.
- scatter · Not applicable · Scatter has no stacked variant.
- donut · Not applicable · Donut has slices rather than stacks.

### F8

- line, area, bar, scatter, compact · Not applicable · This slice rule is specific to donut.

### F4

- donut · Not applicable · Donut has categories and no temporal axis.

### F11

- donut · Not applicable · Donut has ordered slice labels rather than x. Duplicate labels are covered by F3.

### F5

- bar · Not applicable · Bars are never simplified (section 3.6).
- scatter · Not applicable · Scatter is never simplified in 1.0 (section 3.6).
- donut · Not applicable · Donut has no per-pixel series simplification.

### T-dense-line

- area, bar, scatter, donut · Not applicable · This is the line cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-dense-area

- line, bar, scatter, donut · Not applicable · This is the area cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-dense-bar

- line, area, scatter, donut · Not applicable · This is the bar cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-dense-donut

- line, area, bar, scatter · Not applicable · This is the donut cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-dense-scatter

- line, area, bar, donut · Not applicable · This is the scatter cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### F7

- donut · Not applicable · Donut uses slices, without Cartesian axes.

### F6


### A3

- line, area, bar, scatter, donut · Cannot be verified here · The required NVDA, VoiceOver and TalkBack browser/device rehearsals cannot be performed here.
- compact · Not applicable · Compact has no point navigation or table. C1 specifies its text alternative.

### A1


### A2

- compact · Not applicable · Static compact charts have no tab stops (C1).

### T-keyboard-line

- line · unit · [packages/axylo/test/lookup/aligned.test.ts](../packages/axylo/test/lookup/aligned.test.ts) · steps within a series, switches series at the same x, and ranks by visible slot
- line · browser · [packages/axylo/test/browser/a11y/keyboard.browser.test.ts](../packages/axylo/test/browser/a11y/keyboard.browser.test.ts) · reads every series at x, narrows to one with Down, reaches the ends, pages by a tenth, and selects
- area, bar, scatter, donut · Not applicable · This is the line cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-keyboard-area

- line, bar, scatter, donut · Not applicable · This is the area cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-keyboard-bar

- line, area, scatter, donut · Not applicable · This is the bar cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-keyboard-donut

- line, area, bar, scatter · Not applicable · This is the donut cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-keyboard-scatter

- line, area, bar, donut · Not applicable · This is the scatter cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### A4

- line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · opens from the toolbar with a caption, headers with units and row headers; pages of 100; closing removes it
- line · unit · [packages/axylo/test/reader/index.test.ts](../packages/axylo/test/reader/index.test.ts) · limits the table to the current x range and omits it when disabled or compact
- line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · a value near row 900,000 of a 1,000,000-point typed-column chart is reachable; opening takes under 100 ms
- line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · opening one table on a 24-chart page leaves every other chart where it was
- compact · Not applicable · Compact does not include a table.

### A5


### L1

- line · Cannot be verified here · Firefox and Safari/WebKit are unavailable here. Cross-engine browser evidence is required.
- compact · Not applicable · Axes, plot text and title are omitted in compact mode.

### L2


### L7

- line · browser · [packages/axylo/test/browser/chart/data.browser.test.ts](../packages/axylo/test/browser/chart/data.browser.test.ts) · describe prefix “states (spec L7)”

### L8

- compact · Not applicable · Compact has its own minimum dimensions and defaults in C3.

### L3

- line · browser · [packages/axylo/test/browser/chart/lifecycle.browser.test.ts](../packages/axylo/test/browser/chart/lifecycle.browser.test.ts) · describe prefix “resize (spec L3)”
- compact · Not applicable · Compact sizing and its different automatic height are in C3.

### L4


### A6

- line, area, bar, scatter, donut · Cannot be verified here · Firefox and Safari/WebKit are unavailable here. Cross-engine browser evidence is required.
- compact · Not applicable · Compact has no visible text and its tile-size contract is in C3.

### I1

- compact · Not applicable · Compact has no pointing behavior or tooltip.

### T-pointer-line

- line · unit · [packages/axylo/test/lookup/aligned.test.ts](../packages/axylo/test/lookup/aligned.test.ts) · uses only visible slots, includes both plot edges, and gives midpoints to the later slot
- area, bar, scatter, donut · Not applicable · This is the line cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-pointer-area

- line, bar, scatter, donut · Not applicable · This is the area cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-pointer-bar

- line, area, scatter, donut · Not applicable · This is the bar cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-pointer-donut

- donut · unit · [packages/axylo/test/lookup/donut.test.ts](../packages/axylo/test/lookup/donut.test.ts) · picks the parts fixture from 12 o’clock clockwise within the ring
- line, area, bar, scatter · Not applicable · This is the donut cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-pointer-scatter

- scatter · unit · [packages/axylo/test/lookup/scatter.test.ts](../packages/axylo/test/lookup/scatter.test.ts) · picks the nearest point within 24 px and breaks a tie by later source row
- line, area, bar, donut · Not applicable · This is the scatter cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-tooltip-line

- line · unit · [packages/axylo/test/lookup/aligned.test.ts](../packages/axylo/test/lookup/aligned.test.ts) · reads values, absent observations, and explicit nulls in series order
- area, bar, scatter, donut · Not applicable · This is the line cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-tooltip-area

- line, bar, scatter, donut · Not applicable · This is the area cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-tooltip-bar

- line, area, scatter, donut · Not applicable · This is the bar cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-tooltip-donut

- donut · unit · [packages/axylo/test/lookup/donut.test.ts](../packages/axylo/test/lookup/donut.test.ts) · picks the parts fixture from 12 o’clock clockwise within the ring
- line, area, bar, scatter · Not applicable · This is the donut cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-tooltip-scatter

- scatter · unit · [packages/axylo/test/lookup/scatter.test.ts](../packages/axylo/test/lookup/scatter.test.ts) · picks the nearest point within 24 px and breaks a tie by later source row
- scatter · unit · [packages/axylo/test/lookup/scatter.test.ts](../packages/axylo/test/lookup/scatter.test.ts) · finds coincident points across a cell boundary and retains the full count after truncation
- line, area, bar, donut · Not applicable · This is the scatter cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### I2

- line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · toggles by click, Enter and Space; a hidden series leaves marks, tooltip and keyboard but stays in the table
- donut · Not applicable · Donut uses slices rather than toggleable series.
- compact · Not applicable · Compact has no legend.

### I3

- donut · Not applicable · Donut has no zoom.
- compact · Not applicable · Compact has no zoom.

### T-zoom-line

- line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · Zoom in and out are single clicks around the centre; Reset appears only while zoomed; the zoom event carries the range
- area, bar, scatter, donut · Not applicable · This is the line cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-zoom-area

- area · unit · [packages/axylo/test/view/review.test.ts](../packages/axylo/test/view/review.test.ts) · fits a monthly area between observations with the zero baseline
- line, bar, scatter, donut · Not applicable · This is the area cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-zoom-bar

- line, area, scatter, donut · Not applicable · This is the bar cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-zoom-donut

- line, area, bar, scatter · Not applicable · This is the donut cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-zoom-scatter

- scatter · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · keeps scatter ranges per series and uses only the points inside zoom for the value domain
- line, area, bar, donut · Not applicable · This is the scatter cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### I4

- line, area, bar, scatter, donut · Cannot be verified here · Native touch on a real phone cannot be verified here. Chrome touch emulation alone is insufficient for this device check.
- compact · Not applicable · Compact presents no interactive controls.

### A7

- compact · Not applicable · Compact has no point focus or streaming announcements.

### I6

- line · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · a pause control appears after append; paused, rows are buffered and nothing moves; resume applies them
- compact · Not applicable · Compact has no toolbar or Pause/Resume control.

### I5


### A8


### A10


### A9


### F9

- donut · Not applicable · Donut uses slices rather than toggleable series.

### T-limit-line

- line · unit · [packages/axylo/test/core/controller.test.ts](../packages/axylo/test/core/controller.test.ts) · a ninth series is rejected (AX130), leaves store, frame, view and diagnostics as they were, and later appends work
- line · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · assigns a unique normal color/dash pair to each of 12 series and warns once
- area, bar, scatter, donut · Not applicable · This is the line cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-limit-area

- line, bar, scatter, donut · Not applicable · This is the area cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-limit-bar

- line, area, scatter, donut · Not applicable · This is the bar cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-limit-donut

- donut · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · keeps the seven largest in original order, favoring the first tie at the cutoff
- donut · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · counts positive entries for grouping and does not render a partially negative ring
- line, area, bar, scatter · Not applicable · This is the donut cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-limit-scatter

- line, area, bar, donut · Not applicable · This is the scatter cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### L6

- compact · Not applicable · Compact omits visible titles, axes and reference decorations.

### T-reference-line

- line · unit · [packages/axylo/test/view/view.test.ts](../packages/axylo/test/view/view.test.ts) · resolves references against the frame kind and includes value bands and lines in the domain
- line · unit · [packages/axylo/test/view/review.test.ts](../packages/axylo/test/view/review.test.ts) · includes x lines and bands in the automatic extent, including on scatter
- line · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · orders clipped reference bands, the value grid, data, axes, and reference rules
- line · unit · [packages/axylo/test/reader/index.test.ts](../packages/axylo/test/reader/index.test.ts) · formats reference lines and bands on their own axes and leaves the deprecated alias unused
- area, bar, scatter, donut · Not applicable · This is the line cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-reference-area

- line, bar, scatter, donut · Not applicable · This is the area cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-reference-bar

- bar · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · draws a 1.5 px dashed reference rule over bar marks
- bar · browser · [packages/axylo/test/browser/chart/interaction.browser.test.ts](../packages/axylo/test/browser/chart/interaction.browser.test.ts) · the bars fixture shows its "Target" reference label next to the line at 90
- bar · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · centers whole continuous bars and retains bands crossing both zoom edges (horizontal false)
- bar · unit · [packages/axylo/test/scene/scene.test.ts](../packages/axylo/test/scene/scene.test.ts) · centers whole continuous bars and retains bands crossing both zoom edges (horizontal true)
- line, area, scatter, donut · Not applicable · This is the bar cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-reference-donut

- line, area, bar, scatter · Not applicable · This is the donut cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### T-reference-scatter

- line, area, bar, donut · Not applicable · This is the scatter cell in section 3.6.
- compact · Not applicable · Compact is specified separately in section 3.7.

### L5

- bar · Not applicable · Bars do not have optional point markers.
- scatter · Not applicable · Points are the marks of a scatter chart.
- donut · Not applicable · Donut uses slices.
- compact · Not applicable · Compact omits regular point markers; isolated compact marks are covered by C2.

### C1

- line, area, bar, scatter, donut · Not applicable · Defined for the compact variant in section 3.7.

### C2

- line, area, bar, scatter, donut · Not applicable · Defined for the compact variant in section 3.7.

### C3

- line, area, bar, scatter, donut · Not applicable · Defined for the compact variant in section 3.7.

### C4

- line, area, bar, scatter, donut · Not applicable · Defined for the compact variant in section 3.7.

### C5

- compact · browser · [packages/axylo/test/browser/chart/render.browser.test.ts](../packages/axylo/test/browser/chart/render.browser.test.ts) · with values left out, the description says so and a corner marker appears; there is no note element
- line, area, bar, scatter, donut · Not applicable · Defined for the compact variant in section 3.7.

### DX1


### DX2


### DX3


### DX4


### DX5


### DX6


### DX7


### DX8


### DX9


### DX10


### DX11


### DX12


### P1

- line · benchmark · [bench/src/page.js](../bench/src/page.js) · first 3×120 · measured history [bench/history/20261118T023022Z-first-3x120-uplot-vs-axylo-canvas-e472.json](../bench/history/20261118T023022Z-first-3x120-uplot-vs-axylo-canvas-e472.json) · Eight measured runs per configuration, software rasterisation.
- line · Cannot be verified here · A recorded workload was measured, but the limit is provisional and has no acceptance verdict. Hardware GPU rasterisation and the reference browser/device profiles cannot be verified here.
- area, bar, scatter, donut, compact · Not applicable · The specified trend workload is a line-chart fixture.

### P2

- line · benchmark · [bench/src/page.js](../bench/src/page.js) · first 1×100k and 1×1M · measured history [bench/history/20261118T023400Z-first-1x100000-uplot-vs-axylo-svg-e9b6.json](../bench/history/20261118T023400Z-first-1x100000-uplot-vs-axylo-svg-e9b6.json), [bench/history/20261118T023656Z-first-1x1000000-uplot-vs-axylo-svg-50d6.json](../bench/history/20261118T023656Z-first-1x1000000-uplot-vs-axylo-svg-50d6.json) · Eight and four measured runs per configuration respectively.
- line · Cannot be verified here · A recorded workload was measured, but the limit is provisional and has no acceptance verdict. Hardware GPU rasterisation and the reference browser/device profiles cannot be verified here.
- area, bar, scatter, donut, compact · Not applicable · The current workload definition uses a single dense line from typed columns.

### P3

- line · benchmark · [bench/src/page.js](../bench/src/page.js) · stream window 600 at 60 Hz · measured history [bench/history/20261118T024054Z-stream-w600-uplot-vs-axylo-canvas-fcdf.json](../bench/history/20261118T024054Z-stream-w600-uplot-vs-axylo-canvas-fcdf.json) · Independent producer clock. CDP frame callbacks do not measure actual presentation.
- line · Cannot be verified here · A recorded workload was measured, but the limit is provisional and has no acceptance verdict. Hardware GPU rasterisation and the reference browser/device profiles cannot be verified here.
- area, bar, scatter, donut, compact · Not applicable · The specified stream workload is the line-chart fixture with a 600-point window.

### P4

- line, area, bar, scatter · Not run · The benchmark workload is not implemented and no matching history exists. Limits are provisional.
- donut · Not applicable · Donut is limited to eight drawn slices and has no 100,000-point picking workload.
- compact · Not applicable · Compact does not show a pointer readout.

### P5

- line · benchmark · [bench/src/page.js](../bench/src/page.js) · page 24×(3×120) · measured history [bench/history/20261118T023750Z-page-3x120-x24-uplot-vs-axylo-canvas-c286.json](../bench/history/20261118T023750Z-page-3x120-x24-uplot-vs-axylo-canvas-c286.json) · Eight measured runs per configuration.
- line · Cannot be verified here · A recorded workload was measured, but the limit is provisional and has no acceptance verdict. Hardware GPU rasterisation and the reference browser/device profiles cannot be verified here.
- area, bar, scatter, donut, compact · Not applicable · The specified trend workload is a line-chart fixture.

### P6

- line, area, bar, scatter, donut, compact · Not run · No complete bytes workload or matching history in bench. The targets remain provisional.

### P7

- line · benchmark · [bench/src/page.js](../bench/src/page.js) · first 1×1M with memory sampling · measured history [bench/history/20261118T023656Z-first-1x1000000-uplot-vs-axylo-svg-50d6.json](../bench/history/20261118T023656Z-first-1x1000000-uplot-vs-axylo-svg-50d6.json) · Records heap and process memory, without a create–destroy trend.
- line · Cannot be verified here · A recorded workload was measured, but the limit is provisional and has no acceptance verdict. Hardware GPU rasterisation and the reference browser/device profiles cannot be verified here.
- area, bar, scatter, donut, compact · Not run · No per-type forced-GC memory measurement and lifecycle trend in benchmark history. Limits are provisional.

### P8

- compact · Not run · The benchmark workload is not implemented and no matching history exists. Limits are provisional.
- line, area, bar, scatter, donut · Not applicable · The workload is explicitly 40 compact charts.

