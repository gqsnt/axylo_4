# React

After this page you can use Axylo's React components, choose between props and the imperative handle, keep re-renders cheap, handle events and errors, and render on the server.

`@axylo/react` works with React 18 and 19. It is a thin layer: each component creates an ordinary Axylo chart in an empty `<div>` and turns prop changes into `update` calls.

```sh
npm install axylo @axylo/react
```

## The components

`Line`, `Area`, `Bar`, `Scatter` and `Donut` take the same options as `line()`, `area()`, `bar()`, `scatter()` and `donut()`, as props. A few props belong to the component itself:

| Prop | What it does |
|---|---|
| `id`, `className`, `style`, `data-*` | Attributes of the container `<div>`. The container always has the class `axylo`. |
| `ref` | Receives `{ chart }`: the chart's handle, or `null` before mount, after unmount and on the server. |
| `onHover`, `onSelect` | The `hover` and `select` events. |
| `onZoom` | The `zoom` event. Not on `Donut`. |

`aria-*` props are not passed to the container: the chart names itself through `title` or `labelledBy`. An `aria-label` prop is reported as an option the chart does not know ([AX150](diagnostics.md#ax150)).

[example: react-line](../examples/react-line.tsx)

## Props and what they cost

On each render the component compares the new props with the ones it last applied, and calls `chart.update` with only what changed.

- `data` is compared by identity. A new array, even with the same rows, is read again. Keep data in state, memoise it with `useMemo`, or build it outside the component. In development, the same content arriving as a new array three renders running prints a hint, `[axylo/react] … memoize it`, to the console.
- Every other prop is compared by content, so an inline `x={{ field: 'day', type: 'date' }}` or `reference={[{ y: 90, label: 'Target' }]}` costs nothing when it has not changed. Do not change an option object in place: a value changed under the same reference is not seen.
- A prop you remove is sent as `undefined`, which returns that option to its default.
- Event handlers are replaced without recreating the chart, so inline arrow functions are fine. `onDiagnostic` too.

## Props or the handle

Props describe what the chart shows. The handle is for what props cannot express: `append` for live data, `zoom` from your own controls, and reading `diagnostics`.

[example: react-stream](../examples/react-stream.tsx)

When `data` is a prop, a new `data` replaces whatever was appended, so a streaming component keeps its first rows stable (in state, as above) and appends through the ref.

## Lifecycle

The chart is created when the component mounts and destroyed when it unmounts. It is correct under StrictMode's setup, cleanup and setup again. A chart hidden by Suspense is not destroyed: when it is shown again it is the same chart, with its appended rows and zoom.

The component creates the chart during React's layout phase, so a parent's layout effect or callback ref already finds `ref.current.chart` with the committed options, and calls made there apply in the order React committed them.

## Errors and error boundaries

A chart does not throw for bad data: it draws what it can, shows the reader what it could not, and reports diagnostics. Only a `strict` chart throws, when a create or an update finds an error or a warning. In a component that happens during React's commit, so the nearest error boundary catches it like any render error, with the `AxyloStrictError` and its `diagnostics`.

To log diagnostics without throwing, pass `onDiagnostic`.

## Server rendering

The component files are marked `'use client'`. On the server a component renders only its empty container, `<div class="axylo"></div>` with your `id`, `className`, `style` and `data-*` attributes, and never reaches the chart code, which needs a browser. The chart is created after hydration. Give the container its size with CSS, so the page does not move when the chart appears: the chart fills the container's width, and with no height set its plot is 16:9 of the width, between 160 and 480 px.

To check data on the server, use `validate()` from `axylo`, which runs without a DOM. See [Diagnostics](diagnostics.md#validate-in-node-and-in-tests).
