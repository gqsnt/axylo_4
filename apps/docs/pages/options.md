# Options reference

After this page you can look up any option of any chart type, any field option, and every member of the chart handle, with its type, its default and what it does. The groups follow the declarations in `packages/axylo/src/public.ts`, which are the source of truth. A test checks that every key in those declarations is on this page and that nothing on this page is missing from them.

`Row` is the type of one of your rows. For typed columns it is inferred from the columns.

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
| `data` | `readonly Row[] \| { columns }` | required | The rows, or typed columns of equal length. See [Your data](data.md). |
| `title` | `string \| Title` | none | Visible heading and accessible name. Without it (and without `labelledBy`) the name is generated, with AX140. |
| `labelledBy` | `string` | none | Id of an existing heading that names the chart, for cards that already show a title. |
| `subtitle` | `string` | none | A line under the title. |
| `description` | `string` | none | Added to the generated summary. The time zone and any omitted values are always stated. |
| `state` | `'ready' \| 'loading' \| { error: string } \| { empty: string }` | `'ready'` | Shows a loading, error or empty message inside the plot instead of the data. |
| `legend` | `'auto' \| false \| 'top' \| 'right' \| 'bottom'` | `'auto'` | Where the legend goes, or `false` for none. `'auto'` places it under the plot. A chart with one series has no legend entries. |
| `tooltip` | `boolean` | `true` | The pointer tooltip. Keyboard reading is not affected. |
| `table` | `boolean` | `true` | The "View as table" control. |
| `colors` | `Record<string, string>` | none | A CSS colour per series name (per slice label on a donut), the same on every chart. |
| `messages` | `Partial<Messages>` | English | Replacements for built-in text. See [Messages](#messages). |
| `locale` | `string` | the document's language | Locale for numbers and dates. |
| `strict` | `boolean` | `false` | Throw on any error or warning found while checking a call, from that call. |
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

Long rows name one `y` and a `series`; wide rows give `y` as a list and no `series`. The two forms are exclusive.

<!-- options: Encoding -->
| Option | Type | Default | Meaning |
|---|---|---|---|
| `x` | `XKey<Row> \| XField` | required | The x field. See [X fields](#x-fields). |
| `y` | `ValueField \| readonly ValueField[]` | required | The value field, or one field per series. See [Value fields](#value-fields). |
| `series` | `SeriesKey<Row>` | none | The field whose value names each row's series (long rows only). |

## Cartesian options

On line, area, bar and scatter charts.

<!-- options: CartesianOptions -->
| Option | Type | Default | Meaning |
|---|---|---|---|
| `zoom` | `boolean \| 'touch'` | `true` on date, time and number x | Zoom and pan. `'touch'` also takes pinch and two-finger drag on touch screens. Category x is not zoomable. |
| `reference` | `readonly Reference[]` | none | Reference lines and bands. See [Reference](#reference). |

### Reference

<!-- options: Reference -->
| Key | Type | Default | Meaning |
|---|---|---|---|
| `x` | `XValue \| readonly [XValue, XValue]` | none | A vertical line at an x value, or a band between two. |
| `y` | `number \| readonly [number, number]` | none | A horizontal line at a value, or a band between two. |
| `label` | `string` | required | Shown beside the line or band, and listed in the summary and the table caption. |

## Compact

<!-- options: CompactOption -->
| Option | Type | Default | Meaning |
|---|---|---|---|
| `compact` | `boolean` | `false` | Line, area and bar only. Marks only, as a static image with a text alternative. See [Compact](compact.md). |

## Area options

<!-- options: AreaOptions -->
| Option | Type | Default | Meaning |
|---|---|---|---|
| `stacked` | `boolean` | `false` | Stack the series; the tooltip adds the total. |

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
| `x` | `XKey<Row> \| ScatterXField` | required | The x field: like an [X field](#x-fields), with `type` limited to `'number'`, `'time'` or `'date'`, and no `ordered`. |
| `y` | `ValueField` | required | The value field. |
| `series` | `SeriesKey<Row>` | none | The field that groups points into series. |

## Donut options

<!-- options: DonutOptions -->
| Option | Type | Default | Meaning |
|---|---|---|---|
| `label` | `SeriesKey<Row>` | required | The field that names each slice. |
| `value` | `ValueField` | required | The value of each slice. Not negative. |

## Value fields

A value field is a key of `Row` whose values are numbers (or `null`), or an object. A key whose values are strings is accepted only in the object form with `parse: 'number'`.

<!-- options: ValueField -->
| Key | Type | Default | Meaning |
|---|---|---|---|
| `field` | `NumberKey<Row>`, or `StringKey<Row>` with `parse` | required | The key of the row. |
| `parse` | `'number'` | none | The field holds numbers as strings (Postgres `bigint`, BigQuery); parse them. |
| `label` | `string` | the field name | Axis title, and the series name in tooltip, table and announcements. |
| `unit` | `string` | none | Follows values in tooltip, table and announcements: `'ms'`, `'USD'`. |
| `scale` | `'percent' \| 'ratio'` | none | Percentage data: `'percent'` is 0–100, `'ratio'` is 0–1. Never inferred. |
| `format` | `Intl.NumberFormatOptions \| (value: number) => string` | locale grouping, up to 6 significant fraction digits | How values are written in tooltip, table and announcements. |
| `tickFormat` | `Intl.NumberFormatOptions \| (value: number) => string` | compact when it saves space | How axis ticks are written. |
| `missing` | `'gap' \| 'zero'` | `'gap'` | What a missing value means. `'zero'` is for counts where absence means none. |
| `domain` | `readonly [number, number]` | from the data | Author bounds. On bar and area, widened to include zero (AX110). |

## X fields

An x field is a key of `Row` whose values are numbers, strings or `Date`s, or an object.

<!-- options: XField -->
| Key | Type | Default | Meaning |
|---|---|---|---|
| `field` | `XKey<Row>` | required | The key of the row. |
| `type` | `'number' \| 'time' \| 'date' \| 'category'` | inferred | `'date'`: calendar dates; `'time'`: instants; numbers are never inferred to be instants. See [the three kinds of time](data.md#three-kinds-of-time). |
| `ordered` | `boolean` | `false` | Category axes: the categories have a natural order, so labels may be thinned when they do not fit. |
| `timeZone` | `'local' \| 'UTC' \| string` | `'local'` | For instants only: the zone they are shown in. `'local'` is the viewer's. |
| `label` | `string` | the field name | Axis title (a date, time or category axis is titled only when you give one). |
| `unit` | `string` | none | Follows x values in tooltip, table and announcements. |
| `format` | `Intl.DateTimeFormatOptions \| Intl.NumberFormatOptions \| (value: XValue) => string` | from the data | How x values are written in tooltip, table and announcements. |
| `tickFormat` | same as `format` | from the data | How x ticks are written. |
| `domain` | `readonly [XValue, XValue]` | from the data | Author bounds for x. |

For scatter charts the x field takes the same keys except `ordered`:

<!-- options: ScatterXField -->
| Key | Type | Default | Meaning |
|---|---|---|---|
| `field` | `XKey<Row>` | required | As above. |
| `type` | `'number' \| 'time' \| 'date'` | inferred | No `'category'`: a scatter relates two measures. |
| `timeZone`, `label`, `unit`, `format`, `tickFormat`, `domain` | as above | as above | As on an x field. |

## The chart handle

Every chart function returns a `Chart<Row, Options>`.

<!-- options: Chart -->
| Member | Type | Meaning |
|---|---|---|
| `update` | `(patch: Partial<Options>) => void` | Change options: a present key replaces, `undefined` restores the default, an absent key stays. See [Updating](updating.md#update-change-options). |
| `append` | `(rows: readonly Row[], options?: { keep?: number }) => void` | Add rows at the end. |
| `zoom` | `(domain: readonly [XValue, XValue] \| null) => void` | Set the visible x range; `null` shows everything. |
| `on` | `(event, listener) => () => void` | Listen to `hover`, `select` or `zoom`; returns a function that removes the listener. |
| `diagnostics` | `readonly Diagnostic[]` | Diagnostics for the current options and data, current as soon as a call returns. |
| `destroy` | `() => void` | Remove the chart and everything it attached. Later calls do nothing. |

### append options

<!-- options: AppendOptions -->
| Key | Type | Default | Meaning |
|---|---|---|---|
| `keep` | `number` | all rows | The number of distinct x values to retain; older ones are dropped. |

### Events

<!-- options: ChartEvents -->
| Event | Payload | Meaning |
|---|---|---|
| `hover` | `Point<Row> \| null` | The datum under the pointer or the keyboard's point; `null` when it leaves. |
| `select` | `Point<Row>` | The reader clicked a point, or pressed Enter or Space on it. |
| `zoom` | `readonly [XValue, XValue] \| null` | The visible range changed; `null` for the whole range. |

<!-- options: Point -->
| Point key | Type | Meaning |
|---|---|---|
| `series` | `string` | The series name; on a donut, the slice label. |
| `x` | `XValue` | The x value. |
| `y` | `number \| null` | The value; `null` for no data. |
| `row` | `Row \| null` | Your row. With typed columns, an object built from the columns at that index. |
| `index` | `number` | The row's index in your data. |

### Diagnostic

<!-- options: Diagnostic -->
| Key | Type | Meaning |
|---|---|---|
| `code` | `` `AX${number}` `` | Stable code, with a page under [Diagnostics](diagnostics.md). |
| `level` | `'error' \| 'warning' \| 'hint'` | See [levels](diagnostics.md#levels-and-who-is-told). |
| `message` | `string` | What is wrong, where, and how to fix it. |
| `chart` | `string` | The chart's title, else its element id. |
| `field` | `string` | The field, when it is about one. |
| `rows` | `readonly number[]` | The first offending rows in your data, at most ten. |
| `count` | `number` | How many values or rows in all. |

## validate

`validate(type, options)` takes `'line'`, `'area'`, `'bar'`, `'scatter'` or `'donut'` and that type's options, runs the checks a created chart runs from its call without a DOM, and returns `Diagnostic[]`. See [Diagnostics](diagnostics.md#validate-in-node-and-in-tests).

## Messages

Every built-in string can be replaced through `messages`. Placeholders in braces are filled in by the chart; an override should keep the ones it needs. The defaults below are read from the library when this site is built.

[table: messages](../../../packages/axylo/src/messages/index.ts)

## React components

`Line`, `Area`, `Bar`, `Scatter` and `Donut` from `@axylo/react` take the chart type's options as props, plus these. See [React](react.md).

<!-- options: ReactProps -->
| Prop | Type | Meaning |
|---|---|---|
| `id` | `string` | Attribute of the container. |
| `className` | `string` | Added to the container's class `axylo`. |
| `style` | `CSSProperties` | Style of the container. |
| `data-*` | `string \| number \| boolean` | Data attributes of the container. |
| `ref` | `Ref<ChartRef>` | Receives `{ chart }`. |
| `onHover` | `(point: Point<Row> \| null) => void` | The `hover` event. |
| `onSelect` | `(point: Point<Row>) => void` | The `select` event. |
| `onZoom` | `(domain: readonly [XValue, XValue] \| null) => void` | The `zoom` event. Not on `Donut`. |

<!-- options: ChartRef -->
| `ChartRef` key | Type | Meaning |
|---|---|---|
| `chart` | `Chart<Row, Options> \| null` | The chart's handle; `null` before mount, after unmount and on the server. |

## Options that do not exist

There is no `width`, `height`, `responsive`, `theme`, `palette` or `animation` option. Size comes from the container, colours from [CSS](theming.md), and motion from the reader's settings: the first render is not animated, and nothing moves under reduced motion. Each of these names, like any unknown key, is ignored with [AX150](diagnostics.md#ax150), which suggests the closest known option.
