# Your data

After this page you can pass the same table as long rows, wide rows or typed columns; say which kind of time your x values are; control what happens to missing values; and give values a unit, a format and a percent scale.

## One table, three shapes

Take seven numbers: sessions per day for two channels.

| day | Direct | Referral |
|---|---|---|
| 2026-03-02 | 3,120 | 410 |
| 2026-03-03 | 3,380 | 455 |
| 2026-03-04 | 3,290 | 390 |
| 2026-03-05 | 3,510 | 520 |

Axylo accepts this table in three shapes. All three produce the same chart, the same table view and the same diagnostics; row numbers in diagnostics and events always refer to your own data in the shape you gave it.

### Long rows

One row per x and series, as most SQL queries and APIs return it. `series` names the field that says which series a row belongs to.

[example: data-long](../examples/data-long.ts)

### Wide rows

One row per x, one field per series. `y` is a list of fields, and there is no `series`. Passing both is a type error, and at run time it raises [AX150](diagnostics.md#ax150).

[example: data-wide](../examples/data-wide.ts)

### Typed columns

One array per field under `columns`, all of the same length; different lengths are [AX100](diagnostics.md#ax100). This is the shape for large data. In a `Float64Array` or `Float32Array`, `NaN` means "no value" and raises nothing.

[example: data-columns](../examples/data-columns.ts)

## Fields

A field is a key of your rows, written as a string, or an object when it needs more:

```ts
x: 'day'
y: { field: 'sessions', label: 'Sessions', unit: 'visits' }
```

The object form adds a label (the axis title, and the series name in tooltip, table and announcements), a unit, formats, a scale, a missing-value rule and author bounds. The [options reference](options.md#value-fields) lists them all.

With TypeScript, field names are checked against your row type. A misspelled field, a text field on a value axis, or wide `y` together with `series` does not compile. With untyped rows (from `fetch().json()`, say) the same mistakes are reported at run time: a field that no row has is [AX101](diagnostics.md#ax101), and the message lists the fields that exist and the closest match.

## Three kinds of time

Dates are where charts most often go wrong without anyone noticing. Axylo keeps three kinds apart and never mixes them silently.

| Kind | Looks like | Means | Shown |
|---|---|---|---|
| Calendar date | `'2026-02-24'`, `'2026-02'`, `'2026'` | A day, month or year, wherever you are | The same in every time zone |
| Instant | Epoch milliseconds with `type: 'time'`, a `Date`, `'2026-02-24T09:30:00Z'`, `'2026-02-24T09:30:00+01:00'` | One moment, the same everywhere | In `timeZone` (default: the viewer's zone), with the zone named in the tooltip heading and the summary |
| Wall-clock time | `'2026-02-24T09:30'` (no offset) | What a clock showed, zone unknown | As written, with hint [AX112](diagnostics.md#ax112) |

### The off-by-one-day trap

A daily metric is a calendar date. Many back ends send it as an instant at UTC midnight: `'2026-02-24T00:00:00Z'`, or the epoch milliseconds of that moment. For a viewer in New York that moment is the evening of 23 February, so every daily value appears one day early. In Berlin it is still the 24th. The library is not wrong to show the instant in the viewer's zone; the data said "this moment", not "this day".

The example below has the same five values sent both ways. On this page your browser's time zone decides how the first chart reads: west of UTC, its first point is on the 23rd.

[example: dates](../examples/dates.ts)

Axylo notices instants that all fall at the same time of day, whole days apart, and raises hint [AX111](diagnostics.md#ax111). The fix is one of:

- Send calendar dates: `'2026-02-24'`. `new Date(ms).toISOString().slice(0, 10)` turns a UTC midnight into one.
- Keep the values and declare `x: { field: 'day', type: 'date' }`. Axylo then reads each instant (string, number or `Date`) as the calendar day it falls on in UTC.
- If they really are instants, and you want everyone to see UTC, set `x: { field: 'day', type: 'time', timeZone: 'UTC' }`.

### How Axylo decides

When `type` is not given, Axylo looks at every value of the x field and takes the kind most of them have:

- `YYYY-MM-DD`, `YYYY-MM` or `YYYY` strings are calendar dates.
- Date-time strings with `Z` or an offset, and `Date` objects, are instants.
- Date-time strings without an offset are wall-clock times.
- Numbers are numbers. A bare number is never taken for an instant: epoch milliseconds need `type: 'time'`, and numbers that look like timestamps raise hint [AX109](diagnostics.md#ax109).
- Anything else is a category, kept in the order it first appears.

A value that does not match the chosen kind (a day that does not exist, a different format) is [AX107](diagnostics.md#ax107): that row is not drawn, and the reader is told.

`timeZone` takes `'local'` (the default, the viewer's zone), `'UTC'`, or an IANA zone such as `'Europe/Paris'`. It applies to instants only. A zone the browser does not know is [AX152](diagnostics.md#ax152), and the viewer's zone is used.

Calendar periods other than years and months (quarters, ISO weeks) are categories in 1.0: write them as you want them read (`'2025 Q1'`) and set `ordered: true` on the x field so that their labels may be thinned when they do not fit.

## Missing values

Axylo never draws a missing value as zero and never connects a line across one, unless you ask.

| In your data | Drawn | Reported |
|---|---|---|
| `null`, or `''` | A gap | Nothing: this is how to say "no data" |
| `NaN` in a typed column | A gap | Nothing |
| The field absent from a row (`undefined`) | A gap | Warning [AX102](diagnostics.md#ax102), and the reader's note |
| `NaN` or `Infinity` in rows | A gap | Warning [AX103](diagnostics.md#ax103), and the reader's note |
| No row at all for a step of a regular axis (a missing day) | A gap, as if the row held `null` | Hint [AX105](diagnostics.md#ax105) |
| `0` | Zero | Nothing |

A value standing alone between two gaps is drawn as a point, so it does not vanish. On a bar chart a missing value gets a small "no data" mark at the baseline, distinct from a zero bar. Tooltip, table and announcements say "No data". When a warning means values were left out, the chart shows a short note to the reader ("Values not shown: 3. See table.") inside the figure, in every build.

For counts, where a day without a row means nothing happened, declare it: `missing: 'zero'` turns null and absent values of that field into zeros.

[example: missing](../examples/missing.ts)

Here are the values an application sends by mistake, all at once. The note under the chart is what the reader sees; the console has one line per code.

[example: line-dirty](../examples/line-dirty.ts)

## Numbers sent as strings

Some database drivers return counts and decimals as strings (Postgres `bigint` and `numeric`, BigQuery). Axylo treats two cases differently:

- A whole field of plain decimal strings (`'40'`, `'-1.5'`) is unambiguous: it is parsed and drawn, and hint [AX104](diagnostics.md#ax104) asks you to say so with `parse: 'number'`. With that, there is no hint, and TypeScript accepts the string field on a value axis.
- A string among numbers, or a string that is not a plain decimal (`'1,234'`, `'n/a'`), is a bug upstream. It is not drawn, and it is warning [AX106](diagnostics.md#ax106).

[example: numeric-strings](../examples/numeric-strings.ts)

## Order and duplicates

Rows can come in any order. Line, area and scatter charts are drawn in x order; categories keep the order in which they first appear.

[example: unsorted](../examples/unsorted.ts)

On a line, area or bar chart one x has one value per series. Two rows with the same x in the same series are error [AX108](diagnostics.md#ax108), and that series is not drawn: Axylo does not know whether you meant the sum, the last or the average. The same applies to two donut slices with the same label. On a scatter chart repeated x values, and repeated points, are ordinary data.

## Units, formats and percentages

| Option on a value field | What it does |
|---|---|
| `label` | The axis title, and the series name in tooltip, table and announcements. Default: the field name. |
| `unit` | Follows every value in tooltip, table and announcements, and is part of the axis title. |
| `format` | How values are written in tooltip, table and announcements: `Intl.NumberFormat` options, or a function. Default: the page locale's grouping, the full integer part and up to six significant fraction digits (`123,456.75`). |
| `tickFormat` | How axis ticks are written; may be shorter than `format`. Default: compact when it saves space (`50K`). |
| `scale: 'percent'` | The values are percentages from 0 to 100. |
| `scale: 'ratio'` | The values are fractions from 0 to 1, shown as percentages. |

A percent or ratio scale is declared, never guessed from a label. Its axis ends at full scale (100%) only when the largest value is at least half of full scale and not above it; otherwise it ends at the first tick at or above the data, so 4% is not drawn as a sliver of 100%. Numbers and dates are formatted for the `locale` option if given, else the document's language (`<html lang>`), else the browser's. A formatter function that throws is warning [AX160](diagnostics.md#ax160), and the default format is used for that value.

[example: units](../examples/units.ts)

Bar and area value axes always include zero, since a bar's length is its value. A `domain` that leaves zero out is widened, with warning [AX110](diagnostics.md#ax110). Line and scatter axes fit the data.

## What Axylo reads, keeps and copies

- **Rows** are read when the chart is created or updated and never changed. Their values are copied into Axylo's own typed arrays. Events hand back your own row object (`point.row`), and every diagnostic names rows by their index in your array.
- **Typed columns** of values (`Float64Array`, `Float32Array`) are borrowed: Axylo reads them in place and does not copy them, unless it must change a value (`Infinity`, or `missing: 'zero'`). Do not change a borrowed array in place afterwards; to change the data, pass new arrays with `update({ data })`.
- **Appended rows** are read once and added to the chart's own storage; `keep` limits how much is kept. See [Updating, streaming and zoom](updating.md#append-and-keep).

## Checking data before you draw

`validate(type, options)` runs the same reading and checking as a chart, without a page, and returns the diagnostics. Use it in Node, in a unit test, or in a coding agent's loop before rendering. See [Diagnostics](diagnostics.md#validate-in-node-and-in-tests).
