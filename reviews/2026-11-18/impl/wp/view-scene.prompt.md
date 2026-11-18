You are implementing two modules of Axylo, a browser charting library, in this repository. Other agents are working in the same checkout on other directories at the same time, and some existing modules are being reviewed and corrected while you work.

First read `AGENTS.md` and follow it exactly. Then read:
- `packages/axylo/src/core/contracts.ts`: the fixed interfaces. You produce `View` (AlignedView, ScatterView, DonutView with DonutSlice, StackView, SeriesCue, ResolvedReference) and `Scene` (every Mark type). You consume `Frame` (AlignedFrame, PointFrame, DonutFrame), `Layout` with its `Projection`, the SLOT_* states and the join rule.
- `packages/axylo/src/public.ts`: Reference, the per-chart options (stacked, layout: 'grouped' | 'stacked', horizontal, compact, zoom, domain).
- `docs/02-product-spec.md`: criteria F1, F2, F5, F7, F8, F9, F10, L2, L5, A5, C2, C4 and the type matrix in section 3.6.
- The modules you build on. Use their exported functions; do not modify them; if one is missing something you need, work around it inside your own module and say so in your report:
  - `packages/axylo/src/scale/` (`valueDomain`, `linearScale`, `bandScale`, `timeScale`, tick candidate functions),
  - `packages/axylo/src/simplify/` (`joinRuns`, `simplifyLine`, `buildPath`, `buildPoints`, `simplifyArea`),
  - `packages/axylo/src/data/` (to build frames in your tests from options; `resolveOptions`, `normalize`).

## You own (create and edit only these)
- `packages/axylo/src/view/**`
- `packages/axylo/src/scene/**`
- `packages/axylo/test/view/**`
- `packages/axylo/test/scene/**`

Pure TypeScript that runs in Node. No DOM. No runtime dependencies.

## Module 1: view (`view/`)

`buildView(frame, state, sink) → View`, where `state` is plain data you define: the chart kind ('line' | 'area' | 'bar' | 'scatter' | 'donut'), whether it stacks, `horizontal`, `compact`, hidden series keys, the zoom domain (or null), the author's x domain and value domain if any, the references from the options, and the previous view if there is one (reuse what did not change).

- **Visibility**: `visible[i]` is false for hidden series and for series with `drawable: false`.
- **x**: `xFull` is the extent of the data's x positions widened by the author's x domain; for bars and for category axes it is the full category range. `xDomain` is the zoom domain clamped into `xFull`, or `xFull`. `visibleSlots` are the slots inside `xDomain`; `drawSlots[i]` widens that range for series i to its nearest value on each side that it may be joined to under the join rule (so a line continues to the plot edge), and never further.
- **Stacking** (spec F10), for stacked area and stacked bar: positives accumulate upward from zero and negatives downward, each in series order, over visible series only; a component that is not a value contributes zero height and marks the slot incomplete. Build `StackView` exactly as the contract documents it.
- **Value domain** (spec F1, F7): from the visible data inside `xDomain` (for stacks: the cumulative totals on both sides), the references on the value axis, and the author's domain, through `valueDomain`. `includeZero` is true for bar and area. When `valueDomain` reports the domain was widened to zero, raise AX110 through the sink (level and wording come from the diagnostics module: use `report`/`createDiagnostic` from `packages/axylo/src/diagnostics/` if their signatures fit, else describe what you needed).
- **Cues** (spec A5, F9): series i gets marker shape i mod 8 from the contract's `MarkerShape` list in a fixed order, and a dash pattern: solid for every series in `normal` mode for the first eight series, and distinct dash patterns per series in `contrast` mode. Beyond eight series the `normal` dash also varies so that no two series share both color index (i mod 8) and dash; raise AX130 once. For a compact chart with more than one series, `normal` dashes differ from the second series on (spec C4) and AX131 is raised.
- **References**: resolve `Reference.x` and `Reference.y` (a value or a pair) to axis positions using the frame's x kind (dates and times parsed the same way the data layer parses them: reuse its exported parser if there is one, otherwise accept numbers and `Date` and report the gap).
- **Scatter**: `visiblePoints[i]` by binary search on each series' x.
- **Donut** (spec F8): slices in the given order starting at 12 o'clock, clockwise. A zero value is a slice with no arc; a non-value slot is a slice with `value: null` and no arc. With more than eight entries that have a positive value, keep the seven largest (ties: earlier wins) in their original order and group the rest into one last slice with key `__other__`, label from a `otherLabel(count)` function passed in state, `members` listing them; raise AX121. `ratio` is the share of the total of positive values. If every value is zero or missing, return a view with no arcs and `total` 0 (the caller shows the empty state).

## Module 2: scene (`scene/`)

`buildScene(view, layout, devicePixelRatio) → Scene` for layouts of kind 'plot' and 'compact' (for the other kinds return an empty scene of the right size). Marks are in CSS px, back to front: reference bands, grid, areas, bars, lines, markers, axes and ticks, reference lines.

- **Axes and grid** (full plots only): a rule on each axis edge with role 'axis', a short tick rule per tick with role 'tick', a grid rule per value-axis tick with role 'grid' and the 'grid' paint. Nothing for compact, nothing for a ring.
- **Line**: per visible series, simplify with `simplifyLine` over `drawSlots[i]` and build one `PathMark` (stroke = series paint, width 2, dash from the series cue) plus a `PointMark` for isolated values (always drawn, spec F2).
- **Markers** (spec L5, A5): when adjacent drawn values of a series are at least 12 CSS px apart on average, one marker per value; otherwise sparse identity markers: one at the series' last drawn value and one about every 80 CSS px along the line, at actual data positions, in the series' marker shape. Compact charts get no markers except isolated values.
- **Area**: per visible series one `AreaMark` (opacity 0.25 unstacked, 0.8 stacked) between the zero line (or the stack boundary below) and the series' values (or its stack boundary above), built with `simplifyArea`; adjacent stack bands must share the identical boundary array; plus the series' line on top as for a line chart (stacked: the upper boundary).
- **Bar**: vertical or horizontal; grouped (each band divided among the visible series) or stacked (from `StackView`). One `RectMark` per series with variant 'bar'; values start at the zero line; a slot whose state is not a value gets a rectangle in a second `RectMark` with variant 'missing' at the baseline position where the bar would start (spec F2). Bars are at least 1 CSS px along the band axis. When there are more bars than CSS pixels along the band axis, still draw (the caller raises the hint).
- **Scatter**: per visible series one `PointMark` of its visible points in the series' marker shape, size 6.
- **Donut**: one `ArcMark` with the drawn slices' angles and paints (slice k uses series paint k; the "Other" slice uses the 'muted' token), `gap` 1.
- **References**: a `BandMark` for a pair (opacity 0.12, 'reference' paint) and a `RuleMark` with role 'reference' for a single value, clipped to the plot.
- `Scene.clip` is the layout's plot rectangle.

## Tests (required)

Expected values come from the spec and from arithmetic on the fixtures, not from running your code and copying its output.
- View: zoom clamps into the data; `drawSlots` reaches exactly the nearest joinable value outside the view and stops at a SLOT_NULL or SLOT_GAP; hidden and non-drawable series are not visible and do not affect the value domain; stacks with mixed signs put positives above zero and negatives below with the totals you compute by hand for a small fixture; an incomplete stack is flagged; bar and area domains include zero and AX110 is raised when an author domain excluded it; a 4% maximum on a field declared percent does not jump to 100 while a 94% maximum does; references extend the value domain.
- Donut: order and angles for the spec's `parts` fixture (46.2, 27.5, 14.1, 8.9, 2.1, 1.2: check start and end angles against values you compute); zero and null slices listed without arcs; ten entries give seven plus "Other" with AX121 and the right members; all-zero gives no arcs.
- Cues: twelve series give twelve distinct (color index, normal dash) pairs and AX130; a two-series compact chart differs by dash and raises AX131.
- Scene: for a small line fixture the path's vertices are exactly the projected data points, a null breaks the path with a NaN pair, and a value between two nulls appears as a point; bars start at the projected zero and a missing bar produces a 'missing' rectangle; grouped bars of two series do not overlap and stay inside their band; stacked bars of mixed signs sit on the correct sides of zero; adjacent stacked areas reference the same boundary array (`toBe`); a dense 100,000-point line yields a path with far fewer vertices than points while its vertical extent per column equals the data's (check a sample of columns against the data); a compact scene contains no rules and no markers.
- fast-check: no mark coordinate is non-finite except the documented NaN pen lifts; every rectangle has non-negative width and height; every mark of a clipped role lies within the plot rectangle expanded by its stroke width, except where data lies outside the zoomed domain.

Run `npm run typecheck` and `npm test` from the repository root before you finish. Failures in files you do not own (other agents are mid-change) are not yours: name them and leave them alone.

Finish with the report described in AGENTS.md.
