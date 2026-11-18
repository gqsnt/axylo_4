<!-- Author: Claude Opus 5.5 (high), agent a5e106319fe97c022; saved by the coordinator -->

## Node acceptance tests strengthened, and the simplification timing made robust

Every strengthened and new test passes: no assertion exposed behaviour the spec forbids, so there are no product findings. No titles were changed. `packages/axylo/src` and the browser acceptance files are untouched; nothing committed.

### 1. The simplification timing bound
**Source of the 30 ms:** no spec row gives it.
- P2 budgets a whole 1,000,000-point chart at 250 ms (task time, median of 20).
- The plan's "Simplified drawing" section only asks for the simplification pass to be measured separately from drawing.
- The number arrived with 01c3e19 ("Layout and simplification: fix the 14 findings from the Opus review").

**Change** (`packages/axylo/test/simplify/simplify.test.ts`, "keeps a million-slot outlier at multiple plot widths and device ratios"):
- The bound is now asserted on the median CPU time of the pass (`median('cpu')`) instead of wall time. Wall time is still printed.
- A comment states that the bound has no spec source and is a regression guard on the pass's own CPU time.
- The number stays 30. Measured: 5 to 6 ms CPU at every width and device pixel ratio.

### 2. What each test asserts now
#### New tests, listed for the matrix's author
**`production.test.ts`** (a production-define bundle of the host and controller). One test per title for each of: line, area, bar, scatter, donut, compact line, compact area, compact bar.
- `F3 {type}: an error prints once in a production build and the chart shows its error state`
  - AX101 at level error, printed once, no marks, the error message.
- `F3 {type}: in production a code prints once per page across two charts`
  - Two controllers share one page and console. Both report AX103; it is printed once.
- `F3 {type}: in production a hint is delivered to onDiagnostic and not printed`
  - AX104 is a hint, `onDiagnostic` receives it, nothing is printed.

**`dx-diagnostics.test.ts`**
- For line, area, bar, scatter, donut and compact:
  - `F3 {type}: a hint does not throw under strict (it is reported and the chart draws)`
  - `F3 {type}: a row getter that throws while the chart reads its data is AX199, an error delivered once, and the chart shows its error state`
    - Delivered once as an error, printed once, no marks, `defaultMessages.internalError`.
  - `F3 {type}: field and row indexes of an unreadable x and of a duplicate x name the caller's rows`
    - AX107 with field x, count 1, rows [1].
    - AX108's rows contain 2 and not 1. Scatter is exempt, since points sharing an x are ordinary data there (F11).
- For line, area, bar, scatter and donut:
  - `F3 {type}: a finding made after the call (AX142, a plot too small) does not throw under strict`

**Strict on create and on append** was already checked per type by `dx-controller.test.ts:124` ("DX5 {type}: strict create, update and append reject warnings synchronously…"). The gap list's "only update is checked" is stale, so I added nothing for it.

**`f-missing-values.test.ts`**
- `F2 {type}: {kind} draws an absent step on a regular instant axis as a gap, through the controller` (line, area, bar, each full and compact)
  - Hourly instants with 03:00 absent: AX105.
  - Line and area: the stroke breaks into runs of 3 and 3. Bar: 6 bars and 1 "no data" mark.
  - The table and the tooltip say "No data" at 03:00.
- `F2 scatter: an explicit null is a silent gap: no diagnostic, no note, and the table says No data`
- `F2 donut: a null slice reads No data in the tooltip and to the keyboard`
  - The tooltip row says "No data". The reading equals the `pointAll` and `position` templates filled in.

**`f-stacks.test.ts`**
- `F10 {area, bar}: the readout's total of an all-negative stack is its sum`
  - Totals "-8" and "-3", and the reading's `seriesValue` "Total -8".

**`f-disclosure.test.ts`**
- `F12 {line, area, bar, scatter}: an x that cannot be read (AX107) leaves the note and the summary statement`

**`f-donut.test.ts`**
- `F8 donut: a null slice while grouping happens stays listed on its own as No data, outside "Other" and the limit`
  - AX121 with count 2. 16 angles: seven arcs plus "Other (2)", none for the null slice.
  - The null slice is its own entry reading "No data". The table lists all ten categories in order.

**`f-time.test.ts`**
- `F4 {type}: mixing wall-clock times and instants with no calendar date is never silent: the minority rows are reported and not drawn` (line, area, bar, scatter, compact)
  - AX112 and AX107, with rows [2, 4] (the two instants).
  - The summary covers only the wall-clock values, and says "Values not shown: 2."

**`f-domains.test.ts`**
- `F1 {bar, compact}: horizontal bars include zero and every bar starts at the zero baseline`
  - Positive and all-negative data. One end of every bar sits at `value.map(0)`.
- `F7 {line, area, bar}: after a zoom on x, a y axis with no author domain is fitted to the values in view`
  - An outlier of 1,000 lies outside the zoom. The y domain covers 14 and stays below 1,000, and it ends on the first drawn tick at or beyond each extreme.
- `F7 {area, bar, compact}: a stacked {kind}'s automatic domain ends at the first tick at or beyond the stack totals`
  - Totals reach 75 while no single value exceeds 45. For compact, the domain equals the full chart's.
- `F7 {line, area}: a continuous x spans exactly its data and the x references it draws`
  - [2.3, 5.7] without references; [1.4, 8.2] with a line and a band.
- `F7 scatter: a date x spans exactly its data while a numeric x ends on drawn ticks`
- `F7 compact: a compact {kind} has the same value domain as the full chart, though it draws no ticks`

#### Strengthened in place (titles unchanged)
- **`dx-diagnostics.test.ts:155`**, AX130 "assigns a secondary cue": the ninth series has the first series' palette colour, and its marks differ from the first's in dash, marker or pattern.
- **`f-disclosure.test.ts:42`**, throwing formatter "still drawn": the value is checked as drawn, per type.
  - Donut: a second arc of 2/3 of the turn.
  - Bar: two value bars. Scatter: two points.
  - Line and area: the second vertex at (x 2, y 2).
- **`f-stacks.test.ts`**, "a missing component has zero height and the reader is told which stack is incomplete":
  - Compact: the summary contains exactly `incompleteAt` for position 2 and not for position 1.
  - Area and bar: the exact tooltip total, "5 and -5 (incomplete)" at x 2 and "9 and -5" at x 1.
- **`reader-model.test.ts:122`**, A3: once "Point 2 of 2" is removed from the reading, the x (or the slice) is still there and the other x is not.
- **`reader-model.test.ts:230`**, I3: the controls state the toolbar is built from has zoom `true` without the option, `'touch'` with it, and zoom off after the update.
  - The Node host cannot see the toolbar's buttons, so "hides controls" as painted remains a browser claim.
- **`reader-model.test.ts:267`**, I1: Series 3 now has no row at x 1, and its tooltip row reads "No observation", distinct from Series 2's explicit null ("No data").
- **`compact.test.ts:58`**, C2 "sorted final geometry": rows arrive as x 3, 1, 2. The geometry runs in x order with the values 5, 9, 20, checked on bar tops and on line and area vertices.
- **`dx-controller.test.ts:21`**, DX2: three more forms put the bad value at a different caller index. Each reports AX103 with the caller's row:
  - shuffled rows: row 2;
  - shuffled typed columns: row 2;
  - interleaved long form: row 3.
- **`dx-controller.test.ts:81`**, DX5 "switch together":
  - every figure model written in the switching frame already contains the new data;
  - the lookup object is new;
  - compact's lookup has all three values;
  - donut's new slice reads 72.

### `core/closing.test.ts:49` (the controller author's file; not edited)
What it should assert:
- At each height, `{ code: 'AX160', field: 'y', level: 'warning' }` is among the diagnostics exactly when a drawn y tick is 2, the value the formatter throws on. That tick's label is the default "2".
- The finding is delivered once and never thrown.
- It keeps the existing "no note" expectation for a tick label (F12).

### Runs
- `npx vitest run packages/axylo/test/acceptance packages/axylo/test/simplify`: `Test Files  17 passed (17)`, `Tests  611 passed (611)`.
- `npm run typecheck`: no errors.
- Whole Node suite: `Test Files  71 passed (71)`, `Tests  1606 passed (1606)`.

### Not done
Parts of gap 4 that were not in your list: AX141 outside line; AX143 on line, area and scatter; AX132 on compact bar; a throwing tick formatter on area, bar and scatter. I3's painted controls need a browser test.
