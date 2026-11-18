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
| `y` | One value field. A list of fields is not accepted ([AX150](diagnostics.md#ax150) at run time). |
| `series` | Optional. The field that names each point's group. |
| `zoom` | Along x only in 1.0. |
| `reference` | Lines and bands, as on a line chart. |
| Common options | `title`, `labelledBy`, `subtitle`, `description`, `state`, `legend`, `tooltip`, `table`, `colors`, `messages`, `locale`, `strict`, `onDiagnostic`. |

Not on a scatter chart, and a type error if given: `compact` (a sparkline of points says nothing a tile can use), `stacked`, `layout`, `horizontal`, `label` and `value`.

## How a scatter chart behaves

| Behaviour | Scatter |
|---|---|
| Pointer | The nearest point within 24 px; when two are equally near, the later row wins. The tooltip shows the point's series, x and y, and lists coincident points, up to eight. |
| Keyboard | By x, then y, through every visible point. |
| Zoom | x only in 1.0; both axes later. |
| Many points | Not simplified in 1.0. Above 50,000 points every point is still drawn, with hint [AX133](diagnostics.md#ax133). |
| Duplicates | Points that share an x, or both coordinates, are ordinary data. |
| Limit | Eight series, then [AX130](diagnostics.md#ax130). |
| Reference lines and bands | Drawn and included in the domain. |

## Edge case: points on top of each other

Whole-number ratings put many reviews on the same spot. They are all kept: the tooltip lists the coincident points, and the keyboard visits each one in turn.

[example: scatter-ties](../examples/scatter-ties.ts)
