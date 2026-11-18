# Migrating from Recharts

After this page you can translate a Recharts chart into an `@axylo/react` component for the three everyday tasks below, map Recharts concepts to Axylo's, and know what Axylo deliberately does differently or does not have.

The Recharts code on this page is quoted, not retyped, from the configurations used in this project's comparison of ten charting libraries (`research/harness/src/libs/recharts.jsx`). They were written against **Recharts 3.11.0** with **React 19.3.1**, and each is the least configuration that library needed for the task. Recharts has no default palette and no title component, so the comparison used the colours of Recharts' own examples. The `mount` helper renders the element into the harness's container. The Axylo versions run live on this page, on the same data.

## A multi-series time line

Recharts takes one row object per x with one key per series, one `<Line>` per series with its colour, and a tick formatter, because a numeric time axis prints raw epoch numbers without one.

[source: Recharts, task "trend"](../../../research/harness/src/libs/recharts.jsx#L1-L29)

In Axylo one component holds the whole chart. Long rows with a `series` field replace one `<Line>` per series; wide rows would work too, with `y` as a list. The palette, the title, the axis titles, the date formatting, the legend and the tooltip need no code. `type: 'date'` reads the fixture's UTC-midnight milliseconds as calendar days.

[example: recharts-trend](../examples/recharts-trend.tsx)

## A bar chart with a target line

Recharts draws a target with its `ReferenceLine` component; the comparison's configuration did not use it, so only its bars are quoted here:

[source: Recharts, task "bars"](../../../research/harness/src/libs/recharts.jsx#L31-L46)

In Axylo the target is the `reference` prop, labelled, included in the value axis and listed in the summary and table caption. The long label is fitted instead of dropped (in the comparison, Recharts removed that label and left a bar with no name), and the chart is titled.

[example: recharts-target](../examples/recharts-target.tsx)

## A live-updating series

The comparison's Recharts stream re-renders with a new array for every point:

[source: Recharts, tasks "scale" and "stream"](../../../research/harness/src/libs/recharts.jsx#L81-L93)

With `@axylo/react` the first rows are state, created once, and new points go through the handle with `append`, so earlier rows are not read again. The reader gets a Pause control.

[example: recharts-stream](../examples/recharts-stream.tsx)

Re-rendering with a new `data` array works too, and is the right thing when the whole data changes; it is the slower path for a stream.

## Concepts side by side

| Recharts | `@axylo/react` |
|---|---|
| `<LineChart data>` with `<XAxis>`, `<YAxis>`, `<CartesianGrid>`, `<Tooltip>`, `<Legend>` and one `<Line>` per series | One `<Line data x y series />`. Axes, grid, tooltip and legend are on by default. |
| `<ResponsiveContainer>` | Nothing: the chart takes its container's size. |
| `dataKey` per series | Long rows with `series`, or `y={['direct', 'organic']}` for wide rows. |
| `stroke`, `fill`, `<Cell fill>` | The default palette, CSS custom properties, or `colors` by series name. See [Theming](theming.md). |
| `<XAxis type="number" scale="time" tickFormatter>` | Nothing for date strings; `type: 'time'` or `type: 'date'` on `x` for numbers. Dates and numbers are formatted for the page's locale. |
| `<YAxis label>` | `label` and `unit` on the `y` field. |
| No title component | `title`, which is also the accessible name. |
| `<ReferenceLine y>`, `<ReferenceArea>` | `reference={[{ y, label }]}`, or `{ x: [from, to], label }`. |
| `<Bar>` with `stackId` | `layout="stacked"` on `<Bar>`; `stacked` on `<Area>`. |
| `layout="vertical"` on `<BarChart>` | `horizontal` on `<Bar>`. |
| `<Pie innerRadius>` | `<Donut label value />`. |
| `isAnimationActive={false}` | Nothing: the first render is never animated. |
| `dot={false}` | Nothing: markers appear only when points are sparse. |
| `onClick`, `onMouseMove` on the chart | `onSelect`, `onHover`. |
| Re-render with a new array to stream | `ref` and `chart.append(rows, { keep })`. |

## What is deliberately different

- **One component, one options object.** The same options work outside React with `line()`, so a chart can move between a React page and any other page unchanged.
- **Defaults that are finished.** A palette that works in light and dark, a title, labels that fit, formatted numbers and dates, all without code.
- **Accessible by default, differently.** Recharts' keyboard navigation (on by default in the version tested) uses `role="application"`. Axylo's plot is one native range control with a text value, plus a table view; see [Accessibility](accessibility.md).
- **Bad data is reported.** A string among numbers is left out and reported with its row ([AX106](diagnostics.md#ax106)), where Recharts plots `'40'` as 40.
- **No composition API.** No custom shapes, custom tooltip content, label render props or `syncId` for linked charts in 1.0. A chart is configured through options, not assembled from components.
- **Fewer chart types.** Line, area, bar, scatter, donut and the compact variant. No radar, radial bar, treemap, funnel or composed charts in 1.0.
