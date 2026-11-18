# Updating, streaming and zoom

After this page you can change a chart's options and data, feed it a live stream, set and follow its zoom, listen to its events and remove it, and you know the rules that keep every one of these calls predictable.

A chart function returns a handle with six members:

```ts
const chart = line('#sessions', options);

chart.update({ title: 'Sessions' });                                   // change options
chart.append([{ day: '2026-05-01', sessions: 41210 }], { keep: 120 }); // add rows
chart.zoom(['2026-03-01', '2026-03-31']);                               // set the visible x range
const off = chart.on('hover', point => console.log(point));            // listen; off() stops
chart.diagnostics;                                                     // what is wrong, right now
chart.destroy();                                                       // remove the chart
```

There is no `resize()`: the chart follows its container by itself.

## The rules every call follows

1. **Calls apply in the order you make them.** `update({ data })` followed by `append(rows)` appends to the new data.
2. **Checking is immediate.** Each call reads and checks its input before it returns. `chart.diagnostics` is up to date as soon as the call returns, and a `strict` chart throws from that call.
3. **Drawing waits for the next frame.** All the calls made before the next animation frame are drawn once, together.
4. **Everything switches together.** Marks, labels, the tooltip, keyboard navigation and the accessibility text move to the new state in the same frame. No frame shows half of one state and half of another.

## update: change options

`update(patch)` takes any options of the chart's type. For each key:

| In the patch | Effect |
|---|---|
| Present with a value | Replaces the old value whole. There is no deep merge: `y: { field: 'revenue' }` replaces the whole `y`, label and unit included. |
| Present as `undefined` | Returns that option to its default. |
| Absent | Stays as it is. |

A new `data` replaces the data, including anything appended. Changing only how values look (`domain`, `format`, `tickFormat`, `title`, `colors`) does not make the chart read the rows again; changing a field, its `label` or its `unit` does.

[example: update](../examples/update.html)

## append and keep

`append(rows, { keep })` adds rows at the end.

- When the new rows are at or after the last x, they are read and added without reading the earlier rows again. Rows before the last x are still accepted, but the chart rebuilds its data from all the rows it holds, which is slower, and raises warning [AX151](diagnostics.md#ax151); a `strict` chart rejects such a call instead.
- `keep` is the number of distinct x values to retain; older ones are dropped. Without it, every row is kept.
- When the view is zoomed to the latest edge, it moves with new data, keeping its width. Zoomed elsewhere, it stays where it is.
- Appended rows are checked like any others, and a `strict` chart throws on a bad one.
- Arriving data is not announced. The plot's value text, which describes the point in keyboard focus, is not rewritten when an append only changes the point count or position number; it is rewritten when the focused point's own values change or the point leaves the window. Whether a screen reader then speaks depends on the reader; this has not been tried with one.

[example: stream](../examples/stream.html)

### Pause and resume

Once a chart has been appended to, its toolbar shows a Pause control. While paused, new rows are taken and checked but not shown, and the view does not move, so a reader can study a moment of a live chart. Their diagnostics come with the `append` call, as when running: rows that bring a ninth series raise [AX130](diagnostics.md#ax130) then, and a `strict` chart rejects that call. Resume shows the data as it is then: everything that arrived, within `keep`. Pause is in the chart's own toolbar for the reader; there is no method for it.

## zoom

`zoom([from, to])` sets the visible x range, given in the form of the x axis: date strings or `Date` objects for calendar dates, `Date` objects or epoch milliseconds for instants, numbers for a number axis. `zoom(null)` shows everything. A range that cannot be read is reported and ignored; `zoom` never throws.

Zoom applies to the date, time and number x axes of full line, area, bar and scatter charts (scatter along x only in 1.0). A category axis, a donut and a compact chart do not zoom in 1.0. There `zoom()` changes nothing and reports [AX150](diagnostics.md#ax150) when it is called: the diagnostic is printed and passed to `onDiagnostic`, and is not kept in `chart.diagnostics`. A compact chart does not keep the range for later either, so turning `compact` off does not apply it. On a scatter chart the whole range is the x axis as drawn, which ends on ticks (spec F7): in a narrow plot that axis can take a coarser step and a range wider than the data, and Zoom out and Reset zoom return to that range.

Where zoom applies, the reader has four ways to zoom:

1. **Buttons, with single clicks.** Zoom in and Zoom out in the toolbar; once zoomed, also Pan left and Pan right (half a view each way, unavailable at an end) and Reset zoom.
2. **Choosing a range.** Drag across the plot. Or, without dragging, press Select range (the symbol after Zoom in) and click or tap the two ends of the range, in either order; the first end is marked in the plot. While Select range is pressed, a click sets an end and neither pins a tooltip nor selects. The toggle releases itself after the second end; pressing it again or Escape releases it sooner, and a drag zooms as a drag and releases it too.
3. **Keys,** while the plot has focus: `+` and `-` zoom, `0` shows everything, and Shift with Left or Right pans. The wheel zooms as well while the plot has focus, never with Ctrl or Meta held, so browser zoom and page scrolling keep working.
4. **Pinch,** when `zoom: 'touch'` is set: two fingers zoom, and moving them pans.

A one-finger drag always scrolls the page. `zoom: false` removes the reader's ways to zoom.

## on: events

`on(event, listener)` returns a function that removes the listener.

| Event | Payload | When |
|---|---|---|
| `hover` | A point, or `null` when nothing is picked | The datum under the pointer, or the keyboard's point, changes. |
| `select` | A point | The reader clicks a point or presses Enter or Space on it. |
| `zoom` | `[from, to]`, or `null` for the whole range | A `zoom()` call, or the reader's zoom or pan, changes the visible range. Not when the view moves with appended data. |

A point is `{ series, x, y, row, index }`:

- `series` is the series key: the `series` field's value for long rows, the field name for wide rows (not its `label`), the slice label on a donut;
- `x` is in the form `zoom()` accepts for the axis: a `Date` for an instant, `'YYYY-MM-DD'` for a calendar date, an ISO date-time without offset for a wall-clock time, the category's label, otherwise the number. The two ends of a `zoom` event take the same form, except that an end between two calendar dates stays a number, which `zoom()` reads as the same position. Either can be passed to another chart's `zoom()` unchanged. Do not turn a wall-clock time into a `Date`: that would read it in the viewer's zone;
- `y` is the value, `null` for no data;
- `row` is your own row object (with typed columns, an object built from the columns at that index), and `index` its index in your data. A position no row of yours holds (an inferred missing step, a donut's "Other") has `row: null` and `index: -1`.

[example: zoom](../examples/zoom.html)

A zoom event's range drives a second chart:

[example: zoom-linked](../examples/zoom-linked.html)

## diagnostics

`chart.diagnostics` lists the diagnostics for the current options and data. It is current as soon as a create, `update` or `append` returns. Diagnostics found later, while drawing (contrast, labels that stop fitting after a resize, a formatter that fails), are added when found. See [Diagnostics](diagnostics.md).

## destroy

`destroy()` cancels the pending frame, disconnects every observer and listener, removes what the chart added to its element, and makes later calls do nothing. Call it when the chart's element leaves your page; a new chart can then be created on the same element (see [using Axylo in a framework](getting-started.md#using-axylo-in-a-framework)). A chart whose element leaves the page without `destroy()` lets go of the page's listeners until the element returns.

## Strict mode

With `strict: true`, any error or warning found while checking a create, `update` or `append` call throws from that call, and the chart keeps its last valid state. The thrown error is named `AxyloStrictError`, its message starts with the first diagnostic, and its `diagnostics` property has all of them. A rejected create leaves nothing behind in the page.

Hints never throw. Neither do diagnostics found later while drawing, nor an internal failure while drawing ([AX199](diagnostics.md#ax199)): those are reported when found. A failure while the call itself is checked (a row getter that throws) rejects the call.

[example: strict](../examples/strict.html)

Strict mode suits tests and development builds, where a bad row should stop you. In production a chart that shows a gap and tells the reader is usually better than one that throws.
