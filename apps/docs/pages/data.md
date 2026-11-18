# Your data

After this page you can pass the same table as long rows, wide rows or typed columns; say which kind of time your x values are; control what happens to missing values; and give values a unit, a format and a percent scale.

## One table, three shapes

Take four days with two readings per day: sessions for two channels.

| day | Direct | Referral |
|---|---|---|
| 2026-03-02 | 3,120 | 410 |
| 2026-03-03 | 3,380 | 455 |
| 2026-03-04 | 3,290 | 390 |
| 2026-03-05 | 3,510 | 520 |

Axylo accepts this table in three shapes. All three produce the same chart, the same table view and the same diagnostics; row numbers in diagnostics and events refer to your own data in the shape you gave it.

### Long rows

One row per x and series, as most SQL queries and APIs return it. `series` names the field whose value says which series a row belongs to; that value is the series' key and its name.

[example: data-long](../examples/data-long.ts)

### Wide rows

One row per x, one field per series. `y` is a list of fields, and there is no `series`. Passing both is a type error, and at run time it raises [AX150](diagnostics.md#ax150). Each field is a series: its key is the field name (`direct`), its name for the reader is the field's `label` (`'Direct'`). Use the key in `colors` and in event handlers, and the label for display. The series share one value axis: the first field's `domain`, `scale` and `tickFormat` set it (a `tickFormat` on a later field is reported, [AX150](diagnostics.md#ax150)), and with more than one field the axis is titled "Value" (the `value` message). The chart's generated name and its summary name the series rather than that axis ("Line chart of Visits and Signups by day", with fields labelled `'Visits'` and `'Signups'`). When the series have different units, the summary gives each series' range in its own unit and no range for the chart as a whole.

[example: data-wide](../examples/data-wide.ts)

### Typed columns

`data: { columns }` with one array-like per field (an array or a typed array), all of the same length; different lengths are error [AX100](diagnostics.md#ax100). In a `Float64Array` or `Float32Array`, `NaN` means "no value" and raises nothing. This shape suits large data, because Axylo can read such a column in place; see [what Axylo reads, keeps and copies](data.md#what-axylo-reads-keeps-and-copies).

[example: data-columns](../examples/data-columns.ts)

## Fields

A field is a key of your rows, written as a string, or an object when it needs more:

```ts
x: 'day'
y: { field: 'sessions', label: 'Sessions', unit: 'visits' }
```

The object form adds a label (the axis title, and the series name in tooltip, table and announcements), a unit, formats, a scale, a missing-value rule and author bounds. The [options reference](options.md#value-fields) lists them all.

With TypeScript, field names are checked against your row type. A misspelled field, a text field on a value axis, or wide `y` together with `series` does not compile. With untyped rows (from `fetch().json()`, say) the same mistakes are reported at run time: a field that no row has is [AX101](diagnostics.md#ax101), and the message lists the keys the rows do have and, when one is close, the closest match. With no rows, there is nothing to check a field against, and nothing is reported.

## Three kinds of time

Dates are where charts most often go wrong without anyone noticing. Axylo keeps three kinds apart and never mixes them silently.

| Kind | Looks like | Means | Shown |
|---|---|---|---|
| Calendar date | `'2026-02-24'`, `'2026-02'`, `'2026'` | A day, month or year, wherever you are | The same in every time zone |
| Instant | Epoch milliseconds with `type: 'time'`, a `Date`, `'2026-02-24T09:30:00Z'`, `'2026-02-24T09:30:00+01:00'` | One moment, the same everywhere | In `timeZone` (default: the viewer's zone), with the zone named in the tooltip heading and the summary |
| Wall-clock time | `'2026-02-24T09:30'` (no offset) | What a clock showed, zone unknown | As written, with hint [AX112](diagnostics.md#ax112) |

### The off-by-one-day trap

A daily metric is a calendar date. Many back ends send it as an instant at UTC midnight: `'2026-02-24T00:00:00Z'`, or the epoch milliseconds of that moment. For a viewer in New York that moment is the evening of 23 February, so every daily value appears one day early. In Berlin it is still the 24th. Showing the instant in the viewer's zone is correct for an instant; the data said "this moment", not "this day".

The example below has the same five values sent both ways. Your browser's time zone decides how the first chart reads: west of UTC, its first point is on the 23rd.

[example: dates](../examples/dates.ts)

Axylo notices at least two distinct instants that all fall at the same time of day, whole days apart, and raises hint [AX111](diagnostics.md#ax111). The fix is one of:

- Send calendar dates: `'2026-02-24'`. `new Date(ms).toISOString().slice(0, 10)` turns a UTC midnight into one.
- Keep the values and declare `x: { field: 'day', type: 'date' }`. Axylo then reads each instant (string, number or `Date`) as the calendar day it falls on in UTC, as the [daily example](getting-started.md#daily-data-five-things-to-get-right) does.
- If they really are instants and everyone should see UTC, set `x: { field: 'day', type: 'time', timeZone: 'UTC' }`.

### How Axylo decides

When `type` is not given, each value of the x field votes for a kind:

- `YYYY-MM-DD`, `YYYY-MM` or `YYYY` strings for a calendar date;
- date-time strings with `Z` or an offset, and `Date` objects, for an instant;
- date-time strings without an offset for a wall-clock time;
- finite numbers for a number. A bare number is never taken for an instant: epoch milliseconds need `type: 'time'`, and numbers that look like timestamps raise hint [AX109](diagnostics.md#ax109);
- anything else for a category.

Categories win when they are at least as many as all the other votes together. Otherwise the kind with the most votes wins, ties going to date, then instant, then wall-clock time, then number. Values of any other kind are then unusable: they are not drawn, and they raise [AX107](diagnostics.md#ax107) with a note to the reader. Three category strings, two dates and two numbers therefore make a date axis that keeps the two dates. When a feed mixes kinds, declare `type`.

Categories keep the order in which they first appear.

`timeZone` takes `'local'` (the default, the viewer's zone), `'UTC'`, or an IANA zone such as `'Europe/Paris'`. It applies to instants. A zone the browser does not know is [AX152](diagnostics.md#ax152), and the viewer's zone is used.

Calendar periods other than years and months (quarters, ISO weeks) are categories in 1.0: write them as you want them read (`'2025 Q1'`) and set `ordered: true` on the x field so that their labels may be thinned when they do not fit.

## Missing values

Axylo never draws a missing value as zero unless you ask, and does not connect a line across a missing value it knows about. It knows about one when your data says so:

| In your data | Drawn | Reported |
|---|---|---|
| `null`, or `''` | A gap | Nothing: this is how to say "no data" |
| `NaN` in a `Float64Array` or `Float32Array` | A gap | Nothing |
| The value field absent from a row (`undefined`) | A gap | Warning [AX102](diagnostics.md#ax102), and the reader's note |
| The x or series field absent from a row | The row is not drawn | Warning [AX102](diagnostics.md#ax102), and the reader's note |
| `NaN` or `Infinity` in rows | A gap | Warning [AX103](diagnostics.md#ax103), and the reader's note |
| `0` | Zero | Nothing |

A day with **no row at all** is different: the data says nothing about it. Axylo infers that a step is missing only from a series' own rows, when the x axis is dates, instants, wall-clock times or numbers and the series is regular: it has at least three rows, every interval between neighbouring rows is a whole multiple of the smallest one, and at least half of the intervals are the smallest one. A missing step it infers is drawn as a gap, as if the row held `null`, with hint [AX105](diagnostics.md#ax105). It infers nothing before the first row or after the last, in a series of one or two rows, in an irregular series, or when there would be more than twice as many missing steps as rows (and more than 1,000). Another series having a row at that x does not make the step missing in this one. So **when you know a day is missing, send it with `null`**: that is the instruction Axylo always follows.

A value standing alone between two gaps is drawn as a point, so it does not vanish. On a bar chart a missing value gets a small "no data" mark (at the baseline, or for a stacked bar at the edge of its stack), distinct from a zero bar. Tooltip, table and announcements say "No data". When a warning means values were left out, the chart shows a short note to the reader ("Values not shown: 3. See table.") inside the figure, in every build.

For counts, where a day without a row means nothing happened, declare it: `missing: 'zero'` turns null, absent and inferred-missing values of that field into zeros, and the note says the values are shown differently from the data.

[example: missing](../examples/missing.ts)

Here are the values an application sends by mistake, all at once. The note under the chart is what the reader sees; the console has one line per code.

[example: line-dirty](../examples/line-dirty.ts)

## Numbers sent as strings

Some database drivers return counts and decimals as strings (Postgres `bigint` and `numeric`, BigQuery). Axylo looks at the whole field:

- When every value is a plain decimal string (`'40'`, `'-1.5'`, and exponent notation such as `'1e3'`), the field is converted and drawn, and hint [AX104](diagnostics.md#ax104) asks you to say so with `parse: 'number'`. With that, there is no hint, and TypeScript accepts the string field on a value axis.
- When the field also holds a number, or any string that is not a plain decimal (`'1,234'`, `'n/a'`), or another kind of value (`true`), every string in it is rejected, plain decimals included. They are not drawn, and they are warning [AX106](diagnostics.md#ax106).

The conversion is to JavaScript numbers. Integers are exact up to 9,007,199,254,740,991 (`Number.MAX_SAFE_INTEGER`); a larger one is rounded to the nearest number JavaScript can hold, without a diagnostic: `'9007199254740993'` reads 9,007,199,254,740,992. A string too large for a number (`'1e999'`) becomes infinite and is [AX103](diagnostics.md#ax103). When exact counts could exceed that limit, check them with `Number.isSafeInteger(Number(value))` before charting.

[example: numeric-strings](../examples/numeric-strings.ts)

## Order and duplicates

Rows can come in any order. Line, area and scatter charts are drawn in x order, and each value stays with its own row; categories keep the order in which they first appear.

[example: unsorted](../examples/unsorted.ts)

On a line, area or bar chart one x has one value per series. Two rows with the same x in the same series are error [AX108](diagnostics.md#ax108): that series is not drawn, while the other series are; with no series left to draw, the chart shows its error state and keeps its table. Axylo does not know whether you meant the sum, the last or the average. Two donut slices with the same label are the same error, and the donut is not drawn. On a scatter chart repeated x values, and repeated points, are ordinary data.

## Units, formats and percentages

| Option on a value field | What it does |
|---|---|
| `label` | The axis title, and the series name in tooltip, table and announcements. Default: the field name. |
| `unit` | Follows every value in tooltip, table and announcements, and is part of the axis title. |
| `format` | How values are written in tooltip, table and announcements: `Intl.NumberFormat` options, or a function. Default: the locale's grouping, the full integer part and up to six significant fraction digits (`123,456.75`). |
| `tickFormat` | How axis ticks are written. Default: the locale's grouping with the fraction digits the tick step needs (`50,000`); compact (`1.2M`) when the largest tick is at least a million; scientific from 10¹⁵. |
| `scale: 'percent'` | The values are percentages from 0 to 100. |
| `scale: 'ratio'` | The values are fractions from 0 to 1, shown as percentages. |

A percent or ratio scale is declared, never guessed from a label. Its axis ends at full scale (100%) only when the largest value is at least half of full scale and not above it; otherwise it ends at the first tick at or above the data, so 4% is not drawn as a sliver of 100%. Numbers and dates are formatted for the `locale` option if given, else the document's language (`<html lang>`), else the browser's. A formatter that fails (a function that throws, or `Intl` options that `Intl` rejects) is warning [AX160](diagnostics.md#ax160), and the default format is used for that value.

[example: units](../examples/units.ts)

Bar and area value axes always include zero, since a bar's length and an area's height are their values. A `domain` that leaves zero out is widened, with warning [AX110](diagnostics.md#ax110). Line and scatter axes fit the data.

Value axes (y, and both axes of a scatter chart) end on a drawn tick at or beyond the data, the reference lines and bands, and stack totals; in a plot too narrow to label an end tick, the axis takes the next coarser step. A date, time or number x axis of a line, area or bar chart spans exactly its data instead (for bars, plus half a band at each end), so a time series is not padded to the next round tick.

## What Axylo reads, keeps and copies

- **Rows** are read when the chart is created or updated, and never changed. Their values are copied into Axylo's own typed arrays. Events hand back your own row object (`point.row`), and diagnostics name rows by their index in your data. A position no row of yours holds (an inferred missing day, a donut's "Other") has `row: null` and `index: -1`; check before you look a row up.
- **Typed columns** of values (`Float64Array`, `Float32Array`) are read in place, without a copy, when Axylo can: the x values are already in order, no missing step is inferred, and no value has to change (no `Infinity`, no `missing: 'zero'` to apply). Otherwise Axylo copies what it needs; grouping long columns into series and scatter charts can need new storage too. Either way, do not change an array after passing it: to change the data, pass new arrays with `update({ data })`.
- **Appended rows** are read once and added to the chart's own storage; `keep` limits how much is kept. See [Updating, streaming and zoom](updating.md#append-and-keep).

## Checking data before you draw

`validate(type, options)` runs the same reading and checking as a chart, without a page, and returns the diagnostics. Use it in Node, in a unit test, or in a coding agent's loop before rendering. See [Diagnostics](diagnostics.md#validate-in-node-and-in-tests).
