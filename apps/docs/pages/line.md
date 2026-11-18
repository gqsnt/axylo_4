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

`target` is a CSS selector or an `HTMLElement`; a selector that matches nothing throws an error that names it.

| Option | On a line chart |
|---|---|
| `x` | Dates, instants, wall-clock times, numbers or categories. See [the three kinds of time](data.md#three-kinds-of-time). |
| `y` | One value field (with `series` for long rows, or alone for one series), or a list of fields for wide rows. |
| `series` | For long rows only: the field that names each row's series. A single `y` needs no `series`. |
| `zoom` | On by default for date, time and number x. `'touch'` also takes pinch and two-finger pan. |
| `reference` | Lines and bands: `{ y: 500, label: 'Objective' }`, `{ x: [from, to], label: 'Incident' }`. |
| `compact` | Marks only, for a tile. See [Compact](compact.md). |
| Common options | `title`, `labelledBy`, `subtitle`, `description`, `state`, `legend`, `tooltip`, `table`, `colors`, `messages`, `locale`, `strict`, `onDiagnostic`. |

Not on a line chart, and a type error if given: `stacked` (stacking lines hides how each part moves; a stacked area shows it), `layout` and `horizontal` (bars only), `label` and `value` (donut only). At run time an option that does not apply is ignored with [AX150](diagnostics.md#ax150). The [options reference](options.md) has every option with its type and default.

## How a line chart behaves

| Behaviour | Line |
|---|---|
| Pointer | The nearest x is picked, wherever the pointer is in the plot. The tooltip, placed against the marks at that x, lists every visible series there (up to eight rows, then "+N more"). A series with no row at that x reads "No observation"; one whose value is missing reads "No data". A click pins the tooltip. In a plot smaller than 240 × 140 px the same text is written in a strip under the plot; see [reading values with a pointer](accessibility.md#reading-values-with-a-pointer). |
| Keyboard | By x, then series. Left and Right move along x with every visible series at once; Up and Down narrow to one series and move between series; Escape returns to all series. |
| Zoom | Date, time and number x: the Zoom in and Zoom out buttons (Pan left, Pan right and Reset zoom once zoomed), dragging across the plot or two clicks with Select range, the keys `+` `-` `0` and Shift with the arrows, the wheel while the plot has focus, and pinch with `zoom: 'touch'`. A category axis and a compact chart do not zoom. See [zoom](updating.md#zoom). |
| Many points | When a line is denser than the screen, the drawing is simplified: in every device-pixel column, each run of valid samples keeps its minimum and maximum, and a break between runs is kept. Nothing is smoothed. Tooltip, keyboard and table read the data, not the drawing, so every sample stays reachable. |
| Markers | Each series carries its marker shape at its last point and at sparse intervals, repeated in the legend and tooltip, so a dense line still has some. Every point gets a marker only when neighbouring points are at least 12 px apart. A point alone between gaps always has one. |
| Gaps | A missing value you send (`null`) is a gap. A missing step with no row is a gap only when Axylo can infer it from the series (see [missing values](data.md#missing-values)). |
| Many series | Eight series have eight colours. From the ninth, colours repeat and each series keeps its own combination of colour and dash or marker, with warning [AX130](diagnostics.md#ax130). |
| Order and duplicates | Drawn in x order whatever the input order. Two rows for the same x in one series are [AX108](diagnostics.md#ax108): that series is not drawn, the others are. |
| Reference lines and bands | Drawn and labelled, included in the automatic value domain, and listed in the summary and the table caption. An author `domain` that leaves a reference out keeps it out of the drawing; the summary still lists it. |

The value axis of a line fits the data and need not start at zero, unlike a bar or area.

## Many points

A hundred thousand readings, drawn simplified and read exactly: press End on the plot to reach the last reading, or open the table.

[example: line-dense](../examples/line-dense.ts)

## More than eight series

[example: line-many-series](../examples/line-many-series.ts)

## Edge case: values that cannot be drawn

Null is a gap without comment. `NaN`, a stray string and an absent field are gaps too, each with its own diagnostic, and the reader is told how many values are not shown. A value alone between gaps is a point.

[example: line-dirty](../examples/line-dirty.ts)
