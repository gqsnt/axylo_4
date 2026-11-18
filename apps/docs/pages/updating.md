# Updating, streaming and zoom

After this page you can change a chart's options and data, feed it a live stream, set and follow its zoom, listen to its events and remove it, and you know the rules that keep every one of these calls predictable.

A chart function returns a handle with six members:

```ts
const chart = line('#sessions', options);

chart.update({ title: 'Sessions' });                               // change options
chart.append([{ day: '2026-05-01', sessions: 41210 }], { keep: 120 }); // add rows
chart.zoom(['2026-03-01', '2026-03-31']);                           // set the visible x range
const off = chart.on('hover', point => console.log(point));        // listen; off() stops
chart.diagnostics;                                                 // what is wrong, right now
chart.destroy();                                                   // remove the chart
```

There is no `resize()`: the chart follows its container by itself.

## The rules every call follows

1. **Calls apply in the order you make them.** `update({ data })` followed by `append(rows)` appends to the new data.
2. **Checking is immediate.** Each call reads and checks its input before it returns. `chart.diagnostics` is up to date as soon as the call returns, and a `strict` chart throws from that call.
3. **Drawing waits for the next frame.** All the calls made before the next animation frame are drawn once, together. Ten updates in a row cost one drawing.
4. **Everything switches together.** Marks, labels, the tooltip, keyboard navigation and the accessibility text move to the new state in the same frame. No frame shows half of one state and half of another.

## update: change options

`update(patch)` takes any options of the chart's type. For each key:

| In the patch | Effect |
|---|---|
| Present with a value | Replaces the old value whole. There is no deep merge: `y: { field: 'revenue' }` replaces the whole `y`, label and unit included. |
| Present as `undefined` | Returns that option to its default. |
| Absent | Stays as it is. |

A new `data` replaces the data, including anything appended. Field options that only change presentation (`domain`, `format`, `tickFormat`, `title`, colours) do not make the chart read the rows again.

[example: update](../examples/update.html)

## append and keep

`append(rows, { keep })` adds rows at the end. It is the fast path for live data: earlier rows are not read again.

- `keep` is the number of distinct x values to retain; older ones are dropped. Without it, every row is kept.
- Rows should be at or after the last x. Rows before it are still accepted, through the slower full update, with warning [AX151](diagnostics.md#ax151).
- When the view is zoomed to the latest edge, it follows new data. Zoomed elsewhere, it stays where it is.
- Appended rows are checked like any others, and a `strict` chart throws on a bad one.
- Data arriving does not speak: announcements happen only when the reader moves, and keyboard focus stays on the same point until that point leaves the window.

[example: stream](../examples/stream.html)

### Pause and resume

Once a chart has been appended to, its toolbar shows a Pause control. While paused, new rows are taken and checked but not shown, and the view does not move, so a reader can study a moment of a live chart. Resume shows everything that arrived. Pause is in the chart's own toolbar for the reader; there is no method for it.

## zoom

`zoom([from, to])` sets the visible x range, in the same kind of values as your x field (date strings, numbers, `Date` objects). `zoom(null)` shows everything. A range that cannot be read is reported and ignored; `zoom` never throws.

The reader can zoom too, on date, time and number x axes: with the Zoom in and Zoom out buttons (and, once zoomed, Pan left, Pan right and Reset zoom), by dragging across the plot, with `+`, `-`, `0` and Shift with the arrows while the plot has focus, with the wheel while the plot has focus (never with Ctrl or Meta held, so browser zoom keeps working), and with pinch and two-finger pan when `zoom: 'touch'` is set. A one-finger drag always scrolls the page. Every one of these works with single clicks or keys alone; no gesture is required.

Every change of the visible range, by your call or by the reader, fires the `zoom` event.

[example: zoom](../examples/zoom.html)

## on: events

`on(event, listener)` returns a function that removes the listener.

| Event | Payload | When |
|---|---|---|
| `hover` | A point, or `null` when the pointer leaves | The datum under the pointer, or the keyboard's point, changes. |
| `select` | A point | The reader clicks a point or presses Enter or Space on it. |
| `zoom` | `[from, to]`, or `null` for the whole range | The visible range changes. |

In event payloads, date and time x values currently arrive as epoch milliseconds (a calendar date as its UTC midnight), whatever form your data used; `new Date(value)` reads either form, as the zoom example does.

A point is `{ series, x, y, row, index }`: the series name (the slice label on a donut), the x value, the value (`null` for no data), your own row object (with typed columns, an object built from the columns at that index), and the row's index in your data.

## diagnostics

`chart.diagnostics` lists the diagnostics for the current options and data. It is current as soon as a create, `update` or `append` returns. Diagnostics found later, while drawing (contrast, labels that stop fitting after a resize, a formatter that throws), are added when found. See [Diagnostics](diagnostics.md).

## destroy

`destroy()` cancels the pending frame, disconnects every observer and listener, removes what the chart added to its element, and makes later calls do nothing. Call it when the chart's element leaves your page. A chart whose element leaves the page without `destroy()` lets go of the page's listeners until the element returns.

## Strict mode

With `strict: true`, any error or warning found while checking a create, `update` or `append` call throws from that call, and the chart keeps its last valid state. The thrown error is named `AxyloStrictError`, its message starts with the first diagnostic, and its `diagnostics` property has all of them. A rejected create leaves nothing behind in the page.

Hints never throw. Neither do diagnostics that can only arise later, while drawing: those are reported when found.

[example: strict](../examples/strict.html)

Strict mode suits tests and development builds, where a bad row should stop you. In production a chart that shows a gap and tells the reader is usually better than one that throws.
