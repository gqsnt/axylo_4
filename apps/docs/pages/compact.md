# Compact charts

After this page you can put a sparkline in a KPI tile with `compact: true`, know what it shows and leaves out, and give it a text alternative.

## When to use it

`compact: true` on a line, area or bar chart draws the marks and nothing else: no axes, gridlines, legend, toolbar, table control, zoom, tooltip or reference lines. It is for a small tile where the page already shows the number and its label, and the chart only says which way it is going.

[example: compact-tiles](../examples/compact-tiles.html)

A compact chart does not give access to every value; its summary is the alternative. When the reader needs every value, use the full chart.

## What a compact chart is

| Behaviour | Compact |
|---|---|
| For assistive technology | An image (`role="img"`) with an accessible name and the generated summary as its description: series, x range, minimum, maximum, last value, any values left out, and for stacks the positions where a part is missing (named up to three, counted beyond). |
| Name | `labelledBy` with the tile heading's id (the heading is usually already there), or `title`. In a compact chart the title is not shown; it is the accessible name. Without either, the name is generated and [AX140](diagnostics.md#ax140) is raised. |
| Keyboard and pointer | No tab stop and no pointer behaviour, so nothing is available to a mouse that is not available to a keyboard. A page of forty tiles adds no tab stops. |
| Size | Fills its container from 24 × 16 px up. With no height set, it is 32 px tall. |
| Several series | Allowed, told apart by dash (lines) or fill pattern (bars) as well as colour, since there is no legend. Bars side by side always differ by pattern: the first series is plain, the next ones take diagonal lines, crosses and dots in turn, and colour and pattern together give 32 combinations before one repeats. Hint [AX131](diagnostics.md#ax131) suggests one series per tile. |
| Fidelity | The rules of the full charts still hold: zero in the value axis for bar and area, gaps for missing values, diagnostics, simplified drawing of dense lines, sorting by x, no motion, and light or dark from the page. |

## Options

`compact` takes the options of its chart type ([line](line.md#options), [area](area.md#options), [bar](bar.md#options)). `zoom`, `legend`, `tooltip` and `table` have no effect on a compact chart, since it has no controls. Three things do not apply and are reported as such ([AX150](diagnostics.md#ax150)): `reference`, since a compact chart draws no references (so a reference far from the data cannot flatten the sparkline); a `tickFormat` on `x` or `y`, since it draws no axes; and a `chart.zoom()` call, which changes nothing and is not kept for later. Scatter and donut have no compact form: on them `compact` is a type error.

## Edge case: a value left out

When values were left out, the description says so and a small marker in the corner of the chart carries the same text as a tooltip.

[example: compact-dirty](../examples/compact-dirty.html)
