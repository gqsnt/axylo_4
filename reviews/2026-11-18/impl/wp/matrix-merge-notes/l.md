# Family l: L1–L8 and the T-reference rows

Rows: L1, L2, L7, L8, L3, L4, L6, T-reference-line, T-reference-area, T-reference-bar, T-reference-donut, T-reference-scatter, L5 (matrix order). Validation: `node .matrix-merge-scratch/validate.mjs .matrix-merge-scratch/rows/l.json` prints `OK: 13 rows, no problems found by this helper` (the checker reports 0 problems in these rows; it still throws on 98 problems in other rows, so the helper prints no static statuses; the statuses below follow from `cellFor` by hand).

Every cell that cites a browser test starts its `limits` with the required sentence. No `engine`, `waivers`, React or negative-control citation was added.

## Changes by criterion

### L1
- Statement: rewritten from the current spec: the remedies in order (thin only on time, date, numeric and `ordered` category axes; wrap to three lines; rotate up to 45°; middle truncation, distinct, full text in tooltip and table), the note "Some labels hidden. See table." with AX143, and orientation never changing.
- Applicability: unchanged (five full types). Compact reason made specific: compact draws marks only (3.7), so there are no labels to fit; its state messages are L7's.
- Removed: weak `render/review.browser.test.ts` "text: after text-spacing overrides and after a late font, …" (a standalone text-layer fixture; the full-chart late-font test now exists for every type).
- Moved: `reader-model.test.ts` "L1 <type>: measured plot labels fit inside the modeled canvas …" from `evidence` to `weak` (a three-point model with the test measurer; label boxes are the model's, not painted text).
- Added: `layout/layout.test.ts` "checks every layout kind, minimum plots and label attribution across generated sizes" (property, 1,000 runs) for line, area, bar, scatter: the only evidence for generated label sets, widths 100–1,920, remedy order, no thinning of unordered categories, pairwise distinct and identifiable truncations, no box intersecting another by more than 1 px, letter/word spacing and line heights. Not cited for donut (the ring layout has no text).
- Added for bar: `dx-diagnostics.test.ts` "F3 bar: AX143 discloses hidden labels after fitting unordered categories" (controller: the note text "Some labels hidden. See table." and AX143 once, with the horizontal-bars advice).
- Kept: the three browser conditions (plain, text spacing, emulated 200 %) and the late-font test for each type; the twelve-label bar test.
- Gaps rewritten per type: generated sets only in Node with a fixed-width measurer; native text-only zoom not run (200 % is `body { font-size: 28px }`); late font only at 480 and 1,280 px and not combined with spacing or zoom; line/area: no unordered category x drawn, so truncation, full text and note/AX143 are not exercised there; bar: the twelve-label test is disjunctive (truncation or note), so the visible note and AX143 are checked only through the controller, the table check runs only if something is truncated, and the tooltip's full text is never checked; donut: no generated label sets at all.
- Limits: required sentence; the 200 % condition is fixed-pixel blind; the property test's measurer; bar orientation checked by equal bar widths.

### L2
- Statement: adds "text drawn inside a mark", hidden-series legend entries, "gridlines are exempt".
- Applicability: unchanged (all six).
- Kept: the light and dark browser tests for each type.
- Added weak: `a11y/axe.browser.test.ts` "<fixture>: default, table open, tooltip shown, series hidden" for trend (line), stacked (area), bars (bar), scatter, parts (donut): axe-core's default rules (contrast among them) in the light scheme, with tooltip and table shown; the test does not require the contrast rule to have decided and checks no size. For compact: `theme/palette.test.ts` "light|dark: 1. every series color reaches 3:1 on the default background" (tokens only; registration given, loop values `light`, `dark` checked by hand).
- Gaps: new for line, area, bar, scatter, donut: only text at rest is measured (tooltip, readout strip, table, notes, state messages are not); cartesian: no fixture has a reference label, the text Axylo can draw over a mark or band. Compact gap kept (compact line only) and extended: the test requires no compact text and the state messages are not measured.
- Limits: required sentence; how text and mark contrast are sampled; what the dark scheme is. Compact's limit no longer mentions axis lines and focus ring.

### L7
- Statement: current wording (message inside the plot area for empty, loading, error and internal failure; no invented axis ranges, no blank box; announced once, politely).
- Line: the prefix `states (spec L7)` replaced by its three exact titles in `chart/data.browser.test.ts`.
- Kept: the two browser acceptance tests and the Node test for each type.
- Gaps: new for compact (compact area and bar run only through the controller; their painted message is not checked in a browser and their internal failure is not checked at all).
- Limits: required sentence; the acceptance test counts distinct announced texts (a `Set`), so a repeated identical announcement would not be seen; the Node test counts every announcement; the change into the empty state is checked only through the controller and without politeness; line's loading test records every change of the polite region.

### L8
- Statement: the amended criterion (first sentence on at most two lines, ellipsis beyond, full summary stays the description).
- Removed: the describe-prefix citations `L8 too small for a plot` + `casePrefix` (the coverage file lists the two current titles per type as uncited).
- Added: the exact titles "L8 <type>: shrinking the container's width|height 1 px at a time, …, and AX142" with `registration` (the threshold numbers come from a ternary).
- Kept: Node "L8 <type>: the undersized model keeps its title, summary and table while omitting marks".
- Gaps: replaced the result-based text ("the archive …", "need a fresh result") with what the test does not force: no first sentence long enough to need a cut, and the ellipsis is asserted only if the sentence is cut.
- Limits: required sentence; start sizes and the bracket (at least 120/80, less than 122/82).

### L3
- Statement: current wording, including "title, controls and table flow above and below it" and "hidden or zero-sized".
- Compact reason: C3 sizing in place of the 16:9 rule.
- Line: prefix `resize (spec L3)` and the ancestor-scoped title replaced by the four exact titles of `chart/lifecycle.browser.test.ts`.
- Kept: three browser acceptance tests and the Node test for each type.
- Gaps rewritten: zero-sized (not hidden) only through the controller; no run-time change of a definite height; with auto height only the table's flow is located, not the title and controls.

### L4
- Statement: current wording (computed color-scheme, else luminance; override; the named triggers; forced colours use system colours).
- Kept: the four browser acceptance tests and the Node test for each type.
- Added weak, all six cells: `render/theme.browser.test.ts` "--axylo-background overrides color-scheme" (renderer level, hand-built scene). Line: `chart/theme.browser.test.ts` "toggling a dark class repaints within a frame, without rebuilding the scene (canvas)" (the only canvas evidence). Compact: `acceptance/compact.browser.test.ts` "C2 compact area|bar: the scheme comes from the page (L4): …" (class toggle on `<body>`, read after settling).
- Gaps rewritten (the old text described a failure in an earlier run): no cited test changes the style of `<html>` or the contrast preference; the forced-colours switch is read after settling, not in the first frame; the override is checked against a computed color-scheme only on the renderer's scene. Compact adds: detection, first-frame triggers and forced colours on a compact line only.
- Limits: required sentence; what "first frame" and "painted" mean in the test; media emulation; compact kinds.

### L6
- Statement: current wording, with the x-kind rule (measure x like a value axis; time, date or category x only with a label).
- Kept: the browser L6 tests, the T-reference line and band tests (label within 16 px), the bars-fixture "Target" test for bar, the Node L6 tests.
- Added weak (cartesian): the L1 plain-condition test (every painted text, axis titles included, checked for overlap at six widths).
- Gaps: new for line, area, bar, scatter: number x titled only in the controller model and its field-name fallback unchecked (line, area, bar); time x and category x not checked on line/area; date or time x not checked on bar; time or date x not checked on scatter. Donut: none.
- Limits: required sentence; "next to" as 16 px (and 8 px in the bars test); the model test reads the label's text, not its place; axis titles checked at one size in L6.

### T-reference rows
- Statements: unchanged wording of section 3.6 ("Yes; included in the domain; listed in the summary and table caption" for line; "Yes" for area, bar, scatter; "No" for donut).
- Compact reason for all five: 3.6 covers the five full types; a compact chart draws no references (F7, 3.7).
- T-reference-line: removed `view/view.test.ts`, `view/review.test.ts`, `scene/scene.test.ts` and `reader/index.test.ts` citations. The reader title was stale (current: "formats reference lines and bands on their own axes"); all four are lower-level checks of parts the Node acceptance test (both domains read, reference paint, summary and caption) and the browser test (painted, labelled, summary, caption) already establish. This removes the two checker errors.
- T-reference-bar: removed scene "draws a 1.5 px dashed reference rule over bar marks" (covered by the acceptance tests) and "centers whole continuous bars and retains bands crossing both zoom edges (horizontal false|true)" (about bar marks crossing the zoom edges, not reference bands); removed `chart/interaction.browser.test.ts` "the bars fixture shows its "Target" reference label …" (it locates the label, not the line; kept in L6 bar). Added weak scene "swaps the grid and reference axes for horizontal bars" (the only check of references on horizontal bars).
- Limits: required sentence plus scope: which references each test draws (y line and x band; bar browser: y line and y band), the browser's indirect check of x-band domain inclusion, horizontal bars only in the scene; donut: a y reference, AX150 as the unknown-option warning.

### L5
- Statement: current wording.
- Reasons for bar, scatter, donut, compact made specific (compact: `scene/lines.ts` draws only isolated markers when compact; isolated points are F2, carried by C2).
- Citations unchanged. Limits: below 12 px the browser asserts "not every point" (fewer than 40), not "none"; the Node bracket.

## Cells whose status went down or up

- L2 line, area, bar, scatter, donut: before, evidence only (pass once run); now `gaps` (text outside the resting state; cartesian also text over a mark) → weak.
- L6 line, area, bar, scatter: before, evidence only; now `gaps` (x kinds not exercised; number x only in the model) → weak.
- L7 compact: before, evidence only; now `gaps` (compact area and bar only through the controller; their internal failure unchecked) → weak.
- L1 all, L2 compact, L3 all, L4 all, L8 all: weak before and after; the gap texts are rewritten to say what the current tests do not assert (L4 and L8 no longer describe old results).
- Unchanged, evidence only (not run until results exist, then pass if all pass): L7 line/area/bar/scatter/donut, L6 donut, L5 line/area, the five T-reference cells. T-reference-bar now also needs its weak scene test to pass.
- Nothing went up.

## No evidence (gap list)

Most important first.

1. L2, every type: size and contrast of text outside the resting state (tooltip, readout strip, opened table, F12 and hidden-labels notes, state messages, the L8 fallback summary): none in the dark scheme; in the light scheme only axe-core's contrast rule (undecided results not counted, no size).
2. L1, every type: generated label sets in a real browser; the browser's own 200 % text-only zoom; the late font at widths other than 480 and 1,280 px and combined with text spacing or zoom.
3. L1 bar: the visible note "Some labels hidden. See table." and AX143 in a browser (only the controller model); the full text of a truncated label in the tooltip (nowhere); in the table only when the browser happens to truncate.
4. L4, every type: a change of the `style` of `<html>`; a change of the contrast preference; the forced-colours switch within one frame; `--axylo-background` against a computed color-scheme on a real chart (only the renderer's hand-built scene).
5. L2 line, area, bar, scatter: text drawn over a mark (a reference label over a band or a bar).
6. L1 line, area: an unordered category x (truncation, full text, note and AX143 on these types).
7. L3, every full type: a zero-sized (not hidden) container in a browser; a definite height changed at run time; the title and controls' place with auto height.
8. Compact area and bar in a browser: L2 painted marks (palette tokens only); L4 detection, first-frame triggers, forced colours (only the C2 class toggle); L7 painted message (controller only) and the internal-failure state (nowhere).
9. L6: the field-name fallback of a number x on line, area, bar (and its label-and-unit title outside the model); a time x on line, area, scatter; a category x on line, area; a date or time x on bar; a date x on scatter.
10. L8, every full type: a first sentence that needs more than two lines, so the ellipsis is not forced.

Scope notes recorded as limits, not gaps: T-reference-bar horizontal bars only in the scene; T-reference line, area, scatter draw no y band or x line; L5 asserts "not every point" below 12 px.

## Not testable as written

- L1 "200 % text-only zoom": Chrome has page zoom and a default font-size setting but no text-only zoom command; the suite emulates it by doubling the inherited font size, which leaves fixed-pixel text unchanged. Native text-only zoom exists in Firefox and Safari, for which no result is recorded.
- L1 "In real browsers": read as "browsers rather than a model", not as "every engine"; only Chrome ran. If the owner means the 2.3 engines, the missing engines belong in `pending` (not added: the Verified-by does not name engines the way A6 does).
- L5 Verified-by "`trend` at 720 px has none": conflicts with the sparse marker cues the implementation keeps on dense lines for A5 (the Node L5 title says so, and `scene/lines.ts` keeps about one marker per 80 px). The tests assert "not a marker on every point", which is what the criterion says.
- L3 "in both directions": read as shrinking and growing (the Verified-by is 720 → 360 → 720); if it means width and height, a run-time height change is needed (listed in the gap anyway). Whether L3's "starts hidden or zero-sized" reaches compact is not said: C3 restates compact sizing but not that clause.
- L6 "next to it" has no distance; the tests use 16 px from the mark's box and 8 px from the line.
- L7 "announced once": a page can observe live-region changes, not what a screen reader speaks; no screen reader is run for 1.0 (owner's decision, A3).
- L2 "Gridlines are exempt": nothing to verify.

## Titles that promise more than their assertions

- `packages/axylo/test/browser/acceptance/l-legibility.browser.test.ts:112` "L1 <type>: … and no category label is lost without the note": the category check runs only for bar (only the bar fixture passes `categories`); for line, area, scatter and donut nothing checks lost category labels.
- `l-legibility.browser.test.ts:242` "L2 donut|compact: … (legend entries of hidden series included) …": the legend click is skipped for donut and compact, so no hidden entry is measured there (a donut legend has no toggles; compact has no legend). For compact, "every text is at least 12 CSS px" is vacuous: the test requires no text.
- `l-legibility.browser.test.ts:434` "L4 <type>: … a class, style or data-theme change on <html> or <body> …": style is changed on `<body>` only.
- `l-legibility.browser.test.ts:487` "L4 <type>: in forced-colors mode the marks are painted in system colours, also when it is switched on at run time": only the run-time switch is tested; a chart created under forced colours is not.
- `l-legibility.browser.test.ts:662` "L7 <type>: … each change of state is announced exactly once, politely, and nothing else is": announcements are de-duplicated with a `Set`, so a repeat of the same text would pass.
- `l-legibility.browser.test.ts:698` "L8 <type>: … on at most two lines (cut only with an ellipsis) …": the ellipsis is asserted only if the sentence is cut, and no fixture forces a cut.
- `packages/axylo/test/browser/acceptance/type-matrix.browser.test.ts:580` "T-reference-<line|area|scatter>: a reference band outside the data is included in the domain …": for these x bands the domain is not read; inclusion is inferred from the band being painted in the plot's right half (the y domain is read for lines and for the bar's y band).
- `packages/axylo/test/browser/chart/data.browser.test.ts:121` "an author error state and an internal failure both show their message inside the plot, in the accessibility tree": the message is read from `#chart .axylo-message`, not located in the plot (the acceptance L7 test does locate it).
- `l-legibility.browser.test.ts:346` "L3 <type>: a container that starts hidden draws when it is shown, at the shown size": "at the shown size" is asserted as a plot wider than 300 px with the third datum inside it.

## Checker or helper defects

- `validate.mjs` prints static statuses only when `check()` succeeds on the whole merged matrix; with problems in other rows it prints none, so per-cell statuses had to be derived by hand.
- `coverage.txt` lists the describe-prefix citation `L8 too small for a plot` under "cited in matrix … but not in EVIDENCE"; the describe exists, but EVIDENCE.json records titles only, so any prefix citation appears stale there.
- The checker accepted the axe-core titles (`${fixture}: …` over an imported, type-annotated `FIXTURES` list) and the canvas theme title without a registration, so the scanner expands those loops; titles outside the two acceptance directories cannot be checked against a run list, and were derived from the loop values by hand.
- Negative controls cover helpers these rows rely on: `textBoxes`/`overlaps` (L1 text check: overlap, clipping, 1.1 px), `referenceMarks` (T-reference: removed line, wrong colour), painted-colour sampling through `paintedSeries` (A5), the table comparison (A4). Not covered by any negative control: the rotation, line-count and category checks inside `textProblems`, `textContrast` and `markContrast` (L2), `recordAnnouncements`/`stateShown` (L7), `markColors`/`firstFrameAfter` (L4), `plotDrawn` and the summary measurement (L8).
