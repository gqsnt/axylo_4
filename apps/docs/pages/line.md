# Line charts

After this page you know when to use a line chart, which options it takes, and how a line is picked, read by keyboard, zoomed and simplified.

## When to use it

A line shows how a measure changed along an ordered x: sessions per day, latency per minute, revenue per month. Several series compare trends. The x can be calendar dates, instants, wall-clock times, numbers or categories.

Use a [bar chart](bar.md) to compare a few categories, an [area chart](area.md) when the total and its parts matter, and a [compact line](compact.md) for a sparkline in a KPI tile.

[example: line-time](../examples/line-time.ts)

## Options

```ts
import { line } from 'axylo';
line(target, { data, x, y, series, ...options });
```

| Option | On a line chart |
|---|---|
| `x` | Dates, instants, wall-clock times, numbers or categories. See [the three kinds of time](data.md#three-kinds-of-time). |
| `y` | One value field with `series` (long rows), or a list of fields (wide rows). |
| `series` | The field that names each row's series, for long rows. |
| `zoom` | On by default for date, time and number x. `'touch'` also takes pinch and two-finger pan. |
| `reference` | Lines and bands: `{ y: 500, label: 'Objective' }`, `{ x: [from, to], label: 'Incident' }`. |
| `compact` | Marks only, for a tile. See [Compact](compact.md). |
| Common options | `title`, `labelledBy`, `subtitle`, `description`, `state`, `legend`, `tooltip`, `table`, `colors`, `messages`, `locale`, `strict`, `onDiagnostic`. |

Not on a line chart, and a type error if given: `stacked` (stacking lines hides how each part moves; a stacked area shows it), `layout` and `horizontal` (bars only), `label` and `value` (donut only). At run time an option that does not apply is ignored with [AX150](diagnostics.md#ax150). The [options reference](options.md) has every option with its type and default.

## How a line chart behaves

| Behaviour | Line |
|---|---|
| Pointer | The nearest x wins, wherever the pointer is in the plot. The tooltip lists every visible series at that x. A series with no row at that x reads "No observation"; one whose value is missing reads "No data". |
| Keyboard | By x, then series. Left and Right move along x and read every visible series at once; Up and Down narrow to one series and move between series; Escape returns to all series. |
| Zoom | Date, time and number x: Zoom in and Zoom out buttons (Pan left, Pan right and Reset zoom once zoomed), dragging across the plot, the keys `+` `-` `0` and Shift with the arrows, the wheel while the plot has focus, and pinch with `zoom: 'touch'`. Category x is not zoomable in 1.0. |
| Many points | When a line is denser than the screen, the drawing is simplified: in every device-pixel column, each run of valid samples keeps its minimum and maximum, and a gap is always kept. Nothing is smoothed. Tooltip, keyboard and table read the data, not the drawing, so every sample stays reachable. |
| Markers | Each series carries its marker shape at its last point and at sparse intervals, repeated in the legend and tooltip. Every point gets a marker only when points are at least 12 px apart. A point alone between gaps always has one. |
| Limit | Eight series have eight colours. Beyond eight, each series still has its own colour and dash or marker combination, with [AX130](diagnostics.md#ax130). |
| Order and duplicates | Drawn in x order whatever the input order. Two rows for the same x in one series are [AX108](diagnostics.md#ax108), and that series is not drawn. |
| Reference lines and bands | Drawn, labelled beside the line, included in the value domain, and listed in the summary and the table caption. |

The value axis of a line fits the data and need not start at zero, unlike a bar or area.

## Edge case: values that cannot be drawn

Null is a gap without comment. `NaN`, a stray string and an absent field are gaps too, each with its own diagnostic, and the reader is told how many values are not shown. A value alone between gaps is a point.

[example: line-dirty](../examples/line-dirty.ts)
