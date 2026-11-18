# Family c: C1 to C5 (spec 3.7, compact variant)

Rows in matrix order: C4, C1, C2, C3, C5. Each row applies to the compact column only. Validation: `node .matrix-merge-scratch/validate.mjs .matrix-merge-scratch/rows/c.json` printed "(checker: 0 problems in these rows; 99 in other rows, not shown)" and "OK: 5 rows, no problems found by this helper". The checker threw on other rows' problems, so the helper printed no static status for these cells. The statuses below come from the cell rules in check.mjs.

What I mean by compact kinds: in the Node acceptance suite, `compactKinds` is recorded in EVIDENCE.json. In the browser acceptance suite, the chart type `compact` in `fixtures.ts` (`TYPES`, `optionsFor`, `TYPE_WORD`) is **compact line only**. So any browser test titled "X compact: …" that comes from a `TYPES` loop (a1-names, f2-gaps, i1-pointer I5, l-legibility L4, a5) runs compact line only. Only `compact.browser.test.ts` loops over line, area and bar.

## Changes by criterion

### C4 (two series)
- Statement: now "With more than one series, compact lines differ by dash as well as colour, since there is no legend; AX131 suggests one series per compact chart." (It adds the spec's "since there is no legend". "Lines" stays as in the spec.)
- Applicability: the compact column, unchanged. The old reasons said "Defined for the compact variant in section 3.7." for all five full types. Now line, area and bar say that spec 3.7 states C4 for `compact: true` only, and scatter and donut say that no compact variant exists for them (spec 2.1, 3.7).
- Kept as evidence: the Node "C4 compact: two line/area strokes …" tests (distinct paint bindings, distinct dash, AX131 with /one series/), and the browser C4 line, area and bar tests.
- Added as evidence: Node `dx-diagnostics.test.ts` "F3 compact: AX131 keeps both series and gives them different dashes". It runs line, area and bar. For bar it asserts two distinct fill patterns, not dashes. It checks the AX131 wording (/one series or turn off compact mode/) and the hint level for all three kinds. This is the only check of the AX131 wording for compact bar.
- Added as weak: browser "A5 compact: the eight painted colours (light scheme) …". It runs compact line only and shows eight series painted in eight distinct colours. It is the only painted evidence that compact series differ in colour.
- What C4 asks of compact bar: C4's text names lines. For compact bar, only AX131 applies. The browser bar test is cited for AX131. Its texture comparison belongs to A5's fill-pattern rule (and F9), and the limits text says so.
- Texts: a new gap (colour as painted), and new limits (kinds, the bar reading, wording vs level).

### C1 (static image with a text alternative)
- Statement: now gives the whole criterion. It covers role="img", a name as in A1 (title, labelledBy heading, or a generated name with AX140), the summary as the description with its listed statements, no tab stop, no pointer-only behaviour, the mouse/keyboard clause, and the page of 40.
- Applicability: unchanged. The reasons were rewritten as for C4.
- Removed:
  - `test/browser/chart/render.browser.test.ts` "with values left out, the description says so and a corner marker appears; there is no note element". It runs compact line only and reads DOM attributes and `textContent`, not Chrome's tree. Its subject is C5. The acceptance C5 tests cover the omission statement for all three kinds in Chrome's tree.
  - The A1 browser compact tests other than labelledBy:
    - The title/summary test and the generated-name tests in both builds repeat the C1 compact line tests, and they run compact line only.
    - "an author description is added …", "the summary of instants states the time zone …" and "24 charts … no duplicate ids …" test parts of A1 that C1 does not list (author description, time zone, ids).
- Moved to weak: the Node "C1 compact: line/area/bar has a name and full summary, and the committed model is static" tests. They check the model only. They are kept because they are the only check that the committed frame is marked not interactive and not zoomable, with no table, no drawn text and no announcements.
- Added as weak: Node `reader-model.test.ts` "A1 compact: model preserves the author's heading, uses an existing label when given …". It runs line, area and bar. With labelledBy, the model records the id, drops its title and raises no AX140. It does not assert the resulting name. It is the only labelledBy evidence for compact area and bar.
- Kept as evidence: the 12 C1 browser tests (role, name and summary statements; AX140 in the development and production builds; the 40-chart page), the 3 C5 browser tests (the summary's omission statement), and the A1 compact labelledBy browser test (compact line).
- Not cited: the uncited Node test "C1 compact line: a reference has no effect on the domain or the description and is reported as not applicable". Its subject is F7's compact clause (a reference has no effect and AX150 reports it). Its exact summary string, on compact line and on the model only, adds nothing to C1's description clause: Chrome's tree covers that clause for all three kinds. It belongs to F7's compact cell.
- Texts: new gaps (labelledBy for area and bar; wheel, drag and touch), and new limits (which builds; the pixel comparison's coverage).

### C2 (the fidelity rules still hold)
- Statement: it names each rule (F1, F2, F3, F5, F11, I5, L4) as the spec does. The old text was "Compact keeps the fidelity rules for baseline, gaps, …".
- Applicability: unchanged. The reasons for line, area and bar now say that the full charts are held to those rows directly.
- Moved to weak:
  - Browser "C2 compact line: a null is a gap and the value between two gaps is a visible point (F2)". It does not check bridging.
  - Browser f2-gaps "F2 compact: with missing: 'zero' … on the zero baseline". For compact, the baseline assertion is skipped.
- Added as evidence:
  - The Node F3 per-code compact tests that were missing: AX100, AX101, AX104, AX105, AX107, AX108, AX109, AX110 (area and bar), AX111, AX112, AX130, AX131, AX134, AX140, AX150, AX151, AX152 and AX160. AX102, AX103 and AX106 were already cited. F3's "Verified by" is one test per code, and C2 asks for the same fixtures as the full charts.
  - Browser "A5 compact: … AX141 is raised" (compact line).
  - The browser C5 tests, for what the reader is told about the dirty fixture's omissions.
- Kept: everything else (F1 Node and browser for area and bar; F2 Node for all three kinds and browser for line; F5 Node; F11 Node and browser; I5 Node and browser; L4 Node and browser).
- Texts: the gaps text was rewritten and widened. The old text left open only "the dense compact SVG and compact bar missing-versus-zero painting". New limits give the kinds per rule.

What each rule has, per kind (M = model, Node through the controller; R = rendered, browser):

| Rule | line | area | bar |
|---|---|---|---|
| F1 | n/a | M (property, 82–97 with AX110), R (82–97, positive, no author domain) | same as area |
| F2 | M (null, absent field, absent date, zero, isolated point, missing: 'zero'), R (gaps not bridged, isolated point, deleted rows = nulls with AX105; missing: 'zero' without the baseline check) | M (as line, plus the no-bridging property), R none | M (no-data mark at the baseline, zero bars), R none |
| F3 | M (per code), R (dirty fixture warning codes; omission statement via C5; AX141) | M (per code), R (dirty codes, omission statement) | M (per code), R (dirty codes, omission statement) |
| F5 | M (property), R none | M (property, stacked pair only), R none | n/a (spec 3.6) |
| F11 | M (shuffled, AX108), R (shuffled = sorted marks) | same | same |
| I5 | M (first frame final, update in one frame), R (both motion settings, 2.5 s, screenshot; update ≤ 200 ms, one step under reduce; plus 1.5 s no-preference) | M, R (1.5 s, no-preference, markup and paint signature only) | same as area |
| L4 | M (scheme change repaints within one frame), R (color-scheme vs text colour, each trigger in the first frame, prefers-color-scheme, light-only page, --axylo-background, forced colours; body class toggle) | M, R (body class toggle only, after settle) | same as area |

### C3 (size)
- Statement: wording only ("24 × 16 CSS px").
- Applicability: unchanged. The reasons were rewritten.
- Moved to weak: the Node "C3 compact: line/area/bar fills a 24 by 16 …" tests. They check model layout only, and the browser tests establish the whole claim for all three kinds.
- Texts: new limits (the sizes tried, what "fills" is checked as, other sizes not tried).

### C5 (values left out)
- Statement: wording only.
- Applicability: unchanged. The reasons were rewritten.
- Removed: `test/browser/chart/render.browser.test.ts` "with values left out, …". It runs compact line only, reads DOM attributes and `textContent`, and does not check position or paint. The three acceptance C5 tests cover more, for all three kinds.
- Moved to weak: the Node C5 tests (line, area, bar) and "C5 compact: production supplies the omission count …" (`production.test.ts`). Both check the model only. The production test is the only production-build check of C5.
- Texts: new limits (development bundle; how "small", "in the corner" and "text equivalent" are checked).

## Cells whose status went down or up

- **C1/compact: down, from pass (when results exist) to weak.** Before, it had evidence only and no gaps. Now it has gaps:
  - The labelledBy name is read in Chrome's tree for compact line only; compact area and bar have model evidence only.
  - Wheel, drag and touch are not tried on a compact chart.
- **C4/compact: down, from pass (when results exist) to weak.** The browser tests compare only the computed dash. The colour difference is asserted on the model (paint bindings). As painted, it is shown only for compact line, through the eight-series palette test. Compact area has no painted colour check.
- **C2/compact: unchanged (weak).** The gaps are now complete per rule and kind; before they named two items.
- **C3/compact and C5/compact: unchanged.** They reach pass once results exist: the browser evidence covers all three kinds, and the Node tests moved to weak with reasons.

## No evidence (gap list)

Most important first.
1. **C2 / F2, compact area and bar, as painted.** Nothing checks that gaps are not bridged, that the value between two gaps is drawn, that compact bar's "no data" mark differs from a zero bar, or missing: 'zero'. Only the model checks these. For compact line, that missing: 'zero' zeros sit on a zero baseline is checked on the model only.
2. **C2 / F5, compact line and area, as painted.** Dense drawing (column extrema, breaks) is checked on the model only. On the model, compact area is checked only as a stacked pair; a single dense compact area is not.
3. **C2 / L4, compact area and bar.** These are not checked: the computed color-scheme, the first frame after each trigger (class, style or data-theme on html or body; prefers-color-scheme), a light-only page on a dark device, --axylo-background, and forced colours. Only a body class that darkens the page is checked, after the chart settles. No compact kind is checked for a change of contrast preference.
4. **C2 / I5, compact area and bar.** These are not checked: reduced motion, the painted update (≤ 200 ms; one step under reduce), and the screenshot comparison. No compact kind runs the 24-chart filter change.
5. **C2 / F3.** No compact test covers AX132 (compact bar, more bars than pixels), AX141 for compact area and bar, or AX199 for any compact kind. What the dirty fixture draws is not checked as painted.
6. **C1, labelledBy for compact area and bar in Chrome's tree.** Only the model checks it, and that test asserts the recorded id, not the resulting name.
7. **C1, pointer input other than a move and a click.** Wheel, drag and touch are not tried. The model shows only `interactive: false` and `zoom: false`.
8. **C4, painted colour difference for compact area.**
9. **C2 / F11.** AX108 (the duplicate series is not drawn) is checked on the model only.
10. **C2 / F1.** Negative or mixed-sign values and an author domain that excludes zero are checked on the model only.
11. **C2 / F2, no-bridging property on compact line.** The property runs compact area only.

These are recorded as limits, not gaps:
- C5 in the production build is checked on the model only.
- C1's role and description are checked on the development bundle only. Production is checked for the generated name and AX140.
- C3 samples three sizes and one auto height.

## Not testable as written

- **C1 "no pointer-only behavior, so nothing is available to a mouse that is not available to a keyboard".** This is a negative over all pointer input. Tests can only try particular inputs (here, a move and a click) and show that the model marks the frame as not interactive.
- **C3 "at any size from 24×16 CSS px up".** This is universal over sizes and has no upper bound. The tests sample 24 × 16, 160 × 48 and 600 × 120 CSS px, plus a 200 px wide container with no definite height.
- **C5 "a small marker … in the corner".** The spec gives no size and no corner. The test accepts less than a quarter of the figure's area (loose: up to 2,400 px² in a 200 × 48 figure) and any corner within 4 CSS px.
- **C2 "no motion (I5)": ambiguous.**
  - I read it as I5 holding for compact charts: first render not animated, an update transition of at most 200 ms, nothing under reduced motion.
  - The literal reading, that a compact chart never moves even on update, is established on the model only, where an update commits in one frame. The browser update test (compact line) allows a transition of up to 200 ms without a motion preference.
- **C4, and AX131 in the registry ("Drawn, with dash differences"), against A5 and F9.** A5 and F9 give compact bars fill patterns, not dashes. C4's text names lines only, so I read C4's dash clause as reaching compact line and the edges of compact area, and C4 on compact bar as AX131 alone. The registry's "dash differences" does not fit compact bar.
- **C1 "an accessible name (as in A1 …)".** I read "as in A1" as A1's whole naming rule: title, labelledBy heading, or a generated name with AX140. A1's heading level and visually hidden title do not apply, because a compact chart draws no title heading.

## Titles that promise more than their assertions

- `packages/axylo/test/acceptance/compact.test.ts:58`, "C2 compact: ${kind} draws only data marks, commits the sorted final geometry in one frame, and ignores public zoom".
  - The geometry is never checked for x order. The input is unsorted, and only the summary's last value (the value at the largest x) reflects the order.
  - The scene is compared only for equality across a zoom and for a change after an update.
- `packages/axylo/test/browser/acceptance/compact.browser.test.ts:43`, "C1 compact ${kind}: role img, … with nothing inside exposed on its own". The filter lets StaticText, generic, paragraph, InlineTextBox and none nodes inside the image. Only other roles (a button, a heading) would fail.
- `compact.browser.test.ts:64`, "C1 compact ${kind}: a page of 40 compact charts adds no tab stop, and pointing at one changes nothing on the page: no element appears, no text changes, no pixel changes".
  - "No pixel changes" is checked only in the top 900 × 700 CSS px.
  - Tile 39, which the test points at, starts about 2,300 px down, below the viewport. The test does not scroll to it, so the pointer most likely reaches no tile there and its pixels are outside the screenshot. This is inferred from the page layout, not run.
  - The DOM comparison lists only elements with an `offsetParent` (and the svg). An element that appears with `position: fixed` would be caught only by the pixel comparison.
- `compact.browser.test.ts:161`, "C2 compact line: a null is a gap and the value between two gaps is a visible point (F2)". It asserts only that no stroke run of two or more vertices has a vertex at the null, and that a marker sits at the isolated value. A stroke bridging from x = 1 to x = 3 would pass.
- `compact.browser.test.ts:176`, "C3 compact ${kind}: … their heights keep their order …". It asserts only that the largest value (18, day 4) is drawn highest and the smallest (11, day 3) lowest. The order of the other three is not checked.
- `compact.browser.test.ts:206`, "C4 compact ${kind}: two series differ by dash as well as colour …" (line and area). It asserts only that the computed `stroke-dasharray` differs. The colour is not compared: both paths only have to carry some `--axylo-series-color-` slot.
- `packages/axylo/test/browser/acceptance/a5-not-colour-alone.browser.test.ts:113`, "A5 compact: two compact series differ by dash as well as colour, with no legend to tell them apart". It also compares the dash only.
- `packages/axylo/test/browser/acceptance/f2-gaps.browser.test.ts:104`, "F2 ${type}: with missing: 'zero' on the field, an explicit null and an absent step are drawn at zero, on the zero baseline". For compact, the baseline assertion is skipped (`if (type !== 'compact')`). It only checks that the two filled values are the two lowest vertices, at one height.
- `packages/axylo/test/acceptance/dx-diagnostics.test.ts:198`, "F3 compact: AX131 keeps both series and gives them different dashes". For compact bar it asserts different fill patterns, not dashes. The title does not fit that kind; it does not overstate.

## Checker or helper defects

- **validate.mjs prints no statuses when the checker fails elsewhere.** It prints per-cell static statuses only when `check()` succeeds. When other rows have problems, the checker throws and no statuses are shown for the rows under validation.
- **The browser index cannot tell which compact kind ran.** In the browser acceptance suite, the chart type `compact` is compact line only, and `EVIDENCE.json` there has no `compactKinds`. A title such as "L4 compact: …" or "I5 compact: …" does not say that area and bar were not run. Adding `compactKinds` to the browser index, or naming the kind in those titles, would prevent misreading.
- **The Node index files the reference test under C1.** Node `EVIDENCE.json` lists "C1 compact line: a reference has no effect …" under criterion C1, because the index takes the criterion from the title prefix. The test belongs to F7's compact clause.
- **Negative controls.** I cite none. Helpers that my rows rely on and that have a control:
  - `missingClauses`: the A1 line control, a summary without its range statement. Used by the C1 and C5 description checks.
  - `traceMotion`: the I5 line control, an entry animation and an update transition that outlasts 200 ms. Used by C2's I5 checks.
  - `paintedSeries` and `paletteProblems`: the A5 line control, marks made nearly transparent or covered. Used by C4's weak palette citation. `inkColor` is exercised there only through `paintedSeries`.
  - `strokeRuns`: exercised through the T-dense-line control (`spikeColumn`).

  Helpers my rows rely on that have no control of their own:
  - `inkColor` as used directly: the C2 L4 colour comparison, the C4 bar texture, the C5 marker ink.
  - `tabStops`, `axOf` and `axWithin` (the A2 control covers only `readRange` and `valueText`).
  - The inline 40-tile DOM and pixel comparison (C1).
  - `shapes` and `datumPoints` (C2 F1, C3).
  - The corner-position checks (C5).
  - `vertices` and `inkIn` in f2-gaps (C2 F2).
