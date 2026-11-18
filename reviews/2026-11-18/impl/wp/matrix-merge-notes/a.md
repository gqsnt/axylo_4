# Family a: A1–A10 and T-keyboard-*

Rows: A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, T-keyboard-line, T-keyboard-area, T-keyboard-bar, T-keyboard-donut, T-keyboard-scatter (`rows/a.json`, in matrix order). Every cited test was opened and its assertions read; titles from the two acceptance directories were checked against their `EVIDENCE.json` by `validate.mjs`; generated titles elsewhere (a11y `${fixture}` loop over `FIXTURES`) were derived by hand from the loop values. Nothing was run. Validation: `OK: 15 rows, no problems found by this helper` (checker: 0 problems in these rows).

Every cell that cites a browser test now has a `limits` text that starts with the required sentence. All old `limits` texts ("System Chrome/SVG…", "Browser acceptance evidence uses…") were replaced, and every text that described results ("pass for the tested fixtures", "The archive exercised…", "Await their results") was rewritten.

## Changes by criterion

**A1**
- Statement: now gives the three naming routes, AX140 in every build, the heading level and visually hidden title, the summary's parts (time zone, omissions), the author description rule, and unique ids.
- Applicability: unchanged (all six).
- Citations added (compact): `C1 compact area|bar: role img, named by its title, described by the generated summary …`, `C1 compact area|bar: without a title the name is generated and AX140 is raised (development|production build)`, `C5 compact area|bar: with the dirty fixture the description says 3 values are not shown …`. Every `a1-names` compact test runs compact line only (`optionsFor('compact')` → `line` with `compact: true`). The C1 and C5 tests are the only browser tests of the name, summary, AX140 and omission statement on compact area and bar.
- Citations kept: the Node A1 test, all a1-names tests.
- New compact gap: the time-zone statement and unique ids are not tested on compact area or bar.
- Limits: the summary is read for the default, instants and one-omission fixtures, not every fixture. Donut: the summary is read as type, slice count, total, and each slice's value and share. Compact: no heading part (C1).

**A2**
- Statement: current spec wording (toolbar holds legend toggles, zoom, pause and the table control).
- Stale titles replaced: the line, area and scatter toolbar titles now include "Select range" (`… North, South, Zoom in, Select range, Zoom out, View as table …`, `… EU, US, Zoom in, Select range, Zoom out, View as table …`).
- Citations added (bar): `I4 bar (number axis): Select range is a toggle …` and `I4 bar (date axis): …`. On a zoomable bar chart they show that the toolbar is the second tab stop and that the arrow keys reach Select range after Zoom in. The A2 bar fixture uses a category axis and has no zoom.
- New gaps:
  - All five types: the arrow keys never reach Pause. The streaming test finds Pause in the toolbar's text and still counts two tab stops.
  - Bar: the zoomed state on a date or number axis is not traversed.
  - Scatter: hiding the focused series is not tested; only line, area and bar test it.
- Limits: focus is the document's active element, the role comes from Chrome's tree, and the text comes from the DOM attribute `aria-valuetext`. The indicator width is a computed style; its 3:1 is measured on painted pixels in the light scheme. Donut: no series switching, hiding or zoom.

**A3** (owner's decision applied)
- Statement: current spec wording.
- Citations kept: Node `A3 …: the pure keyboard value text conveys …` and browser `A2 …: Right visits every datum …, each read with its text …`. The browser test is what establishes the content at each stop, read from `aria-valuetext` in the DOM: x, series names, values with units and "i of N"; for scatter, series, x and y with units and position; for donut, label, value, share and position.
- New gap: the channel. The text travels in the slider's value text (decision 0001, option C). Chrome's DevTools tree reports the slider's number as its value, so the tests read the text from the DOM attribute. The criterion names the accessible name or a polite live region; the plot's name is the fixed label "Chart plot" (`keyboard.browser.test.ts` asserts it). No test reads the point text from either channel, and A7's focused test asserts that a key press changes no live region.
- `cannotVerify`: the owner's text, verbatim. I found no structural test that supports the touch part: no accessibility-tree order or gesture-count test exists, so there is no `weak` citation.
- Old `cannotVerify` text (decision 0001 rehearsal list) replaced.

**A4**
- Statement: current spec wording.
- Citations removed (line), because the acceptance suite asserts the same A4 parts:
  - `chart/interaction.browser.test.ts`: "opens from the toolbar with a caption …", "a value near row 900,000 … opening takes under 100 ms", "opening one table on a 24-chart page …".
  - `reader/index.test.ts`: "limits the table to the current x range and omits it when disabled or compact".
  - The remaining assertions (closing removes the table, under 100 ms, omitted when compact) are not A4 parts.
- Citations kept: everything from `a4-table` and the Node A4 test, including the "Jump to" error test as part of jumping to an x value.
- Gaps (area, bar, scatter, donut) rewritten without result wording: the million-row jump runs on line only.
- Limits: the table is read from Chrome's tree; fixture values are whole numbers and dates, so F6's fraction rules are not exercised.
- Compact not-applicable reason made specific (section 3.7, C1).

**A5** (amended criterion)
- Statement: covers the amended parts: shape markers, dash under more contrast and forced colours, 1 px separators, how bars are told apart, the compact fill pattern (four patterns), the palette at 3:1 and 0.10 OKLab under three deficiencies, and AX141.
- Citation removed (bar): `F9 bar: thirty-two series are each painted with their own combination of colour and fill pattern …`. A pattern on full bars is F9's rule (more than eight series), not an A5 part.
- Citation added (bar): `T-tooltip-bar: every visible series at that category, in series order; a hidden series is not listed`. The tooltip names the series in order, and the legend entry named "Actual" hides that series.
- Citation added (compact): `C4 compact area: two series differ by dash as well as colour …`.
- Citation kept (compact): `C4 compact bar: … more than colour, as painted …`, the compact fill-pattern rule for two neighbours.
- Gaps:
  - Bar (rewritten): no test asserts that the bars within a group are drawn in the legend's and tooltip's order.
  - Donut (removed): the old gap asked for slices to be identified without colour by their text. The amended A5 asks only for separators between slices, which are measured. Slice order and the legend are F8's.
  - Compact (rewritten): area and bar are not tested under the two modes; the palette and AX141 run on compact line only; there are no compact separator checks; the pattern check uses two series only.
- Limits: what is sampled or computed; AX141 is checked on one background.

**A6**
- Statement: current spec wording.
- `cannotVerify` removed. The missing Firefox and WebKit results moved to `pending` (BRIEF item 8). The tests do not call `requireEngineFeature`, so they can run on other engines; "(Chrome)" in their titles is a label.
- Native zoom is no longer listed as unverifiable. The limits now say that 400 % is emulated as a 320 × 256 CSS px viewport at device pixel ratio 4, which is how WCAG 1.4.10 states reflow. They also say that each chart is checked in its first-drawn state (table closed, no tooltip) and that the text-spacing test checks clipping, not overlap.
- Applicability changed: compact now applies. The old reason "Compact has no visible text" is untrue. A compact chart shows a state message (the A8 compact states assert a visible `.axylo-message` for loading, empty and error) and the C5 corner marker (`*`, `dom/figure.ts`).
- Compact cell: the three C3 tests are `weak` (it fills containers from 24 × 16), with a gap saying that no A6 condition is applied to a compact chart.
- Compact has no `pending`: it has no Chrome evidence either, and `pending` would show it as only awaiting a run. **Coordinator decision:** if you prefer compact not applicable, a true reason has to account for the state message and the corner marker.

**A7**
- Statement: current spec wording.
- Citations unchanged.
- Limits: live regions are watched as DOM mutations, focus is the active element, the numeric position comes from Chrome's tree and the text from the DOM; decision 0004 part 2 sets when the text may be rewritten. Donut: every append changes the focused slice's share, so the test compares only its name and value (line 163). Compact: no focus part (C1).
- Compact gap rewritten without result wording.

**A8**
- Statement: unchanged meaning.
- Citation added (line): `trend paused, zoomed, in the narrow readout and in the internal-error state: no violations; undecided rules listed apart` (a11y suite). It is the only scan of the readout strip.
- New gaps (line, area, scatter, donut):
  - No test scans a pinned tooltip, whose rows are buttons (decision 0004 rule 4).
  - The readout strip is not scanned on area, bar, scatter or donut.
- Bar gap kept: a zoomed bar chart on a date or number axis is not scanned.
- Limits: light scheme, state checked to hold first, heading-order required on full charts.

**A9** (amended; had no citations)
- Statement: covers the amended text, including the uncited-criterion rule.
- Citations added (unit, `apps/docs/test/conformance.test.ts`):
  - "on the specification: every number a "WCAG" in a criterion row's last column names is listed"
  - "reads citations from the last column of a criterion row, and nothing else"
  - "a criterion that is not level A or AA of WCAG 2.2 stops the build"
  - "every criterion no row cites has a reason: one of the two A9 names, or "not assessed""
- `weak`: "a refused matrix leaves every criterion not recorded", for the part "a CI check that every listed test exists". The only test that a missing test title is refused is in `acceptance/test/check.test.mjs` (node:test, results not recorded by any configuration).
- Gaps: no test reads the generated page. The tests per criterion, the author obligations, the section 3.8 limits and the listing of uncited criteria are all untested; the obligations and the limits are hand-written in `apps/docs/pages/conformance.md`. The WCAG A/AA list in `apps/docs/data/wcag.mjs` is hand-written and not compared with the W3C list. Publication with each release has no test.
- I cited only what the tests assert. Another author is editing `apps/docs`; the titles were read today.

**A10**
- Statement: current spec wording.
- Citations replaced: the describe-wide prefix `A10 built-in text` (case prefix per type, 2 cases) became the two exact titles per type ("every built-in string that a … chart shows is replaced …" and "on a lang="de" page the built-in English is marked lang="en" …").
- Citations removed (line): the two `tests/dist/text.browser.test.ts` citations ("every built-in string that reaches the page is the override, literally …", once per describe.each loader). The BRIEF says that fixture is being adjusted, and the A10 acceptance tests cover every type.
- Citations added (line, a11y suite):
  - "on a lang="de" page built-in strings carry lang="en"; an overridden string and the series names are in the page language"
  - "an overridden string is not marked English, even inherited, when it is the only text"
  - "on an English page nothing is marked"
- Gaps rewritten: the keys `labelsHidden` and `value` are reached by no scenario; one large layout is used, so the readout strip and the L8 fallback are not shown with overrides; the lang check does not cover tooltip and readout rows, table headers, the Jump to field, or state messages (state messages are checked for line only).
- Compact gap rewritten: the old text described results. Compact `limits` say which compact kinds each scenario draws.

**T-keyboard-line/area/bar/donut/scatter**
- Statements, applicability and citations unchanged; each cited test was re-read.
- Limits rewritten: focus from the active element, role and numeric position from Chrome's tree at each step, text from `aria-valuetext`.

## Cells whose status went down or up

Static status; no results exist for this commit, so "evidence only" reads "not run" until results are recorded.

**Down:**
- **A1/compact**: evidence only → weak. The compact A1 browser tests run compact line only; nothing tests the zone statement or unique ids on compact area or bar.
- **A2/line, area, bar, scatter, donut**: evidence only → weak.
  - All five: Pause is never reached with the arrow keys.
  - Bar: its zoomed state on a date or number axis is not traversed.
  - Scatter: hiding the focused series is not tested.
- **A8/line, area, scatter, donut**: evidence only → weak.
  - All four: no pinned tooltip is scanned.
  - Area, scatter, donut: no readout strip is scanned.
- **A6/line, area, bar, scatter, donut**: cannot be verified here → not run (`pending`: no Firefox or WebKit result; native zoom is a limit, not an environment).
- **A6/compact**: not applicable → weak (applicability changed, see above).

**Up:**
- **A5/donut**: weak → evidence only. The amended A5 asks separators of slices; the old gap asked for something A5 does not ask.
- **A9/all six**: no evidence → weak (four unit citations, one weak citation, gaps).

**Unchanged:**
- A3 (cannot be verified here; the channel gap was added).
- A4 (line evidence only, others weak).
- A5/bar and compact (weak, gaps rewritten).
- A7 (compact weak).
- A8/bar and compact (bar weak, compact evidence only).
- A10 (weak).
- T-keyboard (evidence only).

## No evidence (gap list)

Most important first.

1. **A3, all full types**: no test shows the point's text arriving through the focused element's accessible name or a polite live region. It travels as the value text (`aria-valuetext`), and the tests read it from the DOM. **Needs an owner decision:** this is a mismatch between the spec wording and decision 0001. Either the spec admits the value text as a channel, or the implementation has to change. Screen-reader speech and touch reachability are not done, by the owner's decision.
2. **A9, all types**:
   - No test reads the generated page: the tests named per criterion, the author obligations, the section 3.8 limits, and uncited criteria shown as not covered.
   - The WCAG 2.2 A/AA list is not checked against the W3C list.
   - Publication with each release has no test.
   - The refusal of a missing test title is tested only outside the recorded configurations.
3. **A8**:
   - All full types: a pinned tooltip (row buttons).
   - Area, bar, scatter, donut: the readout strip of a small plot.
   - Bar: a date or number axis zoomed in.
4. **A6/compact**: no reflow or text-spacing test. **A6/all full types**: no Firefox or WebKit result (pending).
5. **A2**:
   - All full types: Pause is not reached with the arrow keys.
   - Bar: the zoomed state's tab stops on a date or number axis.
   - Scatter: focus after hiding the focused series.
6. **A7/compact**: no browser test of compact live regions while streaming, alone or 24 at once. The Node model is the only evidence.
7. **A5**:
   - Bar: the in-group order of bars against the legend and tooltip order.
   - Compact area and bar: the more-contrast and forced-colours modes, the palette and AX141.
   - Compact: stacked separators, and the pattern rule for more than two series.
8. **A10**:
   - All types: keys `labelsHidden` and `value`, and overrides in the readout strip and the L8 fallback.
   - Full types: lang on tooltip and readout rows, table headers and the Jump to field, and on state messages except for line.
   - Compact: lang on state messages and the corner marker's title.
9. **A4/area, bar, scatter, donut**: the million-row jump (line only).
10. **A1/compact area and bar**: the time-zone statement and unique ids.

## Not testable as written

- **A8** "on any fixture in any state": open-ended. The tests enumerate states per type; the gaps name the states the spec and decision 0004 define that are not scanned.
- **A2** "The exact keys and roles are fixed after the pattern spike in M1 (section 8)": a process note, not a property of the chart.
- **A9** "Published with each release": a release-process claim with no test surface. It would need a release check or a document citation.
- **A3** speech and touch: they need a screen-reader rehearsal, which is out of 1.0 by the owner's decision. Also, the criterion's channel ("accessible name or a polite live region") does not match the design the tests exercise (value text, decision 0001). As written, A3 would fail if tested literally, because the plot's name is the fixed "Chart plot".
- **A5**:
  - "repeats included" (Verified by): its meaning is unclear. The palette tests score exactly eight series, with no repeated colours.
  - "in any mode": open-ended. The tests cover light and dark (palette), more contrast and forced colours (dash).
  - It is unclear whether "each line and area carries a shape marker …, repeated in the legend and tooltip" reaches compact lines and areas, which have no legend or tooltip; C4 gives them dash instead. I did not record a gap for markers on compact.
- **A1** "Accessibility-tree snapshot for every fixture": the set of fixtures is not defined. Recorded as a limit.
- **A6** "400% zoom": WCAG 1.4.10 states the condition as 320 CSS px, which the emulation meets. Native zoom is not a separate requirement, so it is recorded as a limit.

## Titles that promise more than their assertions

- `packages/axylo/test/acceptance/reader-model.test.ts:122`, "A3 …: the pure keyboard value text conveys identity, value with unit and position". For the non-donut types, the x is checked as `toContain('2')`, which "Point 2 of 2" already satisfies. The x is not established, so A3 rests on the browser walk for it.
- `packages/axylo/test/browser/acceptance/a2-keyboard.browser.test.ts:260`, "A2 …: … the focus indicators … are painted at least 2 px wide and 3:1 …". The width is a computed style (outline width, stroke width). Only the 3:1 and the presence are measured on painted pixels.
- `packages/axylo/test/browser/acceptance/a6-a10.browser.test.ts:53`, "A6 …: at 400 % zoom of a 1280 × 1024 window …". It is an emulated viewport and device pixel ratio, not browser zoom; the title does say so in parentheses.
- `packages/axylo/test/browser/acceptance/a6-a10.browser.test.ts:143`, "A7 …: … the value text is not rewritten while the datum stays …". On donut, line 163 compares only the text without share and position, so the claim is weaker there. It is allowed by decision 0004 part 2, rule 2.
- `packages/axylo/test/browser/acceptance/a6-a10.browser.test.ts:459`, "A10 …: every built-in string that a … chart shows is replaced …". Two `Messages` keys (`labelsHidden`, `value`) are never brought onto a surface (`WHERE`, lines 303 and 314).
- `packages/axylo/test/browser/a11y/axe.browser.test.ts:57`, "`${fixture}`: default, table open, tooltip shown, series hidden". For `bars` and `parts` the "series hidden" state is not applied (line 76), though the title lists it. A8 bar's acceptance test scans a hidden series.

## Checker or helper defects

- `validate.mjs` prints per-cell statuses only when the whole merged matrix is accepted. With 99 problems in other rows the checker throws, so I worked out the static statuses above from the fields.
- The checker accepts the a11y `${fixture}: default, table open, …` titles statically, expanding a loop over `FIXTURES`, which is imported from `a11y/util.ts`. The a11y directory has no `EVIDENCE.json`, so I confirmed by hand that `trend`, `stacked`, `bars`, `scatter` and `parts` are in `FIXTURES`.
- The checker accepted the `C1 compact … (${build} build)` titles without `registration` and refused them with one: it expands the inline `['development', 'production']` loop. That is not a defect, but it is inconsistent with A1's `${build}` title, which needs a registration because of `TYPE_WORD[type]`.
- My rows depend on the helpers that these negative controls cover (not cited):
  - A1: `missingClauses`, "A1 line: negative control: the summary check …"
  - A2, A3, A7, T-keyboard: `valueText` with its focus and slider check, "A2 line: negative control: reading the value text fails …"
  - A2 indicator: `covered`, "I1 bar: negative control: the occlusion check …"
  - A4: `compareTable`, "A4 line: negative control: the table comparison …"
  - A5:
    - separators: "A5 bar: negative control: the separator check …"
    - painted colours: "A5 line: negative control: painted-colour sampling …"
    - grayscale: "A5 line: negative control: the grayscale marker-class check …"
  - A6: `textBoxes`/`overlaps`, "L1 line: negative control: the text check …"
  - A6's `clippedText`, A7's `watchLive` and A10's `surfaces` have no negative control.
