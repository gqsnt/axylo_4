# Phase 1a: the browser charting landscape, November 2026

Evidence collected 2026-11-17. Scripts, raw data and screenshots are in [`research/`](../research/README.md).

## Summary

Ten widely used libraries were given the same five reader-facing tasks and two load tasks, with the least configuration each one needs. No library passed all of them, and the failures cluster in three places that Axylo can own:

1. **Charts that are wrong or unreadable without anyone being told.** None of the ten reported a string, a `NaN` or an `undefined` in the data. Four plotted the string as a number, four lost the series or the whole chart, one drew a line across the missing days, and the hand-built D3 chart lost everything after the second point. Six showed a daily value on the previous day to a reader in Los Angeles. Two silently removed the category label that did not fit, and a third removed five of seven.
2. **Accessibility that depends on the author doing extra work.** Five of ten exposed nothing usable to a keyboard or a screen reader. Four animate regardless of the reader's reduced-motion setting. Two were legible on a dark page without configuration. No default palette both reached 3:1 contrast and stayed distinguishable under simulated color-vision deficiency.
3. **A gap between "easy" and "fast".** Six of ten took between 1.9 seconds and more than 45 seconds to draw a million points with default options; the one that drew them in about 60 ms needed hand-set sizes, colors and time units and has no accessibility layer.

The strongest single library on the reader's side was Highcharts (with its accessibility module imported): it alone wrapped the long label, adapted to dark mode by design, and generated a description of the chart. It is commercially licensed, 143 kB gzipped for three chart types, ignores reduced motion, and threw an unhelpful error on dirty input.

How to read the evidence labels in this document:

| Label | Meaning |
|---|---|
| **Observed** | Seen firsthand in the harness on 2026-11-17: rendered, probed or measured in Chrome 157. |
| **Docs** | Read in the library's current documentation on the same day. Not independently tested unless also marked Observed. |
| **Inferred** | A conclusion drawn from observed facts; the reasoning is stated. |

## 1. Which libraries, and how sure can we be

### 1.1 Adoption data

Three independent signals, each measuring something different.

| Library | npm package | npm downloads, week of 10–16 Nov 2026 | npm downloads, 12 months | jsDelivr requests, 30 days | Origins detected (mobile crawl, Oct 2026) | GitHub stars |
| --- | --- | --- | --- | --- | --- | --- |
| Recharts | `recharts` | 68.3M | 2,020M | 6.2M | 2,618 | 28k |
| D3 | `d3` | 34.1M | 717M | 64.9M | 15,028 | 114k |
| Chart.js | `chart.js` | 17.0M | 539M | 870.4M | 104,208 | 68k |
| visx | `@visx/shape` | 11.5M | 147M | 45k | not fingerprinted | 21k |
| Apache ECharts | `echarts` | 10.7M | 187M | 126.3M | 2,339 | 68k |
| Highcharts | `highcharts` | 3.6M | 117M | 55.4M | 10,988 | 13k |
| ApexCharts | `apexcharts` | 2.8M | 94M | 110.7M | 13,318 | 15k |
| AG Charts | `ag-charts-community` | 2.6M | 69M | 1.1M | not fingerprinted | 491 |
| Vega-Lite | `vega-lite` | 2.3M | 35M | 4.5M | not fingerprinted | 6k |
| Nivo | `@nivo/core` | 2.0M | 75M | 4k | not fingerprinted | 14k |
| Lightweight Charts | `lightweight-charts` | 1.8M | 36M | 3.3M | 353 | 18k |
| MUI X Charts | `@mui/x-charts` | 1.6M | 45M | 85k | not fingerprinted | 6k |
| Observable Plot | `@observablehq/plot` | 1.6M | 22M | 4.6M | not fingerprinted | 5k |
| Plotly.js | `plotly.js` + `plotly.js-dist-min` | 1.6M | 52M | 5.0M | 676 | 18k |
| uPlot | `uplot` | 1.0M | 26M | 5.4M | 29 | 11k |
| Victory | `victory` | 763k | 22M | 7k | not fingerprinted | 11k |
| amCharts 5 | `@amcharts/amcharts5` | 468k | 15M | 70k | 4,475 | 451 |
| C3 | `c3` | 208k | 5.6M | 409k | not fingerprinted | 9k |
| Chartist | `chartist` | 138k | 5.2M | 159.0M | not fingerprinted | 13k |
| billboard.js | `billboard.js` | 70k | 2.1M | 1.1M | not fingerprinted | 6k |

Sources, all fetched 2026-11-17: npm downloads API (`api.npmjs.org/downloads/point/last-week` and `last-year`); jsDelivr statistics API (`data.jsdelivr.com/v1/stats/packages/npm/<pkg>?period=month`); HTTP Archive technology report (`cdn.httparchive.org/v1/adoption`, crawl of 2026-10-01, 8,466,939 mobile origins in total); GitHub REST API. Google Charts is not distributed on npm; the HTTP Archive crawl detected it on 5,151 mobile origins.

Also observed: wrapper packages add to their hosts' reach (`react-chartjs-2` 5.9M a week, `echarts-for-react` 2.1M, `react-apexcharts` 1.5M, `highcharts-react-official` 1.3M, `vue-chartjs` 1.3M), and D3's building blocks are downloaded far more than D3 itself (`d3-shape` 132M a week, `d3-scale` 103M).

### 1.2 What these numbers cannot tell us

| Limit | Effect |
|---|---|
| npm counts installs by machines, not people or products. | Every CI run, container build and lockfile refresh counts. A library that is a dependency of popular templates or generators is counted each time they are installed. Recharts' weekly figure is 1.8 times its 12-month weekly average, so a large part of it is recent and tooling-driven. **Inferred**: I did not trace which dependents cause it. |
| npm counts transitive installs. | `d3-shape` at 132M a week is mostly other chart libraries depending on it, not people choosing D3. `ag-charts-community` and `vega-lite` are pulled in by a grid product and by notebook tooling. **Inferred** from package relationships, not measured. |
| npm misses script-tag use entirely. | Chart.js has about 12 times more jsDelivr requests in a month (870M) than npm downloads in a month (roughly 73M). Chartist has 159M CDN requests a month against 138k weekly installs: old pages keep loading it. |
| jsDelivr is one CDN, and counts requests, not sites. | One busy site can outweigh thousands of quiet ones. Libraries served from their own CDN (Highcharts, Google Charts, amCharts, Plotly) are undercounted. |
| The HTTP Archive crawl loads home pages without logging in. | Dashboards and internal tools, where most everyday charts live, are behind a login and are not seen. Detection relies on fingerprints: bundled libraries that leave no global or DOM marker are missed, and several libraries have no fingerprint at all. |
| Stars measure attention at some point in the past. | Chartist and C3 have 13k and 9k stars and almost no current installs. |
| None of the sources measure commercial deployments. | Highcharts is used heavily inside paid products; its true reach is larger than any column here shows. **Inferred.** |
| No current survey data was found. | A search for State of JS 2025 results on charting libraries returned nothing usable; the last such result I could find reported is from 2022. Not used. |

The safest reading is ordinal and per channel: Recharts leads installs in React projects, Chart.js leads script-tag and public-site use by a wide margin, and ECharts, D3, Highcharts and ApexCharts are each strong on at least two signals.

### 1.3 The ten

Selection rule: general-purpose charting used for everyday charts, ranked by the three signals together, keeping the three reference points named in the brief.

| # | Library | Why it is in |
|---|---|---|
| 1 | Chart.js 4.6 | First on CDN requests and on detected sites, each by a factor of about seven. |
| 2 | Recharts 3.11 | First on npm. |
| 3 | D3 7.9 | Second on npm and on detected sites. It has no chart-level API, so its tasks were built by hand following the official gallery examples; that cost is itself a finding. |
| 4 | Apache ECharts 6.1 | Third among chart-level libraries on npm, third on jsDelivr. |
| 5 | Highcharts 13.1 | Named in the brief. Strong on all three signals despite a commercial license. |
| 6 | ApexCharts 8.9 | Fourth on jsDelivr, second on detected sites among chart-level libraries. |
| 7 | Plotly.js 4.3 | Widely used through Python and R front ends, which npm does not capture. |
| 8 | Nivo 0.99 | Largest React alternative to Recharts by 12-month installs. |
| 9 | MUI X Charts 9.18 | Ships with the most used React component suite; 43 releases in 12 months. |
| 10 | uPlot 1.6 | Named in the brief. The performance reference. |

Next in line and why they were left out: visx (low-level React primitives, the same role as D3), AG Charts and Vega-Lite (install counts driven by a parent product), Observable Plot (the most interesting API of the group, and the next one to study if the list grows), Lightweight Charts (financial charts only), Victory and amCharts 5 (lower on every signal than the tenth pick), Google Charts (no package to pin and test).

### 1.4 Maintenance and cost facts

| Library | Version tested | Published | Stable releases, 12 months | Major versions since Nov 2024 | License | Min + gzip for the three tasks | Harness lines |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chart.js | 4.6.1 | 2026-10-22 | 1 | none | MIT | 81 kB | 54 |
| Recharts | 3.11.0 | 2026-11-17 | 12 | v3 (2025-06) | MIT | 140 kB + React | 83 |
| D3 | 7.9.2 | 2026-11-03 | 2 | none | ISC | 35 kB | 91 |
| ECharts | 6.1.0 | 2026-05-19 | 1 | v6 (2025-07) | Apache-2.0 | 373 kB | 63 |
| Highcharts | 13.1.1 | 2026-09-20 | 10 | v12 (2024-11), v13 (2026-06) | Commercial | 143 kB | 51 |
| ApexCharts | 8.9.0 | 2026-11-17 | 65 | v5 (2025-07), v6 (2026-07), v7 (2026-08), v8 (2026-10) | Free under $2M revenue, otherwise commercial | 289 kB | 60 |
| Plotly.js | 4.3.0 | 2026-11-10 | 12 | v3 (2025-01), v4 (2026-08) | MIT | 1,450 kB | 30 |
| Nivo | 0.99.0 | 2025-05-23 | 0 | none | MIT | 129 kB + React | 54 |
| MUI X Charts | 9.18.1 | 2026-11-16 | 43 | v8 (2025-04), v9 (2026-04) | MIT; zoom and pan need the Pro plan | 160 kB + React | 44 |
| uPlot | 1.6.32 | 2025-03-14 | 0 | none | MIT | 23 kB | 45 |

Observed from the npm registry and from bundling each harness module with esbuild. Sizes are for the import path each library's getting-started guide shows (`chart.js/auto`, the full `echarts` and `apexcharts` builds, `plotly.js-dist-min`); most of them document a smaller, more manual import. "Harness lines" counts non-blank, non-comment lines for all tasks. License terms: **Docs** (Highcharts shop page lists 366 USD per seat for Highcharts Core; ApexCharts' license file sets the $2M threshold and requires an OEM license for embedding in a product at any size; MUI's accessibility page marks zoom and pan as Pro).

## 2. Method

One Vite project loads each library from npm and runs the same tasks into a 720×400 container. A Playwright script drives system Chrome 157 (headless) through every combination and records screenshots, the DOM, the accessibility tree, keyboard and pointer behavior, and timings.

**Rule for "default settings":** each task states what the reader must be able to do (see the data with axes and a title, tell series apart, read exact values). Each library gets the least configuration that its documentation needs for that, and no styling. Where a library cannot render at all without a choice (a color, a size), the value from its own documentation is used and the requirement is recorded.

| Task | Data | What it tests |
|---|---|---|
| `trend` | 3 series × 120 daily values (UTC midnights), thousands to tens of thousands; one series has 7 missing days | Time axis, legend, tooltip, number formatting, gaps |
| `bars` | 7 categories, values 82–97, one long category name | Zero baseline, label fitting |
| `parts` | 6 shares, two under 3% | Part-to-whole labels, palette |
| `dirty` | `[10, 20, null, NaN, '40', undefined, 70]` | What happens to bad input, and who is told |
| `empty` | The `trend` chart with zero rows | Empty state |
| `scale` | One series of 10,000, 100,000 and 1,000,000 points | Time to draw, default and documented fast path |
| `stream` | 600-point window, one new point per frame for 300 frames | Update cost |

Cross-cutting probes on `trend`: Tab and arrow-key walk; pointer hover with the browser in UTC and in America/Los_Angeles; container shrunk to 360 px; page rendered at 340 px; `prefers-color-scheme: dark`; first frame against settled frame with and without `prefers-reduced-motion`.

What this method does not cover: Firefox and Safari; real screen readers (the accessibility tree was inspected, no reader was run); touch; right-to-left text; anything beyond each library's first-page configuration. Each library has options that fix most of what follows. The point of the study is what a reader gets when the author does the minimum, because that is what most everyday charts are.

## 3. How the charts look and communicate

![Trend task, default settings](../research/harness/shots/_sheet-trend.png)

### 3.1 Scoreboard

All rows are **Observed**.

| | Chart.js | Recharts | D3 (by hand) | ECharts | Highcharts | ApexCharts | Plotly.js | Nivo | MUI X | uPlot |
|---|---|---|---|---|---|---|---|---|---|---|
| Bars start at zero | yes | yes | yes | yes | yes | yes | yes | yes | yes | **no, axis starts at 80** |
| Long category label | all labels rotated | **label dropped** | overlaps | **5 of 7 labels dropped** | wrapped | rotated, clipped | rotated, clipped | overlaps | **label dropped** | overlaps |
| Time tick labels at 720 px | rotated 45° | crowded | fit | overlap | fit | fit | fit | overlap | fit | fit |
| Thousands on the y axis | `50,000` | `60000` | `50,000` | `50,000` | `60k` | `50000` | `50k` | `50000` | `50,0…` (truncated) | `50,000` |
| Marker on every point of a 120-point line | yes | yes | no | yes | no | no | no | yes | no | no |
| Missing days shown as a gap | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Chart title | built in | **none** | hand-built | built in | built in | built in | built in | **none** | **none** | built in |
| Donut: values readable without hovering | no | no; legend re-sorted alphabetically | yes, small ones overlap | no (names only) | no (names only) | yes (percent) | yes (percent) | yes, small ones overlap | no | no donut |
| Empty data | invented axes (0–1.0, hours) | blank frame | blank frame | blank | blank | invented axis (0–6) | invented axes (−1 to 6) | "Jan 01" eight times | **"No data to display"** | blank |
| Legible on a dark page | dim | dim | **yes** | title nearly invisible | **yes, palette adapts** | text nearly invisible | stays a white card | text invisible | text invisible | axis text invisible |

### 3.2 Findings

**R1. Zero baseline is mostly respected.** Nine of ten start bars at zero. uPlot auto-ranged to 80–97.5, which makes 82 look like one eighth of 97.

**R2. Labels that do not fit are the most common visible failure.** Only Highcharts wrapped "Customer Success & Onboarding". Recharts and MUI X removed that one label and left a bar with no name. ECharts kept two labels of seven. Nivo, uPlot and the hand-built D3 chart overlapped text. ApexCharts and Plotly rotated and then clipped at the container edge. On the time axis, ECharts and Nivo overlapped tick labels at 720 px, and Nivo became an unreadable smear at 340 px.

![Bars task, default settings](../research/harness/shots/_sheet-bars.png)

**R3. Dates move depending on where the reader sits.** The data is one value per day stamped at UTC midnight. With the browser set to America/Los_Angeles:

| Shows the previous day | Shows the intended day | Decided by the author's formatter |
|---|---|---|
| Chart.js (`Feb 23, 2026, 4:00:00 p.m.`), ECharts (`2026-02-25 16:00:00`), Plotly, Nivo, MUI X, uPlot | Highcharts, ApexCharts | Recharts (no time formatting built in), D3 (the author picks `scaleUtc` or `scaleTime`) |

Neither default is right for every dataset. What is missing everywhere is a way to say "this is a calendar date" as opposed to "this is an instant".

**R4. Default value formatting is uneven.** Recharts, ApexCharts and Nivo print `50000`. Nivo's default tooltip is `x: Sat Mar 07 2026 00:00:00 GMT+0000 (Coordinated Universal Time), y: 24930`, and MUI X's tooltip heading is the same raw date string, cut off at the container edge. Plotly's tooltip rounds to `36.832k`. Recharts prints raw epoch numbers on a time axis unless given a formatter.

**R5. Bad input is never reported.** For `[10, 20, null, NaN, '40', undefined, 70]`:

| Outcome | Libraries |
|---|---|
| Plots the string `'40'` as 40, no message | Chart.js, Recharts, ECharts, Plotly |
| Throws `TypeError: Cannot read properties of undefined (reading 'x')` and draws empty axes | Highcharts |
| Draws empty axes, no message | ApexCharts |
| Chart breaks, 10–20 SVG attribute errors about `NaN` in the console | Nivo, MUI X |
| Draws a line from Thursday (which is `NaN`) through Saturday (which is `undefined`) to Sunday | uPlot |
| Line stops after Tuesday; the rest, including Sunday's valid 70, is lost | D3 when `.defined()` is forgotten |

No library named the field, the row or the problem.

![Dirty input task](../research/harness/shots/_sheet-dirty.png)

**R6. Empty results look broken.** Only MUI X says "No data to display". Chart.js, ApexCharts, Plotly and Nivo draw axes with invented ranges; the rest are blank. Highcharts' generated description for the empty chart reads "Data ranges from 1970-01-01 00:00:00 to 1970-01-01 00:00:00".

**R7. Default palettes fail contrast, color-vision checks, or both.** The first six colors each library used for the donut, scored for contrast against white (WCAG 1.4.11 asks 3:1 for graphical objects) and for the smallest pairwise difference in OKLab under normal vision and Machado-simulated deficiencies:

| Library | First six colors | Distinct | Below 3:1 on white | Min difference, normal | Protanopia | Deuteranopia | Tritanopia |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chart.js | `#36a2eb` `#ff6384` `#ff9f40` `#ffcd56` `#4bc0c0` `#9966ff` | 6 | 5 | 0.108 | 0.114 | 0.084 | 0.051 |
| Recharts (documentation colors; no palette) | `#0088fe` `#00c49f` `#ffbb28` `#ff8042` | 4 | 3 | 0.143 | 0.131 | 0.102 | 0.097 |
| ECharts | `#5070dd` `#b6d634` `#505372` `#ff994d` `#0ca8df` `#ffd10a` | 6 | 4 | 0.100 | 0.016 | 0.047 | 0.092 |
| Highcharts | `#2caffe` `#544fc5` `#00e272` `#fe6a35` `#6b8abc` `#d568fb` | 6 | 4 | 0.123 | 0.107 | 0.012 | 0.082 |
| ApexCharts | `#008ffb` `#00a86f` `#ca8501` `#ff4560` `#846dd5` | **5** | 0 | 0.128 | 0.083 | 0.055 | 0.047 |
| Plotly.js | `#1f77b4` `#ff7f0e` `#2ca02c` `#d62728` `#9467bd` `#8c564b` | 6 | 1 | 0.142 | 0.007 | 0.039 | 0.068 |
| Nivo | `#e8c1a0` `#f47560` `#f1e15b` `#e8a838` `#61cdbb` `#97e3d5` | 6 | 6 | 0.087 | 0.040 | 0.069 | 0.065 |
| MUI X Charts | `#4254fb` `#ffb422` `#fa4f58` `#0dbeff` `#22bf75` `#fa83b4` | 6 | 4 | 0.131 | 0.081 | 0.046 | 0.067 |

ApexCharts is the only one whose colors all reach 3:1, and it gave the sixth slice the same blue as the first. Recharts and uPlot have no palette: in Recharts every line is `#3182bd` and every pie sector `#808080` until the author assigns colors. Plotly's red and green are nearly identical under simulated protanopia (0.007). A feasibility search under the same metric found eight-color sets that reach 3:1 and keep a minimum difference of 0.12 or more under all four conditions, on both white and dark backgrounds ([`research/palette/`](../research/palette/feasibility.json)), so a much better default is achievable.

![Donut task, default settings](../research/harness/shots/_sheet-parts.png)

**R8. Dense lines get a marker on every point in four libraries.** Chart.js, Recharts, ECharts and Nivo draw 360 markers for the trend task; at 340 px the lines turn into beads.

**R9. Titles and units are an afterthought in the React libraries.** Recharts, Nivo and MUI X have no chart title. In Recharts and MUI X the y-axis title overlapped the tick labels with the documented placement. Highcharts titles an untitled y axis "Values".

**R10. Dark mode works in two of ten.** Highcharts 13 switches palette and text with `prefers-color-scheme`. The hand-built D3 chart works because D3's axis uses `currentColor`. Everything else hardcodes dark text, and Plotly keeps a white background.

![Dark color scheme](../research/harness/shots/_sheet-dark.png)

## 4. How readers explore and interact

### 4.1 Scoreboard

All rows are **Observed** in Chrome's accessibility tree and by scripted keyboard and pointer input. No screen reader was run.

| | Chart.js | Recharts | D3 (by hand) | ECharts | Highcharts + a11y module | ApexCharts | Plotly.js | Nivo | MUI X | uPlot |
|---|---|---|---|---|---|---|---|---|---|---|
| Accessibility tree | **empty** | legend list; chart region named by its tick labels | image named by all its text | **empty** | named region, heading, generated description, one region per series | named region, legend buttons | two unnamed images, toolbar | unnamed image | legend list, status | title text, legend table |
| Tab stops in the chart | 0 | 8 (7 unlabeled) | 0 | 0 | 2 | 10 | 9, all toolbar buttons | 0 | 1 | 0 |
| Arrow keys move between points | no | yes | no | no | yes | yes | no | no | yes | no |
| Focused point announced or shown as text | no | live region, `assertive` | no | no | tooltip text, polite region | live region | no | no | tooltip, status region | no |
| Generated chart description | no | no | no | opt-in (**Docs**) | **yes** | name and type only | no | no | no | no |
| Tooltip with the pointer between points | **none** (needs an exact hit) | all series | all series (hand-built) | all series (opt-in) | one series | all series | one point | one point | all series | all series, in the legend |
| Follows container resize without code | yes | yes | scales like an image | **no** | yes | yes | **no** | yes | yes | **no** |
| Animates on first render | yes | yes | no | yes | yes | yes | no | yes | yes | no |
| Stops animating under reduced motion | **no** | yes | n/a | **no** | **no** | yes | n/a | **no** | yes | n/a |

![After Tab and three arrow keys](../research/harness/shots/_sheet-kbd.png)

### 4.2 Findings

**R11. Half of the ten are invisible to assistive technology by default.** Chart.js and ECharts put a single unlabeled canvas on the page; uPlot adds a title and a legend table that reads `--` until a mouse moves; Nivo and the hand-built D3 chart are an image with no name or with every tick label concatenated. Chart.js' documentation leaves making the canvas accessible to the author (**Docs**, page last updated 2021). ECharts' description generator and patterns are off by default and need an extra component import (**Docs**).

**R12. Four libraries have keyboard navigation, with rough edges.** In the versions tested it is on by default in Recharts, ApexCharts and MUI X (**Observed**; the ApexCharts and MUI X documentation confirm the default). Highcharts provides it once its accessibility module is imported, and its documentation says a console warning appears when the module is missing (**Docs**). Rough edges observed: Recharts names the chart region with the concatenated tick labels (`1/11/20261/26/2026…`), needed eight Tab presses to leave the chart, and announces through an `assertive` live region; ApexCharts adds ten tab stops per chart, which is 240 on a 24-chart dashboard; MUI X's focus target has `role="none"` and its documentation says the feature is still being developed (**Docs**); Plotly's nine tab stops are all toolbar buttons and the data cannot be reached, and pressing Enter on the first one downloaded a PNG.

**R13. Only one library describes the chart.** Highcharts generated: "Line chart with 3 lines. The chart has 1 X axis displaying Time. Data ranges from 2026-01-01 00:00:00 to 2026-04-30 00:00:00. The chart has 1 Y axis displaying Sessions. Data ranges from 2732 to 48085." None of the ten offers a data table without an extra module.

**R14. Reduced motion is ignored by four of the seven that animate.** Chart.js, ECharts, Highcharts and Nivo produced the same early-frame difference with `prefers-reduced-motion: reduce` as without, and none of their packages contains the string `prefers-reduced-motion`. Recharts, ApexCharts and MUI X stop animating.

**R15. Tooltips differ in the most basic behavior.** With the pointer in the plot but not on a point, Chart.js shows nothing. Highcharts, Plotly and Nivo describe one series; the others list all series at that x. MUI X's tooltip ran off the right edge of the container.

**R16. Three libraries do not follow their container.** ECharts, Plotly and uPlot stayed 720 px wide when the container shrank to 360 px. Each documents a manual resize call or option. uPlot also requires pixel sizes up front, and its title and legend are outside the height it is given.

![Rendered at 340 px](../research/harness/shots/_sheet-narrow.png)

## 5. How developers create, update, customize and maintain

### 5.1 What each library needed beyond data

All **Observed** while writing the harness ([`research/harness/src/libs/`](../research/harness/src/libs)).

| Library | Had to know or add |
|---|---|
| Chart.js | A date adapter package before a time axis works. `maintainAspectRatio: false` to fill a fixed-height container. |
| Recharts | Reshape columns into row objects. A color for every series. A tick formatter for time. Eight components for one line chart. No title. |
| D3 | Everything: 91 lines for the tasks, with title, legend and readout built by hand and no keyboard access. |
| ECharts | `tooltip` and `legend` are absent unless declared. |
| Highcharts | The accessibility module is a separate import. |
| ApexCharts | A numeric height: `height: '100%'` produced a 456 px chart in a 400 px container. |
| Plotly.js | Nothing extra: 30 lines, the shortest. Costs 1.45 MB gzipped with the documented import. |
| Nivo | Margins by hand or axes are clipped. `useMesh` for a tooltip. A five-property object for a legend. No title. |
| MUI X Charts | `@mui/material` and `@mui/system` as peer dependencies. No title. |
| uPlot | Pixel width and height, a stroke color per series, x values in seconds, and a path builder plus a custom axis for bars. No donut. |

### 5.2 Findings

**D1. Line counts are similar; hidden knowledge is not.** Nine of ten needed 30 to 83 lines for all tasks. What separates them is the list above: things that produce a broken or blank chart with no message when missed.

**D2. Five data shapes for the same table.** Parallel arrays with labels (Chart.js, uPlot), `[x, y]` pairs per series (ECharts, Highcharts, ApexCharts), row objects keyed by series (Recharts), `{ id, data: [{ x, y }] }` (Nivo), and separate x and y arrays per trace (Plotly, MUI X). Every harness module begins by reshaping.

**D3. Seven update idioms.** Mutate then `chart.update()` (Chart.js); `setOption` merge (ECharts); `series.addPoint` (Highcharts); `updateSeries` (ApexCharts); `Plotly.extendTraces`; `setData` (uPlot); re-render with new props (the React three).

**D4. Bundle cost spans 60 times.** 23 kB (uPlot) to 1,450 kB (Plotly) gzipped for a line, a bar and a donut with the documented import.

**D5. Errors do not help.** The one thrown error in the study was Highcharts' `Cannot read properties of undefined (reading 'x')` from minified code. The others fail silently or through browser SVG errors.

**D6. Release cadence ranges from none to hectic.** Nivo and uPlot have had no release in 18 and 20 months. ApexCharts shipped four major versions in 16 months and 65 stable releases in the last 12. MUI X ships a major version a year.

**D7. Licensing splits the field.** The library with the best reader experience (Highcharts) is paid for commercial use; ApexCharts is free only under a revenue threshold and never for embedding in a product; MUI X charges for zoom and pan. The fully permissive options are the ones with the weakest accessibility defaults, plus Recharts and MUI X's free tier.

### 5.3 Load

Time from calling the library to the second animation frame after it returns, median of three runs, headless Chrome 157 on one desktop machine. This captures main-thread work; it misses off-thread rasterization and any entry animation still running, and it cannot resolve below about 35 ms. Read it for order of magnitude. All **Observed**.

| Library and configuration | 10,000 points | 100,000 points | 1,000,000 points | Streaming: update cost p50 / p95 | Frames over 20 ms (of 300) |
| --- | --- | --- | --- | --- | --- |
| Chart.js, defaults | 152 ms | 1.8 s | 13.7 s | 5.5 / 11.9 ms | 3 |
| Recharts, defaults | 900 ms | 7.1 s | > 45 s | 15.1 / 26.2 ms | 89 |
| D3, one SVG path | 31 ms | 75 ms | 559 ms | 0.2 / 0.4 ms | 0 |
| ECharts, defaults | 189 ms | 1.5 s | 12.9 s | 5.3 / 11.2 ms | 21 |
| Highcharts, defaults | 96 ms | 319 ms | 1.9 s | 2.8 / 5.8 ms | 1 |
| ApexCharts, defaults | 36 ms | 120 ms | 844 ms | 3.9 / 6.7 ms | 1 |
| Plotly.js, defaults | 47 ms | 74 ms | 425 ms | 3.9 / 8.8 ms | 0 |
| Nivo, defaults | 479 ms | 4.0 s | > 45 s | 17.6 / 32.2 ms | 222 |
| MUI X Charts, defaults | 58 ms | 321 ms | 2.5 s | 4.3 / 7.0 ms | 0 |
| uPlot, defaults | 31 ms | 24 ms | 62 ms | 0.0 / 0.1 ms | 0 |
| Chart.js, decimation + no parsing + no animation | 31 ms | 40 ms | 111 ms | 1.6 / 2.4 ms | 0 |
| ECharts, LTTB sampling + no symbols + no animation | 41 ms | 78 ms | 395 ms | 1.9 / 4.5 ms | 0 |
| Recharts, no dots + no animation | 105 ms | 792 ms | 8.1 s | 6.8 / 11.9 ms | 3 |
| Highcharts, Boost module (WebGL) | 123 ms | 139 ms | 449 ms | 3.4 / 5.5 ms | 0 |
| Plotly.js, `scattergl` (WebGL) | 222 ms | 962 ms | 9.2 s | 6.4 / 10.6 ms | 282 |

The two WebGL rows are not representative: headless Chrome reported its WebGL renderer as SwiftShader, a software rasterizer. They need a rerun on a real GPU before any conclusion.

**D8. Defaults are one to two orders of magnitude from the documented fast path.** Chart.js goes from 13.7 s to 111 ms at a million points with four options; ECharts from 12.9 s to 395 ms with three. The capability is there and the default does not use it.

**D9. Canvas with decimation in plain JavaScript is already near the frame budget.** uPlot draws a million points in about 60 ms and appends at a cost under 0.1 ms. That sets the bar for Axylo's TypeScript baseline and for any later claim that another technology is needed.

**D10. One DOM node per point does not scale.** Recharts and Nivo create an SVG element per point by default, took 4 to 7 seconds at 100,000 points, and dropped 89 and 222 of 300 frames while streaming a 600-point window.

## 6. What the findings add up to

| Opening | Evidence | Who is closest today |
|---|---|---|
| Tell the developer when the data is wrong, and never draw a guess | R5, R6, D5: zero of ten report bad input | Nobody |
| Fit every label at every width, or say what was hidden | R2: one of ten wrapped; three dropped labels silently | Highcharts |
| Make dates mean what the author meant | R3: six of ten shift a daily value for a reader in another zone | Highcharts, ApexCharts (by defaulting to UTC) |
| Accessible without an import, an option or a plan | R11–R14, R7, R10 | Highcharts (module, commercial), then ApexCharts and MUI X |
| Fast by default, not by expert configuration | D8–D10 | uPlot |
| One data shape, one way to update, small bundle, permissive license, steady releases | D1–D4, D6, D7 | Chart.js on license and stability; uPlot on size |

No library is strong in more than two rows. The product specification in [02-product-spec.md](02-product-spec.md) is built on holding all six at once for a deliberately small set of chart types.
