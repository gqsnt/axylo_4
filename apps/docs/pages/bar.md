# Bar charts

After this page you know when to use a bar chart, how to group, stack and turn bars horizontal, and what Axylo does with long labels, missing bars and negative values.

## When to use it

Bars compare categories: satisfaction by team, tickets by product area, orders per region. A bar's length is its value, so the value axis always starts at zero. Bars over a date axis compare counts per period (orders per day).

Use a [line chart](line.md) to show a trend over many points, and a [donut](donut.md) only for the shares of one whole.

[example: bar-target](../examples/bar-target.ts)

## Options

```ts
import { bar } from 'axylo';
bar(target, { data, x, y, series, layout: 'grouped', horizontal: false, ...options });
```

| Option | On a bar chart |
|---|---|
| `x` | The categories (or dates, numbers). Categories keep the order of the data. `ordered: true` says they have a natural order (months, age bands), which allows thinning their labels. |
| `y`, `series` | One value field with `series`, or a list of fields. Several series make groups. |
| `layout` | `'grouped'` (default) puts the series side by side; `'stacked'` stacks them. |
| `horizontal` | `true` draws the bars from the left, with the categories down the side. Default: `false`. |
| `zoom` | On date, time and number x only. A category axis is not zoomable. |
| `reference`, `compact` | As on a line chart. |
| `domain` on `y` | Widened to include zero, with [AX110](diagnostics.md#ax110). |
| Common options | `title`, `labelledBy`, `subtitle`, `description`, `state`, `legend`, `tooltip`, `table`, `colors`, `messages`, `locale`, `strict`, `onDiagnostic`. |

Not on a bar chart: `stacked` (that is `layout: 'stacked'` here), `label` and `value` (donut only).

## How a bar chart behaves

| Behaviour | Bar |
|---|---|
| Pointer | The band under the pointer: the whole category, not only the bar. The tooltip lists every series in that category. |
| Keyboard | By category, then series. |
| Zoom | Only on date, time and number x. |
| Baseline | Always zero. An author `domain` without zero is widened ([AX110](diagnostics.md#ax110)). |
| Missing values | A missing bar gets a small "no data" mark at the baseline, distinct from a zero bar. |
| Stacking | Positive parts stack up from zero, negative parts down from it; the axis covers both totals. A missing part has zero height and marks its stack "incomplete". |
| Long labels | Remedies in order: thinning (date, number and `ordered` category axes only), wrapping to three lines, rotating up to 45°, truncating in the middle with the full text in tooltip and table. If labels still do not fit, the chart says "Some labels hidden. See table." and [AX143](diagnostics.md#ax143) suggests `horizontal: true`. Axylo never switches orientation by itself: that would change what the chart says at a glance. |
| Many bars | Not simplified. More bars than pixels along the axis are drawn, with hint [AX132](diagnostics.md#ax132). |
| Limit | Eight series, then [AX130](diagnostics.md#ax130). |
| Reference lines | Drawn and labelled, included in the domain, listed in the summary and table caption. |

## Horizontal and grouped bars

Long category names read best down the side. With two value fields the bars are grouped, and a missing value is a "no data" mark, not an empty slot that looks like zero.

[example: bar-horizontal](../examples/bar-horizontal.ts)

## Edge case: stacks with both signs

[example: bar-stacked](../examples/bar-stacked.ts)
