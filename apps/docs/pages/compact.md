# Compact charts

After this page you can put a sparkline in a KPI tile with `compact: true`, know what it shows and leaves out, and give it a text alternative that a screen-reader user can rely on.

## When to use it

`compact: true` on a line, area or bar chart draws the marks and nothing else: no axes, gridlines, legend, toolbar, table control, zoom or tooltip. It is for a small tile where the page already shows the number and its label, and the chart only says which way it is going.

[example: compact-tiles](../examples/compact-tiles.html)

A compact chart does not give access to every value; its summary is the alternative. When the reader needs every value, use the full chart.

## What a compact chart is

| Behaviour | Compact |
|---|---|
| For assistive technology | A static image (`role="img"`) with an accessible name and the generated summary as its description: series, x range, minimum, maximum, last value, and any values left out. |
| Name | `labelledBy` with the tile heading's id (best: the heading is already there), or `title`. In a compact chart the title is not shown; it is the accessible name. Without either, the name is generated and [AX140](diagnostics.md#ax140) is raised. |
| Keyboard and pointer | No tab stop and no pointer behaviour, so nothing is available to a mouse that is not available to a keyboard. A page of forty tiles adds no tab stops. |
| Size | Fills its container from 24 × 16 px up. With no height set, it is 32 px tall. |
| Several series | Allowed, with lines told apart by dash as well as colour, since there is no legend; hint [AX131](diagnostics.md#ax131) suggests one series per tile. |
| Fidelity | The rules of the full charts still hold: zero baseline for bar and area, gaps for missing values, diagnostics, simplified drawing of dense lines, sorting by x, no motion, and light or dark from the page. |
| Reference lines | Not drawn. |

## Options

`compact` takes the options of its chart type ([line](line.md#options), [area](area.md#options), [bar](bar.md#options)). The ones that need axes or controls (`zoom`, `reference`, `legend`, `tooltip`, `table`) have no effect on a compact chart. Scatter and donut have no compact form: on them `compact` is a type error.

## Edge case: a value left out

When values were left out, the description says so and a small marker with a text equivalent appears in the corner of the chart.

[example: compact-dirty](../examples/compact-dirty.html)
