# Phase 1b: Axylo product specification

Revision 3, 2026-11-18. Revised after three independent reviews ([ledger](../reviews/2026-11-18/ledger.md)), then updated with the owner's decisions of the same day: scatter is in 1.0, a compact variant is in 1.0, and the mark renderer is decided by measurement in M1.

Based on the findings in [01-landscape.md](01-landscape.md). Finding IDs (R1–R16 for readers, D1–D10 for developers) refer to that document. Criterion IDs defined here are F, L, I, A (reader), DX (developer) and P (performance).

## 1. What Axylo is

**Axylo is the everyday chart you can ship without checking it.** The smallest correct call produces a chart that represents the data faithfully, stays readable at any width and in any color scheme, and works with a keyboard and a screen reader. When the data is wrong, Axylo says so, to the developer and to the reader, instead of drawing a guess.

It is a framework-neutral TypeScript library under the MIT license, with a thin React adapter.

Speed is a constraint, not the headline: Axylo must stay within the budgets in section 5 with default options. Whether it can do that at a million points with its accessibility layer on is something the first milestone measures, not something this document can promise.

### 1.1 Why someone would choose it

Phase 1 found no library among the ten that holds these together. Each row is the reason to choose Axylo over the library a team would otherwise reach for. The right-hand column is a design target, not a measured result.

| If you would otherwise use | You get today | Axylo aims to add |
|---|---|---|
| Chart.js | Simple API, permissive license, widest reach | Keyboard and screen-reader access without author work; reduced-motion support; a tooltip that appears wherever the pointer is; large data without expert options; a stated time zone on every instant |
| Recharts | The React default | A palette, a title, labels that fit, formatted numbers and dates without code; 100,000 points without seconds of blocking; the same chart outside React |
| Highcharts | The best reader experience of the ten | The same class of accessibility with no module to import and no commercial license; reduced-motion support; errors that name the field and the row |
| ECharts or ApexCharts | Many chart types | Fewer types, each of which fits its labels, reports bad data and is accessible by default |
| uPlot | The speed reference | Automatic sizing, a palette, bars and donuts without path builders, and an accessibility layer, at a speed the budgets in section 5 keep honest |

What Axylo does not try to win: number of chart types, visual customization depth, or exploratory analysis.

### 1.2 Who it is for

A developer adding charts to a product or an internal dashboard: data arrives as rows from an API, the chart is one component among many on the page, and the person writing it is not a visualization specialist and will not test it with a screen reader. Coding agents writing that code are the same audience: they benefit from typed fields, one logical data model and diagnostics that say what to change.

Not the audience for 1.0: analysts exploring data in notebooks, designers building bespoke graphics, and teams that need maps, financial charts or network diagrams.

### 1.3 Principles

| Principle | In practice |
|---|---|
| Correct before configurable | A default that can mislead (truncated bars, interpolated gaps, a silently dropped label) is a bug, even if an option fixes it. |
| Say it, do not guess | Anything Axylo cannot draw faithfully becomes a diagnostic with a code, a location and a fix. If values were left out, the reader is told too. |
| The data is the authority | Exact values, the table, keyboard navigation and descriptions come from the normalized data. The drawing is derived from it and may be simplified; nothing else may be. |
| Everything a reader needs is on; nothing else is | Title, units, legend, tooltip, keyboard, description and table are on. Entry animation, a marker on every point of a dense line, and decorative toolbars are not. |
| One way to do each thing | One logical data model, one method per kind of change, one place for colors (CSS). |
| The page is the theme | Font, text color and color scheme come from the page. |

## 2. Scope of the first release

### 2.1 Chart types

| Type | Variants | Typical question | Status |
|---|---|---|---|
| Line | Multi-series, gaps; time, date, numeric or category x | How did it change? | 1.0 |
| Bar | Vertical, horizontal, grouped, stacked | How do categories compare? | 1.0 |
| Area | Single, stacked | How did the total and its parts change? | 1.0 |
| Donut | Up to eight slices | What share does each part have? | 1.0 |
| Scatter | Optional series | How are two measures related? | 1.0 (owner's decision) |
| Compact variant | Of line, area and bar: marks only, for KPI tiles and sparklines | Which way is it going? | 1.0 (owner's decision) |

Plus, on every cartesian chart: reference lines and bands (a target, an incident window).

The Phase 1 harness exercised line, bar and donut in all ten libraries (donut in nine; uPlot has none). Area and scatter are added on judgment; Phase 1 found no usage data by chart type. Two reviewers argued for fewer types and one for a compact variant; the owner decided on all five types plus the compact variant. Scatter alone needs two-dimensional hit testing and its own navigation model, so it is built last and carries the most schedule risk.

Each type has its own rules for picking, navigation and limits. They are in the type matrix in section 3.6, and a type does not ship until its row is fully tested.

### 2.2 Workflows

| # | Workflow | What it requires of Axylo |
|---|---|---|
| W1 | Show a query result | Rows in, chart out; field types inferred where that is safe; bad rows reported. |
| W2 | Fill a dashboard | Dozens of charts per page; container-sized; themed by the page; loading, empty and error states; a chart can take its name from the card's own heading. |
| W3 | Compare categories | Long labels; horizontal bars; grouped and stacked. |
| W4 | Watch a live metric | Append without redraw cost growing; a pause control; no announcement flood. |
| W5 | Explore a range | Tooltip anywhere, legend toggle, zoom and pan by single click, drag, touch and keyboard. |
| W6 | Read it another way | Keyboard, screen reader, table view, high contrast, reduced motion, 400% zoom, color-vision deficiency. |

### 2.3 Supported environments

| Dimension | 1.0 |
|---|---|
| Browsers | The current and previous major versions of Chrome, Edge, Firefox and Safari (macOS and iOS). |
| TypeScript | 5.4 and later. Plain JavaScript is fully supported; types are an aid, not a requirement. |
| React | 18 and 19, through `@axylo/react`. |
| Text direction | Left-to-right pages. Right-to-left text renders, but the layout is not mirrored; this is stated in the conformance table. |
| Built-in text | English, overridable (A10). |

## 3. Acceptance criteria: the reader's experience

Every criterion maps to at least one test in the acceptance matrix kept in the repository (criterion → test → chart types it applies to → result). "Property test" means the statement is checked over at least 1,000 generated datasets. Expected values come from the fixture data and this specification, never from the implementation's output.

### 3.1 Faithful representation

| ID | Criterion | Verified by | Driven by |
|---|---|---|---|
| F1 | Bar and area value axes always include zero. An author `domain` that excludes zero is widened and raises AX110. | Property test on domains, including all-negative and mixed-sign data; `bars` fixture (values 82–97) starts at 0 | R1 |
| F2 | Missing values are never drawn as zero and never bridged unless the author asks. An explicit `null` is a gap, silently. An isolated value between two gaps is a visible point. A missing bar shows a "no data" mark at the baseline, distinct from a zero bar. On a time or date axis with a regular step, an absent step is a gap and raises AX105; `missing: 'zero'` on the field turns absent and null values into zeros for counts. Tooltip, table and announcements say "No data". | `trend` with nulls and `trend` with the same 7 rows deleted render the same gap; `dirty` fixtures; property test that no segment connects across a missing index | R5 |
| F3 | Input that cannot be plotted as given is reported, never guessed. The diagnostic registry (section 3.5) fixes each case's level, what is drawn and what the reader sees. | One test per code; the combined `dirty` fixture and the four one-bad-value fixtures yield exactly the codes listed in section 3.5 | R5, D5 |
| F4 | Three temporal types, never mixed silently. **Calendar dates** (`2026-02-24`, `2026-02`, `2026`) read the same in every viewer time zone. **Instants** (epoch milliseconds declared `type: 'time'`, `Date` objects, ISO strings with an offset) are shown in `timeZone` (default: the viewer's), with the zone named in the tooltip heading and the description. **Wall-clock times** (date-time strings without an offset) are shown as written, with hint AX112. Instants that all fall on the same time of day, whole days apart, raise hint AX111 ("these look like calendar dates"). A bare number is never assumed to be an instant. | Four fixture variants in UTC, America/Los_Angeles and Asia/Kolkata: (a) date strings: identical text in all three; (b) ISO strings with `Z`, (c) epoch ms with `type: 'time'`, (d) `Date` objects: each zone's correct local text, zone visible, AX111 raised; with `timeZone: 'UTC'` or `type: 'date'`: identical. Plus: both DST transitions, a leap day, an unparseable date | R3 |
| F5 | No smoothing. When a line is denser than the screen, the drawing is simplified with this guarantee: for every device-pixel column, and every contiguous run of valid samples inside it, the drawn stroke covers exactly that run's minimum and maximum. A gap is drawn whenever at least one whole column contains no valid sample. Stacked areas are simplified on their cumulative sums. Exact values always come from the data, not the drawing. | Assertions on which source samples the drawing kept, for: one outlier in 1,000,000; two peaks and a gap in one column; alternating valid and missing samples; tied extremes; device pixel ratio 1 and 2; several zoom levels. A sample that the drawing dropped is still reachable by keyboard and in the table | D8, D9 |
| F6 | Numbers and dates are formatted for the page locale. Ticks and readouts are formatted separately: ticks may be compact (`50K`); tooltip, table and announcements show the full integer part and up to six significant fraction digits, with the unit. A custom formatter that throws falls back to the default and raises a diagnostic. | Expected strings for chosen values (large integers, small decimals, percentages, zoned times) in `en-US`, `de-DE` and `en-IN` | R4 |
| F7 | Domains follow one order of precedence: the zoomed view is inside the author's `domain` if given, otherwise inside the automatic domain. The automatic domain contains all data, reference lines and stack totals, and ends at the first tick at or beyond each extreme. A field declared `scale: 'percent'` (0–100) or `'ratio'` (0–1) ends at full scale only when its maximum is at least half of full scale and not above it. Nothing is inferred from a label. | Property tests; `bars` ends at 100 when declared `percent`; a 4% maximum ends at the first tick at or above 4% | R1 |
| F8 | Donut: slices keep the given order, start at 12 o'clock and run clockwise. The legend shows every slice's value and percentage as text, in slice order. A zero slice is listed without an arc; a `null` slice is listed as "No data". A negative value is AX120 and the chart shows its error state. With more than eight slices, the seven largest are drawn and the rest are grouped as "Other (n)", with AX121; the table lists every category. An all-zero donut shows the empty state. | `parts` fixture; one test per case | R7, landscape scoreboard 3.1 |
| F9 | Up to eight series, no two share a color. Beyond eight, each series still has a unique combination of color and dash or marker, and AX130 is raised. | Tests with 6, 8 and 12 series | R7 |
| F10 | Stacks place positive and negative values on their own sides of zero, and the axis covers both totals. A missing component is drawn with zero height and the stack is marked "incomplete" in tooltip, table and announcements. | Property test on stacked geometry; mixed-sign and incomplete fixtures | R5 |
| F11 | Line, area and scatter are drawn in x order whatever the input order. Two rows with the same x in one series are AX108 and that series is not drawn. | Shuffled `trend` renders identically; duplicate fixture | R5 |
| F12 | When a warning means values were left out or changed, the chart says so to the reader: a short note ("2 values not shown. See table.") inside the figure and in the accessibility tree, in every build. | Production build given `dirty` shows the note | R5, R6 |

### 3.2 Legibility

| ID | Criterion | Verified by | Driven by |
|---|---|---|---|
| L1 | No visible text overlaps other text or is clipped, and no label disappears without the reader being told. Remedies, in order: thin (time, date, numeric and `ordered` category axes only); wrap to two lines; rotate up to 45°; truncate in the middle, keeping every label distinct, with the full text in tooltip and table. If labels still do not fit, a visible note ("Some labels hidden. See table.") appears and AX143 suggests horizontal bars. Axylo never changes a chart's orientation on its own. | In real browsers, after fonts load: for widths 240–1,920 px and generated label sets, zero intersecting text boxes (1 px tolerance), zero text outside the figure, truncated labels pairwise distinct. Repeated with the WCAG 1.4.12 text-spacing overrides, 200% text-only zoom, and a font that loads late | R2 |
| L2 | Text is at least 12 CSS px and at least 4.5:1 against what is behind it, including text drawn inside a mark and legend entries for hidden series. Marks, axis lines and focus indicators are at least 3:1. Gridlines are exempt: they are not needed to read a value while the tooltip and table exist. Holds in light and dark. | Computed-style and rendered-pixel checks in both schemes | R7, R10 |
| L3 | The chart follows its container with no call from the page, in both directions. With no definite height, the plot is 16:9, clamped between 160 and 480 CSS px tall, and the title, controls and table flow above and below it. A container that starts hidden or zero-sized draws when it gets a size. | Resize 720 → 360 → 720 px; hidden-then-shown test; `height: auto` container is stable over 10 frames | R16, D1 |
| L4 | Light or dark is taken from the chart element's computed `color-scheme`; if that is not set, from the luminance of the inherited text color. `--axylo-background` overrides both. Marks repaint within one frame when the scheme, forced colors, contrast preference, or the `class`, `style` or `data-theme` of `<html>` or `<body>` changes. Forced-colors mode uses system colors. | A page that sets `color-scheme`; a class-toggled dark theme without it; a light-only page on a dark device (must stay light); a runtime toggle; forced-colors emulation | R10 |
| L5 | A marker on every point appears only when adjacent points are at least 12 px apart (provisional value), and always for isolated points. | `trend` at 720 px has none; a 12-point line has them | R8 |
| L6 | Title, subtitle and axis titles with units are part of the chart. Axis titles never overlap tick labels. | Layout tests; `trend` fixture | R9 |
| L7 | Empty data shows a message inside the plot area; so do loading, error and Axylo's own internal failures. No invented axis ranges, no blank box. A change of state is announced once, politely. | `empty` fixture: message visible and in the accessibility tree, no tick labels; forced internal error shows the error state | R6 |
| L8 | When the figure cannot hold a readable plot (less than 120×80 CSS px for the plot), it shows the title, the one-line summary and the table control instead, and raises AX142. | Narrow and short container tests | R2 |

### 3.3 Interaction

| ID | Criterion | Verified by | Driven by |
|---|---|---|---|
| I1 | Pointing anywhere in the plot shows what is there, by the picking rule for the chart type (section 3.6), within one frame at the 95th percentile. On line, area and bar the tooltip lists every visible series at the nearest x; a series with no row at that x reads "No observation", distinct from "No data". The tooltip stays inside the viewport, does not cover the active mark, can itself be hovered, and lists at most eight rows plus "+N more". When it cannot fit, the same content appears in a fixed readout under the plot. Escape closes it until the pointer reaches a different datum. | Hover at 20 positions including all four edges; sparse-series fixture; narrow tile with eight series; Escape test | R15 |
| I2 | Legend entries are toggle buttons with a pressed state, operable by click, Enter and Space. | Keyboard and accessibility-tree tests | R12 |
| I3 | Zoom on time, date and numeric x axes is reachable four ways: visible Zoom in, Zoom out and Reset buttons that work with single clicks; drag to select a range; `+`, `-`, `0` and Shift+arrows; and pinch when `zoom: 'touch'` is set. The wheel zooms only while the plot has focus, and never when Ctrl or Meta is held, so browser zoom and page scrolling are not intercepted. | Reach a given range by clicks only; by keyboard only; by drag; page scrolls normally with the pointer over an unfocused chart | D7, R12, WCAG 2.5.1, 2.5.7, 1.4.4 |
| I4 | Every interaction works with a single pointer without dragging, and by touch. Every control is at least 24×24 CSS px. A one-finger drag on a chart scrolls the page. | Touch emulation; size checks | WCAG 2.5.7, 2.5.8 |
| I5 | First render is not animated. An update may transition for at most 200 ms. Under `prefers-reduced-motion: reduce` nothing transitions, on first render or on update. | After `document.fonts.ready`: first frame equals the frame at 2.5 s within a 0.1% pixel tolerance, in both settings; an update under reduced motion reaches its final frame in one step; a 24-chart filter change settles within 200 ms | R14 |
| I6 | A chart fed by `append` shows a Pause/Resume control. While paused, new rows are buffered and the view does not move. | Stream test | WCAG 2.2.2 |

### 3.4 Accessibility

Target: every WCAG 2.2 level AA success criterion that applies to what Axylo renders, as component-level evidence. Conformance of a page is a property of the page and remains the author's.

| ID | Criterion | Verified by | Driven by |
|---|---|---|---|
| A1 | Every chart has an accessible name: its `title`, or the heading named by `labelledBy`, or else a generated name ("Line chart of Sessions by Day") with AX140 raised in every build. The title's heading level is the author's (`level`), and it can be hidden visually. Every chart has a generated summary: type, series, x range with time zone, y range, each series' minimum, maximum and last value, and any omissions. `description` adds to the summary and never removes the zone or omission statements. Element ids are unique per chart. | Accessibility-tree snapshot for every fixture; a 24-chart page has no duplicate ids; axe `heading-order` | R11, R13 |
| A2 | Keyboard: at most two tab stops while the table is closed, the plot and one toolbar with roving focus that holds legend toggles, zoom, pause and the table control. Every point is reachable in order; the series can be switched; the ends can be reached directly; focus can leave the chart. The focus indicator is at least 2 px and 3:1 and is not hidden by the tooltip. The exact keys and roles are fixed after the pattern spike in M1 (section 8). | Forward and reverse traversal in collapsed, zoomed, streaming and table-open states; focus after hiding the focused series; indicator contrast | R12 |
| A3 | Moving focus to a point conveys its text (series, x, value with unit, position) through the focused element's accessible name or a polite live region. On touch screen readers, every point is reachable by swiping, or the table is reachable within two gestures. | Accessibility-tree snapshot after each key; a recorded rehearsal on NVDA with Chrome, NVDA with Firefox, VoiceOver with Safari on macOS, VoiceOver on iOS, and TalkBack with Chrome | R12, R13 |
| A4 | "View as table" shows the data as an HTML table built from the normalized data when opened: the title as caption, field labels with units as column headers, x values as row headers, values formatted as in F6. It covers the current x range, 100 rows per page, with every row reachable by paging or by jumping to an x value. It sits in a focusable scroll region no taller than the plot, and opening it does not move other charts. | Table content compared with fixture data, including a value near row 900,000 of 1,000,000; a 24-chart page layout test | R13 |
| A5 | Series are never distinguished by color alone, in any mode. Each line and area carries a shape marker at its last point and at sparse intervals, repeated in the legend and tooltip; under `prefers-contrast: more` or forced colors, lines also differ by dash. Adjacent filled marks (slices, stacked segments) are separated by at least 1 px of background. The default palette has eight colors, each at least 3:1 on the default light and dark backgrounds, with a minimum pairwise OKLab difference of 0.10 (provisional) under normal vision and simulated protanopia, deuteranopia and tritanopia. On any other background, Axylo measures the palette against the resolved background and raises AX141 below 3:1. | Palette script scoring the rendered marks of an eight-series chart in both schemes, repeats included; rendered-pixel checks of separators; a grayscale screenshot in which three crossing lines can be told apart by marker | R7, WCAG 1.4.1, 1.4.11 |
| A6 | Content reflows at 320 CSS px and 400% zoom without two-dimensional scrolling. User text-spacing overrides do not clip text. | Viewport and style-override tests in three engines | WCAG 1.4.10, 1.4.12 |
| A7 | Data arriving does not speak. Announcements happen only for the reader's own navigation, and for a change of state (L7). While data streams, keyboard focus stays on the same datum until it leaves the window. | Stream test counting live-region changes with and without focus; 24 concurrent streams | R12 |
| A8 | axe-core reports no violations on any fixture in any state, including `heading-order` and `scrollable-region-focusable`. | CI | R11 |
| A9 | A conformance table lists every applicable WCAG 2.2 AA success criterion, the test that covers it, and what the author must supply (a meaningful title or `labelledBy`, series names, units, the page's own structure). It also states the limits in section 3.8. | Published with each release; a CI check that every listed test exists | R11 |
| A10 | Every built-in string can be replaced through `messages`. Built-in English text is marked `lang="en"` when the document language is not English. | Test on a `lang="de"` page | WCAG 3.1.2 |

### 3.5 Diagnostic registry

Level decides delivery. **Error**: the chart or a series cannot be drawn; the chart shows its error state. **Warning**: something is not drawn as given; the reader sees the note in F12. **Hint**: advice for the author. Errors and warnings print once per code per page in every build; hints print in development builds only. `strict: true` throws on errors and warnings found while validating a create, `update` or `append` call, synchronously from that call. A diagnostic that can only arise later (a contrast check after the page's CSS changes, a custom formatter that throws when a table page is built, a label that stops fitting after a resize) is reported when it is found and is never thrown. Every diagnostic names the chart; those about data name the field and the first row indexes in the caller's own data.

| Code | Level | Condition | What is drawn |
|---|---|---|---|
| AX100 | Error | Typed columns have different lengths | Error state; the message names the columns and their lengths |
| AX101 | Error | A named field is not a key of any row | Error state; the message lists the keys that exist and the closest match |
| AX102 | Warning | A field is absent (`undefined`) in some rows | Gaps |
| AX103 | Warning | A value is `NaN` or infinite | Gap |
| AX104 | Hint | Every non-missing value of a value field is a plain decimal string (`'40'`, `'-1.5'`) | Parsed and drawn; the message suggests `parse: 'number'`. An empty string counts as missing |
| AX105 | Hint | Steps are absent on a regular time or date axis | Gaps |
| AX106 | Warning | A value field mixes numbers with strings, or holds strings that are not plain decimals (`'1,234'`, `'n/a'`) | The strings are not drawn |
| AX107 | Warning | A date or time cannot be parsed | That row is not drawn |
| AX108 | Error | Duplicate x within a series, or duplicate donut labels | That series, or the donut, is not drawn |
| AX109 | Hint | Numbers on an axis declared `time` look like seconds, or a numeric x looks like epoch milliseconds without `type: 'time'` | As declared |
| AX110 | Warning | An author domain on bar or area excluded zero | Domain widened to zero |
| AX111 | Hint | Instants look like calendar dates | As instants, zone shown |
| AX112 | Hint | Date-time strings have no offset | As written |
| AX120 | Error | Negative donut value | Error state |
| AX121 | Warning | More than eight donut slices | Seven largest plus "Other (n)" |
| AX130 | Warning | More than eight series | All series, with dash or marker differences |
| AX140 | Warning | No `title` and no `labelledBy` | Generated name |
| AX141 | Warning | Palette below 3:1 on the resolved background | As themed |
| AX142 | Hint | Plot too small to draw | Summary and table control |
| AX143 | Hint | Labels hidden after every remedy | Note shown to the reader |
| AX150 | Warning | Unknown option key | Ignored; the message suggests the closest known key |
| AX151 | Warning | `append` rows out of order | Accepted through the slower full update |
| AX131 | Hint | A compact chart has more than one series | Drawn, with dash differences |
| AX132 | Hint | More bars than pixels along the category axis | Drawn; the message suggests aggregating |
| AX133 | Hint | A scatter chart has more than 50,000 points | Drawn; the message says drawing may be slow |
| AX160 | Warning | A custom formatter threw | The default format is used for that value |

Expected results for the Phase 1 fixtures: the combined `dirty` fixture (`[10, 20, null, NaN, '40', undefined, 70]`) yields AX102, AX103 and AX106 once each, draws Mon–Tue as a segment and Sun as a point, and shows the F12 note. `dirty-string` (one `'40'` among numbers) yields AX106. A column made only of numeric strings yields AX104 and is drawn in full. `dirty-null` yields nothing.

The split between AX104 and AX106 answers a reviewer's objection that common back ends return counts as strings (Postgres `bigint` and `numeric`, BigQuery): a whole column of plain decimal strings is unambiguous and is parsed; a stray string among numbers is a bug and is not.

### 3.6 Type matrix

| | Line | Area | Bar | Donut | Scatter |
|---|---|---|---|---|---|
| Picking by pointer | Nearest x | Nearest x | The band under the pointer | The slice under the pointer | Nearest point within 24 px; ties go to the later row |
| Tooltip content | Every visible series at that x | Same, plus the stack total | Every series in that category | Label, value, percentage | The point's series, x and y; coincident points listed, up to eight |
| Keyboard order | By x, then series | By x, then series | By category, then series | By slice order | By x, then y |
| Zoom | Yes | Yes | On time, date and numeric x only | No | Yes, both axes later; x only in 1.0 |
| Simplified drawing when dense | F5 | F5 on cumulative sums | No; more bars than pixels raises a hint | No | No in 1.0; above 50,000 points a hint says drawing may be slow |
| Limit that raises a diagnostic | Eight series | Eight series | Eight series | Eight slices | Eight series |
| Reference lines and bands | Yes; included in the domain; listed in the summary and table caption | Yes | Yes | No | Yes |

### 3.7 Compact variant

`compact: true` on line, area and bar draws the marks and nothing else: no axes, gridlines, legend, toolbar, table control, zoom or tooltip. It is for a small tile where the page already shows the number and the label.

| ID | Criterion | Verified by |
|---|---|---|
| C1 | A compact chart is a static image with a full text alternative: `role="img"`, an accessible name (as in A1, including AX140 when none is given) and the generated summary as its description (series, x range, minimum, maximum, last value, omissions). It has no tab stop and no pointer-only behavior, so nothing is available to a mouse that is not available to a keyboard. | Accessibility-tree snapshot; a page of 40 has zero added tab stops |
| C2 | The fidelity rules still hold: zero baseline for bar and area (F1), gaps (F2), diagnostics (F3), simplified drawing (F5), sorting (F11), no motion (I5), scheme from the page (L4). | The same fixtures as the full charts |
| C3 | It fills its container at any size from 24×16 CSS px up; with no definite height it is 32 px tall. | Size tests |
| C4 | With more than one series, lines differ by dash as well as color, since there is no legend; AX131 suggests one series per compact chart. | Two-series fixture |
| C5 | When values were left out (F12), the description says so and a small marker with a text equivalent appears in the corner. | `dirty` fixture in compact mode |

A compact chart does not give access to every value; the summary is its alternative. An author who needs every value reachable uses the full chart.

### 3.8 What the evidence will and will not show

Automated checks establish structure: names, roles, focus order, contrast, text. They do not establish that a screen-reader user finds a chart understandable. The only evidence for that in 1.0 is A3's rehearsal by the developer on five reader and browser pairs, recorded as rehearsal. Axylo is built by one person with no access to study participants, so no claim of usability testing with disabled users is made, and the conformance table says so in those words. Reviewers proposed participant testing as a release gate; it is recorded here as a known limit instead.

## 4. Acceptance criteria: the developer's experience

| ID | Criterion | Verified by | Driven by |
|---|---|---|---|
| DX1 | The first chart takes ten lines or fewer, including import, by npm, by script tag and in React. No required option besides data and fields. | Three CI tests that render the documented snippet from the packed distribution | D1 |
| DX2 | One logical table, three ways to pass it: long rows, wide rows, typed columns. The three forms of each fixture produce the same normalized data and the same diagnostics, with row indexes in the caller's own form. | Equivalence tests | D2 |
| DX3 | With typed rows, a misspelled field, a text field on a value axis, wide `y` combined with `series`, and an option that does not apply to the chart type all fail to compile. At run time, for untyped rows, the same mistakes raise AX101, AX106 and AX150. | [docs/api/examples.ts](api/examples.ts) compiles and each marked mistake fails (already checked with TypeScript 7.0.2); runtime tests per code | D5 |
| DX4 | Diagnostics follow the registry in section 3.5: stable code, chart name, field and rows where they apply, the fix, and a documentation page per code. | Message snapshots; link checker | R5, D5 |
| DX5 | Three methods change a chart: `update` changes options, `append` adds rows, `zoom` sets the view. They apply in call order. Validation and diagnostics are synchronous; drawing is deferred to the next frame; marks, labels, hit testing and the accessibility layer always switch to a new state together. `destroy()` releases everything and cancels pending work. No `resize()` exists. | Sequence tests: replace then append then zoom in one turn; a rejected `strict` update leaves the last valid chart; destroy before the frame; 1,000 create–destroy cycles show no heap growth trend (P7) | D3, R16 |
| DX6 | Colors, font and spacing are CSS custom properties with documented names; the chart inherits `font-family` and `color`. `colors` pins a color to a series name so the same series has the same color on every chart. There is no theme object and no positional palette option. | Theming tests, including a 24-tile page where series subsets differ | R10 |
| DX7 | Zero runtime dependencies (reconsidered only with a measured comparison). Size targets, provisional until M1 measures a working slice: 40 KiB gzipped for everything, 25 KiB for a page that uses only `line`, 2 KiB for the React adapter, CSS included. | size-limit in CI on the packed distribution | D4 |
| DX8 | Importing in Node without a DOM does not throw, and `validate()` runs there. Works under React StrictMode, including setup, cleanup and setup again. Works under a Content Security Policy without `unsafe-inline` or `unsafe-eval`, served with real headers. Labels and formatter output are inserted as text, never as HTML. A target that matches no element throws an error that names the selector. | CI tests | D1 |
| DX9 | Semantic versioning. A deprecated API keeps working for at least one minor release and six months. At most one major version a year. The previous release's documented examples still compile and run against each release candidate. | Release policy; API report diff; upgrade test | D6 |
| DX10 | Every runnable example in the documentation is compiled and rendered in CI from the packed distribution. | Docs build | D1 |
| DX11 | MIT license for everything, including zoom and accessibility. Third-party notices are verified at release. | Repository; release check | D7 |
| DX12 | A coding agent gets the first chart right. Given fixed prompts and trap fixtures (UTC-midnight ISO dates, numeric strings, unsorted rows, missing days, a misspelled field), an agent with only the published docs produces a chart with no error diagnostics that passes the reader criteria. Recorded as agent rehearsal, not as user evidence. | Scripted rehearsal at each release | D1, 1.2 |

## 5. Performance budgets

These numbers are provisional. They are design targets taken from Phase 1's order-of-magnitude measurements, and they become release gates only after the benchmark harness built in M0 has measured a working Axylo slice in M1 and the limits have been recalibrated and frozen (plan, M1 and M6). Each budget names its workload, metric and statistic so that two people measuring the same build get the same verdict.

| ID | Workload | Metric | Statistic | Provisional limit | Phase 1 reference |
|---|---|---|---|---|---|
| P1 | `trend` (3×120), default options, reference desktop | Main-thread task time from the call until the chart is complete | Median of 20 runs | 10 ms | Not comparable across libraries below about 35 ms with the Phase 1 method |
| P2 | One series, 100,000 and 1,000,000 points, typed columns | Same | Median of 20 | 60 ms and 250 ms | See 01, section 5.3: uPlot and tuned Chart.js are the fastest measured |
| P3 | 600-point window, one appended point per display frame at 60 Hz, driven by an independent clock | Main-thread task time per update; and frames later than 25 ms | Median; count per 300 frames | 2 ms; 0 | See 01, section 5.3 |
| P4 | Pointer moved across a 100,000-point chart | Time from input to the frame showing the matching readout | 95th percentile | One frame (16.7 ms at 60 Hz) | Not measured in Phase 1 |
| P5 | 24 `trend` charts created on one page | Total main-thread task time | Median of 20 | 200 ms | Not measured in Phase 1 |
| P6 | Download | Minified and gzipped bytes, CSS included | Exact | DX7 | 01, section 1.4 |
| P8 | 40 compact charts created on one page | Total main-thread task time | Median of 20 | 80 ms | Not measured in Phase 1 |
| P7 | Memory | Bytes owned by Axylo beyond the caller's columns for 1,000,000 points; heap trend over 1,000 create–destroy cycles | Measured after forced collection | At most 1× the size of the caller's two columns; no upward slope | Not measured in Phase 1 |

Three rules hold whatever the numbers become:

1. Budgets apply to default options. Finding D8 showed libraries that are fast only for authors who know which options to set.
2. Budgets are absolute, on named hardware profiles. Comparison libraries, uPlot above all, are measured in the same runs and published beside Axylo, but a ratio to another library is not a gate: it would reward leaving out work that library does not do.
3. The accessibility layer is on in every measured configuration.

## 6. Decisions and the findings behind them

"Status" records what the reviews changed.

| Decision | What decided it | Status after review |
|---|---|---|
| Diagnostics are a first-class feature with codes | R5: none of the ten named the field, the row or the problem. | Kept. Severity and delivery rewritten (3.5): readers are told too, and production builds are not silent. |
| Calendar dates, instants and wall-clock times are different types | R3: given instants, six libraries show a daily value on a different day in some zones, which is correct for instants and wrong for dates; given date strings, most of them get it right. The gap is that nothing says which one the author meant. | Kept, sharpened. The test now separates the types, and a hint fires when instants look like dates. Default zone for instants: the viewer's, with the zone always visible. |
| Accessibility is in the core, on by default | R11–R13. | Kept. The table is built on demand, not eagerly. |
| The normalized data, not the drawing, is the source for values, table, keyboard and summary | Reviews: a simplified drawing cannot return the values it dropped. | New. |
| No animation on first render | Reading starts at first paint, and with 24 charts loading at once motion competes with it. R14: four of seven animating libraries ignore reduced motion. | Kept, with the rationale restated. Update transitions stay capped at 200 ms. |
| Label fitting is a tested invariant with a visible fallback | R2. | Changed. The absolute "everything always fits" was infeasible in a 240 px tile; it is now "nothing overlaps, and nothing disappears without the reader being told". Rotation comes before truncation. |
| One logical table, three input forms | D2. | Changed from "one data shape": typed columns and wide rows are first-class. |
| Three methods with a commit contract | D3. | Changed from "one update method": `append` and `zoom` were always there, and their ordering is now specified. |
| Canvas marks with DOM text | D9: a canvas library is the speed reference. D10: one DOM node per point is slow. | **Reopened.** Phase 1 does not show that SVG is slow, only that one node per point is; a single SVG path per series was fast. M1 builds both mark renderers on the same scene and measures them (section 8). Canvas is the working assumption. |
| Simplified drawing that preserves extremes, on by default | D8. | Kept for lines and areas, with the guarantee restated per pixel column and per run of valid samples. "Every spike survives" was wrong as written. |
| Palette held to measurable thresholds | R7. | Kept as a screen, marked provisional. Marks carry a non-color cue in every mode, which the first draft did not require. |
| Colors and fonts from CSS | R10. | Kept. Repaint triggers specified; `palette` option replaced by `colors` keyed by series name. |
| Numeric strings | R5. | Changed: a whole column of plain decimal strings is parsed with a hint; mixed columns are not. |
| Chart types | Judgment, then the owner's decision. | All five in 1.0, plus the compact variant (3.7). |
| MIT, including zoom and accessibility | D7. | Kept. |
| React adapter in 1.0 | Recharts leads npm installs among chart-level libraries. | Kept, and built early to test the core API. Downloads show where charts are written, not that Axylo will be wanted there. |
| Budgets apply to defaults | D8. | Kept. The ratio to uPlot is no longer a gate. |
| Zero runtime dependencies | D4. | Kept provisionally; time-zone arithmetic uses `Intl`. |

## 7. Changes this revision rejected

| Proposal | Why not |
|---|---|
| Test with screen-reader users, outside developers or design partners before release | One-person project with no participants. Recorded as a stated limit (3.8). Agent rehearsal (DX12) and developer rehearsal (A3) are used and labelled as such. |
| Collect chart sizes and device profiles from beta deployments | A chart library should not phone home. Workload sizes come from the spec and from issue reports. |
| Switch to horizontal bars automatically when labels do not fit | Changing orientation changes what the chart says at a glance; Axylo suggests it and tells the reader what is hidden. |
| Remove the first-chart line-count criterion | Kept as a floor, and joined by DX12, which tests getting it right. |

## 8. Decisions still open

Settled by the owner on 2026-11-18: scatter is in 1.0; the compact variant is in 1.0; the mark renderer stays open until M1 measures both.

| Question | Recommendation | Settled by |
|---|---|---|
| Canvas or SVG paths for marks? | Decide from the M1 comparison: P1, P2, P3, P5, bytes, memory, theme toggle, forced colors, print. | M1 record. |
| Which keyboard and screen-reader pattern for the plot? | Decide from the M1 spike: three candidate patterns on the `trend` chart, rehearsed on the five pairs. | M1 record, confirmed in M4. |
| Is the palette that meets A5 one people want to look at? | Hand-tune from the search output with the thresholds in CI. | M5. |
