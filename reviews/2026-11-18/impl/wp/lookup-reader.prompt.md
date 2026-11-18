You are implementing three small modules of Axylo, a browser charting library, in this repository. Other agents are working in the same checkout on other directories at the same time, and some existing modules are being reviewed and corrected while you work.

First read `AGENTS.md` and follow it exactly. Then read:
- `packages/axylo/src/core/contracts.ts`: the fixed interfaces. You implement `Lookup` (with `DatumRef`, `PickTarget`, `DatumText`, `TooltipModel`, `StepDirection`), `TableModel` and `ReaderModel`. You consume `View` (AlignedView, ScatterView, DonutView), `Layout` and its `Projection`, `Formatters`, the SLOT_* states. Read the comments on `DatumRef` (identity, not position), `Lookup` and `TableModel` carefully.
- `packages/axylo/src/public.ts`: `Messages` (every built-in string is a template with {name} placeholders), `Title`, `CommonOptions` (title, labelledBy, subtitle, description, table).
- `docs/02-product-spec.md`: criteria I1, A1, A3, A4, A7, A10, C1, C5, F2, F8, F10, F12, L1, and the type matrix in section 3.6 (picking, tooltip content and keyboard order per chart type).
- `packages/axylo/src/format/index.ts` (`createFormatters`) and `packages/axylo/src/data/` (to build frames in tests). The view types are in the contracts; a `view` module that builds views is being written by another agent right now and may not exist yet: in your tests construct `View` objects by hand, or with a small helper of your own, from frames produced by the data module.

## You own (create and edit only these)
- `packages/axylo/src/lookup/**`
- `packages/axylo/src/reader/**`
- `packages/axylo/src/messages/**`
- `packages/axylo/test/lookup/**`, `packages/axylo/test/reader/**`, `packages/axylo/test/messages/**`

Pure TypeScript that runs in Node. No DOM. No runtime dependencies.

## Module 1: messages (`messages/`)

- `defaultMessages: Messages` in English, one entry per key of the public `Messages` interface, as templates. Examples of the intended wording: `viewAsTable` "View as table"; `noData` "No data"; `noObservation` "No observation"; `valuesNotShown` "{count} values not shown. See table."; `labelsHidden` "Some labels hidden. See table."; `pointOf` "{series}, {x}, {value}. Point {index} of {count}."; `chartName` "{type} chart of {y} by {x}"; `chartSummary` "{type} chart with {seriesCount} series. {xLabel} from {xMin} to {xMax}. {yLabel} from {yMin} to {yMax}."; `seriesSummary` "{series}: minimum {min}, maximum {max}, last {last}."; `timeZoneNote` "Times are shown in {zone}."; `otherSlices` "Other ({count})"; `moreRows` "+{count} more"; `incompleteStack` "incomplete". Write the rest in the same plain style, with singular and plural handled by separate keys only where the interface has them (otherwise word the sentence so a number reads naturally either way).
- `fill(template, values)` replaces {name} placeholders with text (never interpreting the values as templates), and `resolveMessages(overrides)` merges an author's partial overrides over the defaults.

## Module 2: lookup (`lookup/`)

`buildLookup(view, layout, formatters, messages) → Lookup`. It reads values only from the view's frame. Follow the type matrix in spec 3.6.

- **Aligned views (line, area, bar).** `pick`: inside the plot rectangle only. Line and area: the visible slot whose x is nearest the pointer (binary search on the frame's x positions through the projection's inverse; ties go to the later slot). Bar: the band under the pointer (horizontal bars use the y coordinate). Returns `{ kind: 'x', x }`.
  `tooltip`: title = the formatted x; one row per visible series in series order with its formatted value, or the `noObservation` text for SLOT_NO_ROW and the `noData` text for the other non-value states; at most eight rows, `count` = the number before truncation; for stacked views `total` = the formatted sum of the values at that x, followed by the `incompleteStack` text in parentheses when the stack is incomplete there. Hidden series are left out.
  Keyboard order: by x, then by series. `next`/`previous` move along x within the same series, skipping slots where that series has no value; `series-next`/`series-previous` move to the neighbouring visible series at the same x (staying on that x even if that series has no value there, so the reader hears "No data"); `first`/`last` go to the series' first and last value in view; `page-next`/`page-previous` move by a tenth of the visible slots, at least one.
- **Scatter.** `pick`: the nearest visible point within 24 CSS px of the pointer (a uniform grid index built once over the projected visible points, cell size 24 px; do not scan every point per query); ties go to the later source row; `refs` holds that point and those that coincide with it (same pixel within 0.5 px), at most eight, with `count` the full number. `tooltip` rows show series, x and y. Keyboard order: by x then y across all visible series; `series-next`/`series-previous` jump to the nearest point of the next visible series.
- **Donut.** `pick`: the slice whose angular range and ring contain the pointer. `tooltip`: label, value and percentage. Keyboard order: slice order, including slices with no arc.
- `primary(target)`: the datum the keyboard continues from (for an x target: the first visible series that has a value there, else the first visible series).
- `datum(ref)` → `DatumText` with every field filled from the frame and formatters; null if the series or x no longer exists.
- `anchor(ref)`: the rectangle where that datum is drawn (a point for lines and scatter, the bar's rectangle, the slice's bounding box), null when it is outside the visible range or has no drawn mark.
- `count`, `ordinal`: the keyboard-reachable data of the current view and a datum's place among them.
- `resolve(ref)`: the same datum if it still exists in this view's frame; otherwise the next datum of that series at a later x; otherwise the previous one; otherwise null (spec A7).

## Module 3: reader (`reader/`)

`buildReader(input) → ReaderModel`, where input is plain data you define: the view, formatters, resolved messages, the chart type name, title or `labelledBy`, subtitle, the author's description, the diagnostics disclosure (how many values were omitted, how many changed), how many labels layout hid, whether the table is enabled, and whether the chart is compact.

- `name` (spec A1): the title's text; empty when `labelledBy` is set; otherwise generated from the `chartName` template.
- `summary` (spec A1, C1): generated from the templates: chart type and series count; the x range; for instants the time zone sentence; the value range; one sentence per visible series with its minimum, maximum and last value in the current x range (computed from the frame; for a donut, each slice with its value and percentage); references; then the omission sentence when values were left out or changed; then the author's description. The zone and omission sentences are present whenever they apply, whatever the author's description says.
- `note` (spec F12, L1): the `valuesNotShown` text when the disclosure says values were omitted or changed, and the `labelsHidden` text when layout hid labels (both when both apply); null otherwise.
- `table` (spec A4): a lazy `TableModel` over the frame's rows in the current x range: caption = the chart's name; headers = the x label then one per series (hidden series included) with its unit in parentheses; `row(i)` formats one row on demand (x through `formatters.x`, values through `formatters.value`, non-values as their missing text); `pageSize` 100; `pageForX` by binary search. For a donut: one row per original category (grouped categories listed individually) with value and percentage. For scatter: one row per point in x then y order with series, x and y. null when the table is disabled or the chart is compact. Nothing may be materialized for rows that are not asked for: a million-row frame must build its model instantly and `row(999999)` must be O(1) or O(log n).

## Tests (required)

Expected values come from the spec and from the fixtures, not from running your code and copying its output.
- Aligned: nearest-slot picking at exact midpoints (later slot wins) and at both plot edges; picks outside the plot are null; a tooltip over three series where one has SLOT_NO_ROW and one SLOT_NULL reads "No observation" and "No data" in the right rows; nine series give eight rows and `count` 9; a stacked view's total and its incomplete marker; `next` skips a gap, `series-next` stays on the x; `first`, `last`, the page steps; `ordinal` and `count` agree with walking `next` from the start.
- Identity: build two views of the same series, the second with the oldest five x values evicted and five appended. A ref to a surviving datum resolves to itself and `datum` returns the same text; a ref to an evicted datum resolves to the oldest remaining one; `anchor` follows the datum to its new pixel.
- Scatter: picking finds the nearest point within 24 px and nothing beyond; coincident points are all listed (and capped at eight with the right `count`); the later row wins ties; a 200,000-point pick does not scan all points (assert the number of candidate points examined through a counter you expose for tests, or a time bound with a generous margin).
- Donut: picking by angle and radius for the spec's `parts` fixture; a point in the hole or outside the ring picks nothing; keyboard order includes a zero slice.
- Reader: the summary for the `trend`-like fixture names three series and their minimum, maximum and last values (computed by hand in the test); an instants axis adds the zone sentence and a dates axis does not; an author description is appended after the omission sentence, never replacing it; `labelledBy` gives an empty name; no title gives a generated name.
- Table: headers carry units; a value near row 900,000 of a 1,000,000-row frame is returned correctly and quickly; `pageForX` lands on the page holding that x; hidden series still appear; a compact chart has no table.
- Messages: every key of `Messages` has a non-empty default; `fill` does not re-interpret braces inside values; overrides replace single keys.
- fast-check: for any small frame and view, every datum reachable by repeatedly stepping `next` has an `ordinal` equal to its step count, `datum` is non-null for each, and `resolve` of each is itself.

Run `npm run typecheck` and `npm test` from the repository root before you finish. Failures in files you do not own (other agents are mid-change) are not yours: name them and leave them alone.

Finish with the report described in AGENTS.md.
