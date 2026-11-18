# Getting started

After this page you can install Axylo, draw a first chart from rows in npm, script-tag or React code, and know the three things to check when a chart looks wrong.

## Install

With npm and a bundler:

```sh
npm install axylo
```

For React, add the adapter. It works with React 18 and 19.

```sh
npm install axylo @axylo/react
```

With a script tag, load one file from the package's `dist` folder: `axylo.iife.js` is the development build (it prints hints), `axylo.iife.min.js` the production build. Both define one global, `Axylo`. The snippet below loads them from jsDelivr, which serves published npm packages; until Axylo is published there, copy the file from the package to your site instead.

```html
<script src="/js/axylo.iife.min.js"></script>
```

The package has no runtime dependencies. It ships two flavours of the module build, chosen by the `development` export condition: a bundler that resolves that condition gets the development build, which also prints hints; otherwise you get the production build, which prints errors and warnings only. The styles are applied by the library itself without adding a `<style>` element, so there is no CSS file to import. A standalone copy, `axylo/axylo.css`, ships for pages that prefer to load the stylesheet themselves. Whether a page with a strict Content Security Policy needs it has not been tested yet.

TypeScript 5.4 or later gives you checked field names; plain JavaScript works the same without them.

## The first chart

Each of these is complete: the import, the rows, and one call (or one component). They are kept in the repository as files that the package's distribution tests install and render, so what you see here is what is checked.

With npm:

[source: examples/first-chart/npm.ts](../../../examples/first-chart/npm.ts)

With a script tag:

[source: examples/first-chart/script.html](../../../examples/first-chart/script.html)

In React:

[source: examples/first-chart/react.tsx](../../../examples/first-chart/react.tsx)

The same kind of chart, running on this page. Point at it, press Tab to reach the plot and use the arrow keys, or open the table.

[example: first-chart](../examples/first-chart.ts)

A script-tag page needs nothing more than this:

[example: script-tag](../examples/script-tag.html)

The only required options are `data` and the fields: `x` and `y` (and `series` for long rows), or `label` and `value` for a donut. `title` is not required, but a chart without one gets a generated name and warning [AX140](diagnostics.md#ax140).

## What you get without asking

| Feature | What it does |
|---|---|
| Title and accessible name | `title` is the visible heading and the chart's name for assistive technology. Without it, the name is generated ("Line chart of sessions by day") and AX140 is raised. In a dashboard card that already has a heading, use `labelledBy` with the heading's id instead. |
| Summary | A generated description: chart type, series, the x range with its time zone, the value range, each series' minimum, maximum and last value, and anything left out. `description` adds to it. |
| Table view | "View as table" shows the data as an HTML table built from your rows, 100 rows per page, with a "Jump to" field. |
| Keyboard | The plot is one tab stop: arrow keys move through the points and read each one. The legend, zoom, pause and table controls are a second tab stop. See [the keyboard map](accessibility.md#the-keyboard-map). |
| Tooltip | Pointing anywhere in the plot shows what is at that x for every visible series; Escape closes it. |
| Colour and more than colour | Up to eight series get eight colours that work in light and dark pages, and each line also carries its own marker shape, repeated in the legend and tooltip. |
| Page theme | Font, text colour and light or dark come from the page. The chart repaints when the page switches scheme. |
| Size | The chart fills its container's width; with no height set, the plot is 16:9, between 160 and 480 px tall. It follows the container as it resizes, with no call from you. |
| States | No rows shows "No data to show." inside the plot, never an empty frame or an invented axis. `state` sets loading, empty and error messages of your own. |
| Diagnostics | Anything that cannot be drawn as given is reported with a code, the field, the rows and the fix; when values were left out, the reader is told too. |

The four states, each a chart with no rows:

[example: states](../examples/states.ts)

## When it looks wrong: three things to check

**1. Read the diagnostics.** Open the browser console. Every problem Axylo found is printed once per code as `[axylo AX…] "Chart title": what is wrong, where, and how to fix it`. The same list is on the chart as `chart.diagnostics`, current as soon as the call returns. Each code has a page under [Diagnostics](diagnostics.md). Hints, which are advice rather than problems, print in the development build only.

**2. Check which kind of x Axylo read.** A date off by one day almost always means the x values are instants where calendar dates were meant: `'2026-02-24T00:00:00Z'` is a moment, which is the evening of the 23rd in New York. If the tooltip heading names a time zone, Axylo read instants. Send `'2026-02-24'`, or declare `x: { field: 'day', type: 'date' }`. If the x labels are your raw strings in input order, Axylo read categories. [The three kinds of time](data.md#three-kinds-of-time) explains the rule.

**3. Check the values.** Numbers that arrive as strings, a missing day, two rows for the same day, a misspelled field: each has its own code, and `validate()` finds them without drawing, in Node or in a test:

```ts
import { validate } from 'axylo';

const problems = validate('line', { data: rows, x: 'day', y: 'sessions', series: 'channel' });
for (const d of problems) console.log(d.code, d.level, d.message);
```

[Your data](data.md) covers each case.

## Next

Read [Your data](data.md) next: it explains the three shapes rows can take, how dates are read, and what happens to missing values.
