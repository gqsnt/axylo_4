# Getting started

After this page you can install Axylo, draw a first chart from rows with npm, a script tag or React, get the five things right that most often make a daily chart wrong, and know what to check when a chart looks wrong.

## Install

With npm and a bundler:

```sh
npm install axylo
```

For React, add the adapter. It works with React 18 and 19.

```sh
npm install axylo @axylo/react
```

With a script tag, load one file from the package's `dist` folder: `axylo.iife.js` is the development build (it prints hints), `axylo.iife.min.js` the production build. Both define one global, `Axylo`.

The package has no runtime dependencies. Its module build comes in two flavours, chosen by the `development` export condition: a bundler that resolves that condition gets the development build, which also prints hints; otherwise you get the production build, which prints errors and warnings only. The styles need no import: the library adopts its stylesheet as a constructed style sheet, or, where that is not possible, adds a `<style>` element. A page that prefers to load the stylesheet itself can link `axylo/axylo.css`, and the library then uses that copy. The packed packages are tested in Chrome under a Content Security Policy without `unsafe-inline`, with the stylesheet adopted and with it linked (`tests/dist/csp.browser.test.ts`).

TypeScript 5.4 or later gives you checked field names. The package's declarations refer to DOM types (`HTMLElement`), so a TypeScript project needs the `DOM` library in `lib`, also for code that only calls `validate()` in Node. Plain JavaScript works the same without types.

## The first chart

Each of these runs live below its source. They are kept in the repository as the files the package's distribution tests install and render (`examples/first-chart`), and each says what page it needs around it.

With npm and a bundler:

[example: first-chart-npm](../../../examples/first-chart/npm.ts)

With a script tag:

[example: first-chart-script](../../../examples/first-chart/script.html)

In React:

[example: first-chart-react](../../../examples/first-chart/react.tsx)

Point at a chart, or press Tab to reach its plot and use the arrow keys, or open its table. The only required options are `data` and the fields: `x` and `y` (and `series` for long rows), or `label` and `value` for a donut. `title` is not required, but without it (or `labelledBy`) the chart gets a generated name and warning [AX140](diagnostics.md#ax140).

## Daily data: five things to get right

The first chart above has months as calendar dates and numbers as numbers. Data from an API is often less tidy. Here is a daily metric as many back ends send it, and the chart that reads it correctly:

[example: daily-sessions](../examples/daily-sessions.ts)

1. **Days sent as UTC midnights.** For daily totals sent as `'2026-02-24T00:00:00Z'` (or as epoch milliseconds of a UTC midnight), use `x: { field: 'day', type: 'date' }`. Without it they are instants, shown in the viewer's time zone, so west of UTC each value appears on the day before, with only hint [AX111](diagnostics.md#ax111). Strings such as `'2026-02-24'` need no `type`. See [the three kinds of time](data.md#three-kinds-of-time).
2. **Numbers sent as strings.** For decimal strings, use `y: { field: 'sessions', parse: 'number' }`. They are converted to JavaScript numbers, which are exact for integers up to 9,007,199,254,740,991; a larger count is rounded without a warning, so check exact counts with `Number.isSafeInteger` first. A field that mixes numbers and strings is not converted at all. See [numbers sent as strings](data.md#numbers-sent-as-strings).
3. **Row order.** Pass rows in any order. Axylo sorts dated rows by x and keeps each value with its own row; categories keep the order in which they first appear.
4. **A day with no data.** When you know a day is missing, send it, with `sessions: null`. Axylo can infer a missing day only between two rows of a series that has at least three rows at a regular step, and never before the first row or after the last; with two rows, or an irregular series, the line runs straight across the missing day. See [missing values](data.md#missing-values).
5. **A misspelled field.** On error [AX101](diagnostics.md#ax101), compare the field you named with the keys the message lists, which come from your rows, and use the suggested spelling when one is offered. With no rows at all the keys cannot be checked, so the error appears once data arrives. With typed rows in TypeScript the typo does not compile.

## What you get without asking

| Feature | What it does |
|---|---|
| Name and summary | `title` is the visible heading and the chart's accessible name. In a card that already has a heading, `labelledBy` names the chart with it. The chart's description is a generated summary: chart type, series, the x range with its time zone, the value range, each series' minimum, maximum and last value, and anything left out. `description` adds to it. |
| Table view | "View as table" shows the data as an HTML table, 100 rows per page; above 100 rows a pager and a "Jump to" field appear. |
| Keyboard | Up to two tab stops while the table is closed: the plot, where the arrow keys move through the points and its value text describes the point in focus, and the toolbar, when the chart has controls. A compact chart has none. See [the keyboard map](accessibility.md#the-keyboard-map). |
| Tooltip | Pointing in the plot shows what is there, by the chart type's rule (nearest x for line and area, the band for bars, the nearest point within 24 px for scatter, the slice for a donut). The tooltip is placed against the marks it describes and lets the pointer through; a click pins it. Escape closes it. |
| Colour and more than colour | Eight default colours that work in light and dark pages. Lines and areas also carry marker shapes, and bars fill patterns past the eighth series, repeated in the legend and tooltip. |
| Page theme | Font, text colour and light or dark come from the page. The chart repaints when the page switches scheme. |
| Size | The chart fills its container's width. With no height set, the plot is 16:9 of the width, between 160 and 480 px tall. It follows the container as it resizes, with no call from you. |
| States | No rows shows "No data to show." inside the plot, never an empty frame or an invented axis. `state` sets loading, empty and error messages of your own. |
| Diagnostics | Anything that cannot be drawn as given is reported with a code, the field and rows where they apply, and the fix. When values were left out or changed, the reader is told too. |

The four states, each a chart with no rows:

[example: states](../examples/states.ts)

## When it looks wrong: three things to check

**1. Read the diagnostics.** Open the browser console. Every problem Axylo found is printed once per code per page as `[axylo AX…] "Chart title": what is wrong, where, and how to fix it`. The same list is on the chart as `chart.diagnostics`, current as soon as the call returns. Each code has a page under [Diagnostics](diagnostics.md). Hints, which are advice rather than problems, print in the development build only.

**2. Check which kind of x Axylo read.** A date off by one day almost always means instants where calendar dates were meant (item 1 above). If the tooltip heading names a time zone, Axylo read instants. If the x labels are your strings in input order, it read categories.

**3. Check the values without drawing.** `validate()` runs the same checks as creating the chart, in Node or in a test, with the same options as the chart:

```ts
import { validate } from 'axylo';

const problems = validate('line', { title: 'Monthly visitors', data: rows, x: 'month', y: 'visitors' });
for (const d of problems) console.log(d.code, d.level, d.message);
```

Numbers that arrive as strings, a missing day, two rows for the same day and a misspelled field each have their own code; [Your data](data.md) covers each case.

## Next

Read [Your data](data.md) next: it explains the three shapes rows can take, how dates are read, and what happens to missing values.
