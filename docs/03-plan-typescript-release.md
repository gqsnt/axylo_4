# Phase 2 plan: Axylo 1.0 in TypeScript

Revision 3, 2026-11-18. Revised after three independent reviews ([ledger](../reviews/2026-11-18/ledger.md)) and the owner's decisions of the same day (scatter and a compact variant are in 1.0; the mark renderer is decided in M1).

This plan builds the product defined in [02-product-spec.md](02-product-spec.md). Criterion IDs (F1, L1, A2, DX4, P1 …) refer to that spec; finding IDs (R5, D2 …) refer to [01-landscape.md](01-landscape.md).

**The release is done when every row of the acceptance matrix passes.** The matrix lives in the repository as data: one row per spec criterion and chart type, naming the test that covers it, with a result of pass, fail or not applicable (with the reason). The Phase 1 comparison is rerun with Axylo included and published, but it is comparison evidence, not the gate: several of its columns are descriptive, and it cannot run the performance budgets.

## 1. Public API

The declarations are in [packages/axylo/src/public.ts](../packages/axylo/src/public.ts), and every example below is in [docs/api/examples.ts](api/examples.ts), type-checked against the package by `npm run typecheck`: the examples compile, and the deliberate mistakes fail to compile. (The first revision of this plan carried a separate declaration sketch, `docs/api/axylo.d.ts`; the package replaced it.)

### 1.1 Shape

One function per chart type, each taking a target element and a plain options object, each returning the same small handle.

```ts
import { line } from 'axylo';

const chart = line('#sessions', {
  title: 'Daily sessions by channel',
  data: rows,              // [{ day: '2026-01-01', channel: 'Direct', sessions: 31713 }, …]
  x: 'day',
  y: 'sessions',
  series: 'channel',
});
```

That is the whole first chart. Axes, legend, tooltip, keyboard access, description, data table, light and dark colors and resizing are on without further options.

| Decision | Reason |
|---|---|
| Field names over a table | Finding D2: the ten libraries take five incompatible shapes, and the harness had to reshape its fixture a different way for each. Application data arrives as rows. |
| One function per chart type (`line`, `area`, `bar`, `donut`, `scatter`) | Each has its own options type, so options that do not apply are type errors (DX3), and bundlers can drop unused chart types. Whether shared code actually tree-shakes is measured on real consumer builds in M7. |
| Plain options object, not a builder or a JSX tree | The same object works in the React adapter. Recharts needed eight components for the trend task; the information content was four fields. |
| No required configuration beyond data and fields | Findings R11, R15, D1: tooltips, legends, time adapters, margins, colors and accessibility were opt-in somewhere in every library. |

### 1.2 Data: one logical table, three forms

```ts
// long rows: one row per (x, series)
line(el, { data: rows, x: 'day', y: 'sessions', series: 'channel' });

// wide rows: one column per series
line(el, { data: wide, x: 'day', y: ['direct', 'organic', { field: 'referral', label: 'Referral' }] });

// typed columns for large data; the row type is inferred from the columns
line(el, { data: { columns: { t: new Float64Array(n), v: new Float32Array(n) } }, x: { field: 't', type: 'time' }, y: 'v' });
```

Long and wide are mutually exclusive in the types: `series` cannot be combined with an array of `y`.

Rules the three forms share:

| Rule | Detail |
|---|---|
| Ownership | Row arrays are read once and never mutated. Typed columns are borrowed, not copied; the caller must not change them in place, and replaces them through `update`. |
| Column lengths | All columns must have the same length; otherwise AX100. |
| Missing values | Rows: `null`, or an absent key. Typed columns: `NaN` means missing and does not raise AX103. |
| Order | Line, area and scatter are sorted by x internally (F11). `append` expects rows at or after the last x. |
| Provenance | Every normalized sample keeps the index of the row it came from, so diagnostics, the table and events point at the caller's own data. |

### 1.3 Fields

A field is a key of the row, or an object when it needs more. The key is checked against the row type by role: a value axis accepts number fields; text fields are accepted there only with `parse: 'number'`.

```ts
line(el, {
  data: samples,
  x: { field: 'ts', type: 'time', timeZone: 'UTC' },
  y: { field: 'sessions', label: 'Sessions', unit: 'sessions', tickFormat: { notation: 'compact' } },
});

// counts that a database driver returns as strings
bar(el, { data: pgRows, x: 'day', y: { field: 'count', parse: 'number', missing: 'zero' } });
```

| Option | Meaning |
|---|---|
| `field` | Key of the row. |
| `label`, `unit` | Axis title; name and unit in tooltip, table and announcements. |
| `type` (x) | `'date'`, `'time'`, `'number'`, `'category'`. Inferred when omitted, except that a number is never inferred to be an instant (F4). |
| `timeZone` (x) | For instants: `'local'` (default), `'UTC'`, or an IANA zone. |
| `format`, `tickFormat` | Readouts and ticks are formatted separately (F6). |
| `scale` (value) | `'percent'` (0–100) or `'ratio'` (0–1). Declared, never inferred (F7). |
| `missing` (value) | `'gap'` (default) or `'zero'` (F2). |
| `parse` (value) | `'number'`, for a text field holding numbers (AX104, AX106). |
| `domain` | Author bounds. Widened to zero on bar and area (F1). |

### 1.4 Common options

Summarized; the declarations are the reference.

| Option | Purpose |
|---|---|
| `title`, `labelledBy`, `subtitle`, `description` | The chart's visible heading and accessible name (A1). `title` may carry a heading `level` and `visible: false`; `labelledBy` points at a heading the page already has. |
| `state` | `'ready'`, `'loading'`, `{ error }`, `{ empty }` (L7). |
| `legend`, `tooltip`, `table` | On by default; each can be turned off. |
| `zoom`, `reference` | Cartesian charts only. |
| `compact` | Line, area and bar: marks only, as a static image with a text alternative (spec 3.7). |
| `colors` | A fixed color per series name (DX6). |
| `messages`, `locale` | Built-in text and formatting locale (A10, F6). |
| `strict`, `onDiagnostic` | Diagnostics delivery (section 3.5 of the spec). |

There is no `width`, `height`, `responsive`, `theme`, `palette` or `animation` option. Size comes from the container, colors from CSS, motion from the spec (I5). An unknown key raises AX150 with the closest known name.

### 1.5 Handle and commit contract

```ts
chart.update({ title: 'Sessions' });                 // options
chart.append([{ day: '2026-05-01', channel: 'Direct', sessions: 41210 }], { keep: 120 });   // rows
chart.zoom(['2026-03-01', '2026-03-31']);            // view
const off = chart.on('hover', point => { … });
chart.diagnostics;                                   // current, as soon as any call returns
chart.destroy();
```

Finding D3: the ten libraries have seven update idioms. Axylo has three methods, one per kind of change, with one contract.

| Rule | Detail |
|---|---|
| Order | Calls are applied in the order made. `update({ data })` followed by `append` appends to the new data. |
| Two phases | Each call validates and normalizes synchronously: diagnostics are current when it returns, and a `strict` chart throws from that call. Drawing is deferred to the next animation frame, and calls made before that frame are drawn once. |
| Atomic switch | Marks, labels, hit testing and the accessibility layer move to a new data revision together. No frame mixes two revisions. |
| Patches | A key present in an `update` replaces the old value whole; a key set to `undefined` returns to its default; absent keys stay. No deep merging. |
| Rejected changes | A call that throws under `strict` leaves the chart on its last valid state. |
| Streaming | `keep` is the number of distinct x values retained. Rows before the last x are accepted through the slower full update and raise AX151. While zoomed to the latest edge the view follows new data; zoomed elsewhere, it stays put. Paused charts buffer (I6). Keyboard focus stays on its datum until that datum leaves the window (A7). |
| Teardown | `destroy()` cancels the pending frame, disconnects observers and listeners, and makes later calls no-ops. |

### 1.6 Diagnostics

The registry, with each code's level and outcome, is in the spec (section 3.5). Example for the Phase 1 combined dirty fixture (`[10, 20, null, NaN, '40', undefined, 70]`):

```
[axylo AX103] "Dirty input": y field "value" has 1 value that is not a finite number (NaN at row 3). Shown as a gap.
  Check the calculation that produced it, or send null for "no data".
[axylo AX106] "Dirty input": y field "value" mixes numbers with 1 string ("40" at row 4). The string is not plotted.
  Convert it to a number where the data is produced.
[axylo AX102] "Dirty input": y field "value" is absent in 1 row (row 5). Shown as a gap.
  Send null if the value is known to be missing.
```

The reader of that chart sees "Values not shown: 3. See table." (F12).

`validate(type, options)` runs the same normalization without a DOM and returns the diagnostics, so a server, a test or a coding agent can check a chart before rendering it.

Development and production flavours are selected through package `exports` conditions. The script-tag distribution ships `axylo.js` (development) and `axylo.min.js` (production). Errors and warnings print once per code per page in both; hints only in development.

### 1.7 React adapter (not in 1.0)

Removed from the first release by the owner on 2026-11-18: 1.0 is plain TypeScript, and adapters for React, Vue, Svelte and others follow later. The adapter described below was built, reviewed twice and fixed; its last state is `packages/react` at commit dac5664. The section is kept as the design to return to.

```tsx
import { Line } from '@axylo/react';

<Line data={rows} x="day" y="sessions" series="channel" title="Daily sessions by channel" />
```

| Behavior | Detail |
|---|---|
| Lifecycle | Create on mount, `destroy` on unmount; correct under StrictMode's setup, cleanup, setup. The file is marked `'use client'`. |
| Props to options | Field specs are compared structurally, so an inline `x={{ field: 'ts' }}` does not renormalize on every render. `data` is compared by identity; in development, the same content arriving three times with a new identity raises a hint to memoize it. |
| Removed props | A prop that disappears is sent as `undefined`, which restores the default. |
| Handlers | Replaced without recreating the chart. |
| Streaming | A ref exposes the handle, so `append`, `zoom` and `diagnostics` are reachable. When `data` is controlled, a new `data` prop replaces whatever was appended. |

The adapter is prototyped in M3, before the API freezes, because it is the cheapest way to find out whether the core contract survives a second consumer. It ships in 1.0 because finding 1.1 of the landscape shows where everyday charts are written; that is evidence of where charts are written, not of demand for Axylo.

## 2. Architecture

### 2.1 Pipeline

```
options ─► normalize ─► frame ──┬─► view model ─► layout ─► scene ─► mark renderer
            │ validate   (authoritative) │   scales, visible range         text renderer (DOM)
            ▼ diagnostics                ├─► lookup: exact values by x, by point, by ordinal
                                         ├─► summary and table
                                         └─► focus model
```

The **frame** is the normalized, lossless data: typed columns, a validity bitmap, dictionary-encoded categories, source-row indexes and a revision number. It is the only source for exact values. The table, the summary, keyboard navigation, tooltips and events read the frame. The **scene** is geometry for drawing and may be simplified (F5); nothing reads values back from it. The first draft derived accessibility from the scene, and two reviewers showed that a simplified drawing cannot return the samples it dropped.

| Stage | Output | Notes |
|---|---|---|
| normalize | Frame, diagnostics | The only place raw input is read. Never coerces silently. |
| view model | Scales, visible index ranges, series visibility | Domain rules implement F1 and F7. |
| lookup | Nearest-x by binary search; nearest-point by a grid index (scatter) | Works on the frame within the visible range; cost bounded independently of the drawing. |
| layout | Plot rectangle, tick sets, label boxes, legend and control placement | Implements L1, L3, L8. Takes a text-measurement interface as input. |
| scene | Flat list of primitives (`path`, `rect`, `arc`, `rule`, `text`) | Plain data; testable in Node with injected text metrics. |
| renderers | Marks; DOM text; accessibility DOM | See 2.3. |

### 2.2 Invalidation

Stages are cached, and the cache keys are explicit. Caching on object identity alone, as the first draft said, would miss font loads, pixel-ratio changes and in-place mutation.

| Stage | Reruns when |
|---|---|
| normalize | Data revision or field encoding changes. `append` extends the frame without renormalizing earlier rows. |
| view model | Frame revision, zoom, series visibility, author domains. |
| layout | View model; container size; resolved font and text spacing; `document.fonts` finishing a load; locale; any label text. A data-only update reruns layout when the tick labels would change, and skips it otherwise. |
| scene | Layout or view model. |
| mark raster | Scene; device pixel ratio; resolved colors (L4's triggers). |

Text is measured with the page's computed font, letter spacing and word spacing applied to the measuring context, and layout reruns when fonts finish loading. The measurement interface is a parameter, so Node tests inject fixed metrics and browser tests use the real one.

### 2.3 Rendering

**Working assumption: Canvas 2D for marks, HTML for all text.** Text stays in the DOM so that it inherits the page font and color, honors user text spacing and zoom (A6), adapts in forced-colors mode, and can be selected and translated.

**This is reopened and decided in M1 by measurement.** The first draft justified canvas by Phase 1's slow SVG libraries, but those create a node per point; the one-path-per-series SVG chart in the harness was fast. With drawing simplified to a few vertices per pixel column (F5), an SVG path per series is small. SVG follows CSS variables and class-toggled themes with no repaint code, adapts to forced colors, prints sharply, needs no pixel-ratio handling and allocates no backing store (a 1,920×1,080 canvas at pixel ratio 2 is about 33 MB). Canvas is likely cheaper for per-frame redraw when streaming and hovering.

M1 builds both mark renderers behind the same scene and compares them on: P1, P2, P3, P5, bytes, memory, a runtime theme toggle, forced colors, print, and browser zoom. The scene is renderer-neutral either way, so the choice is contained.

**Simplified drawing.** Per device-pixel column and per contiguous run of valid samples, the stroke covers the run's minimum and maximum (F5). One rule for when it applies: more than four visible samples per device-pixel column on average. The pass over visible samples is O(visible) on typed columns and is measured separately from drawing; the vertex count is bounded by width times the number of runs, not by width alone.

**No animation system.** First render is not animated (I5). Updates cut, or tween for at most 200 ms where the cost is negligible, and not at all under reduced motion.

### 2.4 Document structure

```html
<figure class="axylo" id="ax7" role="group" aria-labelledby="ax7-t" aria-describedby="ax7-s">
  <figcaption>
    <h3 id="ax7-t">Daily sessions by channel</h3>        <!-- level from options; or omitted when labelledBy is used -->
    <p id="ax7-s" class="axylo-summary">Line chart, 3 series, …</p>
  </figcaption>
  <div class="axylo-plot" tabindex="0"> … marks … <div class="axylo-text" aria-hidden="true">tick labels</div></div>
  <div class="axylo-toolbar" role="toolbar" aria-label="Chart controls">   <!-- one tab stop, roving focus -->
    legend toggles · zoom in · zoom out · reset · pause · view as table
  </div>
  <p class="axylo-note" role="status">Values not shown: 2. See table.</p>
  <div class="axylo-live" aria-live="polite"></div>
  <div class="axylo-tooltip" hidden></div>
  <div class="axylo-table" hidden><!-- built when opened: caption, headers, pager --></div>
</figure>
```

Ids are generated per chart. The plot's role, and how a focused point is conveyed, are not fixed here: M1 runs a spike with three candidate patterns and M4 confirms the choice (section 4).

Default styles are applied without injecting a `<style>` element, and a standalone stylesheet ships for pages that prefer to load it themselves. Which mechanism passes a strict Content Security Policy is settled by the M7 test with real headers, not assumed.

### 2.5 Repository

```
packages/axylo/        core library (src/, test/)
(packages/react/      @axylo/react: removed from 1.0, see 1.7)
apps/docs/             documentation site; runnable examples are test fixtures
bench/                 benchmark harness (04-plan-performance.md), built in M0
acceptance/            the acceptance matrix and the fixtures it uses
research/              Phase 1 evidence and the ten-library harness
docs/api/              the type-checked API sketch, replaced by generated declarations in M0
```

Tooling: TypeScript strict; ESM output with `.d.ts`, plus IIFE files for `<script>` use; Vitest; fast-check for property tests; Playwright on Chromium, Firefox and WebKit; axe-core; size-limit on the packed distribution; API Extractor so that public API changes fail CI until reviewed; Changesets.

CI runs on Linux, Windows and macOS. Windows runs the browser suite natively on Chromium, Firefox and Edge. Playwright's WebKit build stands in for Safari in CI; real Safari on macOS and iOS is a manual release check, named separately in results.

## 3. Milestones

Each milestone ends with outcomes checked by a command, an example that runs in the docs site, and the documentation page for what was built. Durations are ceilings for one owner working with coding agents, not targets. Every milestone from M1 on re-runs the acceptance matrix, the size report and the benchmark smoke set, and records the results.

### M0. Foundations (ceiling: 5 days)

- Repository, build, test runners, CI matrix.
- Public declarations generated from source; the examples file compiles against them in CI.
- The acceptance matrix as data, every row "not yet", with applicability decided per chart type.
- The benchmark harness from the performance plan, section 3: readiness markers, main-thread accounting, the reference-machine record, and adapters for uPlot and Chart.js. It measures those two before any Axylo code exists.

Outcomes: `npm test` and `npm run build` pass on three operating systems; the API report is committed; the benchmark harness reproduces a uPlot and a Chart.js measurement with a recorded noise band.

### M1. A vertical slice, and the two open decisions (ceiling: 12 days)

- `line()` from rows and from typed columns: normalization with provenance, linear, time and date scales, DOM tick labels, resize, light and dark, `destroy`.
- A minimal tooltip and one keyboard path, enough to exercise lookup and focus end to end.
- **Renderer comparison:** the mark renderer built twice (Canvas 2D and SVG paths) behind the same scene, measured as in 2.3.
- **Screen-reader pattern spike:** three candidates on the `trend` chart (application region with a live region; a roving labelled proxy; an adjustable control with value text), rehearsed on the five reader and browser pairs.
- First measurements of P1, P2 and P5 with the accessibility layer present.

Outcomes:
- `trend` renders in three engines at 720 and 340 px; scene snapshot; resize in both directions with no call from the page.
- 1,000 create–destroy cycles show no heap growth trend and no remaining listeners or observers.
- Two written decision records, each with its measurements: the renderer, and the plot's interaction pattern. Each says what was observed and what was inferred.
- Provisional budgets P1, P2, P5 and the size targets are recalibrated from the slice and recorded.

Example: "Line chart from an API response". Docs: Getting started, Data and fields.

### M2. Faithful data, on the line chart (ceiling: 8 days)

- The diagnostic registry (F3, F12); missing values and absent steps (F2); the three temporal types (F4); formatting (F6); domains (F7); sorting and duplicates (F11); `validate()`.

Outcomes:
- One test per diagnostic code; the combined and one-bad-value dirty fixtures yield exactly the codes in the spec.
- F4's four fixture variants in three zones, plus DST and leap-day cases.
- Property tests: no scene path contains a non-finite coordinate; no segment crosses a missing index; domains obey F7.
- A production build given `dirty` shows the reader's note.

Example: "What Axylo tells you about your data". Docs: Diagnostics reference, one page per code; Dates and time zones.

### M3. Reading the chart (ceiling: 10 days)

- Title, `labelledBy`, subtitle, axis titles; toolbar with legend toggles; full tooltip and fixed readout (I1); label fitting (L1) and the too-small fallback (L8); states (L7); reference lines and bands.
- React adapter prototype, used to test the commit contract (1.5, 1.7).

Outcomes:
- L1's property test in three engines, including text-spacing overrides and a late-loading font, on a category-axis line chart with long labels.
- Tooltip tests at the edges, with sparse series, and in a narrow tile.
- `empty`, loading, error and internal-error states visible and in the accessibility tree, each announced once.
- Adapter tests: prop removal, handler replacement, inline field objects, StrictMode (written and passing at commit dac5664; removed with the adapter).

Example: "A dashboard tile with a target line and an empty state". Docs: Titles and labels, Tooltip, Legend, States.

### M4. Accessibility, complete on the line chart (ceiling: 10 days)

- The pattern chosen in M1, built fully: names and summary (A1), keyboard (A2), point text (A3), table with paging (A4), non-color cues (A5), reflow (A6), streaming behavior (A7), messages and language (A10); single-pointer zoom controls (I3, I4); reduced motion on update (I5).

Outcomes:
- Tab-order tests in collapsed, zoomed and table-open states; accessibility-tree snapshot after each key.
- axe-core clean on every fixture and state (A8).
- A 24-chart page: unique ids, no layout shift when one table opens, total tab stops recorded.
- The rehearsal script run and recorded on the five pairs, separating what was heard from what was inferred.
- The first conformance table (A9), with every listed test existing.

Example: "Exploring a chart with the keyboard". Docs: Accessibility: what is automatic, what the author supplies, the rehearsal record and its limits.

### M5. Bar, area, donut, scatter and the compact variant (ceiling: 18 days)

Each type is done when its column of the type matrix (spec 3.6) and every applicable row of the acceptance matrix pass, including the accessibility and performance rows. Types are finished one at a time, in this order: bar, area, donut, the compact variant, scatter.

Outcomes:
- `bars` fixture: starts at zero, long label handled by L1's remedies, missing bar distinct from zero.
- Stacked area and bar: mixed signs, incomplete stacks, simplified drawing on cumulative sums.
- `parts` fixture: legend carries values and percentages; ninth slice, zero slice, negative slice and all-zero cases.
- Palette scored on rendered marks, repeats included, in both schemes; grayscale identification test.
- Compact variant: criteria C1–C5; a page of 40 adds no tab stops and meets P8.
- Scatter: picking, ties, coincident points and a clustered-data benchmark.

Examples: one per type and variant. Docs: one page per type; Color.

### M6. Updates and scale (ceiling: 10 days)

- `update`, `append` and `zoom` under the full commit contract; pause; simplified drawing complete; zoom by drag, buttons, keyboard and opt-in touch.

Outcomes:
- Sequence tests from DX5.
- F5's assertions on kept samples, including the adversarial same-column cases.
- A value near row 900,000 of 1,000,000 that the drawing dropped is reachable by keyboard, tooltip and table.
- Budgets P1–P5 and P7 measured with the Phase 3 method, recalibrated once if M1's provisional values were wrong, then frozen with a written reason for each.

Examples: "Live metrics", "A million points". Docs: Updating, Large data, Zoom.

### M7. Distribution and documentation (ceiling: 8 days)

- Script-tag builds; documentation site; migration notes from Chart.js and Recharts. (No framework adapter in 1.0.)

Outcomes:
- The packed tarball installed into two clean fixtures (npm with a bundler, script tag): the first chart works in ten lines or fewer in each (DX1).
- Node import and `validate()` without a DOM; strict CSP with real headers (DX8).
- Size measured on the packed distribution for line-only, full and script-tag cases, CSS included (DX7).
- Every runnable docs example compiled and rendered from the packed distribution (DX10).
- The agent rehearsal (DX12), recorded as rehearsal.

### M8. Release (ceiling: 10 days)

- Beta under a `next` tag; issues from real use fixed; API frozen through the API report.
- The Phase 1 comparison regenerated with Axylo beside the ten libraries, with the same harness and the corrections from the review, and published with its limits.
- Real Safari on macOS and iOS checked by hand.
- Independent review of the acceptance evidence before 1.0 is tagged, by a reviewer who did not write the code under review.

Outcomes: every acceptance-matrix row is pass or not applicable with a reason; changelog, upgrade policy and third-party notices published.

Publishing to npm, tagging and pushing are separate, explicit decisions by the owner at this point; the plan does not assume them.

## 4. Test strategy

| Layer | Tool | What it proves |
|---|---|---|
| Unit | Vitest | Scales, ticks, formatting, parsing, simplification. |
| Property | fast-check | Invariants that must hold for any data: F1, F2, F5, F7, F11, L1. |
| Scene snapshot | Vitest, injected text metrics | Geometry and text for each fixture and width, without a browser. |
| Browser | Playwright on three engines | Real text boxes, resize, pointer, touch, keyboard, time zones, color schemes, reduced motion, fonts loading late. |
| Accessibility | axe-core, accessibility-tree snapshots, keyboard scripts, recorded rehearsal | A1–A10. |
| Visual | Screenshots per operating system | What the scene cannot see: antialiasing, state leaks. |
| Types | `docs/api/examples.ts` pattern | The listed mistakes fail to compile (DX3). |
| Packed distribution | Clean install fixtures | What users actually get (DX1, DX7, DX8, DX10). |
| Acceptance matrix | Data file plus a checker | Every criterion has a test that exists and a current result; stale criterion IDs fail CI. |

Expected values are derived from the spec and the fixture data, never from the implementation's output. A failing test is fixed in the code or escalated as a spec question, never by editing the expected value to match.

## 5. Risks

| Risk | Mitigation |
|---|---|
| The interaction pattern that works in one screen reader fails in another. | Three candidates rehearsed on five pairs in M1, before any of the surrounding DOM is built. Plot roles are internal and can change in a minor release. |
| DOM text costs too much with many charts on a page. | P5 is measured in M1. A fallback to canvas-drawn tick labels would give up user text spacing and forced-colors adaptation for those labels, so it must pass the same L1 and A6 tests before it is allowed. |
| Size targets and features conflict. | Measured from M1; each milestone records its byte cost. Accessibility is not what gets cut; chart types are. |
| The million-point budget cannot be met with exact lookup and gap-preserving simplification. | The headline claim is already limited to measured workloads (spec, section 1). If P2 fails after tuning, the budget is changed in the spec with the measurements, not hidden. |
| Layout promises collide in small tiles. | L8 defines the fallback; the property test covers down to 240 px. |
| One person cannot hand-check real Safari, iOS, Android and Windows screen readers at every milestone. | Automated checks at every milestone; the manual rehearsal at M1, M4 and M8 only, recorded with dates and versions. Device access is a named dependency of those three milestones. |
| Scope growth through chart-type requests. | Section 6. |

## 6. What waits until after 1.0

| Item | Why it can wait |
|---|---|
| More chart types (histogram, heatmap, box plot, candlestick, radar, treemap, sankey, gauge, maps) | Each must pass the full acceptance matrix. Histogram is first in line. |
| Log and other non-linear scales | Need their own rules for zero and negative values. |
| Second y axis | Often misleading; needs a design that keeps F1. |
| Annotations beyond reference lines and bands | Text placement interacts with L1. |
| Linked charts (shared cursor, brush) | Needs a small coordination API. |
| Export (PNG, SVG, CSV), print styling | CSV from the table is the first step. |
| Server-side rendering to SVG | The scene makes it possible. |
| Right-to-left layout mirroring | Stated as a limit in 1.0. |
| Calendar periods beyond year and month (quarters, ISO weeks) | Treated as categories in 1.0. |
| Nested field paths | Flatten rows before passing them. |
| Vue, Svelte, Angular adapters and a custom element | Thin wrappers over the same handle. |
| Public plugin or custom-mark API | After two real uses show its shape. |
| Translations of built-in messages | `messages` makes them possible in 1.0; only English ships. |
| Workers, WebGL or WebGPU, Rust | Decided from measurements (04-plan-performance.md). |
