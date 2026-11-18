# Node acceptance evidence

## Ran and saw

The 16 test files drive the real controller through the recording host. [EVIDENCE.json](EVIDENCE.json) lists one entry for each of the 494 executed tests. Every entry matches an applicable cell in the repository matrix. The index spans 224 cells and includes failing tests and partial model evidence.

The exact requested command, `timeout 300 npx vitest run packages/axylo/test/acceptance`, exited 1. Its last lines were:

```text
 Test Files  7 failed | 9 passed (16)
      Tests  18 failed | 476 passed (494)
   Start at  05:52:29
   Duration  13.01s (tests 89%, transform 5%, import 5%)
```

A second run with Vitest’s JSON reporter returned the same totals and supplied the registered titles for the evidence index. Strict TypeScript checking passed for these acceptance files and their imported code with the repository compiler options. The full `npm run typecheck` stopped at TS2367 in [the browser naming test](../browser/acceptance/a1-names.browser.test.ts#L45), where the console event type is compared with `warn`.

## Counts by criterion and chart type

| Criterion | Line | Area | Bar | Scatter | Donut | Compact | Total | Failed |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| F1 | 0 | 2 | 2 | 0 | 0 | 4 | 8 | 0 |
| F2 | 4 | 3 | 3 | 2 | 2 | 7 | 21 | 2 |
| F3 | 25 | 20 | 22 | 17 | 12 | 22 | 118 | 1 |
| F12 | 3 | 3 | 3 | 3 | 3 | 0 | 15 | 0 |
| F10 | 0 | 2 | 2 | 0 | 0 | 4 | 8 | 2 |
| F8 | 0 | 0 | 0 | 0 | 5 | 0 | 5 | 0 |
| F4 | 9 | 9 | 9 | 9 | 0 | 9 | 45 | 1 |
| F11 | 2 | 2 | 1 | 2 | 0 | 4 | 11 | 0 |
| F5 | 5 | 1 | 0 | 0 | 0 | 2 | 8 | 0 |
| T-dense-line | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-dense-area | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-dense-bar | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| T-dense-donut | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 |
| T-dense-scatter | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| F7 | 4 | 4 | 4 | 4 | 0 | 3 | 19 | 6 |
| F6 | 4 | 4 | 4 | 4 | 3 | 3 | 22 | 0 |
| A3 | 1 | 1 | 1 | 1 | 1 | 0 | 5 | 0 |
| A1 | 1 | 1 | 1 | 1 | 1 | 1 | 6 | 0 |
| A2 | 1 | 1 | 1 | 1 | 1 | 0 | 5 | 0 |
| T-keyboard-line | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-keyboard-area | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-keyboard-bar | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| T-keyboard-donut | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 |
| T-keyboard-scatter | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| A4 | 1 | 1 | 1 | 1 | 1 | 0 | 5 | 3 |
| A5 | 1 | 1 | 1 | 1 | 1 | 1 | 6 | 0 |
| L1 | 1 | 1 | 1 | 1 | 0 | 0 | 4 | 0 |
| L7 | 1 | 1 | 1 | 1 | 1 | 1 | 6 | 0 |
| L8 | 1 | 1 | 1 | 1 | 1 | 0 | 5 | 0 |
| L3 | 1 | 1 | 1 | 1 | 1 | 0 | 5 | 0 |
| L4 | 1 | 1 | 1 | 1 | 1 | 1 | 6 | 0 |
| I1 | 1 | 1 | 1 | 1 | 1 | 0 | 5 | 0 |
| T-pointer-line | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-pointer-area | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-pointer-bar | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| T-pointer-donut | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 |
| T-pointer-scatter | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| T-tooltip-line | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-tooltip-area | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-tooltip-bar | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| T-tooltip-donut | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 |
| T-tooltip-scatter | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| I2 | 1 | 1 | 1 | 1 | 0 | 0 | 4 | 0 |
| I3 | 1 | 1 | 1 | 1 | 0 | 0 | 4 | 0 |
| T-zoom-line | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-zoom-area | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-zoom-bar | 0 | 0 | 2 | 0 | 0 | 0 | 2 | 0 |
| T-zoom-donut | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 |
| T-zoom-scatter | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| A7 | 1 | 1 | 1 | 1 | 1 | 0 | 5 | 0 |
| I6 | 1 | 1 | 1 | 1 | 1 | 0 | 5 | 0 |
| I5 | 1 | 1 | 1 | 1 | 1 | 1 | 6 | 0 |
| A10 | 1 | 1 | 1 | 1 | 1 | 1 | 6 | 0 |
| F9 | 1 | 1 | 1 | 1 | 0 | 1 | 5 | 0 |
| T-limit-line | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-limit-area | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-limit-bar | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| T-limit-donut | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 |
| T-limit-scatter | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| L6 | 1 | 1 | 1 | 1 | 1 | 0 | 5 | 0 |
| T-reference-line | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-reference-area | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| T-reference-bar | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| T-reference-donut | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 |
| T-reference-scatter | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| L5 | 1 | 1 | 0 | 0 | 0 | 0 | 2 | 0 |
| C1 | 0 | 0 | 0 | 0 | 0 | 3 | 3 | 0 |
| C2 | 0 | 0 | 0 | 0 | 0 | 3 | 3 | 0 |
| C3 | 0 | 0 | 0 | 0 | 0 | 3 | 3 | 0 |
| C4 | 0 | 0 | 0 | 0 | 0 | 2 | 2 | 0 |
| C5 | 0 | 0 | 0 | 0 | 0 | 4 | 4 | 3 |
| DX2 | 1 | 1 | 1 | 1 | 1 | 1 | 6 | 0 |
| DX3 | 2 | 1 | 1 | 1 | 1 | 1 | 7 | 0 |
| DX4 | 3 | 1 | 1 | 1 | 1 | 1 | 8 | 0 |
| DX5 | 5 | 5 | 5 | 5 | 5 | 5 | 30 | 0 |
| DX6 | 1 | 1 | 1 | 1 | 1 | 1 | 6 | 0 |
| DX8 | 1 | 1 | 1 | 1 | 1 | 1 | 6 | 0 |
| **Total** | 96 | 87 | 87 | 77 | 57 | 90 | 494 | 18 |

Counts include multiple tests per cell. Fast-check tests request 1,000 cases each. The four failing first-tick properties stop when a counterexample is found.

## Failing tests

### F2 scatter omissions and zero imputation

> Missing values are never drawn as zero and never bridged unless the author asks. … Tooltip, table and announcements say "No data".

> On a time or date axis with a regular step, an absent step is a gap and raises AX105; `missing: 'zero'` on the field turns absent and null values into zeros for counts.

- **F2 scatter: gaps are unplotted, zero is readable and the table says No data (reading: the table keeps omitted observations)**  
  Expected table values `4, No data, No data, 0`. The table returned `4, 0`. Two points were correctly drawn. [Point normalization](../../src/data/normalize.ts#L338) keeps only valid x/y pairs, and [the scatter table](../../src/reader/table.ts#L53) enumerates those points exclusively.
- **F2 scatter: missing zero draws two imputed zero points and exposes all four observations**  
  Expected four points, including two imputed zeros. The scene contained two points. [Point normalization](../../src/data/normalize.ts#L343) calls the value reader with zero imputation disabled and filters the null and absent values out.

### F3 AX143 guidance

> If labels still do not fit, a visible note ("Some labels hidden. See table.") appears and AX143 suggests horizontal bars.

- **F3 bar: AX143 discloses hidden labels after fitting unordered categories**  
  The 90 bars and the note were present. The diagnostic said “Give the plot more room or shorten the labels.” Expected the horizontal-bar remedy. The [AX143 registry message](../../src/diagnostics/registry.ts#L130) omits it.

### F4 scatter month and year precision

> **Calendar dates** (`2026-02-24`, `2026-02`, `2026`) read the same in every viewer time zone.

- **F4 scatter: calendar days, months and years keep their input precision across time zones (reading: month and year inputs keep their granularity)**  
  The leap-day checks passed. Expected `Feb 2024` in the summary of month observations, while the summary used `Feb 1, 2024`. The same code path covers years. [The point-frame formatter specification](../../src/core/controller.ts#L778) supplies `dateUnit: null`, so date formatting defaults to days.

### F7 scatter percentage and ratio domains

> A field declared `scale: 'percent'` (0–100) or `'ratio'` (0–1) ends at full scale only when its maximum is at least half of full scale and not above it.

- **F7 scatter: declared percent reaches full scale at half scale while a small maximum uses the first tick**  
  Expected a maximum of 50 to produce domain end 100. The domain ended at 56.
- **F7 scatter: declared ratio reaches full scale at half scale while a small maximum uses the first tick**  
  Expected a maximum of 0.5 to produce domain end 1. The domain ended at 0.56.

[The scatter view state](../../src/core/stages.ts#L69) passes the value field and domain but drops its scale declaration. [The scatter view](../../src/view/index.ts#L334) then calls value-domain calculation with the absent declaration.

### F7 value domain endpoint

> The automatic domain contains all data, reference lines and stack totals, and ends at the first tick at or beyond each extreme.

- **F7 line: for any generated reference extreme the automatic value domain ends at the first drawn tick that reaches it (reading: the tick is the one the reader sees)**
- **F7 area: for any generated reference extreme the automatic value domain ends at the first drawn tick that reaches it (reading: the tick is the one the reader sees)**
- **F7 bar: for any generated reference extreme the automatic value domain ends at the first drawn tick that reaches it (reading: the tick is the one the reader sees)**
- **F7 scatter: for any generated reference extreme the automatic value domain ends at the first drawn tick that reaches it (reading: the tick is the one the reader sees)**

For each counterexample the largest reference value was 61 and the first drawn tick at or above it was 70. Expected the domain end at 70. The committed domain ended at 80. [Domain calculation](../../src/scale/domain.ts#L85) rounds to its own interval, and [axis construction](../../src/core/axes.ts#L42) gives layout separate tick candidates, which can use a finer interval.

### F10 compact incomplete stacks

> A missing component is drawn with zero height and the stack is marked "incomplete" in tooltip, table and announcements.

- **F10 compact: a missing area component has zero height and the reader is told which stack is incomplete (reading: the summary provides the incomplete warning)**
- **F10 compact: a missing bar component has zero height and the reader is told which stack is incomplete (reading: the summary provides the incomplete warning)**

Both zero-height geometry checks passed. Expected the summary, the compact reader’s alternative, to indicate an incomplete stack. Both summaries listed the series minima, maxima and last values and omitted any mention of incompleteness. [Summary construction](../../src/reader/index.ts#L48) formats per-series aggregates without reading the view’s incomplete-stack flags.

### A4 aligned table headers

> "View as table" shows the data as an HTML table built from the normalized data when opened: the title as caption, field labels with units as column headers, x values as row headers, values formatted as in F6.

- **A4 line: the lazy table uses the heading and units and reaches rows on the current range’s second page**
- **A4 area: the lazy table uses the heading and units and reaches rows on the current range’s second page**
- **A4 bar: the lazy table uses the heading and units and reaches rows on the current range’s second page**

In all three cases the caption, pagination and page-two value passed. Expected the x header `Distance (m)`. The table returned `Distance`. [The aligned table builder](../../src/reader/table.ts#L80) applies units to series headers only.

### C5 compact visual and text alternatives

> When values were left out (F12), the description says so and a small marker with a text equivalent appears in the corner.

> `compact: true` on line, area and bar draws the marks and nothing else: no axes, gridlines, legend, toolbar, table control, zoom or tooltip.

- **C5 compact: line supplies omission text for the corner marker and summary (reading: neither refers to an unavailable table)**
- **C5 compact: area supplies omission text for the corner marker and summary (reading: neither refers to an unavailable table)**
- **C5 compact: bar supplies omission text for the corner marker and summary (reading: neither refers to an unavailable table)**

Each model supplied the omission count and had a null table. Expected the marker text and summary to explain the omission without an unavailable action. The marker text was `Values not shown: 1. See table.` in all three. [The reader builder](../../src/reader/index.ts#L141) uses the same omission template for the note and summary before checking whether the chart has a table.

## Model boundary and remaining evidence

- Every one of the 29 registry codes is exercised through the controller. AX141 requires a resolved low-contrast theme. The test uses an authored color and a host stand-in for the resolved backdrop, since public options alone cannot set the resolved page theme. AX199 requires an internal failure and uses the existing development hook. The public diagnostic omits `effect`, so the registry tests observe the input of the real conversion to public diagnostics.
- The recording host supplies deterministic text widths and committed outputs. Its `pending` and `layout` getters are copied once by `Object.assign`, so these tests drain the live frame queue and read the layout from `committed`. The host substitutes for DOM interaction and exposes state announcements. These tests call the real pure keyboard value-text function for navigation wording. Actual live-region delivery, focus, tab order, toolbar semantics and keyboard or pointer event wiring require a browser.
- Model tooltip text, picking, navigation, legends, table paging, compact controls, plot-label boxes and paint bindings are exercised. Tooltip placement and hover persistence, touch and scroll behavior, actual text fit after font loading, computed contrast, 400% reflow, system themes, CSS height, rendered separator pixels, motion preferences, built-in language attributes, unique IDs, and axe results need the browser. Donut L1 in particular has no plot text boxes and needs the real caption and legend. F12 is checked with an in-memory production-defined controller build, while placement in the accessibility tree in a packed build remains browser evidence.
- Section 3.8 requires recorded assistive-technology rehearsals for A3 and a statement of the limits in A9. The Node run provides model structure only. DX1 and DX10 require rendering the documented entry points and examples from a packed distribution. DX3 compile-error fixtures, DX4 documentation links, DX6 CSS inheritance, and DX8 React StrictMode, CSP, text insertion and unmatched-selector behavior require evidence from their respective test environments. DX7 and DX9–DX12 also include package metadata, release policy, licensing and agent rehearsal checks. P1–P8 need their specified benchmarks, bundle measurements or forced-collection runs.
- The recorded run used Node only. The browser suite, packed release build, conformance audit and performance budgets were outside this run. No contract change is needed to run or interpret these tests.

## Specification readings used in the tests

- A bar missing mark can be distinct from a zero-height value bar even though both originate at the baseline. A singleton needs an isolated point and no fabricated segment. For scatter, F2’s table wording applies to existing rows whose y is null or absent, even when a point cannot be drawn.
- Month and year dates keep their input granularity. An IANA alias returned by the platform names the same zone. An unambiguous majority temporal kind sets the axis, and incompatible rows are diagnosed. In the zoned bar fixture, AX143 is a separate label-fitting warning. The temporal checks still require AX111 and exact local date/time readouts.
- F7’s “first tick” means the first tick actually presented to the reader. In a mixed-sign stack the single tooltip total is the algebraic sum. For compact stacks the summary carries incomplete status because the full chart’s interactive readouts are absent.
- Donut’s eight-slice limit counts drawn arcs. Arcless zero and missing categories remain separately readable. Aligned keyboard walks visit x positions by default and switch through series in their declared order. I3’s `zoom: false` disables reader zoom controls while preserving explicit author calls where the chart type supports them. Sparse marker cues required by A5 remain compatible with L5’s restriction on marking every point.
- C3 refers to the compact figure occupying the container, with room inside for stroke clearance. For C5 an omission notice in a chart with no table should explain the omission without referring the reader to one.
