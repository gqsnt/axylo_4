# Migrating from Chart.js

After this page you can translate a Chart.js configuration into Axylo for three everyday tasks, map Chart.js concepts to Axylo's, and know what Axylo deliberately does differently or does not have.

The Chart.js code on this page is quoted, not retyped, from the configurations used in this project's comparison of ten charting libraries (`research/harness/src/libs/chartjs.js`, Phase 1). They were written against **Chart.js 4.6.1** with **chartjs-adapter-date-fns 3.0.0** and **date-fns 4.4.0** (`research/harness/package.json`, and the installed `research/harness/node_modules/chart.js/package.json`). Each is the configuration used in that comparison, with comments marking what was added beyond the data; it is not offered as the only or the shortest way to write it. The Axylo versions run live on this page, on the same data, from the shared fixture `examples/_phase1-data.ts`, a TypeScript copy of `research/harness/src/data.js`.

Statements about Chart.js below say where they were checked: in the harness configuration, by running the installed package, or in the comparison's recorded observations (`docs/01-landscape.md`). Anything else is marked as not checked here.

## A multi-series time line

The comparison's configuration passes parallel arrays (`labels` and one `data` array per dataset), imports a date adapter for its time axis, and sets `maintainAspectRatio: false` to fill a container of fixed height.

[source: Chart.js, task "trend"](../../../research/harness/src/libs/chartjs.js#L1-L16)

In Axylo the same table is rows and field names. The fixture's x values are epoch milliseconds of UTC midnights, which are calendar days: `type: 'date'` reads them that way, so each value shows on its own day in every time zone. In the comparison, Chart.js showed the same values as local instants: in Los Angeles a point of 24 February read "Feb 23, 4:00 p.m." (observed, `docs/01-landscape.md`, finding R3). The gap in "Referral" (seven `null`s) is a gap in both.

[example: migrate-trend](../examples/migrate-trend.ts)

## A bar chart with a target line

The comparison's bar configuration has no target line, so only its bars are quoted here. Chart.js has no reference line in its core package; a target is commonly drawn with the separate `chartjs-plugin-annotation` package, or with a second dataset of `type: 'line'`. Neither is installed or configured in the harness, so neither was checked here.

[source: Chart.js, task "bars"](../../../research/harness/src/libs/chartjs.js#L18-L25)

In Axylo the target is one option, `reference`: it is labelled, included in the value axis, and listed in the chart's summary and table caption. In the comparison both libraries started these bars at zero; in Axylo a bar or area axis always includes zero. The long label "Customer Success & Onboarding" is fitted by Axylo's remedies (wrapping, then rotating, then truncating with the full text in tooltip and table). At the comparison's width Chart.js rotated all labels, and they stayed readable (observed, finding R2).

[example: migrate-target](../examples/migrate-target.ts)

## A live-updating series

The comparison's stream task mutates the Chart.js arrays, pushing one point and dropping the oldest, then calls `update()`:

[source: Chart.js, tasks "scale" and "stream"](../../../research/harness/src/libs/chartjs.js#L45-L62)

In Axylo, `append` adds rows and `keep` bounds the window. The reader gets a Pause control, the view follows the newest data while it is zoomed to the latest edge, and arriving data is not announced.

[example: migrate-stream](../examples/migrate-stream.ts)

The comparison also used a tuned Chart.js configuration for large data (`chartjs-tuned.js`): a different data shape (`{ x, y }` objects) with `parsing: false`, the decimation plugin, no animation and no point markers. Axylo has no such options: typed columns are an optional input shape, and dense lines are drawn simplified by default.

## Concepts side by side

| Chart.js | Axylo | Chart.js side checked against |
|---|---|---|
| `new Chart(canvas, { type: 'line', … })` | `line(target, options)`: one function per chart type; `target` is a CSS selector or an `HTMLElement`, not a canvas. | Harness |
| `data.labels` and `datasets[].data` | `data` as rows, wide rows or typed columns, and field names: `x`, `y`, `series`. See [Your data](data.md). | Harness |
| `datasets[].label` | The `series` field's values, or `label` on each `y` field. | Harness |
| `options.plugins.title` | `title` (also the accessible name). | Harness |
| `scales.x.type: 'time'` and a date adapter | Nothing for date strings; `type: 'time'` for epoch milliseconds that are instants, `type: 'date'` for calendar days. No adapter. | Harness |
| `scales.y.title` | `label` and `unit` on the `y` field. | Harness |
| `maintainAspectRatio`, `responsive`, canvas size | Nothing: the chart takes its container's size. | Harness (`maintainAspectRatio`) |
| `scales.y.beginAtZero` | Bars and areas always include zero; lines fit the data. | Installed types (`research/harness/node_modules/chart.js/dist/types/index.d.ts`) |
| `spanGaps` | No equivalent: a gap your data marks is never bridged. `missing: 'zero'` for counts. | Installed types |
| `backgroundColor`, `borderColor` | The default palette, CSS custom properties, or `colors` by series key. See [Theming](theming.md). | Installed types |
| `plugins.legend.position` | `legend: 'top' \| 'right' \| 'bottom' \| false`. | Installed types |
| `plugins.tooltip` (`mode`, `intersect`) | On by default, picking by the chart type's rule; `tooltip: false` turns it off. | Installed types; in the comparison, Chart.js showed nothing between points by default (finding R15) |
| `chartjs-plugin-annotation` | `reference: [{ y, label }]` or `{ x: [from, to], label }`. | Not checked here: the plugin is not installed |
| Mutate `chart.data`, then `chart.update()` | `chart.update(patch)` for options and data, `chart.append(rows, { keep })` for new rows. | Harness |
| `onClick`, `onHover` | `chart.on('select', …)`, `chart.on('hover', …)`. | Installed types |
| `animation` | No option: the first render is never animated. | Harness (tuned) |
| `parsing: false`, decimation | No options: see above. | Harness (tuned) |
| `chart.destroy()` | `chart.destroy()`. | Harness |

## What is deliberately different

- **Accessible without work.** In the comparison a Chart.js chart was one canvas with no accessible name (finding R11). An Axylo chart exposes a name, a summary, the value of the point in keyboard focus and a table view, with no option. See [Accessibility](accessibility.md) for what has and has not been verified.
- **Bad data is reported.** Chart.js reads the string `'40'` as the number 40, and plots it without comment: checked by running the installed `LinearScale.parse('40')`, which returns 40. Axylo leaves a string among numbers out, tells the reader, and prints a diagnostic with the field and row ([AX106](diagnostics.md#ax106)).
- **Time zones are named.** Instants are shown in a zone that the tooltip heading and the summary name, and calendar dates are not shifted.
- **Fewer chart types.** Line, area, bar, scatter, donut and the compact variant. No radar, polar area, bubble or mixed charts in 1.0.
- **Less to configure.** No plugin API, no per-point styles, no custom tooltip renderer, no animation settings, no log scale or second y axis in 1.0.
- **Your data is not watched.** Changing an array in place is not seen; call `update` or `append`. Do not change a typed column after passing it.
