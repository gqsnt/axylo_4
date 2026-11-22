<!-- Analysis and text: Codex gpt-6.2-astra (observed, effort xhigh), read-only, from the Phase 1 harness results rerun on 2026-11-19 (commit 2bb830d). Checked by the coordinator (Claude Opus 5.5): sizes, line counts, the dirty-input reading and the keyboard-instruction finding against research/harness/results.json and sizes.json. Timing updated on 2026-11-22 from the comparison harness records by Codex gpt-6.2-sol (observed, xhigh). -->

# Axylo compared with the ten Phase 1 libraries

Axylo was the only tested configuration that told the developer which input values it omitted and told the reader how many were missing. It also supplied a named chart, keyboard point navigation and an on-demand data table without an accessibility import. It tied other libraries on several visible results, including wrapped bar labels and readable donut values. Three harness bundles were smaller. The timing rerun covers all eleven libraries, the no-chart floor and the five tuned configurations. [Probe results](../research/harness/results.json) · [Table spot check](../research/harness/spot-checks.json) · [Bundle sizes](../research/harness/sizes.json)

## Method and changes since Phase 1

On 2026-11-19 the coordinator reran every non-timing step for **all eleven libraries**, including the alternate Highcharts and ECharts accessibility configurations. The rerun used headless Chrome 158.0.8127.36, up from Chrome 157. It used the same Vite harness, deterministic data and Phase 1 rule of giving each library the least configuration needed for the reader’s task. D3’s charts were authored, as were Recharts’ colors and uPlot’s bars. Axylo used its packed production ES module. [Phase 1 method](01-landscape.md#2-method) · [Fixtures](../research/harness/src/data.js) · [Run log](../research/harness/rerun-2026-11-19.log)

The people who built Axylo also made this comparison. The judgments most exposed to bias are what counts as minimum configuration, whether labels fit, whether a focused point is visible, and which element a library-specific probe reads. The adapters, screenshots and probe selectors are available for inspection. The keyboard walk starts at the first tab stop. The motion check compares two frames of bar entry. Container-cropped images cannot distinguish clipping from overflow. The study used no screen reader, touch device, other browser or customization task. [Adapters](../research/harness/src/libs/) · [Probe code](../research/harness/probe.mjs) · [Screenshots](../research/harness/shots/)

**No published scoreboard verdict changed for the original ten.** Recharts’ early donut capture varied between runs, but the rerun again had no values at 1.8 seconds and all six at 4 seconds, as Phase 1 reported. Some animation pixel fractions varied without changing the reduced-motion verdicts. MUI’s combined dirty fixture logged 21 browser errors, up from 20 in the prior snapshot. Its single-`NaN` result stayed at 21. All ten adapters now have more lines than the first-pass counts in §1.4. At the precision stored in `sizes.json`, only Chart.js and D3 changed gzip size, from 81.0 to 81.1 KiB and 34.7 to 34.8 KiB respectively. The palette scores and size order held. [Phase 1 report](01-landscape.md) · [Recorded results](../research/harness/results.json) · [Four-second donut check](../research/harness/spot-checks.json) · [Sizes](../research/harness/sizes.json)

## What readers see · Phase 1 §3.1

“Every point” refers to markers on the 120-point trend. “Gap” refers to the seven missing Referral days. Donut scores count values readable anywhere on the chart without hovering, including a legend. The screenshots supply the visual judgments. [Bars](../research/harness/shots/_sheet-bars.png) · [Trend](../research/harness/shots/_sheet-trend.png) · [Donuts](../research/harness/shots/_sheet-parts.png) · [Empty charts](../research/harness/shots/_sheet-empty.png)

| Library | Bar baseline | Long category label | Time ticks at 720 px | Y-axis example | Every point | Gap | Visible title | Donut values | Empty plot |
|---|---|---|---|---|---|---|---|---|---|
| **Axylo** | **0** | **Wraps to 3 lines** | Fit | `50,000` | No, sparse shapes | Yes | Built in | **6/6, value and % in legend** | “No data to show.” |
| Chart.js | 0 | All rotate, complete | Rotated 45° | `50,000` | Yes | Yes | Built in | 0/6 | Invented hours and 0–1.0 axis |
| Recharts | 0 | Dropped | Crowded | `60000` | Yes | Yes | None | 6/6 at 4 s | Blank frame |
| D3, authored | 0 | Overlaps | Fit | `50,000` | No | Yes | Authored | 4/6 | Blank frame |
| ECharts | 0 | 5 of 7 dropped | Overlap | `50,000` | Yes | Yes | Built in | 0/6, names only | Blank |
| Highcharts | 0 | Wraps | Fit | `60k` | No | Yes | Built in | 0/6, names only | Blank |
| ApexCharts | 0 | Rotated, cut at edge | Fit | `50000` | No | Yes | Built in | 4/6, % | Invented 0–6 axis |
| Plotly.js | 0 | Rotated, cut at edge | Fit | `50k` | No | Yes | Built in | 6/6, % | Invented axes |
| Nivo | 0 | Overlaps | Overlap | `50000` | Yes | Yes | None | 6/6, two overlap | “Jan 01” eight times |
| MUI X Charts | 0 | Dropped | Fit | `50,0…` | No | Yes | None visible | 0/6 | “No data to display” |
| uPlot | 80 | Overlaps | Fit | `50,000` | No | Yes | Built in | No donut | Blank |

Highcharts matched Axylo’s wrap, Chart.js kept the full label by rotating it, and MUI matched Axylo on explaining empty data. ApexCharts and Nivo printed exact values directly on the bars. Axylo required interaction for those values. [Bar comparison](../research/harness/shots/_sheet-bars.png)

## How readers explore · Phase 1 §4.1

“Live text” uses Phase 1’s literal test of whether the focused point’s text reached a live region. “Visible point” is judged after Right, Right, Down, Enter. A dash means the criterion does not apply. The underlying keys are `trend.aria`, `keyboard.stops`, `keyboard.arrows`, `hover_utc`, `resize` and `motion_*`. [Results](../research/harness/results.json) · [Keyboard screenshots](../research/harness/shots/_sheet-kbd.png) · [Resize screenshots](../research/harness/shots/_sheet-resize.png)

| Library | Accessibility tree on trend | Tab stops | Arrows move points | Live text | Visible point | Between-point readout | Auto-resize | Bars animate | Stop on reduce |
|---|---|---:|---|---|---|---|---|---|---|
| **Axylo** | Named group, heading, summary, plot slider and toolbar | **2** | Yes | **No** | Yes | All series | Yes | No | — |
| Chart.js | Empty | 0 | No | No | — | None | Yes | Yes | No |
| Recharts | Legend list, unnamed application with ticks | 8 | Yes | Yes, assertive | Unseen | All series | Yes | Yes | Yes |
| D3, authored | Image containing chart text | 0 | No | No | — | All series, authored | Scales as image | No | — |
| ECharts | Empty | 0 | No | No | — | All series | No | Yes | No |
| Highcharts + accessibility module | Named region, heading, description, region per series | 2 | Yes | No | Yes | One series | Yes | Yes | No |
| ApexCharts | Named application, legend buttons | 10 | Yes | Yes, polite | Yes | All series | Yes | Yes | Yes |
| Plotly.js | Two unnamed images, toolbar | 9 | No | No | — | One point | No | No | — |
| Nivo | Unnamed image | 0 | No | No | — | One point | Yes | Yes | No |
| MUI X Charts | Legend list and status, title on `role="none"` | 1 | Yes | No | Yes | All series | Yes | Yes | Yes |
| uPlot | Title and legend table | 0 | No | No | — | All series in legend | No | No | — |

Recharts and ApexCharts score better on the live-region criterion. Axylo uses the focused slider’s `aria-valuetext`, as its spec calls for. The second Right press reported Jan 3, Direct 36,072, the other series and point 3 of 120. All four live-region readings were empty. MUI supported point navigation with one tab stop to Axylo’s two. Highcharts exposed a separate region per series with its module. Without the module it exposed a titled image and zero stops. ECharts’ ARIA switch added a generated label and still had zero stops. [Keyboard records](../research/harness/results.json) · [Axylo focused point](../research/harness/shots/kbd-axylo.png) · [Switch checks](../research/harness/spot-checks.json)

Axylo’s “View as table” opened a captioned table with row and column headers. The probe counted zero tables while closed and 100 body rows after opening. That establishes the first page only. Axylo also shrank to 360 px with a 360 px scroll width, and its bar frames had zero measured pixel difference under both motion preferences. [Table check](../research/harness/spot-checks.json) · [Resize and motion results](../research/harness/results.json)

## Data, color and a discrepancy with the spec

- **Bad input.** Axylo’s combined fixture drew Mon–Tue and the isolated Sunday point. It named field `value` and zero-based rows 3, 4 and 5 for `NaN` (AX103), `'40'` (AX106) and `undefined` (AX102), with a fix for each. The figure and accessibility tree both said “Values not shown: 3. See table.” Each individual bad value left a gap with valid data on both sides. Explicit `null` left a silent gap. This matches F2, F3 and F12. Nine peers plotted `'40'` as 40; Highcharts silently omitted it. None gave a field-and-row diagnosis. [Dirty comparison](../research/harness/shots/_sheet-dirty.png) · [Single-string capture](../research/harness/shots/one-string-axylo.png) · [`dirty.logs`, `dirty.aria` and `sentinels`](../research/harness/results.json)
- **Dates and instants.** Axylo showed the calendar date **Feb 22, 2026** in UTC, Los Angeles and Kolkata, matching seven peers on preserving the day. Given the instant, it displayed **Feb 22, 12:00 AM UTC**, **Feb 21, 4:00 PM PST** and **Feb 22, 5:30 AM GMT+5:30** for the same values. This confirms those two cases of F4. The production probe did not collect the development hint AX111. For Recharts, the table printer mistakes three missing extracted headings for a same-day result. Its screenshot shows the author-formatted local date, as Phase 1 reported. [`dates.*.readoutTitle`](../research/harness/results.json) · [Axylo instant in Los Angeles](../research/harness/shots/instant-la-axylo.png) · [Recharts instant in Los Angeles](../research/harness/shots/instant-la-recharts.png) · [Table printer](../research/tables.mjs)
- **Palette and page theme.** Axylo’s six donut fills were distinct. Their lowest contrast on white was 3.10:1, the minimum of `contrastOnWhite`. Closest-pair OKLab distances were 0.1185 for normal vision, 0.1063 for protanopia, 0.1022 for deuteranopia and 0.1024 for tritanopia. Only Axylo cleared both 3:1 and the spec’s provisional 0.10 separation in every simulation on this fixture. ApexCharts cleared contrast but repeated blue. Plotly scored better for normal-vision separation at 0.1418. This tests six light-background colors of A5’s eight-color, two-scheme claim. On the separate trend task Axylo changed its marks and text on a dark page and stayed light on a light-only page under a dark device setting. Highcharts stayed dark in the latter case. [Palette scores](../research/harness/palette.json) · [Dark page](../research/harness/shots/_sheet-dark.png) · [Light-only page](../research/harness/shots/_sheet-lightonly.png)
- **Incorrect keyboard help.** Axylo’s donut and categorical bar both told readers “Plus and minus zoom; 0 resets.” The spec excludes zoom for both configurations, and their recorded toolbars offered only “View as table.” The discrepancy is in the instructions exposed to readers. The probe did not press the zoom keys on either chart. [`axylo.parts.aria` and `axylo.bars.aria`](../research/harness/results.json) · [Spec I3 and type matrix](02-product-spec.md#36-type-matrix)

## What authors supplied and what shipped

These are the choices the harness author made. Lines count nonblank adapter lines excluding full-line `//` comments. The three React adapters also use one shared nine-line mount file, seven lines by that same counting rule. Sizes are minified adapter bundles in KiB, dividing gzip bytes by 1,024. React and React DOM are external. [Size script](../research/harness/sizes.mjs) · [Sizes and line counts](../research/harness/sizes.json) · [Shared React mount](../research/harness/src/libs/_react.jsx) · [Locked versions](../research/harness/package-lock.json)

| Library | Version | Adapter lines | Gzip KiB | What the author supplied beyond data |
|---|---|---:|---:|---|
| **Axylo** | 0.0.0 | **32** | **103.3** | Titles, field bindings and an explicit instant type for epoch milliseconds. Task details below. |
| Chart.js | 4.6.1 | 62 | 81.1 | Date adapter and `maintainAspectRatio: false` for the fixed-height container. |
| Recharts | 3.11.0 | 99 + shared | 140.4 | Wide rows, per-series colors, time formatter and eight components for the line chart. |
| D3, authored | 7.9.2 | 97 | 34.8 | Scales, axes, marks, margins, title, legend and pointer readout. |
| ECharts | 6.1.0 | 69 | 372.6 | Explicit tooltip and legend. |
| Highcharts | 13.1.1 | 56 | 142.8 | Separate accessibility module, included in the size. |
| ApexCharts | 8.9.0 | 66 | 289.3 | Numeric pixel height to fit the container. |
| Plotly.js | 4.3.0 | 34 | 1,450.0 | Trace and layout declarations sufficed. |
| Nivo | 0.99.0 | 63 + shared | 128.6 | Manual margins, `useMesh` for hover and a five-property legend configuration. |
| MUI X Charts | 9.18.1 | 49 + shared | 160.1 | Material and System peer packages, `Date` objects for the time axis. |
| uPlot | 1.6.32 | 50 | 23.1 | Pixel dimensions, strokes, seconds conversion, bar path builder and category axis. No donut. |

For Axylo, `trend` reshaped the columns into long rows keyed by channel so the shared y-axis could say “Sessions.” `dates` reused those bindings and passed the ISO strings through. `bars` bound team and value with “Satisfied (%)”. `parts` bound slice name and value with “Share (%)”. Both used default layout and colors. `dirty` and its four single-value variants passed every sentinel through unchanged. `empty` used the trend configuration with zero rows. `scale` bound the existing arrays and declared an instant axis. `stream` added `append(rows, { keep: 600 })`. These last two describe adapter code only. [Axylo adapter](../research/harness/src/libs/axylo.js) · [Task report](../reviews/2026-11-19/wp/phase1-axylo.report.md)

**103.3 KiB is the cost of this harness entry.** It imports `line`, `bar` and `donut` from the packed build, includes adapter code, and uses esbuild minification and Node’s default gzip. uPlot, authored D3 and Chart.js were smaller. Axylo’s own consumer check uses the same package integrity, exports the entire public API, includes the embedded stylesheet and uses gzip level 9. It measured **113.08 KiB** for everything and **94.73 KiB** for line only. Entry points and compression settings both differ. [Harness measurement](../research/harness/sizes.mjs) · [Package provenance](../research/README.md) · [Consumer size check](../bench/size-latest.json)

## Timing on November 22, 2026

All configurations ran in headless system Chrome 158.0.8127.36 on the same Linux desktop. Axylo used the packed production build corresponding to the sealed SVG-only artifact `20261122T052512Z-de0f0ab3-d46057`. The default and tuned runs started at 07:28 and 07:36 Central European Time. Chart sizes show median main-thread task milliseconds and completed/attempted runs. Each successful size had three runs. Recharts and Nivo timed out once at 1,000,000 points and their remaining attempts at that size were skipped. The timing includes work done in the 1.6-second settling window so entry animations contribute to the count. [Raw results and load samples](../research/harness/results.json) · [Timing log](../research/harness/perf-2026-11-22.log) · [Package provenance](../research/README.md)

Each stream column reports one run of 300 updates, with main-thread milliseconds per update and callbacks later than 20 ms. The probe sends updates on animation frames. The load column gives the range of the one-minute load before the attempts in that row. The product budgets use their own declared workloads and absolute limits. [Product spec, section 5](02-product-spec.md#5-performance-budgets)

### Default configurations

| Configuration | 10,000 points | 100,000 points | 1,000,000 points | Stream ms/update | Late callbacks | Load range |
|---|---:|---:|---:|---:|---:|---:|
| Axylo | 35.6 (3/3) | 40.0 (3/3) | 91.7 (3/3) | 1.40 | 0/300 | 2.60–2.73 |
| Chart.js | 1137.4 (3/3) | 2166.9 (3/3) | 11890.2 (3/3) | 7.68 | 0/300 | 0.82–1.98 |
| Recharts | 2246.8 (3/3) | 8263.7 (3/3) | Timeout (0/1) | 14.39 | 7/300 | 1.84–2.92 |
| D3 | 18.1 (3/3) | 58.2 (3/3) | 444.2 (3/3) | 0.65 | 0/300 | 2.66–2.80 |
| ECharts | 1311.5 (3/3) | 2208.8 (3/3) | 10704.0 (3/3) | 7.86 | 0/300 | 2.05–2.48 |
| Highcharts | 73.7 (3/3) | 278.6 (3/3) | 2099.7 (3/3) | 2.93 | 0/300 | 2.30–2.52 |
| ApexCharts | 62.0 (3/3) | 101.7 (3/3) | 524.8 (3/3) | 5.66 | 0/300 | 2.11–2.66 |
| Plotly.js | 40.7 (3/3) | 77.4 (3/3) | 322.9 (3/3) | 4.10 | 0/300 | 2.21–2.27 |
| Nivo | 441.2 (3/3) | 3352.5 (3/3) | Timeout (0/1) | 19.77 | 97/300 | 1.94–2.20 |
| MUI X Charts | 78.1 (3/3) | 335.7 (3/3) | 2626.9 (3/3) | 3.90 | 0/300 | 2.01–2.96 |
| uPlot | 31.3 (3/3) | 30.8 (3/3) | 74.9 (3/3) | 0.52 | 0/300 | 2.67–2.98 |

### No-chart floor and tuned configurations

| Configuration | 10,000 points | 100,000 points | 1,000,000 points | Stream ms/update | Late callbacks | Load range |
|---|---:|---:|---:|---:|---:|---:|
| No chart | 7.2 (3/3) | 9.6 (3/3) | 10.2 (3/3) | 0.09 | 0/300 | 2.32–2.69 |
| Chart.js tuned | 44.0 (3/3) | 43.2 (3/3) | 149.0 (3/3) | 1.48 | 0/300 | 2.27–2.51 |
| ECharts tuned | 50.9 (3/3) | 93.0 (3/3) | 448.4 (3/3) | 1.99 | 0/300 | 2.28–2.51 |
| Recharts tuned | 110.1 (3/3) | 557.5 (3/3) | 5812.3 (3/3) | 4.55 | 0/300 | 1.68–2.14 |
| Highcharts tuned | 98.4 (3/3) | 151.8 (3/3) | 494.4 (3/3) | 2.23 | 0/300 | 1.39–2.22 |
| Plotly.js tuned | 221.0 (3/3) | 965.4 (3/3) | 8295.6 (3/3) | 17.81 | 42/300 | 1.95–6.91 |

Plotly.js tuned reached a one-minute load of 6.91 during its timed runs. Local docs browser verification overlapped the comparison, and the raw load readings are preserved with each result. [Raw results](../research/harness/results.json)

## What remains

The probes establish accessible structure and changing value text. Actual speech, touch navigation, update motion, table paging and the documented dense-scatter and closed-shadow-root cases remain unverified here. Two readings need care. Axylo’s empty SVG-text fields miss its HTML labels, so label scores use the screenshots. The keyboard probe reports a 1 px native input outline, while the focused screenshot shows a separate blue edge two pixels thick along the top of the plot. The native outline alone cannot score the visible indicator. [Probe selectors](../research/harness/probe.mjs) · [Focused plot](../research/harness/shots/kbd-axylo.png) · [Known limits](../apps/docs/pages/stability.md#known-limits)

**November 19 verification.** The comparison review was read-only. I ran `node research/tables.mjs`, inspected the screenshots, and checked the recorded results against the fixtures and the Phase 1 snapshot. No repository file or contract change was needed. The read-only checks ended with:

```text
PASS  Original ten: keyboard, hover, dates, resize, motion classes, sentinel outcomes and palettes match Phase 1.
PASS  Axylo: fixture values, keyboard, resize, bar motion, diagnostics, table and six-color palette.
PASS  Adapter line counts and Axylo size records. No November 19 perf run.
```
