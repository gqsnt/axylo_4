# Migrating from Recharts

After this page you can translate a Recharts chart into an `@axylo/react` component for three everyday tasks, map Recharts concepts to Axylo's, and know what Axylo deliberately does differently or does not have.

The Recharts code on this page is quoted, not retyped, from the configurations used in this project's comparison of ten charting libraries (`research/harness/src/libs/recharts.jsx`, Phase 1). They were written against **Recharts 3.11.0** with **React 19.3.1** (`research/harness/package.json`, and the installed `research/harness/node_modules/recharts/package.json`). Each is the configuration used in that comparison, not offered as the only or the shortest way to write it. The `mount` helper (`research/harness/src/libs/_react.jsx`) renders the element into the harness's container. The comparison used Recharts without a theme and supplied series colours itself; Recharts 3.11.0 also ships opt-in light and dark themes with their own palettes (`es6/theme/lightTheme.js`, `darkTheme.js`), which the comparison did not use. The Axylo versions run live on this page, on the same data, from the shared fixture `examples/_phase1-data.ts`, a TypeScript copy of `research/harness/src/data.js`.

Statements about Recharts below say where they were checked: in the harness configuration, in the installed package, by running it, or in the comparison's recorded observations (`docs/01-landscape.md`). Anything else is marked as not checked here.

## A multi-series time line

The comparison's configuration builds one row object per x with one key per series, one `<Line>` per series with its colour, and a tick formatter for its numeric time axis, which otherwise prints epoch numbers (harness comment).

[source: Recharts, task "trend"](../../../research/harness/src/libs/recharts.jsx#L1-L29)

In Axylo one component holds the chart. Long rows with a `series` field replace one `<Line>` per series; wide rows would work too, with `y` as a list. The palette, the legend, the tooltip and the date formatting need no code. The title and the value axis's label are given, as `title` and the `y` field's `label`; `type: 'date'` reads the fixture's UTC-midnight milliseconds as calendar days.

[example: recharts-trend](../examples/recharts-trend.tsx)

## A bar chart with a target line

The comparison's bar configuration has no target line, so only its bars are quoted here. Recharts has a `ReferenceLine` component for that (exported by the installed package, `types/cartesian/ReferenceLine.d.ts`); it was not configured or run here.

[source: Recharts, task "bars"](../../../research/harness/src/libs/recharts.jsx#L31-L46)

In Axylo the target is the `reference` prop, labelled, included in the value axis and listed in the summary and table caption. The long label is fitted rather than left out; at the comparison's width, Recharts removed that label and left a bar with no name (observed, `docs/01-landscape.md`, finding R2).

[example: recharts-target](../examples/recharts-target.tsx)

## A live-updating series

The comparison's Recharts stream renders again with a new array for every point:

[source: Recharts, tasks "scale" and "stream"](../../../research/harness/src/libs/recharts.jsx#L81-L93)

With `@axylo/react` the first rows are state, created once, and new points go through the handle with `append`. The reader gets a Pause control.

[example: recharts-stream](../examples/recharts-stream.tsx)

Rendering again with a new `data` array works too, and is the right thing when the whole data changes; for a stream it makes the chart read every row again.

## Concepts side by side

| Recharts | `@axylo/react` | Recharts side checked against |
|---|---|---|
| `<LineChart data>` with `<XAxis>`, `<YAxis>`, `<CartesianGrid>`, `<Tooltip>`, `<Legend>` and one `<Line>` per series | One `<Line data x y series />`. Axes, grid, tooltip and legend are on by default. | Harness |
| `<ResponsiveContainer>` | Nothing: the chart takes its container's size. | Harness |
| `dataKey` per series | Long rows with `series`, or `y={['direct', 'organic']}` for wide rows. | Harness |
| `stroke`, `fill`, `<Cell fill>` | The default palette, CSS custom properties, or `colors` by series key. See [Theming](theming.md). | Harness |
| `<XAxis type="number" scale="time" tickFormatter>` | Nothing for date strings; `type: 'time'` or `type: 'date'` on `x` for numbers. Dates and numbers are formatted for the page's locale. | Harness |
| `<YAxis label>` | `label` and `unit` on the `y` field. | Harness |
| No chart title component | `title`, which is also the accessible name. | Installed package: no `Title` export in `types/index.d.ts` |
| `<ReferenceLine y>`, `<ReferenceArea>` | `reference={[{ y, label }]}`, or `{ x: [from, to], label }`. | Installed package (`types/cartesian/`) |
| `<Bar>` with `stackId` | `layout="stacked"` on `<Bar>`; `stacked` on `<Area>`. | Installed package (`types/cartesian/Bar.d.ts`) |
| `layout="vertical"` on `<BarChart>` | `horizontal` on `<Bar>`. | Installed package (`layout` prop) |
| `<Pie innerRadius>` | `<Donut label value />`. | Installed package (`types/polar/Pie.d.ts`) |
| `isAnimationActive={false}` | Nothing: the first render is never animated. | Harness (tuned) |
| `dot={false}` | Nothing: markers appear on every point only when points are sparse; a dense line keeps markers at its end, at intervals and on isolated points. | Harness (tuned) |
| `onClick`, `onMouseMove` on the chart | `onSelect`, `onHover`. | Installed package (`types/chart/types.d.ts`) |
| Render again with a new array to stream | `ref` and `chart.append(rows, { keep })`. | Harness |

## What is deliberately different

- **One component, one options object.** The same options work outside React with `line()`, so a chart can move between a React page and any other page unchanged.
- **Defaults that are finished.** A palette that works in light and dark pages, labels that fit, formatted numbers and dates, without code. A visible title and a date axis's title are yours to give.
- **Accessible by default, differently.** With its accessibility layer on, which it is by default in the version tested, Recharts gives the chart's surface `role="application"` (`es6/container/RootSurface.js`). Axylo's plot is one native range input with value text, plus a table view; see [Accessibility](accessibility.md). How either reads in a screen reader was not checked here.
- **Bad data is reported.** Recharts' numeric scale reads the string `'40'` as 40: checked by running the d3 linear scale the installed package depends on (`victory-vendor/d3-scale`), and observed in the comparison (finding R5). Axylo leaves a string among numbers out and reports it with its row ([AX106](diagnostics.md#ax106)).
- **No composition API.** No custom shapes, custom tooltip content, label render props or `syncId` for linked charts in 1.0. A chart is configured through options, not assembled from components; a zoom event can drive another chart's `zoom()` (see [Updating](updating.md#on-events)).
- **Fewer chart types.** Line, area, bar, scatter, donut and the compact variant. No radar, radial bar, treemap, funnel or composed charts in 1.0.
