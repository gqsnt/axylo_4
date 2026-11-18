# Migrating from Chart.js

After this page you can translate a Chart.js configuration into Axylo for the three everyday tasks below, map Chart.js concepts to Axylo's, and know what Axylo deliberately does differently or does not have.

The Chart.js code on this page is quoted, not retyped, from the configurations used in this project's comparison of ten charting libraries (`research/harness/src/libs/chartjs.js`). They were written against **Chart.js 4.6.1** with **chartjs-adapter-date-fns 3.0.0** and **date-fns 4.4.0**, and each is the least configuration that library needed for the task; comments mark what was required beyond the data. The Axylo versions run live on this page, on the same data.

## A multi-series time line

Chart.js takes parallel arrays (`labels` and one `data` array per dataset), needs a date adapter before a time axis works, and needs `maintainAspectRatio: false` to fill a container of fixed height.

[source: Chart.js, task "trend"](../../../research/harness/src/libs/chartjs.js#L1-L16)

In Axylo the same table is rows and field names. The fixture's x values are epoch milliseconds of UTC midnights, which are calendar days: `type: 'date'` reads them that way, so each value shows on its own day in every time zone. Chart.js shows the same values as local instants, which west of UTC puts every point on the day before. The gap in "Referral" (seven `null`s) is a gap in both.

[example: migrate-trend](../examples/migrate-trend.ts)

## A bar chart with a target line

Chart.js has no reference line of its own. The usual ways are the separate `chartjs-plugin-annotation` package, or a second dataset of `type: 'line'` repeating the target. The comparison's configuration has neither, so only its bars are quoted here:

[source: Chart.js, task "bars"](../../../research/harness/src/libs/chartjs.js#L18-L25)

In Axylo the target is one option, `reference`, and it is labelled, included in the value axis, and listed in the chart's summary and table caption. Both libraries start these bars at zero; in Axylo a bar or area axis cannot be made to start elsewhere. The long label "Customer Success & Onboarding" is fitted by Axylo's remedies (wrapping, then rotating, then truncating with the full text in the tooltip and table), where Chart.js rotates all labels.

[example: migrate-target](../examples/migrate-target.ts)

## A live-updating series

Chart.js updates by mutating its arrays and calling `update()`. The comparison's stream task pushes one point and drops the oldest:

[source: Chart.js, tasks "scale" and "stream"](../../../research/harness/src/libs/chartjs.js#L45-L62)

In Axylo, `append` adds rows and `keep` bounds the window. A Pause control appears for the reader, the view follows the newest data while it is zoomed to the latest edge, and arriving data is not announced to screen readers.

[example: migrate-stream](../examples/migrate-stream.ts)

The comparison also has a tuned Chart.js configuration for large data (`chartjs-tuned.js`: no parsing, the decimation plugin, no animation, no point markers). Axylo has no equivalent options: typed columns and the simplified drawing of dense lines are the defaults.

## Concepts side by side

| Chart.js | Axylo |
|---|---|
| `new Chart(canvas, { type: 'line', … })` | `line(target, options)`: one function per chart type; `target` is any element or a selector, not a canvas. |
| `data.labels` and `datasets[].data` | `data` as rows, wide rows or typed columns, and field names: `x`, `y`, `series`. See [Your data](data.md). |
| `datasets[].label` | The `series` field's values, or `label` on each `y` field. |
| `options.plugins.title` | `title` (also the accessible name). |
| `scales.x.type: 'time'` and a date adapter | Nothing for date strings; `type: 'time'` for epoch milliseconds, `type: 'date'` for calendar days. No adapter. |
| `scales.y.title` | `label` and `unit` on the `y` field. |
| `maintainAspectRatio`, `responsive`, canvas size | Nothing: the chart takes its container's size. |
| `scales.y.beginAtZero` | Bars and areas always start at zero; lines fit the data. |
| `spanGaps` | No equivalent: gaps are never bridged. `missing: 'zero'` for counts. |
| `backgroundColor`, `borderColor` | The default palette, CSS custom properties, or `colors` by series name. See [Theming](theming.md). |
| `plugins.legend.position` | `legend: 'top' \| 'right' \| 'bottom' \| false`. |
| `plugins.tooltip` (`mode`, `intersect`) | On by default, nearest x wherever the pointer is; `tooltip: false` turns it off. |
| `chartjs-plugin-annotation` | `reference: [{ y, label }]` or `{ x: [from, to], label }`. |
| Mutate `chart.data`, then `chart.update()` | `chart.update(patch)` for options and data, `chart.append(rows, { keep })` for new rows. |
| `onClick`, `onHover` | `chart.on('select', …)`, `chart.on('hover', …)`. |
| `animation` | No option: the first render is never animated. |
| `parsing: false`, decimation | No options: typed columns and simplified drawing are the defaults. |
| `chart.destroy()` | `chart.destroy()`. |

## What is deliberately different

- **Accessible without work.** A Chart.js chart is a canvas, and making it accessible is left to you. An Axylo chart has a name, a summary, keyboard access and a table view, with no option.
- **Bad data is reported.** Chart.js plots `'40'` among numbers as 40 and says nothing. Axylo leaves it out, tells the reader, and prints a diagnostic with the field and row ([AX106](diagnostics.md#ax106)).
- **Time zones are named.** Instants are shown in a zone that the tooltip heading and the summary name, and calendar dates are not shifted.
- **Fewer chart types.** Line, area, bar, scatter, donut and the compact variant. No radar, polar area, bubble or mixed charts in 1.0.
- **Less to configure.** No plugin API, no per-point styles, no custom tooltip renderer, no animation settings, no log scale or second y axis in 1.0.
- **Your data is not watched.** Changing an array in place is not seen; call `update` or `append`. Typed columns are borrowed and must not be changed in place.
