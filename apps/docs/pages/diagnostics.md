# Diagnostics

After this page you can read an Axylo diagnostic, collect diagnostics in your own code, make a chart throw on them, and check a chart's data in Node or in a test before anything is drawn. Every code has its own page, listed at the end.

## Reading one

When Axylo cannot draw something as given, it prints one line to the console:

```text
[axylo AX103] "Conversion": Field "rate" has 1 non-finite value at row 1 (NaN). Check the calculation that produced it or send null for no data. Shown as gaps.
```

| Part | Here |
|---|---|
| Code | `AX103`. Stable across releases; each has a page. |
| Chart | `"Conversion"`: the chart's title, or its element id when it has none. |
| What and where | The field, how many values, and the first rows (up to ten), numbered in your own data as you passed it. |
| Fix | What to change. |
| Outcome | What the chart did instead: here, gaps. |

## Levels and who is told

| Level | Means | Console | The reader |
|---|---|---|---|
| Error | The chart, or a series, cannot be drawn. | Every build, once per code per page | The chart shows its error state, or says which series could not be drawn |
| Warning | Something is not drawn as given. | Every build, once per code per page | When values were left out or changed, a note in the figure: "Values not shown: 3. See table." |
| Hint | Advice for you; the chart is drawn as given. | Development builds only | Usually nothing. Two hints go with a visible change: a plot too small to draw shows its summary instead ([AX142](diagnostics.md#ax142)), and hidden labels get a note ([AX143](diagnostics.md#ax143)) |

Errors and warnings print with `console.warn`, hints with `console.info`. The note to the reader is in every build, inside the figure and in the accessibility tree, so a production chart is never silently wrong.

## Collecting them in your code

Each diagnostic is an object:

```ts
interface Diagnostic {
  code: `AX${number}`;           // 'AX103'
  level: 'error' | 'warning' | 'hint';
  message: string;               // what is wrong, where, and how to fix it
  chart: string;                 // the chart's title, else its element id
  field?: string;                // when it is about a field
  rows?: readonly number[];      // first rows, in your data, at most 10
  count?: number;                // how many values or rows in all
}
```

`chart.diagnostics` lists them for the current options and data, up to date as soon as a create, `update` or `append` returns. `onDiagnostic` is called once for each diagnostic the chart newly finds, in every build and at every level, so it is the place to send them to your error tracking. A listener that throws is reported once and otherwise ignored; it cannot break the chart.

[example: diagnostics-listener](../examples/diagnostics-listener.html)

## When they are found

Most diagnostics are found while a call checks its input: the create, `update` or `append` call. Those are in `chart.diagnostics` when the call returns. A few can only be found later, while drawing: low contrast after the page's CSS changes ([AX141](diagnostics.md#ax141)), a plot too small ([AX142](diagnostics.md#ax142)), labels that stop fitting after a resize ([AX143](diagnostics.md#ax143)), more bars than pixels ([AX132](diagnostics.md#ax132)), a formatter that throws ([AX160](diagnostics.md#ax160)), and a label element that does not exist. They are reported when found, through the same console line and `onDiagnostic`.

## Strict mode

`strict: true` makes the chart throw on any error or warning found while checking a create, `update` or `append` call, synchronously from that call. The chart keeps its last valid state; a rejected create leaves nothing in the page. The error is named `AxyloStrictError`, and its `diagnostics` property has every diagnostic of the rejected call. Hints never throw, and neither do diagnostics found later while drawing. See the example in [Updating](updating.md#strict-mode).

## validate() in Node and in tests

`validate(type, options)` runs the same reading and checking as creating a chart (options, data, view, name) without a DOM, and returns the diagnostics a created chart would report from its call. It takes the same options as the chart type, so it type-checks the same way. Importing `axylo` in Node does not touch the DOM.

Use it on a server, in a build step, or in a coding agent's loop:

[source: examples/node/validate.ts](../examples/node/validate.ts)

Or in a unit test, so that a change in the data a query returns fails the build instead of a dashboard:

[source: examples/node/chart-data.test.ts](../examples/node/chart-data.test.ts)

Both files are run by this documentation's own tests. `validate()` cannot find what only a page can show: the diagnostics listed under "When they are found" need a browser.

## Every code

[table: diagnostic codes](../data/diagnostics.mjs)
