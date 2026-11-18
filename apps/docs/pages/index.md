# Axylo

Axylo draws the everyday charts of web apps and dashboards: line, area, bar, scatter and donut, and a compact variant for KPI tiles. You pass rows and name the fields; the chart that comes back is faithful to the data, readable at any width and in light or dark pages, and works with a keyboard and a screen reader. When the data is wrong, Axylo says so, to you in the console and to the reader on the chart, instead of drawing a guess.

This page says what you get, what Axylo leaves out on purpose, and where to read next.

[example: bar-target](../examples/bar-target.ts)

That chart is one call with a title, the rows and two field names, plus a target line. Its value axis starts at zero, its long label fits, its colours follow this page's scheme, and it has a legend-free toolbar with "View as table". Try Tab, then the arrow keys.

## What you get without asking

| You get | Where to read more |
|---|---|
| A title and an accessible name, and a generated summary of the data (range, minimum, maximum, last value, time zone) | [Accessibility](accessibility.md) |
| Axes with units, a legend, a tooltip that appears wherever the pointer is, and "View as table" | [Getting started](getting-started.md) |
| Keyboard access: one tab stop for the plot, one for the controls | [Accessibility](accessibility.md#the-keyboard-map) |
| Series told apart by colour and by marker or dash, in every mode | [Theming](theming.md) |
| Light and dark taken from the page, forced colours, reduced motion | [Theming](theming.md#dark-mode) |
| Sizing from the container, in both directions, with no call from you | [Getting started](getting-started.md#what-you-get-without-asking) |
| Gaps for missing values, never a line drawn through them | [Your data](data.md#missing-values) |
| Calendar dates that read the same in every time zone | [Your data](data.md#three-kinds-of-time) |
| A coded diagnostic with the field, the rows and the fix for anything that cannot be drawn as given | [Diagnostics](diagnostics.md) |

## What Axylo does not try to do

Axylo has few chart types, each with its own rules for labels, bad data and accessibility. It does not aim for many chart types, deep visual customisation, or exploratory analysis in notebooks. There are no maps, financial charts or network diagrams, and no log scale or second y axis in 1.0. [Stability and releases](stability.md#what-is-not-in-10) lists what is left for later and why.

There is one way to do each thing: one data model, one method per kind of change, and CSS for every colour. There is no `width`, `height`, `theme`, `palette` or `animation` option. Size comes from the container, colour from CSS, and the first render is never animated.

## Where to go next

- [Getting started](getting-started.md): install, the first chart, and what to check when it looks wrong.
- [Your data](data.md): rows and columns, dates and times, missing values, units.
- One page per chart type: [line](line.md), [area](area.md), [bar](bar.md), [scatter](scatter.md), [donut](donut.md), [compact](compact.md).
- [Updating, streaming and zoom](updating.md), and the [React components](react.md).
- [Diagnostics](diagnostics.md): every code, with a page each.
- [Options reference](options.md): every option of every chart type.
- Coming from another library: [Chart.js](migrate-chartjs.md) or [Recharts](migrate-recharts.md).

## About this documentation

The live examples on these pages run the library's built files (the development flavour) from this repository. A test type-checks every example and renders it in Chrome, and fails on any console error or on a diagnostic the example does not say it raises. The library is a pre-release (package version 0.0.0) and some areas are still being finished: the tooltip's placement, the pan buttons, zoom on category axes and the table overlay. Pages that describe those areas follow the specification and say where the built library may still differ.
