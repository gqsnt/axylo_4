# Donut charts

After this page you know when a donut is the right choice, which options it takes, and what it does with zero, missing, negative and too many slices.

## When to use it

A donut shows the shares of one whole: sessions by browser, budget by item. It works for a handful of parts; when more than eight have a value, Axylo groups the smallest. To compare amounts that are not parts of one whole, or many categories, use a [bar chart](bar.md).

[example: donut-basic](../examples/donut-basic.ts)

## Options

```ts
import { donut } from 'axylo';
donut(target, { data, label, value, ...options });
```

| Option | On a donut |
|---|---|
| `label` | The field that names each slice. Labels must be unique. The label is also the slice's key, for `colors` and events. |
| `value` | The value field: a field name or a [value field object](options.md#value-fields) (`label`, `unit`, `scale`, `format`). Values must not be negative. |
| Common options | `title`, `labelledBy`, `subtitle`, `description`, `state`, `legend`, `tooltip`, `table`, `colors`, `messages`, `locale`, `strict`, `onDiagnostic`. |

Not on a donut, and a type error if given: `x`, `y` and `series` (a donut has a label and a value), `zoom` and `reference` (there is no axis), `compact`, `stacked`, `layout`, `horizontal`. Without an axis there is nothing for `chart.zoom()` or a `tickFormat` on the value field to act on: both change nothing and are reported ([AX150](diagnostics.md#ax150)).

## How a donut behaves

| Behaviour | Donut |
|---|---|
| Order | Slices keep the order of the data, start at 12 o'clock and run clockwise. |
| Legend | Every slice, in slice order, with its value and its share as text. Shares have at most one fraction digit. Each entry has a button that selects its slice. |
| Pointer | The slice under the pointer. The tooltip shows its label, value and share, in the hole when it fits there; a click pins it. The hole itself selects nothing. |
| Keyboard | Through the slices in slice order. |
| Zero and missing | A zero slice is listed in the legend without an arc. A slice with no value is listed as "No data". |
| Negative | A negative value is error [AX120](diagnostics.md#ax120): the donut shows its error state, since a negative share cannot be drawn. |
| More than eight | Counted among slices with a positive value only. When more than eight have one, the seven largest are drawn and the rest of those are grouped as "Other (n)", with [AX121](diagnostics.md#ax121). Zero and missing slices never count and are never grouped: each stays listed on its own. The table lists every category. "Other" has a key of its own and the muted colour. |
| All zero | The empty state: there is no whole to divide. |
| Duplicates | Two slices with the same label are [AX108](diagnostics.md#ax108): the donut is not drawn. |
| Separators | Adjacent slices are separated by at least 1 px of background. |

## Edge case: many slices, a zero and a gap

[example: donut-many](../examples/donut-many.ts)
