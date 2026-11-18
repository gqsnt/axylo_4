# Donut charts

After this page you know when a donut is the right choice, which options it takes, and what it does with zero, missing, negative and too many slices.

## When to use it

A donut shows the shares of one whole: sessions by browser, budget by item. It works for a handful of parts; with more than eight, Axylo groups the smallest. To compare amounts that are not parts of one whole, or many categories, use a [bar chart](bar.md).

[example: donut-basic](../examples/donut-basic.ts)

## Options

```ts
import { donut } from 'axylo';
donut(target, { data, label, value, ...options });
```

| Option | On a donut |
|---|---|
| `label` | The field that names each slice. Labels must be unique. |
| `value` | The value field: a field name or a [value field object](options.md#value-fields) (`label`, `unit`, `scale`, `format`). Values must not be negative. |
| Common options | `title`, `labelledBy`, `subtitle`, `description`, `state`, `legend`, `tooltip`, `table`, `colors`, `messages`, `locale`, `strict`, `onDiagnostic`. |

Not on a donut, and a type error if given: `x`, `y` and `series` (a donut has a label and a value), `zoom` and `reference` (there is no axis), `compact`, `stacked`, `layout`, `horizontal`.

## How a donut behaves

| Behaviour | Donut |
|---|---|
| Order | Slices keep the order of the data, start at 12 o'clock and run clockwise. |
| Legend | Every slice, in slice order, with its value and percentage as text. |
| Pointer | The slice under the pointer. The tooltip shows its label, value and percentage. |
| Keyboard | Through the slices in slice order. |
| Zero and missing | A zero slice is listed in the legend without an arc. A slice with no value is listed as "No data". |
| Negative | A negative value is error [AX120](diagnostics.md#ax120): the donut shows its error state, since a negative share cannot be drawn. |
| More than eight | The seven largest slices are drawn and the rest grouped as "Other (n)", with [AX121](diagnostics.md#ax121). The table still lists every category. |
| All zero | The empty state: there is no whole to divide. |
| Duplicates | Two slices with the same label are [AX108](diagnostics.md#ax108): the donut is not drawn. |
| Separators | Adjacent slices are separated by at least 1 px of background. |

## Edge case: many slices, a zero and a gap

[example: donut-many](../examples/donut-many.ts)
