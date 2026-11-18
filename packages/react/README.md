# @axylo/react

React components for [Axylo](https://www.npmjs.com/package/axylo) charts: `Line`, `Area`, `Bar`, `Scatter`
and `Donut`. Each takes the same options as the matching `axylo` function, as props.

## Install

```sh
npm install axylo @axylo/react
```

## First chart

```tsx
import { Line } from '@axylo/react';

const rows = [
  { month: '2026-01', visitors: 4210 },
  { month: '2026-02', visitors: 4685 },
  { month: '2026-03', visitors: 5302 },
  { month: '2026-04', visitors: 5127 },
];

export function MonthlyVisitors() {
  return <Line title="Monthly visitors" data={rows} x="month" y="visitors" />;
}
```

The chart is created on mount and destroyed on unmount (correct under StrictMode). On the server a
component renders its empty container only. A `ref` exposes the chart handle for `append`, `zoom` and
`diagnostics`. `ref.current.chart` is null while the chart is not attached (before mount, while Suspense
hides it, after unmount). A call made through a handle you kept while the chart is hidden, or before the
current render's props reach it, waits and is applied right after them; a call after unmount throws.

## License

MIT
