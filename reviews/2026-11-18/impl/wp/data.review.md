I ran every experiment below from esbuild bundles of the source in the scratchpad (/tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/exp). I did not touch the repository. The repo's own `npm run typecheck` and the data/diagnostics vitest files pass (60 tests). Paths below are relative to packages/axylo/src.

**1. B: absent steps are materialized with no upper bound, so normalize can crash or stall.** data/steps.ts:91 (`new Float64Array(gaps)`), data/store.ts:231.
- Input: x = [0,1,2,3,1e12] as line rows.
- Observed (ran): `RangeError: Array buffer allocation failed`, thrown out of normalize, `validateOptions` and `AlignedStore.append`.
- Other runs:
  - [0,1,2,3,5e7] gives 50,000,001 slots, 1.66 GB and 4.5 s.
  - Millisecond timestamps declared `type: 'time'` (B, B+1, B+2, B+3, then B+1 day) give 86,400,003 slots in 6.6 s.
  - Minute data followed by one row a year later gives 525,603 slots.
  - In the store, `append([{x:5e6}], {keep:10})` leaves 5,000,001 slots, because `keep` counts only observed x.
- Spec: F2 says an absent step is a gap. Nothing permits unbounded allocation, and nothing permits throwing instead of reporting.
- Fix: cap the inferred gap count, as a total and relative to the observations (for example at most N × observations). Beyond the cap, treat the series as irregular (SLOT_NO_ROW plus a hint) and never allocate.

**2. B: `type: 'date'` rejects every instant form.** data/x.ts:107 (the `date` branch accepts only strings).
- Input: `x: {field:'x', type:'date'}` over each of:
  - '2026-03-01T00:00:00Z' strings
  - `Date` objects
  - epoch milliseconds
- Observed (ran): every row raises AX107 and the frame is empty in all three cases.
- Spec: F4 says variants (b), (c) and (d) "with timeZone: 'UTC' or type: 'date': identical" to the date strings.
- Fix: in the `date` kind, accept `Date` objects, finite numbers and offset ISO strings, and map each to its UTC calendar day at 00:00 UTC with dateUnit 'day'.

**3. M: the x kind is decided by the first row, so shuffling changes the axis.** data/x.ts:47 (`if (kind === 'number' || kind === 'category') return kind;`).
- Input: x = ['n/a','2026-03-02','2026-03-01'].
- Observed (ran):
  - The axis becomes a category axis with one category ('n/a'), and both real dates are dropped with AX107.
  - The same rows in the order ['2026-03-02','n/a',…] give a date axis, with AX107 only on 'n/a'.
  - Fuzzing at 3% junk x reproduced this with number, month, ISO and date columns.
- Spec: F11 says a shuffled input gives the same frame. F3 says input is never guessed.
- Fix: infer over the whole column, by majority or with category only when no row parses as a temporal or number kind, and make the result independent of row order.

**4. M: space-separated date-times silently become categories in input order.** data/x.ts:7 and :30.
- Input: ['2026-03-02 10:00:00','2026-03-01 10:00:00','2026-03-03 10:00:00']. This is the default text form of SQL, Postgres and BigQuery timestamps.
- Observed (ran):
  - Kind is category, the positions follow input order (unsorted in time), and there is no diagnostic.
  - In the store with `keep:100`, 30,000 such appends retain 30,001 categories for 100 slots.
- Spec: F4 (date-times without an offset are wall-clock, with AX112), F11 (sorted by x), and "never guess silently".
- Fix: accept a space separator in `dateTime` and in the ISO-looking fallback, and normalize it to `T` before `Date.parse`.

**5. M: a wall-clock axis never gets gaps, so missing steps are bridged.** data/steps.ts:18 (`supportsSteps` excludes 'wall').
- Input: hourly '2026-03-01T00:00:00' … '07:00:00' with 04:00 missing.
- Observed (ran): 7 slots, all values, joined across the missing hour.
  - The same strings with `Z` give an inserted SLOT_GAP and AX105.
- Spec: F2 says missing values are "never bridged" and absent steps on a time or date axis are gaps. The brief listed only time, date and number, so this needs your call.
- Fix: treat 'wall' like 'time' with plain UTC arithmetic. There is no daylight saving on a wall axis.

**6. M: an invalid `timeZone` is never validated and can throw.** data/options.ts:126, data/x.ts:79, data/steps.ts:36.
- Input: `x: {field:'x', type:'time', timeZone:'Mars/Olympus'}`.
- Observed (ran):
  - With a missing day, normalize and `validateOptions` throw `RangeError: Invalid time zone specified`.
  - Without a missing day, the invalid zone passes into `XColumn.timeZone` for the formatters to hit later.
  - 'utc' is passed through without canonicalization.
- Spec: F3 says everything is reported. `validate()` must return diagnostics, not throw. No registry code covers this condition.
- Fix: check the zone once with `Intl.DateTimeFormat` inside try/catch, report it (AX150 on `x.timeZone`, or a new code) and fall back to the environment zone.

**7. M: invalid enum values pass through unchecked and can break the contract types.** data/options.ts:125 and :137.
- Observed (ran):
  - `type:'datetime'` (or `'Time'`) produces `XColumn.kind === 'datetime'`, which is outside XKind, and drops every row with an AX107 that blames the data.
  - `scale:'pct'` reaches `Series.valueScale`.
  - `missing:'zeros'` is silently treated as a gap.
- Spec: DX3 says that for untyped callers these mistakes are caught at run time (AX150).
- Fix: check `type`, `scale`, `missing` and `parse` against their literal sets. Report AX150 with the closest value and use the default.

**8. M: the streaming store leaks under `keep`, and its diagnostics outlive the window.** data/store-rows.ts:20 (positions that are not finite are never recorded), data/store.ts:379, data/store-buffers.ts (series never removed).
- Observed (ran), 50,000 appends with `keep:100` and 1 in 10 rows having a null x:
  - 5,100 rows retained in `StreamRows.added` and 5,011 trace entries.
  - `diagnostics` reports AX107 with count 5000 and rows [10,20,30], all long evicted. The reader's note would count all of them.
  - Missing series names behave the same way.
- Observed (ran), series churn (a new key every 100 rows): 201 series stay in the frame, 199 of them entirely SLOT_NO_ROW, and every append writes all of them.
- Category names are never evicted either (see finding 4).
- Spec: plan 1.5 retains only `keep` distinct x values. Memory must stay bounded. F12 counts only what is not shown.
- Fix:
  - Tie unplaceable rows to the current last x so they are evicted with it, or keep them in a bounded FIFO.
  - Drop series buffers whose window holds no observation.
  - Evict categories that no retained slot references.

**9. M: one-row appends of long-form data at a shared x are quadratic.** data/store.ts:405 (`copySeries` copies the whole window).
- Input: per x, `append([{x,s:'a'}])` then `append([{x,s:'b'}])`.
- Observed (ran): 10,000 x values cause 10,000 `copySeries` calls copying 50,015,000 elements.
  - Timing: 5k/10k/20k/40k x take 117/213/650/2140 ms.
  - The same data batched per x takes 20/39/85/152 ms.
- Spec: plan 1.5 asks for amortized O(appended) work with no full copy.
- Fix: write into a fresh tail slot (end) and leave the last shared slot alone. Alternatively, make the current revision's last slot private copy-on-write once per x, not once per append.

**10. M: AX101 is never raised for a chart that starts empty and is fed by `append`.** data/options.ts:178 (skipped when there are no rows); the store never re-checks.
- Input: `data: []`, `y: 'vlaue'`, then `append([{x:1,value:1},…])`.
- Observed (ran): AX102 (a warning), "absent in 3 records", with no list of keys and no suggestion. The chart draws nothing.
- Spec: AX101 is an error that lists the existing keys and the closest match. DX12 lists the misspelled-field trap.
- Fix: run the field-existence check on the first non-empty batch, or whenever every row of a batch lacks the field.

**11. M: dense alignment of long-form data has no guard.** data/normalize.ts:245.
- Observed (ran):
  - 1,000,000 rows, 1,000 series, disjoint x: 1e9 slots, 13.0 GB of ArrayBuffers, 12.2 s.
  - 200,000 rows, 2,000 series: 5.2 GB, 5.0 s.
- No diagnostic is raised before the allocation. AX130 is raised later, by the view.
- Spec: hot paths use typed arrays and no unbounded allocation; F9 caps meaningful series.
- Fix: before allocating, reject or cap when series × slots exceeds a budget, as a chart error with a code. Alternatively, raise AX130 early and stop.

**12. M: valid `messages` keys raise AX150.** data/options.ts:58.
- Input: `messages: {showSeries:…, hideSeries:…}`, which are both public keys of `Messages`.
- Observed (ran): two AX150 warnings, so a `strict` chart throws on valid options.
- Fix: add both keys, or derive the list from the `Messages` type through a typed constant.

**13. m: the reader's disclosure counts are wrong in both directions.** diagnostics/collector.ts:49, data/normalize.ts:141 and :347.
- Observed (ran):
  - A row with an unparseable x and y NaN counts 2 values not shown (AX107 + AX103).
  - A wide row with a null x and three y fields counts 1.
  - Value diagnostics fire for rows that are not in the frame (long-form rows with no series name; a donut row with a null label raises AX120).
  - An AX105 hint with effect 'changed' (under `missing:'zero'`) feeds the note, although section 3.5 says only warnings reach the reader.
- Fix: count per omitted slot or point. Skip value checks for rows already omitted for x, series or label. Give AX105 the effect 'none'.

**14. m: the data module imports another module.** data/steps.ts:2 imports `../scale/zone`.
- This is outside core/contracts.ts and public.ts.
- In the other direction, reader/table.ts and view/references.ts import `data/x` and `data/reports`.
- Fix: move the zone helpers behind a contract, or copy the two functions into data.

**15. m: diagnostic text and rows have quality problems.** diagnostics/collector.ts:20, diagnostics/registry.ts, data/options.ts:80.
- Merged rows are not deduplicated: "2 duplicates at rows 1, 1", and the same diagnostic added twice gives rows [3,3].
- AX108's example is the series key, formatted as if it were the duplicated value ("(\"y\")").
- AX105 lists raw epoch milliseconds ("(1772582400000)") and names neither the series nor the dates.
- Messages omit the registry's "what is drawn" part (plan 1.6: "Shown as a gap."). AX108 never says the series is not drawn.
- A non-string field gives `Field "x" … Did you mean "x"?`.
- Far-off names get nonsense suggestions ("qqqqqqqqqqqq" → "data").
- `createDiagnostic` with more than 10 rows and no count reports "1 non-finite value at rows 0…9".
- Fix: deduplicate rows. Format positions with the x kind. Add the outcome sentence. Suggest only within a distance threshold.

**16. m: gap positions on fractional number axes can duplicate.** data/steps.ts (`gapPosition`, `snapGap`).
- `snapGap` snaps only to observed x, so two series missing the same step can produce two slots (fuzz case: 0.39999999999999997 and 0.4), each a gap in one series and no-row in the other.
- Generated positions are not canonical decimals.
- Fix: round gap positions to the step's decimal precision, or snap them against the union of gap positions as well.

**17. m: the donut ignores `missing:'zero'`.** data/normalize.ts:328 (`readValues(…, false)`).
- Observed (ran): a null slice stays SLOT_NULL, and an absent value raises AX102 with effect 'omitted'.
- Contracts: `missing:'zero'` on a value field is applied by normalization.
- Fix: impute for the donut too, or report AX150 if it is deliberately unsupported.

**18. m: several tests do not test what they claim.**
- Narrow generators:
  - The normalize property uses integer x in −30..30 on a number axis only.
  - The streaming equivalence property is single-series, one row at a time, with no batches and no `keep` comparison.
  - No property checks that older frames stay unchanged (there is one example).
- An expected value copied from output: test/data/normalize.test.ts:234 asserts `rows: [2, 2]`, which is the duplicate-row artefact from finding 15.
- Missing spec cases:
  - The `type:'date'` variants of F4.
  - DST with a missing day (where the gap lands).
  - Europe/Paris and +05:30 zones for AX111.
  - AX111 cases that must not fire.
  - Space-separated date-times and first-row junk.
  - Long absent stretches and invalid zones.
- AX132 is in the registry but nothing in src raises it.
- The million-point test allows 700 ms for a 25 ms operation (28× slack) on a single run.

**Areas I tried hard to break and could not:**
- **Old-frame immutability:** 1,000 randomized append sequences (batches, out-of-order, same-x, new series, `keep`). No held frame ever changed against its deep copy.
- **Stream vs full normalization without `keep`:** 811 random cases (number, day, month and LA-instant axes; long and wide; gaps; mixed cadences). Frames and diagnostic counts were identical.
- **Frame invariants:** 3,000 random frames (7 x kinds × 3 forms × `missing:'zero'`). x was strictly ascending, y was NaN exactly where the slot is not a value, row was −1 only on NO_ROW, GAP or imputed slots, `rowAt` was valid, results were deterministic, and caller data was never mutated.
- **DST:** daily local-midnight instants across both 2026 changes, and a full year, in LA, Paris and Kolkata. No false AX105, gaps landed exactly at local midnight, and hourly, half-hourly and weekly-arbitrary instants raised no AX111.
- **Typed-column borrowing:** 1M ascending rows took about 25 ms with x and y borrowed. Infinity and zero imputation copy instead of writing through. Buffer capacity stays about 2× the window for clean streams.
- **Value and date parsing:** the dirty fixture and its one-bad-value variants, the AX104/AX106 split, '1e400' → AX103, invalid calendar dates (02-30, month 13/00), hour 25, minute 61, the leap day, +0530 and +05:30 offsets, fractional seconds, and lowercase t/z.
