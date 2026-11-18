You are implementing one module of Axylo, a browser charting library, in this repository. Other agents are working in the same checkout on other directories at the same time.

First read `AGENTS.md` and follow it exactly. Then read:
- `packages/axylo/src/core/contracts.ts`: the fixed interfaces. You produce `Frame` (AlignedFrame, PointFrame, DonutFrame), use the SLOT_* states and the join rule, and report through `DiagnosticSink` with `DiagnosticInput` (note its `effect` and `origin` fields).
- `packages/axylo/src/public.ts`: the public options you must accept (Data, Encoding, ValueField, XField, DonutOptions, ScatterOptions, CommonOptions, Diagnostic).
- `docs/02-product-spec.md`: criteria F2, F3, F4, F8, F10, F11, F12, DX2, DX3, DX4, and the diagnostic registry in section 3.5 (every AX code, its level, its condition and what is drawn). The expected results for the dirty fixtures are stated under the registry.
- `docs/03-plan-typescript-release.md` sections 1.2 (the three data forms and their shared rules), 1.3 (fields), 1.5 (commit contract: streaming rules) and 1.6 (the wording of diagnostic messages).

## You own (create and edit only these)
- `packages/axylo/src/data/**`
- `packages/axylo/src/diagnostics/**`
- `packages/axylo/test/data/**`
- `packages/axylo/test/diagnostics/**`

## What to build

Pure TypeScript that runs in Node. No DOM. No runtime dependencies.

1. **Diagnostics** (`diagnostics/`).
   - A registry: every code in spec 3.5 with its level and a message builder that produces text of the form "what, where, how to fix" (see plan 1.6 for the tone and an example). Messages name the field and give the first offending rows.
   - A collector implementing `DiagnosticSink`: merges by code, field and effect, adds counts, caps example rows at 10, keeps insertion order, and can return the list as public `Diagnostic` objects once given the chart's name.
   - A helper that computes the reader's disclosure from a diagnostic list: how many values were omitted and how many were changed (only effects 'omitted' and 'changed' count).

2. **Options resolution** (`data/options.ts`). Turn the public options of each chart type into one internal, fully explicit description: which field is x, which value fields there are and whether the data is long (one value field plus an optional series field) or wide (several value fields), each field's label, unit, scale, missing policy, parse flag, declared type and time zone. Reject what the types cannot catch at run time: an unknown option key raises AX150 and suggests the closest known key (edit distance); a field named in the options that is not a key of any row (or not a column) raises AX101, lists the keys that exist and suggests the closest.

3. **Normalization** (`data/normalize.ts` and helpers). `normalize(chartType, resolvedOptions, environment, sink, epochAndRevision) → Frame`.
   - Accept the three forms: long rows, wide rows, typed columns (`{ columns }`). Typed columns are borrowed: use the caller's y array directly when the data is already in ascending x order; never mutate it. Columns of different lengths raise AX100.
   - **x kind** (spec F4): strings `YYYY-MM-DD`, `YYYY-MM` and `YYYY` are calendar dates (`date`, position = that date at 00:00 UTC, with `dateUnit` = the precision written, the finest if mixed); ISO strings with `Z` or an offset and `Date` objects are instants (`time`); ISO date-times without an offset are wall-clock (`wall`, position = the written fields read as UTC, hint AX112); numbers are `number` unless the field is declared `type: 'time'` (then epoch milliseconds); other strings are `category` (position = index in first-seen order). A declared `type` wins over inference. A value that cannot be parsed as the column's kind raises AX107 and that row is not placed. Raise the hints AX109 (numbers declared `time` that look like seconds, or an undeclared numeric x that looks like epoch milliseconds) and AX111 (instants that all share one time of day and are whole days apart, within one hour for daylight saving: "these look like calendar dates"). Resolve `timeZone: 'local'` to `environment.timeZone`.
   - **Values**: a finite number is a value; `null` is SLOT_NULL; an empty string is SLOT_NULL; an absent key or `undefined` is SLOT_ABSENT_FIELD (AX102); `NaN` or an infinity in a row is SLOT_INVALID (AX103); in a typed column `NaN` is SLOT_NULL with no diagnostic. Strings: when every non-missing value of the field is a plain decimal string (optional sign, digits, optional fraction, optional exponent; nothing else, no thousands separators), parse the column and raise the hint AX104 once (no hint when the field says `parse: 'number'`); otherwise each string is SLOT_INVALID and AX106 is raised.
   - **Alignment** (aligned frames): the frame's x column holds every distinct x of any series, ascending (category: first-seen order). Each series has a y and a slot state for every x. Rows are sorted by x whatever the input order (spec F11). Two rows with the same x in one series raise AX108 with effect 'series-disabled'; the series keeps the first occurrence and gets `drawable: false`.
   - **Slots without a row.** For each series on a `time`, `date` or `number` axis, infer its own step: take the differences between its consecutive observed x positions (for `date`, in units of its `dateUnit`; for `time`, treat differences within one hour of a whole number of days as whole days); if the series has at least three observations, the smallest difference is the step when every difference is a whole multiple of it and at least half of them equal it. A slot that lies on that series' step grid and has no row is SLOT_GAP (an expected step is absent: raise AX105 with the count and the first positions); if no other series has that x either, insert the x position so the gap exists as a slot. Any other slot without a row is SLOT_NO_ROW. On a category axis a slot without a row is SLOT_NO_ROW.
   - **`missing: 'zero'`**: as described in the contracts next to the SLOT constants.
   - **Scatter** (`PointFrame`): per series, x and y sorted by x then y, keeping the source row of each point; a point with a missing or invalid x or y is left out and reported with the same codes.
   - **Donut** (`DonutFrame`): labels and values in the given order. A negative value raises AX120 with effect 'chart-error'. Duplicate labels raise AX108 with effect 'chart-error'. Zero and null are kept (the view decides what to draw).
   - Every diagnostic you raise has `origin: 'call'` and the right `effect` ('omitted' when a value is left out of the drawing, 'changed' when it is drawn differently from what was given, 'none' for hints that change nothing).
   - Every slot and point keeps the index of the caller's row it came from; `Frame.source.rowAt(i)` returns the caller's row (for typed columns, an object built on demand).

4. **Streaming store** (`data/store.ts`). A store that owns growable buffers for an aligned frame and supports `append(rows, { keep })` per plan 1.5: it returns a new frame with a higher revision and the same epoch, shares buffers with the previous frame (the new frame is a view onto the same buffers plus the appended part; amortized O(appended) work, no full copy), and with `keep` drops the oldest distinct x values beyond the limit. Rows before the last x are accepted by renormalizing everything and raise AX151. Appending to typed-column data and to wide and long rows must all work. Diagnostics for appended rows use the same rules.

5. **`validateOptions`** (`data/validate.ts`): runs options resolution and normalization for a chart type and returns the diagnostics, with no DOM (this backs the public `validate()`).

## Tests (required)

Expected values come from the spec, not from running your code and copying its output.
- One test per diagnostic code you raise, asserting the code, level, effect, field, example rows and count, and that the message names the field and the fix.
- The dirty fixtures exactly as the spec states their results (combined, and one bad value at a time: null, NaN, a string, undefined).
- A column of only numeric strings is parsed with AX104; with `parse: 'number'` there is no hint.
- A misspelled field raises AX101 and suggests the right key.
- F4: the same series as (a) date strings, (b) ISO strings with `Z`, (c) epoch milliseconds declared `time`, (d) `Date` objects: (a) gives kind `date`; (b), (c), (d) give kind `time`, raise AX111, and resolve the zone from the environment; an ISO date-time without an offset gives `wall` and AX112. Include a daily series across the March and November 2026 daylight-saving changes in America/Los_Angeles (stored as instants at local midnight) and check that AX105 is not raised for it, and a leap day.
- F2: a daily series with seven explicit nulls and the same series with those seven rows deleted both produce seven slots that may not be joined across (SLOT_NULL in one, SLOT_GAP with AX105 in the other). A weekly series next to a daily series is SLOT_NO_ROW between its observations and raises nothing.
- F11: a shuffled input gives the same frame as the sorted input. Duplicate x raises AX108 and marks the series not drawable.
- DX2: the same data as long rows, wide rows and typed columns gives equal x positions, equal values and equal slot states (with the documented difference that NaN in a typed column means missing), and diagnostics that point at each form's own row indexes.
- fast-check properties: x positions are strictly ascending; every y is NaN exactly where the slot is not a value; `row` indexes are valid; normalizing twice gives equal frames; appending row by row gives the same frame contents as normalizing all rows at once; with `keep = k` the frame never holds more than k distinct observed x values and always holds the latest ones.
- A million-point typed-column normalization finishes in well under a second on this machine and does not copy the y column when x is already ascending (assert buffer identity).

Run `npm run typecheck` and `npm test` from the repository root before you finish. If something outside your directories fails, say so and leave it alone.

Finish with the report described in AGENTS.md.
