# Scatter charts

After this page you know when to use a scatter chart, which options it takes, and how its points are picked and read by keyboard.

## When to use it

A scatter chart relates two measures: latency against payload size, rating against price. Each row is a point. An optional `series` groups the points by colour and marker.

Its x is a number, an instant or a date, never a category. To compare categories, use a [bar chart](bar.md); to follow one measure over time, a [line](line.md).

[example: scatter-basic](../examples/scatter-basic.ts)

## Options

```ts
import { scatter } from 'axylo';
scatter(target, { data, x, y, series, ...options });
```

| Option | On a scatter chart |
|---|---|
| `x` | A number, time or date field. `type` takes `'number'`, `'time'` or `'date'`; `ordered` does not apply. |
| `y` | One value field. A list of fields is a type error; at run time it is warning [AX150](diagnostics.md#ax150) and the chart shows its error state, since it cannot choose one. |
| `series` | Optional. The field that names each point's group. |
| `zoom` | Along x only in 1.0. |
| `reference` | Lines and bands, as on a line chart. |
| Common options | `title`, `labelledBy`, `subtitle`, `description`, `state`, `legend`, `tooltip`, `table`, `colors`, `messages`, `locale`, `strict`, `onDiagnostic`. |

Not on a scatter chart, and a type error if given: `compact`, `stacked`, `layout`, `horizontal`, `label` and `value`.

## How a scatter chart behaves

| Behaviour | Scatter |
|---|---|
| Pointer | The nearest point within 24 px; when two are equally near, the later row wins. The tooltip shows the point's series, x and y, and lists the points at the same place, up to eight; a click pins it. Empty space selects nothing. See [reading values with a pointer](accessibility.md#reading-values-with-a-pointer). |
| Keyboard | Through every visible point, ordered by x, then y. |
| Zoom | x only in 1.0, the same ways as on a line; both axes later. |
| Many points | Not simplified in 1.0: every visible point is drawn. Above 50,000 points that can be plotted, hint [AX133](diagnostics.md#ax133) says drawing may be slow. |
| Missing y | A row with an x but no y is not a point, but it is still an observation: the table lists it, with "No data". |
| Duplicates | Points that share an x, or both coordinates, are ordinary data. |
| Many series | From the ninth series, warning [AX130](diagnostics.md#ax130); each keeps its own colour and marker combination. |
| Reference lines and bands | Drawn and included in the automatic domain. |

## Edge case: points on top of each other

Whole-number ratings put many reviews on the same spot. They are all kept: the tooltip lists the coincident points, and the keyboard visits each one in turn.

[example: scatter-ties](../examples/scatter-ties.ts)

## Edge case: a row without a y value

Open the table to see the row that has no point.

[example: scatter-missing-y](../examples/scatter-missing-y.ts)
