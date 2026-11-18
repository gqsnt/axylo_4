# Axylo

Axylo draws the everyday charts of web apps and dashboards: line, area, bar, scatter and donut, and a compact variant for KPI tiles. You pass rows and name the fields. The chart that comes back follows its container's width, takes light or dark from the page, and can be read with a keyboard; to assistive technology it exposes a name, a summary, the value of the point in focus and a data table. When the data cannot be drawn as given, Axylo says so, to you in the console and to the reader on the chart, instead of drawing a guess.

This page says what you get, what Axylo leaves out on purpose, and where to read next.

[example: bar-target](../examples/bar-target.ts)

That chart is one call with a title, the rows, two field names and a target line. Its value axis includes zero, its long label fits, its colours follow this page's scheme, and its toolbar has "View as table". Press Tab to reach the plot, then use the arrow keys.

## What you get without asking

| You get | Where to read more |
|---|---|
| A title and an accessible name, and a generated summary of the data (range, minimum, maximum, last value, time zone) | [Accessibility](accessibility.md) |
| Axes with units, a legend when there are several series, a tooltip placed against the marks it describes, and "View as table" | [Getting started](getting-started.md#what-you-get-without-asking) |
| Keyboard access: up to two tab stops, the plot and the toolbar | [Accessibility](accessibility.md#the-keyboard-map) |
| Series told apart by colour and by marker, dash or fill pattern | [Theming](theming.md) |
| Light and dark taken from the page, forced colours, reduced motion | [Theming](theming.md#dark-mode) |
| Sizing from the container, in both directions, with no call from you | [Getting started](getting-started.md#what-you-get-without-asking) |
| Gaps for the missing values your data marks, never a zero in their place | [Your data](data.md#missing-values) |
| Calendar dates that read the same in every time zone | [Your data](data.md#three-kinds-of-time) |
| A coded diagnostic, with the field and rows where they apply and the fix, for anything that cannot be drawn as given | [Diagnostics](diagnostics.md) |

## What Axylo does not try to do

Axylo has few chart types, each with its own rules for labels, bad data and accessibility. It does not aim for many chart types, deep visual customisation, or exploratory analysis in notebooks. There are no maps, financial charts or network diagrams, and no log scale or second y axis in 1.0. [Stability and releases](stability.md#what-is-not-in-10) lists what is left for later and why.

There is one way to do each thing: one data model, one method per kind of change, and CSS for every colour. There is no `width`, `height`, `theme`, `palette` or `animation` option. Size comes from the container, colour from CSS, and the first render is never animated.

## Where to go next

- [Getting started](getting-started.md): install, the first chart, five things to get right with daily data, and what to check when a chart looks wrong.
- [Your data](data.md): rows and columns, dates and times, missing values, units.
- One page per chart type: [line](line.md), [area](area.md), [bar](bar.md), [scatter](scatter.md), [donut](donut.md), [compact](compact.md).
- [Updating, streaming and zoom](updating.md), and the [React components](react.md).
- [Diagnostics](diagnostics.md): every code, with a page each.
- [Options reference](options.md): every option of every chart type.
- Coming from another library: [Chart.js](migrate-chartjs.md) or [Recharts](migrate-recharts.md).

## About this documentation

The live examples on these pages are bundled from the packed packages, installed into a clean project the way an application installs them, and run in the development condition. A test type-checks every example against the packed declarations, renders it in Chrome, checks a value each one shows and the interaction it teaches, and fails on any console error or on a diagnostic the example does not say it raises. The library is a pre-release (package version 0.0.0). Files of the repository that the pages link to are published with the site, as they were when it was built.
