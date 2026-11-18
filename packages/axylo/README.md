# axylo

Everyday charts that are faithful to the data, readable everywhere and accessible by default: line, area, bar,
scatter and donut, plus a compact variant for small tiles. No runtime dependencies.

Axes, legend, tooltip, keyboard access, a text description, a data table, light and dark colors and resizing
are on without further options. Data that cannot be drawn as given is reported with a coded diagnostic, never
guessed.

## Install

```sh
npm install axylo
```

## First chart

With a bundler, given an element `<div id="chart"></div>` on the page:

```ts
import { line } from 'axylo';

const rows = [
  { month: '2026-01', visitors: 4210 },
  { month: '2026-02', visitors: 4685 },
  { month: '2026-03', visitors: 5302 },
  { month: '2026-04', visitors: 5127 },
];

line('#chart', { title: 'Monthly visitors', data: rows, x: 'month', y: 'visitors' });
```

With a script tag, no build step:

```html
<!doctype html>
<html lang="en">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/axylo/dist/axylo.css">
<script src="https://cdn.jsdelivr.net/npm/axylo/dist/axylo.iife.min.js"></script>
<div id="chart"></div>
<script>
  const rows = [{ month: '2026-01', visitors: 4210 }, { month: '2026-02', visitors: 4685 },
    { month: '2026-03', visitors: 5302 }, { month: '2026-04', visitors: 5127 }];
  Axylo.line('#chart', { title: 'Monthly visitors', data: rows, x: 'month', y: 'visitors' });
</script>
```

The script-tag files are `dist/axylo.iife.min.js` (production) and `dist/axylo.iife.js` (development, with
hints for the author). The library applies its stylesheet at run time without creating a `<style>` element;
linking `axylo.css` yourself, as above, is optional and suits a page with a strict Content Security Policy.
Bundlers import it as `axylo/axylo.css`.

## Checking a chart without a browser

`validate(type, options)` runs the same normalization in Node and returns the diagnostics a chart would
report, so a server, a test or a coding agent can check options before rendering.

## License

MIT
