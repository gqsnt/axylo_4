## Findings

### B1. The calendar-date fix misses the most common way daily data arrives, and Axylo's own default would fail the R3 probe column
- Where: 02 F4 (line 79), §1.1 Chart.js row "dates that do not shift" (17), §6 "Calendar dates and instants" (166), §7 Q4 (190); 03 §1.2 `timeZone` row (58), M2 time-zone outcome (242), line 5 ("passes every column of the same probe"); 01 R3 (156–162), §6 row 3 (315).
- Evidence:
  - Observed: the `trend` fixture is epoch milliseconds at UTC midnight (`research/harness/src/data.js` lines 7, 12), so its values are instants. The R3 probe hovers with the browser set to America/Los_Angeles (`probe.mjs` 124–131). 03 line 58 makes `'local'` the default zone for instants, so Axylo given this fixture would show Feb 23 for the Feb 24 value. That is the outcome R3 counts as a failure in six libraries.
  - Observed: the M2 test ("identical tick labels and tooltip text" in UTC, LA and Kolkata) can pass only if the fixture is rewritten as `'2026-02-24'` strings, as in the 03 §1.1 example, or if a zone is declared. 02 line 190 says "either way F4's test holds because the zone is declared and stated". That is false for the `'local'` default: stating the zone in the description does not make the tick labels identical.
  - Observed: the harness gave Plotly `Date` objects (`libs/plotly.js` line 4). Its LA tooltip reads `(Mar 9, 2026, 36.832k)` against `(Mar 10…)` in UTC (`results.json` `plotly.hover_la`, `plotly.hover_utc`).
  - From memory (plotly.js 2.x; date-fns v2/v3): Plotly converts JS `Date` objects to local wall-clock time and shows date strings exactly as written, with no zone conversion. The Chart.js date-fns adapter's `parseISO('2026-02-24')` returns local midnight. Either way a date-only string comes back as the same day in every zone. If this still holds in the tested versions, R3's "What is missing everywhere is a way to say 'this is a calendar date'" comes from the harness feeding instants. I trust the harness for the input it used, not for the generalisation.
  - From memory: common back ends send daily values as UTC-midnight instants:
    - node-postgres parses `date` columns into a JS `Date`.
    - `JSON.stringify(new Date('2026-02-24'))` gives `…T00:00:00.000Z`, because ECMAScript parses date-only strings as UTC.
    - pandas `to_json` defaults to epoch milliseconds.
  - Inferred: with the default zone, Axylo repeats R3 for exactly the inputs most likely to reach it, while 02 §1.1 promises Chart.js users "dates that do not shift".
- Change:
  1. Add to F4: "When every value of an instant field has the same time of day (in UTC or in one fixed offset) and consecutive values are whole days apart (±1 h for DST), raise hint AX1xx: 'these look like calendar dates; set `type: 'date'` or `timeZone`'. Show the zone abbreviation next to every visible date and time (axis title or tooltip header), not only in the description." Never reinterpret the values silently.
  2. Replace the M2 time-zone outcome with four fixture variants and expected results:
     - (a) `'2026-02-24'` strings: identical output in UTC, LA and Kolkata.
     - (b) `'2026-02-24T00:00:00Z'` strings, (c) epoch ms and (d) `Date` objects: shown in the declared zone, with AX1xx raised and the zone visible. Identical across zones only when `type: 'date'` or `timeZone: 'UTC'` is set.
  3. Delete "either way F4's test holds" from 02 §7, and choose the default after seeing the results for (b) and (c).
  4. Rerun `hover-la` for all ten libraries with the same four representations, and report the result per representation, before keeping "six of ten" in R3 and §6 row 3.

### B2. Even if every criterion passes, Axylo would not meet WCAG 2.2 AA, yet A9 will publish a conformance table claiming it
- Where: 02 §3.4 target (111), A2 (116), A5 (119), A7 (121), A9 (123), I3 (105), L5 (95), L7 (97); 03 line 357 (English only), §3 M4 and M6.
- Evidence (WCAG references are From memory, WCAG 2.2 Recommendation, Oct 2023):
  - 2.5.1 Pointer Gestures (A) and 2.5.7 Dragging Movements (AA): I3's pointer methods are drag-to-zoom and pinch, and the only visible control is a reset button that appears "whenever zoomed". Keyboard shortcuts do not satisfy either criterion; both require an alternative that works with a single pointer and no dragging.
  - 2.2.2 Pause, Stop, Hide (A): `append` streaming is moving, auto-updating content shown alongside other content for more than 5 s. No criterion gives it a pause mechanism or lists it as an author obligation in A9.
  - 1.4.1 Use of Color (A): L5 removes markers from dense lines, and A5 adds dashes only under `prefers-contrast: more` or forced colors. In the default mode the multi-series `trend` lines differ by color alone. A legend marker shape that never appears on the line does not help, so A5's opening sentence is contradicted by L5 on the main fixture.
  - 1.4.11 Non-text Contrast (AA): for adjacent filled marks (donut slices, stacked segments), the Understanding document's pie-chart example asks for contrast between neighbours or a separator. A5 measures only against the background.
  - 3.1.2 Language of Parts (AA): built-in strings ("View as table", "No data", "point 4 of 120", the generated summary) ship in English only (03 line 357), while `locale` follows the document language (03 line 82). On a `lang="de"` page they are mispronounced unless marked `lang="en"`, and nothing lets the author override them.
  - 4.1.3 Status Messages (AA): L7 requires the empty, loading and error message to be in the accessibility tree, but not to be announced when the state changes.
  - 1.4.4 (page zoom): if the zoom modifier in I3 is Ctrl, intercepting it blocks browser zoom over the chart. Trackpad pinch also reaches pages as `wheel` with `ctrlKey` in Chrome and Firefox. Capturing touch pinch on a chart that fills a phone screen blocks page pinch-zoom.
  - Inferred: the visible zoom and pause controls needed above push past A2's three tab stops. M4 checks A2 before M6 adds zoom (03 lines 265, 288–294), and nothing rechecks A2 afterwards.
- Change:
  - I3: "When zoom is enabled, visible Zoom in, Zoom out and Reset buttons (each ≥24×24) work with single clicks, and panning has click or keyboard equivalents. Wheel zoom never uses Ctrl or Meta and never calls `preventDefault` on a Ctrl or Meta wheel event. Touch pinch and drag are not captured unless `zoom: 'touch'`." Test: reach a given range by clicks only.
  - A2: "At most three tab stops: the plot; one toolbar with roving tabindex and `role="toolbar"` holding legend toggles, zoom, table and pause; and the open table if it scrolls." Retest in M6 and M7.
  - New A10: "A chart fed by `append` shows a visible Pause/Resume control, or A9 records that the author must supply one. Appends are buffered while paused."
  - A5, first sentence: "In every mode each line or area can be identified without color: by a direct label at the line end when it fits (the default), otherwise by dashes from series 2 onward. The legend repeats the same cue." Add: "Adjacent filled marks are separated by a gap of at least 1 px in the background color."
  - New A11: "Every built-in string can be overridden through `messages`. Built-in text carries `lang="en"` when the document language is not English."
  - L7: "Changes of state are announced once through a polite status region."
  - A9: list every WCAG 2.2 AA success criterion, including those above, with its test ID.

### M1. The 01 interaction table counts visual tooltips as announcements, misnames roles and contradicts results.json in two cells
- Where: 01 §4.1 rows "Accessibility tree" (216) and "Focused point announced or shown as text" (219); R12 (232); §6 row 4 (316); 03 §2.2 (171).
- Evidence:
  - Observed: after Tab, two ArrowRight, ArrowDown and Enter, every `live` array is empty for Highcharts and MUI X (`results.json` `highcharts.keyboard.arrows[*].live`, `mui.keyboard.arrows[*].live`). Both pages do contain polite regions (`highcharts.trend.dom.marked`, `mui.trend.dom.marked`).
  - Observed: DOM focus stayed on Highcharts' container div (`arrows[*].tag = "div"`) and on MUI's unlabeled `role="none"` div. The focused point shows up only as visual tooltip text (`newTextAfterKeys`).
  - Observed: only Recharts (assertive) and ApexCharts (polite) put the point's text into a live region (`recharts.keyboard.arrows[0].live`, `apexcharts.keyboard.arrows[0].live`).
  - Observed: Recharts and ApexCharts expose `role="application"` (`recharts.trend.aria` "- application:", `apexcharts.trend.aria`), which the table reports as "region". Recharts' application element has no `aria-label`; the tick labels are child text, not its accessible name.
  - Observed: by these data the libraries that followed Highcharts are ApexCharts and Recharts, not "ApexCharts and MUI X" as §6 says.
  - Inferred: `application` versus region decides whether NVDA and JAWS stay in browse mode, which is the question 03 §2.3 leaves open, and the table hides it.
- Change:
  - Split row 219 into "Point text reaches a live region or a focused element's accessible name" and "Point shown visually". Set Highcharts and MUI X to "no (tooltip only)" in the first.
  - Record the observed `application` role for Recharts and ApexCharts.
  - Change §6 row 4 to "Highcharts (module, commercial), then ApexCharts and Recharts".
  - In `probe.mjs` `describe()` (111–115), also read the text of `role=status|alert|log` elements and the focused node's computed accessible name, and record whether DOM focus moved.

### M2. The accessibility comparison gives Highcharts its accessibility opt-in and gives no other library its equivalent
- Where: 01 §2 rule (111), §4.1 header (214), R11 (230), R13 (234), Summary (13).
- Evidence:
  - Observed: `libs/highcharts.js` line 2 imports `highcharts/modules/accessibility`. The task requirements (line 111) do not mention accessibility, so this goes beyond "the least configuration".
  - Observed: `libs/echarts.js` sets no `aria` option and imports the full build (line 1). R11 says ECharts' description generator needs "an extra component import (Docs)".
  - From memory (ECharts 5): the full build registers the Aria component, so `aria: { enabled: true }` alone generates a description; the extra import is needed only with `echarts/core`. If that still holds in 6.1, R11 is wrong for the configuration tested.
  - Inferred: "strongest on the reader's side" and "only one library describes the chart" compare one library's opt-in state with nine default states.
- Change: add an "accessibility switch on" column that gives each library its single documented switch (ECharts `aria.enabled`; Chart.js and Plotly: none) and records its cost in lines and bytes. Alternatively, also run Highcharts without the module. Reword the summary to say the module was imported and the other nine were given no equivalent.

### M3. A misspelled or absent field produces an empty chart with no diagnostic
- Where: 02 F2 (77), F3 (78), DX3 (135); 03 line 127 ("`null` and `undefined` … produce a gap without a warning").
- Evidence: Inferred.
  - In row objects, `undefined` usually means the key is absent: a typo (`Sessions` against `sessions`) or a schema change. Every value then reads as missing, the chart is all gaps, and nothing is reported.
  - DX3's compile-time check does nothing for `await res.json()` rows (`any`), which is how developers and coding agents usually write it.
- Change: add to F3:
  - "A field named in the options that is not an own key of any row raises error AX101 ('field "sessions" not found; rows have day, channel, Sessions — did you mean "Sessions"?') and the chart shows its error state."
  - "A field absent from some rows raises warning AX102 with the row indexes."
  - "Only an explicit `null` is silent."
  - Add a misspelled-field fixture to the M2 outcomes.

### M4. Absent rows, unsorted rows and missing bars are drawn wrong without a diagnostic
- Where: 02 F2 (77), F10 (85); 03 §2.1 interact "binary search" (162).
- Evidence: Inferred.
  - F2's property test covers only explicit `null` and `undefined`. `GROUP BY day` leaves out days with no events, so the line joins across them (the uPlot failure in R5). For counts the faithful value is often 0, not a gap.
  - Nothing says whether `line` sorts by x, yet the binary-search lookup assumes sorted data, and rows from a query without `ORDER BY` arrive unsorted.
  - A `null` bar and a zero bar look the same.
  - F10 says a missing value inside a stack is reported, but not what is drawn.
- Change:
  - F2: "On a time axis with a regular step inferred from the data, an absent step is a gap and raises hint AX105 with the count and the first dates. `missing: 'gap' | 'zero' | 'connect'` sets the behavior explicitly." Test: `trend` with 7 rows deleted renders like the `null` version and raises AX105.
  - New F11: "Line, area and scatter sort by x (stable sort). A duplicate x within a series is an error and that series is not drawn."
  - F2, for bars: "A missing bar shows a 'No data' mark at the baseline, distinct from a zero-height bar."
  - F10: "The missing segment is drawn at zero height, and the stack total is marked 'incomplete' in the tooltip, the table and announcements."

### M5. A minimal chart has no accessible name, and a dashboard cannot name it from its own heading
- Where: 02 A1 (115), L6 (96), DX1 (133), DX4 (136); 03 `title` (72), `<h3>` (183).
- Evidence:
  - Observed text: A1 says the accessible name is the title. L6 only raises a hint when the title is missing. DX1 says nothing besides data and fields is required. Hints print only in development builds.
  - Inferred: the minimal valid chart ships to production without a name. Dashboard cards usually show the title in their own header, so authors leave `title` out to avoid showing it twice.
  - Observed: a fixed heading level in a library (Highcharts' `heading [level=6]`, `results.json` `highcharts.trend.aria`) imposes its level on every host page. 03 hard-codes `<h3>`.
- Change:
  - API: `title?: string | { text: string; visible?: boolean; level?: 2|3|4|5|6|false }` and `labelledBy?: string` (the id of an existing heading).
  - A1: "With neither `title` nor `labelledBy`, the name is generated ('Line chart of Sessions by Day') and warning AX140 is raised in both builds."
  - Run axe's `heading-order` rule as part of A8.

### M6. Dark mode was tested on a page that turns dark itself, and canvas marks will not follow a theme toggle
- Where: 02 L4 (94), DX6 (138), §6 (175); 01 R10 (204).
- Evidence:
  - Observed: the harness page declares `color-scheme: light dark` with `Canvas` and `CanvasText` (`index.html` lines 7–8), so the page itself turns dark under the emulation.
  - Inferred: real dashboards often switch theme with a class on `<html>` and no `color-scheme`, and light-only apps stay light on a dark OS. R10 says Highcharts follows `prefers-color-scheme`, so on a light-only page with a dark OS it would draw light text on white. The probe cannot see this.
  - Inferred: DOM text follows a class toggle by inheritance. Canvas colors (palette, grid, axis lines) do not change until something redraws them, and no event fires when computed styles change.
  - Inferred: L4 does not say how light or dark is decided when `color-scheme` is unset.
- Change:
  - L4: "Light or dark is decided from the chart element's computed `color-scheme`. If that is unset, from the luminance of the inherited `color` (light text means a dark background). `--axylo-background` overrides both."
  - L4: "Marks are repainted within one frame after a change in `prefers-color-scheme`, `forced-colors` or `prefers-contrast`, or in the `class`, `style` or `data-theme` attribute of `<html>` or `<body>`."
  - Tests:
    - a class-toggled dark theme with no `color-scheme`;
    - a light-only page under a dark OS, which must stay light (run Highcharts on this too before keeping "by design");
    - a runtime toggle, after which the canvas pixels change within one frame.

### M7. Production builds tell nobody about bad data
- Where: 02 DX4 (136), principle "Say it, do not guess" (36); 03 line 129.
- Evidence:
  - Observed text: production builds call only `onDiagnostic`.
  - Inferred: bad data mostly appears after deployment. If the author never wired `onDiagnostic`, nobody is told, which is the R5 result again. Nothing says how a build decides it is "development"; the IIFE `<script>` build, Chart.js' main channel, has no bundler to decide it.
- Change: DX4:
  - "Errors that drop values show a short note in the chart ('2 values could not be shown — see table') in every build, and the note is in the accessibility tree."
  - "Production builds `console.warn` each error code once per page."
  - "Development and production flavours are selected through package `exports` conditions. The script-tag build is the development flavour, with a separate `.min` production file."
  - Add a test: a production build given `dirty` shows the note.

### M8. Numeric strings are dropped by default, although common back ends send counts as strings
- Where: 02 F3 (78); 03 lines 123–124.
- Evidence:
  - From memory: node-postgres returns `int8` (e.g. `COUNT(*)`) and `numeric` as strings, Django REST Framework serialises `DecimalField` as strings, and the BigQuery REST API returns every value as a string.
  - Inferred: the standard `SELECT day, count(*)` chart from a Node and Postgres API draws nothing, so a first chart written by a developer or an agent fails.
  - Observed: five of the ten libraries plotted `'40'` (see m3).
- Change: see Decisions 3.

### M9. The screen-reader pattern is chosen after the DOM, key map and tab-stop budget it constrains are built, and neither candidate serves touch screen readers
- Where: 03 §2.3 (196), M3 and M4 (247–271); 02 A2 (116), A3 (117), §7 Q1 (187).
- Evidence:
  - From memory: NVDA and JAWS do not switch to focus mode when a generic focusable `div` (03 line 185) gets focus. Arrow keys reach the chart only with `role="application"` or a widget role.
  - Inferred: A2 fixes the key map (Up and Down change series) and the tab-stop count in the spec, but M4 may pick a role whose conventions differ.
  - Inferred: VoiceOver on iOS and TalkBack, both in A3's script, have no arrow keys. With "application plus live region", points cannot be reached by swiping. M1–M3 build the plot, legend and tooltip DOM before M4.
- Change:
  - Move the pattern decision to a spike at the end of M1: two patterns on the `trend` scene, A3's script on the four reader and browser pairs, recorded as developer rehearsal.
  - Until then, word A2 and A3 as outcomes: "every point reachable in order by keyboard; series switchable; the focused point's text is conveyed when focus changes; on touch screen readers every point is reachable by swipe, or the table within two gestures".
  - Add a third candidate: an adjustable (`role="slider"`-style) element with `aria-valuetext`. From memory, this is an established way to support swipe up and down on touch screen readers.

### M10. Text is measured with canvas metrics but drawn as DOM text, so L1 and A6 can fail in the very cases they test
- Where: 03 §2.1 layout (158), §2.2 (167, which cites "A7" where it means A6), §4 scene tests; 02 L1 (91), A6 (120).
- Evidence:
  - From memory: `measureText` ignores CSS `letter-spacing`, `word-spacing` and `line-height` set by user stylesheets (the WCAG 1.4.12 overrides), and it measures with whatever font is loaded at the time.
  - Inferred: with those overrides, a web font that loads late, or page translation (which 03 lists as a benefit of DOM text), DOM labels end up wider than the layout assumed.
  - Inferred: an L1 property test run in Vitest with injected metrics cannot detect any of this.
- Change:
  - Measure through a hidden DOM element that carries the computed style, or apply the computed spacing to `ctx.letterSpacing` and `ctx.wordSpacing`.
  - Re-run layout on `document.fonts` `loadingdone` and whenever label text changes.
  - In M3, run the overlap check in all three engines with the 1.4.12 override stylesheet, Firefox text-only zoom at 200%, and a font that loads 500 ms late.

### M11. React use and `update` semantics will misbehave in ordinary code
- Where: 03 §1.4 (94–99), §1.6 (139), §2.1 "memoize on input identity" (152); 02 DX5 (137).
- Evidence: Inferred.
  - Shallow comparison plus memoizing on identity means `x={{ field: 'ts', timeZone: 'UTC' }}` or `data={rows.filter(f)}` written inline renormalizes every chart on every parent re-render.
  - `update` is applied on the next frame, so `strict: true` cannot throw to the caller, and `chart.diagnostics` is stale right after `update`.
  - React has no route to `append`.
  - Merge or replace semantics for nested patches are not specified.
  - `zoom()`, `append()`, `onDiagnostic` and `on('diagnostic')` sit beside DX5's claim that `update` is the only way to change a chart.
- Change:
  - `update` validates and normalizes synchronously (it throws under `strict` and refreshes `diagnostics`); only drawing waits for the next frame.
  - Top-level keys of a patch replace the old value; document this.
  - The adapter compares field specs structurally. In development it raises a hint when content-equal `data` arrives with a new identity three times in a row.
  - Expose `append` through the adapter, via a prop or a ref to the handle.
  - Reword DX5 as "`update` changes options, `append` adds rows, `zoom` sets the view", and keep only one of `onDiagnostic` and `on('diagnostic')`.

### M12. The data table (A4) conflicts with A2, A8 and fixed-height dashboard tiles
- Where: 02 A4 (118); 03 `<details>` (192), `table` default true (78).
- Evidence:
  - From memory: axe-core's `scrollable-region-focusable` rule.
  - Inferred: a 1,000-row table in a 400 px tile either scrolls, which needs a focusable region (a fourth tab stop or an axe failure), or overflows the tile.
  - Inferred: "the first 1,000 rows" of a 100k-point series is unrepresentative.
  - Inferred: nothing specifies the caption, header semantics, units, how hidden series and zoom are handled, or that the table is built lazily (24 tables would be about 100k cells).
- Change: A4:
  - "Caption is the title. Column headers are field labels with units, and row headers are x values. Values are formatted per F6."
  - "The table covers the current x domain. Above 1,000 rows it shows evenly spaced or aggregated rows, labelled as such."
  - "It is built when opened, inside a focusable scroll region no taller than the plot."
  - Test: on a 24-chart page, opening one table changes no other chart's size.

### M13. F7's percentage rule is a guess and flattens most dashboard percentages
- Where: 02 F7 (82).
- Evidence: Inferred.
  - Detecting a percentage from free label text contradicts "Say it, do not guess" (02 line 36).
  - With `format: { style: 'percent' }` (Intl), values are fractions, so "data ≤ 100" is always true and the domain would run to 10,000%.
  - Ending at 100 flattens 0–4% error or conversion rates into a line along the bottom.
- Change: "A field declared `unit: 'percent'` (0–100) or formatted with `style: 'percent'` (0–1) ends at 100% only if its maximum is at least half of full scale; otherwise the normal rule applies. Nothing is inferred from label text." Add a property test: a 4% maximum ends at the first tick at or above 4%.

### M14. Label fitting truncates before rotating, can make labels identical, and its fallback "report" reaches the developer, not the reader
- Where: 02 L1 (91), §6 (169); 03 M3 "remains identifiable" (253).
- Evidence:
  - Inferred: "Customer Success – EMEA" and "…– APAC" both truncate to "Customer Succ…".
  - Observed: Chart.js' rotated labels are complete and legible (`_sheet-bars.png`).
  - Inferred: a console diagnostic satisfies "reporting" while the reader sees an unnamed bar. "Identifiable" has no test.
  - Inferred: ordered categories (months, age bands) cannot be thinned because their order is unknown.
- Change:
  - Order the remedies: thin ordered axes, including `ordered: true` categories and calendar periods; wrap to two lines; rotate up to 45°; truncate in the middle while keeping labels unique; switch to horizontal bars unless the author fixed the orientation; finally show a visible note ("Some labels hidden — see table") plus a diagnostic.
  - Add a property test that truncated labels are pairwise distinct.
  - Replace "identifiable" in M3 with that test.

### M15. The rationale for canvas marks misreads the Phase 1 timings
- Where: 03 §2.2 (167); 02 §6 (172).
- Evidence:
  - Observed (01 §5.3, lines 285–291): D3 with one SVG path took 75 ms at 100k points and 559 ms at 1M. Plotly's default SVG `scatter` took 74 ms and 425 ms. The canvas libraries Chart.js and ECharts took 1.8 s and 1.5 s at 100k.
  - Inferred: "tens of milliseconds in canvas libraries" is true only of uPlot. D10 shows that one DOM node per point is slow, not that SVG is.
  - Inferred: the dark-mode argument rests on inheriting `currentColor` (the D3 harness also sets it on its own text, `libs/d3.js` lines 12, 20, 38), and canvas code can read `currentColor` too.
- Change: correct the rationale and treat the renderer as an open, measured decision (Decisions 1).

### M16. The palette threshold, and the claim that a better default exists, rest only on a search whose "usable" result covers few hues
- Where: 02 A5 (119), note (125); 01 R7 (196).
- Evidence:
  - Observed: `research/palette/feasibility.json` `usable-light-8` is `#7d2960 #9584f2 #620ab4 #ca7b9b #f3471b #9b578a #b12508 #6a41f6`: purples, reds and a pink, with no green, teal or yellow. Its minimum Δ is 0.122, only 22% above the 0.10 threshold.
  - Observed: the light and dark sets are different colors, so a series changes color with the scheme.
  - Inferred: 0.10 sits between the library scores and the search result; it is not a perceptual quantity. It is scored on swatches, while lines are 1.5–2 px wide.
- Change:
  - Mark 0.10 as provisional, or give its perceptual basis.
  - Score colors at line width.
  - Add a hue-coverage constraint to the search.
  - Test one palette valid on both `#fff` and `#16181d` (relative luminance about 0.13–0.30).
  - Reword R7 to "the thresholds are reachable; whether a pleasant palette meets them is open (02 §7)".

### m1. Wrong cross-references
- 03 line 167 "(A7)" should be A6.
- 03 line 267 "(A9)" should be A8.
- 03 line 139 cites a "finding A1" that does not exist.
- M5's palette outcome (03 line 280) leaves out normal vision and the dark scheme, both of which A5 requires.

### m2. Internal contradictions in F9 and F5
- F9 says "No two series share a color" and also cycles colors beyond eight. Change to: "up to eight series no two share a color; beyond eight, colors repeat, each repeat differs by dash and marker, and AX130 is raised".
- F5 decimates when "points outnumber pixels"; 03 line 173 does so at "more than twice the width". Use one rule, stated in device pixels.

### m3. R5's counts and framing
- Observed: uPlot also plotted `'40'` (`_sheet-dirty.png`, uPlot panel, Fri = 40), so five libraries did this, not four (01 line 9 and the R5 table).
- Observed: the D3 dirty chart leaves out `.defined()` deliberately (`libs/d3.js` line 91, while line 30 uses it), yet the summary counts it as a library failure.
- From memory (uPlot 1.6): `undefined` is documented as "connect across" and `null` as a gap. Say so.

### m4. Probe defects that touch recorded values
- `probe.mjs` line 144 picks up a 14 px legend icon for Recharts and MUI X (`recharts.resize.mainWidth = 14`, `mui.resize.mainWidth = 14`). The "yes" verdicts rest on `_sheet-resize.png`, not on the JSON.
- `&w=340` (line 147) shrinks the container inside an 800 px viewport, but 01 line 123 says "page rendered at 340 px". There was no mobile viewport, DPR or touch emulation.
- `innerText` capture (126–132) cannot see tooltips drawn on canvas. `chartjs.hover_la.newText` is empty and `hover-la-chartjs.png` shows no tooltip, yet R3 quotes Chart.js' `Feb 23, 2026, 4:00:00 p.m.` as Observed. Attach the artifact or relabel the claim.
- Motion was probed only on `bars` (line 152), and every pixel difference is counted as animation. No script under `research/` performs the "prefers-reduced-motion string" check.

### m5. The Recharts donut result may be a timing artifact
- Observed: `libs/recharts.jsx` line 53 passes `label`, yet `_sheet-parts.png` shows no labels. The screenshot is taken 1.8 s after create (`settle = 1800`).
- From memory (Recharts 2.x): the pie animation starts at 400 ms and lasts 1,500 ms, and labels render only once it ends. Rerun with a 3 s settle or with reduced motion before keeping "no".
- Observed: the harness gave Recharts four colors for six slices (line 8). Caption the repeated colors as caused by the harness.

### m6. Extrapolations stated as observations
- "240 tab stops on a 24-chart dashboard" for ApexCharts: six of its ten stops are the zoom toolbar of a datetime chart, and only `trend` was keyboard-probed. Label 240 as an inferred upper bound.
- Plotly's PNG download on Enter is the documented behavior of the button that had focus. The real finding is that the first tab stops are toolbar buttons, not data.

### m7. Undefined quantities in F6, F8 and I1
- F6 "the data's own precision": computed floats have 17 digits. Cap at 6 significant digits.
- F8 does not cover `null` or `0` slices. Let the legend carry value and percentage, which satisfies F8 and L1 at 240 px.
- I1 describes line behavior only. Bars, scatter and donut need their own wording, and a tooltip for 12 series needs a "+N more" cap.
- A2 says Escape leaves the plot and I1 says Escape closes the tooltip. Define the order: the first Escape closes the tooltip, the second leaves point mode, and Escape is otherwise not consumed (charts inside dialogs).

### m8. Gaps in the I5 motion criterion
- Updates under reduced motion have no test.
- "First frame equals the frame at 2.5 s" needs a pixel tolerance and must start after `document.fonts.ready`.
- Add a 24-chart filter-change test.

### m9. Ambiguities and unsupported thresholds in L2, L3 and L5
- L2 "lines needed to read values" does not say whether gridlines count; 3:1 gridlines dominate the data. Exempt gridlines when a tooltip or table is present.
- Text inside a mark is measured against the mark color.
- A toggled-off legend item is not "inactive", so dimming its text below 4.5:1 fails WCAG 1.4.3.
- L3's 16:9 box is 1,080 px tall at 1,920 px and 135 px at 240 px. Clamp it, and test that a `height: auto` container is stable over 10 frames.
- L5's 12 px, A4's 1,000 rows, A7's 5 s and A2's three stops have no stated basis. Mark them provisional.

### m10. Streaming and focus (A7)
- A polite summary every 5 s, indefinitely, interrupts the reader. Announce nothing unless the plot has focus.
- Keep focus on the same datum (by x) until it leaves the window. Do not re-announce position changes caused by new data. Apply the same rule when the focused series is hidden.

### m11. Gaps a coding agent will hit
- Unknown options (`height`, `colors`, `xAxis`) are caught only by TypeScript. Add a runtime warning with "did you mean".
- Diagnostics should name the chart (title or element id).
- A3 needs a unit, but the field API (03 §1.2) has no `unit`.
- Support dotted paths for nested fields.
- Specify what happens when the selector is not found.
- Ship `'use client'` in `@axylo/react`.
- Expose `validate(options): Diagnostic[]` for use in Node.
- Insert labels and `format` output as text only, never as HTML; they come from data.

### m12. Scope versus fixtures
- `line` is scoped to "time or numeric x" (02 line 47, 03 line 225), but M2's `dirty` test is a line over Mon–Sun categories (`data.js` line 40).
- Year-month, quarter and week strings are common dashboard x values and are neither dates under F4 nor ordered categories. Add calendar periods to F4.

### m13. F1's escape hatch keeps bar length misleading
- Inferred: an axis-break mark does not repair a length encoding.
- Change: `zero: false` on `bar` draws dots or lollipop heads without bar bodies.

### m14. Budget references mix different quantities
- P1 cites "9.5 ms (uPlot) to 43 ms" (02 line 151). `results.json` shows D3 at 3.6 ms and Recharts at 3.9 ms `createMs`, and Recharts' figure leaves out its deferred render (`toPaintMs` 74.4).
- An 8 ms budget for more work than uPlot does has no basis, and neither does DX7. Derive both from M1 measurements.

## Decisions I would overturn or reopen

1. **Canvas marks with DOM text** (02 §6; 03 §2.2).
   - Counter-argument: everyday charts have a few thousand marks or fewer. One SVG path per series with the same decimation fits the budgets on Phase 1 numbers (D3 one path: 75 ms at 100k).
   - SVG also follows CSS variables and class-toggled themes with no repaint code, adapts to forced colors through CSS, prints sharp, needs no DPR handling on browser zoom, and allows per-mark accessible elements if M9's spike chooses proxies. Canvas wins for streaming and hover at 100k points and above (P3).
   - Verdict: this defeats the stated rationale, not necessarily the decision.
   - What would settle it: in M1, render `trend`, `scale` at 100k and 1M, and W-page with an SVG and a canvas renderer of the same scene. Compare P1, P2, P3, P5, bytes, and behavior under theme toggle, forced colors and print.
2. **Instants default to the viewer's zone (`'local'`), with no hint when values look like calendar dates** (02 §7 Q4). Reopen per B1.
   - What would settle it: the four-representation probe, plus fixtures for what node-postgres, DRF, BigQuery, pandas and `Date.toJSON` emit for a date column. Either default is acceptable once the hint and a visible zone label exist.
3. **Numeric strings not plotted** (F3).
   - Counter-argument: for whole-column canonical number strings, parsing is lossless and unambiguous, so it is not a guess.
   - Verdict: overturn for that case. Coerce, with hint AX104 once. Keep the warning and do not plot for mixed columns and locale-formatted strings (`'1,234'`). Treat `''` as missing.
   - What would settle it: the AX104 rate on the back-end fixture set above.
4. **Production diagnostics silent** (DX4).
   - Verdict: overturn per M7. This is a values choice that no measurement settles. The reader-facing note's layout cost can be measured.
5. **Label-fitting order** (L1). Reopen per M14.
   - What would settle it: over generated label sets at 240–1,920 px, compare truncate-first with rotate-first by counting ambiguous labels and horizontal fallbacks.
6. **A2's key map and three tab stops fixed before the screen-reader decision** (A2; 03 M4). Reopen per M9 and B2. The outcome-based wording proposed there holds until the M1 spike reports.
7. **Colors only from CSS, no theme object** (02 §6).
   - Counter-argument: canvas needs repaint triggers (M6). The `palette` option (03 line 81) is a second way to set colors.
   - Counter-argument: dashboards need the same series ("Direct") to keep the same color on every chart, even charts where some series are missing. Positional palettes break that.
   - Verdict: keep CSS. Add the repaint triggers, and replace `palette` with color-by-series-name (`colors: { Direct: 'var(--brand-1)' }`) plus a stable default assignment by name.
   - What would settle it: a 24-tile example in which series subsets vary.
8. **No first-render animation**.
   - Counter-argument: R14 and D8 argue for honoring reduced motion and for cheap animation, not for none.
   - Verdict: not defeated. With 24 charts loading, reading starts at first paint. Restate the rationale on that basis.
9. **Five chart types**.
   - Counter-argument: dashboards are full of KPI sparklines and small multiples. Each Axylo chart brings a title, legend, table control and three tab stops, which is too heavy for 40 sparklines.
   - Verdict: not defeated if 1.0 has a `compact` variant (no axes, legend or table control; one tab stop or none, plus a generated label).
   - What would settle it: tab-stop and byte counts in a 24-tile example in M7.
10. **Extreme-preserving decimation**.
    - Counter-argument: decimating each stacked series separately misdraws the stack.
    - Verdict: keep, but decimate cumulative sums and add a stacked-area case to F5.
11. **Kept, with no objection**: rows and field names (add dotted paths), a single `update` (specify merge semantics; M11), accessibility in core, MIT, the React adapter, and budgets relative to uPlot.

## Missing from the documents

- **Customization comparison.** The original request asks for it. No harness task customizes anything (brand colors, font, a tick formatter, a theme).
- **AG Charts and Observable Plot left out.** From memory, with low confidence (AG Charts v9–10, Observable Plot 0.6): AG Charts Community enables keyboard navigation and ARIA by default under MIT; Observable Plot uses UTC time scales. Both sit in "next in line". 01 §6 claims "Nobody" and "No library is strong in more than two rows" without probing them.
- **CanvasJS not mentioned.** It has 3,240 mobile origins, more than ECharts (`httparchive.json`), and is absent from "next in line".
- **First-chart rehearsal by a coding agent.** DX1's line count says nothing about getting the chart right first time. Add an agent-rehearsal, labelled as rehearsal and not as user evidence: fixed prompts with fixtures containing UTC-midnight ISO dates, numeric strings, unsorted rows, missing days and a misspelled field. A pass is a probe-clean chart with no error diagnostics.
- **WCAG 2.2 AA criteria missing from the spec:** 2.2.2, 2.5.1, 2.5.7, 3.1.2 and 4.1.3, plus 1.4.1 for dense lines and 1.4.11 for adjacent segments (B2).
- **RTL pages.** Excluded in 01 line 125 and not mentioned in 02 or 03.
- **Print and devicePixelRatio changes** (browser zoom) for the canvas.
- **Delivery of the default CSS under CSP** (DX8). From memory: injecting a `<style>` element needs `unsafe-inline` or a nonce, while `el.style` assignment does not. Say which method Axylo uses and how script-tag users get it.
- **Accessibility workloads in 04.** None of the W-* workloads covers keyboard step latency at 1M points, table-open time, or the size of the accessible DOM on a 24-chart page.
- **Internal errors.** What the reader sees when Axylo itself throws (an error state, not a blank chart).

## What I could not verify

- No screen reader was run, by the author or by me. Every accessibility statement above comes from the accessibility tree, live-region text and screenshots.
- `node_modules` was off limits, so I could not check package contents: the "prefers-reduced-motion" string search, ECharts' full-build Aria component, Recharts' pie animation defaults, or how Highcharts' dark mode works.
- I re-ran nothing: no probe, build, palette or performance script.
- Spot checks that matched:
  - 01 §1.1 rows for Recharts, Chart.js and D3 against `adoption.json`;
  - HTTP Archive origin counts;
  - release dates against `cadence.json`;
  - §1.4 against `sizes.json`;
  - §5.3 against `perf.log`;
  - R7 against `palette.json`;
  - R2, R5 and R6 outcomes against the screenshots and JSON, except where noted above.
- Not checked:
  - claims labelled Docs (licenses, prices, MUI Pro, the date of the Chart.js accessibility page);
  - ApexCharts' `height: '100%'` giving 456 px;
  - Recharts printing raw epoch numbers without a formatter (the harness always passes one);
  - the Chart.js LA tooltip text quoted in R3.
- My from-memory statements apply to older versions (plotly.js 2.x, Recharts 2.x, ECharts 5, uPlot 1.6, node-postgres 8, WCAG 2.2 of October 2023) and may not hold for the November 2026 versions tested.
