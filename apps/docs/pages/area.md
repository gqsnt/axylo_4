# Area charts

After this page you know when to use an area chart, how stacking works, and what Axylo does with mixed signs and missing parts.

## When to use it

An area shows a quantity over an ordered x where the filled height is the point: a total and how its parts changed. Stacked, each band is one part. A single unstacked area is a line with its volume filled in.

Use a [line chart](line.md) to compare trends that do not add up, or when the parts cross over and must be read one by one. Overlapping unstacked areas hide each other; stack them or use lines.

[example: area-stacked](../examples/area-stacked.ts)

## Options

```ts
import { area } from 'axylo';
area(target, { data, x, y, series, stacked: true, ...options });
```

| Option | On an area chart |
|---|---|
| `x`, `y`, `series` | As on a [line chart](line.md#options): one `y` (with `series` for long rows), or a list of `y` fields for wide rows. |
| `stacked` | `true` stacks the series. Default: `false`. |
| `zoom`, `reference`, `compact` | As on a line chart. |
| `domain` on `y` | Widened to include zero, with [AX110](diagnostics.md#ax110): an area's height is its value. |
| Common options | `title`, `labelledBy`, `subtitle`, `description`, `state`, `legend`, `tooltip`, `table`, `colors`, `messages`, `locale`, `strict`, `onDiagnostic`. |

Not on an area chart: `layout` and `horizontal` (bars only), `label` and `value` (donut only).

## How an area chart behaves

| Behaviour | Area |
|---|---|
| Pointer | The nearest x, as on a line. The tooltip lists every visible series at that x and, when stacked, the total; a click pins it. |
| Keyboard | By x, then series, as on a line. |
| Zoom | As on a line: date, time and number x; a category axis does not zoom. |
| Baseline | The value axis always includes zero. |
| Stacking | Positive values stack upwards from zero and negative values downwards, each on its own side, and the axis covers both. When every part at an x has the same sign, the total is their sum. When signs are mixed, the top edge is the sum of the positive parts and the bottom edge the sum of the negative parts, and the readout names both ("Total 12 k USD and -7 k USD" in the example below), not their difference. Adjacent bands are separated by at least 1 px of background, so they can be told apart without colour. |
| Many points | Simplified as a line is, on the cumulative sums, so the drawn edges keep every column's extremes. Values come from the data. |
| Many series | As on a line: from the ninth series, warning [AX130](diagnostics.md#ax130). |
| Reference lines and bands | As on a line. |

## Edge case: both signs in one stack

[example: area-mixed](../examples/area-mixed.ts)

## Edge case: a missing part of a stack

When one series has no value at an x, its band there has zero height, so the bands above it do not fall into the gap. The total at that x is marked "incomplete" in the tooltip, the table and announcements, because it is not the whole.

[example: area-incomplete](../examples/area-incomplete.ts)
