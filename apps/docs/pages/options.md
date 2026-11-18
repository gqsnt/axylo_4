# Options reference

After this page you can look up any option of any chart type, any field option, and every member of the chart handle, with its type, its default and what it does. The groups follow the declarations in `packages/axylo/src/public.ts`, which are the source of truth. Tests check that every key of those declarations is here with the type written here, and that each default written in `code` is what the chart does when the option is left out.

Types are written in TypeScript. `Row` is the type of one of your rows (for typed columns it is inferred from the columns), `Options` the options type of the chart, and `XValue` is `number | string | Date`, a value on an x axis.

## Which options apply where

| Group | line | area | bar | scatter | donut |
|---|---|---|---|---|---|
| [Common options](#common-options) | yes | yes | yes | yes | yes |
| [Encoding](#encoding-line-area-bar) (`x`, `y`, `series`) | yes | yes | yes | – | – |
| [Cartesian options](#cartesian-options) (`zoom`, `reference`) | yes | yes | yes | yes | – |
| [`compact`](#compact) | yes | yes | yes | – | – |
| [`stacked`](#area-options) | – | yes | – | – | – |
| [`layout`, `horizontal`](#bar-options) | – | – | yes | – | – |
| [Scatter encoding](#scatter-options) | – | – | – | yes | – |
| [Donut encoding](#donut-options) (`label`, `value`) | – | – | – | – | yes |

An option that does not apply to a chart type does not compile, and at run time is ignored with [AX150](diagnostics.md#ax150).

## Common options

On every chart type.

<!-- options: CommonOptions -->
| Option | Type | Default | Meaning |
|---|---|---|---|
| `data` | `Data<Row>` | required | The rows (`readonly Row[]`), or `{ columns }` with one array or typed array per field, all of equal length. See [Your data](data.md). |
| `title` | `string \| Title` | none | Visible heading and accessible name. Without it (and without `labelledBy`) the name is generated, with AX140. In a compact chart it is the accessible name only. |
| `labelledBy` | `string` | none | Id of an existing heading that names the chart, for cards that already show a title. |
| `subtitle` | `string` | none | A line under the title. |
| `description` | `string` | none | Added to the generated summary. The time zone and any omitted values are always stated. |
| `state` | `'ready' \| 'loading' \| { error: string } \| { empty: string }` | `'ready'` | Shows a loading, error or empty message inside the plot instead of the data. |
| `legend` | `'auto' \| false \| 'top' \| 'right' \| 'bottom'` | `'auto'` | Where the legend goes, or `false` for none. `'auto'` places it under the plot. A chart with one series has no legend entries. |
| `tooltip` | `boolean` | `true` | The pointer readout: the tooltip, or in a small plot the strip under it. With `false` nothing is pinned, and a click still selects. Keyboard reading is not affected. |
| `table` | `boolean` | `true` | The "View as table" control. |
| `colors` | `Readonly<Record<string, string>>` | none | A CSS colour per series key: the `series` value for long rows, the field name for wide rows, the slice label on a donut. |
| `messages` | `Partial<Messages>` | built-in English | Replacements for text the reader sees. See [Messages](#messages). |
| `locale` | `string` | the document's language | Locale for numbers and dates: this option, else `<html lang>`, else the browser's. |
| `strict` | `boolean` | `false` | Throw on any error or warning found while checking a create, `update` or `append` call, from that call. |
| `onDiagnostic` | `(diagnostic: Diagnostic) => void` | none | Called once for each diagnostic the chart newly finds, in every build. |

### Title

When `title` is an object:

<!-- options: Title -->
| Key | Type | Default | Meaning |
|---|---|---|---|
| `text` | `string` | required | The title. |
| `visible` | `boolean` | `true` | `false` keeps it as the accessible name but hides it visually. |
| `level` | `2 \| 3 \| 4 \| 5 \| 6` | `3` | The heading level, to fit the page's outline. |

## Encoding (line, area, bar)

Long rows name one `y` and a `series`; wide rows give `y` as a list and no `series`. The two forms are exclusive. One series needs only a single `y`.

<!-- options: Encoding -->
| Option | Type | Default | Meaning |
|---|---|---|---|
| `x` | `XField<Row>` | required | The x field: a key, or an [x field object](#x-fields). |
| `y` | `ValueField<Row> \| readonly ValueField<Row>[]` | required | The value field, or one field per series. See [Value fields](#value-fields). The first field sets the shared value axis's domain and scale. |
| `series` | `SeriesKey<Row>` | none | The field whose value names and keys each row's series (long rows only). |

## Cartesian options

On line, area, bar and scatter charts.

<!-- options: CartesianOptions -->
| Option | Type | Default | Meaning |
|---|---|---|---|
| `zoom` | `boolean \| 'touch'` | `true` | Zoom and pan, on date, time and number x axes only: a category axis and a compact chart never zoom. `'touch'` also takes pinch and two-finger drag on touch screens. |
| `reference` | `readonly Reference[]` | none | Reference lines and bands. See [Reference](#reference). Not on compact charts. |

### Reference

<!-- options: Reference -->
| Key | Type | Default | Meaning |
|---|---|---|---|
| `x` | `XValue \| readonly [XValue, XValue]` | none | A line at an x value, or a band between two. |
| `y` | `number \| readonly [number, number]` | none | A line at a value, or a band between two. On a horizontal bar chart it runs up and down the plot. |
| `label` | `string` | required | Shown beside the line or band, and listed in the summary and the table caption. |

A reference widens the automatic value domain to include it. An author `domain` that leaves it out keeps it out of the drawing; the summary still lists it.

## Compact

<!-- options: CompactOption -->
| Option | Type | Default | Meaning |
|---|---|---|---|
| `compact` | `boolean` | `false` | Line, area and bar only. Marks only, as an image with a text alternative. See [Compact](compact.md). |

## Area options

<!-- options: AreaOptions -->
| Option | Type | Default | Meaning |
|---|---|---|---|
| `stacked` | `boolean` | `false` | Stack the series; the tooltip adds the total, or both totals when signs are mixed. |

## Bar options

<!-- options: BarOptions -->
| Option | Type | Default | Meaning |
|---|---|---|---|
| `layout` | `'grouped' \| 'stacked'` | `'grouped'` | Several series side by side, or stacked. |
| `horizontal` | `boolean` | `false` | Bars from the left, categories down the side. |

## Scatter options

Scatter takes one `y` (never a list) and an x that is a number, an instant or a date.

<!-- options: ScatterOptions -->
| Option | Type | Default | Meaning |
|---|---|---|---|
| `x` | `ScatterXField<Row>` | required | The x field: like an [x field](#x-fields), with `type` limited to `'number'`, `'time'` or `'date'`, and no `ordered`. |
| `y` | `ValueField<Row>` | required | The value field. |
| `series` | `SeriesKey<Row>` | none | The field that groups points into series. |

## Donut options

<!-- options: DonutOptions -->
| Option | Type | Default | Meaning |
|---|---|---|---|
| `label` | `SeriesKey<Row>` | required | The field that names, and keys, each slice. |
| `value` | `ValueField<Row>` | required | The value of each slice. Not negative. |

## Value fields

A value field is a key of `Row` whose values are numbers (or `null`), or an object. A key whose values are strings is accepted only in the object form with `parse: 'number'`.

<!-- options: ValueField -->
| Key | Type | Default | Meaning |
|---|---|---|---|
| `field` | `NumberKey<Row> \| StringKey<Row>` | required | The key of the row: a number field, or a string field with `parse`. |
| `parse` | `'number'` | none | The field holds numbers as strings; convert them to JavaScript numbers (exact for integers up to 9,007,199,254,740,991). |
| `label` | `string` | the field name | Axis title, and the series name in tooltip, table and announcements. |
| `unit` | `string` | none | Follows values in tooltip, table and announcements: `'ms'`, `'USD'`. |
| `scale` | `'percent' \| 'ratio'` | none | Percentage data: `'percent'` is 0–100, `'ratio'` is 0–1. Never inferred. |
| `format` | `Intl.NumberFormatOptions \| ((value: number) => string)` | the locale's grouping, the full integer part and up to six significant fraction digits | How values are written in tooltip, table and announcements. |
| `tickFormat` | `Intl.NumberFormatOptions \| ((value: number) => string)` | the locale's grouping, with the step's fraction digits; compact from a largest tick of one million, scientific from 10¹⁵ | How axis ticks are written. |
| `missing` | `'gap' \| 'zero'` | `'gap'` | What a missing value means. `'zero'` is for counts where absence means none. |
| `domain` | `readonly [number, number]` | from the data | Author bounds. On bar and area, widened to include zero (AX110). In a wide chart only the first field's applies. |

## X fields

An x field is a key of `Row` whose values are numbers, strings or `Date`s, or an object.

<!-- options: XField -->
| Key | Type | Default | Meaning |
|---|---|---|---|
| `field` | `XKey<Row>` | required | The key of the row. |
| `type` | `'number' \| 'time' \| 'date' \| 'category'` | inferred | `'date'`: calendar dates; `'time'`: instants; numbers are never inferred to be instants. See [how Axylo decides](data.md#how-axylo-decides). |
| `ordered` | `boolean` | `false` | Category axes: the categories have a natural order, so labels may be thinned when they do not fit. |
| `timeZone` | `'local' \| 'UTC' \| (string & {})` | `'local'` | For instants: the zone they are shown in. `'local'` is the viewer's; otherwise `'UTC'` or an IANA zone name. |
| `label` | `string` | the field name | Axis title of a number axis; a date, time or category axis is titled only when you give one. |
| `unit` | `string` | none | Follows x values in tooltip, table and announcements. |
| `format` | `Intl.DateTimeFormatOptions \| Intl.NumberFormatOptions \| ((value: XValue) => string)` | from the kind of x | How x values are written in tooltip, table and announcements. |
| `tickFormat` | `Intl.DateTimeFormatOptions \| Intl.NumberFormatOptions \| ((value: XValue) => string)` | from the kind of x | How x ticks are written. |
| `domain` | `readonly [XValue, XValue]` | from the data | Author bounds for x. |

For scatter charts the x field takes the same keys except `ordered`, and `type` without `'category'`:

<!-- options: ScatterXField -->
| Key | Type | Default | Meaning |
|---|---|---|---|
| `field` | `XKey<Row>` | required | As above. |
| `type` | `'number' \| 'time' \| 'date'` | inferred | No `'category'`: a scatter relates two measures. |
| `timeZone` | `'local' \| 'UTC' \| (string & {})` | `'local'` | As above. |
| `label` | `string` | the field name | As above. |
| `unit` | `string` | none | As above. |
| `format` | `Intl.DateTimeFormatOptions \| Intl.NumberFormatOptions \| ((value: XValue) => string)` | from the kind of x | As above. |
| `tickFormat` | `Intl.DateTimeFormatOptions \| Intl.NumberFormatOptions \| ((value: XValue) => string)` | from the kind of x | As above. |
| `domain` | `readonly [XValue, XValue]` | from the data | As above. |

## The chart handle

Every chart function returns a `Chart<Row, Options>`.

<!-- options: Chart -->
| Member | Type | Meaning |
|---|---|---|
| `update` | `(patch: Partial<Options>) => void` | Change options: a present key replaces, `undefined` restores the default, an absent key stays. See [Updating](updating.md#update-change-options). |
| `append` | `(rows: readonly Row[], options?: { keep?: number }) => void` | Add rows at the end. |
| `zoom` | `(domain: readonly [XValue, XValue] \| null) => void` | Set the visible x range; `null` shows everything. Where the chart does not zoom (a category axis, a donut, a compact chart), it changes nothing and reports [AX150](diagnostics.md#ax150). |
| `on` | `<E extends keyof ChartEvents<Row>>(event: E, listener: (payload: ChartEvents<Row>[E]) => void) => () => void` | Listen to `hover`, `select` or `zoom`; returns a function that removes the listener. |
| `diagnostics` | `readonly Diagnostic[]` | Diagnostics for the current options and data, current as soon as a call returns. |
| `destroy` | `() => void` | Remove the chart and everything it attached. Later calls do nothing. |

### append options

<!-- options: AppendOptions -->
| Key | Type | Default | Meaning |
|---|---|---|---|
| `keep` | `number` | every row | The number of distinct x values to retain; older ones are dropped. |

### Events

<!-- options: ChartEvents -->
| Event | Type | Meaning |
|---|---|---|
| `hover` | `Point<Row> \| null` | The datum under the pointer or the keyboard's point; `null` when nothing is picked. |
| `select` | `Point<Row>` | The reader clicked a point, or pressed Enter or Space on it. |
| `zoom` | `readonly [XValue, XValue] \| null` | A `zoom()` call or the reader changed the visible range; `null` for the whole range. Not sent when the view moves with appended data. |

<!-- options: Point -->
| Point key | Type | Meaning |
|---|---|---|
| `series` | `string` | The series key: the `series` value for long rows, the field name for wide rows, the slice label on a donut. |
| `x` | `XValue` | In the form `zoom()` accepts: a `Date` for an instant, `'YYYY-MM-DD'` for a calendar date, an ISO date-time without offset for a wall-clock time, the category, otherwise the number. |
| `y` | `number \| null` | The value; `null` for no data. |
| `row` | `Row \| null` | Your row; with typed columns, an object built from the columns at that index; `null` for a position no row holds. |
| `index` | `number` | The row's index in your data; `-1` when `row` is `null`. |

### Diagnostic

<!-- options: Diagnostic -->
| Key | Type | Meaning |
|---|---|---|
| `code` | `` `AX${number}` `` | Stable code, with a page under [Diagnostics](diagnostics.md). |
| `level` | `'error' \| 'warning' \| 'hint'` | See [levels](diagnostics.md#levels-and-who-is-told). |
| `message` | `string` | What is wrong, where, and how to fix it. |
| `chart` | `string` | The chart's title, else its element id. |
| `field` | `string` | The field or option, when it is about one. |
| `rows` | `readonly number[]` | The first offending rows in your data, at most ten, when it is about rows. |
| `count` | `number` | How many values or rows in all, when it counts them. |

## validate

`validate(type, options)` takes `'line'`, `'area'`, `'bar'`, `'scatter'` or `'donut'` and that type's options, runs the checks a created chart runs from its call without a DOM, and returns `Diagnostic[]`. It cannot find what needs a page: contrast, sizes, label fitting, formatters, or whether a `labelledBy` id exists. See [Diagnostics](diagnostics.md#validate-in-node-and-in-tests).

## Messages

Every message the chart shows the reader can be replaced through `messages`: the notes, states, controls, the table's labels, the generated name and summary. Diagnostics for developers keep the registry's English wording. Placeholders in braces are filled in by the chart; an override should keep the ones it needs. `{seeTable}` is filled with `seeTable` when the chart has a table and removed when it does not (`table: false`), so a translated note that keeps it reads right either way:

[example: messages-translated](../examples/messages-translated.ts)

Every key, with its built-in English text, read from the library when this site is built, and where the chart shows it:

[table: messages](../../../packages/axylo/src/messages/index.ts)

## Options that do not exist

There is no `width`, `height`, `responsive`, `theme`, `palette` or `animation` option. Size comes from the container, colours from [CSS](theming.md), and motion from the reader's settings: the first render is not animated, and nothing moves under reduced motion. Each of these names, like any unknown key, is ignored with [AX150](diagnostics.md#ax150), which suggests the closest known option.
