# Migrating from Recharts

After this page you can translate a Recharts chart into Axylo calls for three everyday tasks, mount them from a React component, map Recharts concepts to Axylo's, and know what Axylo deliberately does differently or does not have.

Axylo 1.0 ships no React adapter (adapters are planned after 1.0). From a React component, create the chart in an effect and destroy it in that effect's cleanup, and call `update()` when its data changes; [using Axylo in a framework](getting-started.md#using-axylo-in-a-framework) has that lifecycle as a runnable example.

The Recharts code on this page is quoted, not retyped, from the configurations used in this project's comparison of ten charting libraries (`research/harness/src/libs/recharts.jsx`, Phase 1). They were written against **Recharts 3.11.0** with **React 19.3.1** (`research/harness/package.json`, and the installed `research/harness/node_modules/recharts/package.json`). Each is the configuration used in that comparison, not offered as the only or the shortest way to write it. The `mount` helper (`research/harness/src/libs/_react.jsx`) renders the element into the harness's container. The comparison used Recharts without a theme and supplied series colours itself; Recharts 3.11.0 also ships opt-in light and dark themes with their own palettes (`es6/theme/lightTheme.js`, `darkTheme.js`), which the comparison did not use. The Axylo versions are the same as on the [Chart.js page](migrate-chartjs.md): plain calls, running live on the same data, from the shared fixture `examples/_phase1-data.ts`, a TypeScript copy of `research/harness/src/data.js`.

Statements about Recharts below say where they were checked: in the harness configuration, in the installed package, by running it, or in the comparison's recorded observations (`docs/01-landscape.md`). Anything else is marked as not checked here.

## A multi-series time line

The comparison's configuration builds one row object per x with one key per series, one `<Line>` per series with its colour, and a tick formatter for its numeric time axis, which otherwise prints epoch numbers (harness comment).

[source: Recharts, task "trend"](../../../research/harness/src/libs/recharts.jsx#L1-L29)

In Axylo one call holds the chart. Long rows with a `series` field replace one `<Line>` per series; wide rows would work too, with `y` as a list. The palette, the legend, the tooltip and the date formatting need no code. The title and the value axis's label are given, as `title` and the `y` field's `label`; `type: 'date'` reads the fixture's UTC-midnight milliseconds as calendar days.

[example: migrate-trend](../examples/migrate-trend.ts)

## A bar chart with a target line

The comparison's bar configuration has no target line, so only its bars are quoted here. Recharts has a `ReferenceLine` component for that (exported by the installed package, `types/cartesian/ReferenceLine.d.ts`); it was not configured or run here.

[source: Recharts, task "bars"](../../../research/harness/src/libs/recharts.jsx#L31-L46)

In Axylo the target is the `reference` option, labelled, included in the value axis and listed in the summary and table caption. The long label is fitted rather than left out; at the comparison's width, Recharts removed that label and left a bar with no name (observed, `docs/01-landscape.md`, finding R2).

[example: migrate-target](../examples/migrate-target.ts)

## A live-updating series

The comparison's Recharts stream renders again with a new array for every point:

[source: Recharts, tasks "scale" and "stream"](../../../research/harness/src/libs/recharts.jsx#L81-L93)

In Axylo the chart is created once and new points go through `append`, so earlier rows are not read again. The reader gets a Pause control. Passing a whole new array with `update({ data })` works too, and is the right thing when the whole data changes.

[example: migrate-stream](../examples/migrate-stream.ts)

## Concepts side by side

| Recharts | Axylo | Recharts side checked against |
|---|---|---|
| `<LineChart data>` with `<XAxis>`, `<YAxis>`, `<CartesianGrid>`, `<Tooltip>`, `<Legend>` and one `<Line>` per series | One `line(target, { data, x, y, series })`. Axes, grid, tooltip and legend are on by default. | Harness |
| `<ResponsiveContainer>` | Nothing: the chart takes its container's size. | Harness |
| `dataKey` per series | Long rows with `series`, or `y: ['direct', 'organic']` for wide rows. | Harness |
| `stroke`, `fill`, `<Cell fill>` | The default palette, CSS custom properties, or `colors` by series key. See [Theming](theming.md). | Harness |
| `<XAxis type="number" scale="time" tickFormatter>` | Nothing for date strings; `type: 'time'` or `type: 'date'` on `x` for numbers. Dates and numbers are formatted for the page's locale. | Harness |
| `<YAxis label>` | `label` and `unit` on the `y` field. | Harness |
| No chart title component | `title`, which is also the accessible name. | Installed package: no `Title` export in `types/index.d.ts` |
| `<ReferenceLine y>`, `<ReferenceArea>` | `reference: [{ y, label }]`, or `{ x: [from, to], label }`. | Installed package (`types/cartesian/`) |
| `<Bar>` with `stackId` | `bar(target, { layout: 'stacked' })`; `area(target, { stacked: true })`. | Installed package (`types/cartesian/Bar.d.ts`) |
| `layout="vertical"` on `<BarChart>` | `horizontal: true` on `bar()`. | Installed package (`layout` prop) |
| `<Pie innerRadius>` | `donut(target, { label, value })`. | Installed package (`types/polar/Pie.d.ts`) |
| `isAnimationActive={false}` | Nothing: the first render is never animated. | Harness (tuned) |
| `dot={false}` | Nothing: markers appear on every point only when points are sparse; a dense line keeps markers at its end, at intervals and on isolated points. | Harness (tuned) |
| `onClick`, `onMouseMove` on the chart | `chart.on('select', …)`, `chart.on('hover', …)`. | Installed package (`types/chart/types.d.ts`) |
| Render again with a new array to stream | `chart.append(rows, { keep })`. | Harness |
| The component's own mount and unmount | Create the chart in an effect, `destroy()` it in the cleanup. | Not checked here: no React code runs on this site |

## What is deliberately different

- **Plain calls, one options object.** A chart is created with a function call, not assembled from components, and the same call works in any page or framework.
- **Defaults that are finished.** A palette that works in light and dark pages, labels that fit, formatted numbers and dates, without code. A visible title and a date axis's title are yours to give.
- **Accessible by default, differently.** With its accessibility layer on, which it is by default in the version tested, Recharts gives the chart's surface `role="application"` (`es6/container/RootSurface.js`). Axylo's plot is one native range input with value text, plus a table view; see [Accessibility](accessibility.md). How either reads in a screen reader was not checked here.
- **Bad data is reported.** Recharts' numeric scale reads the string `'40'` as 40: checked by running the d3 linear scale the installed package depends on (`victory-vendor/d3-scale`), and observed in the comparison (finding R5). Axylo leaves a string among numbers out and reports it with its row ([AX106](diagnostics.md#ax106)).
- **No composition API.** No custom shapes, custom tooltip content, label render props or `syncId` for linked charts in 1.0; a zoom event can drive another chart's `zoom()` (see [Updating](updating.md#on-events)).
- **Fewer chart types.** Line, area, bar, scatter, donut and the compact variant. No radar, radial bar, treemap, funnel or composed charts in 1.0.
