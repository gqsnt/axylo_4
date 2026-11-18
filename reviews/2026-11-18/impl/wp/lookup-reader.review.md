Review of packages/axylo/src/{lookup,reader,messages} and their tests. I read the brief, contracts, public Messages and spec 3.x first.

Snapshot: sources taken 02:40 on 2026-11-18 and unchanged at the end of the review. Between my first read and the snapshot, scatter.ts started putting `x` into refs. Because of that, test/lookup/scatter.test.ts currently fails 5 tests and the type check: its `point()` helper has no `x`. That is part of the known in-progress change and is not counted below.

All experiments were written only under the scratchpad (a vitest config there, with node_modules symlinked to the repo's).
- "Ran" means I executed it and saw the result.
- "Inferred" means I read it from the code without running it.

---

**1. B: keyboard focus gets stuck on a datum the view no longer reaches**
- **Where:** lookup/aligned.ts:210 (step guard) and 239-248 (resolve); lookup/scatter.ts:138-141 and 156.
- **Ran:**
  - Hidden series. Line, x 0..3, series a and b, `visible: [true, false]`, ref `{aligned, b, 1}`:
    - `resolve(ref)` returns the same ref.
    - `step(ref, d)` returns null for every direction, including `first` and `last`.
    - `ordinal` is -1, `anchor` is null, `datum` still returns text.
  - Zoom. 20 slots, `visibleSlots 10..20`, ref `y@3`: `resolve` returns itself and `step(ref, 'first')` is null.
  - Scatter. A ref in hidden series C: `resolve` returns itself, `step` is null.
- **Why the caller can't recover:** `ordinal === -1` and `anchor === null` are also what a legitimate "No data" datum reached by `series-next` returns (see 2). So the focus model cannot tell "stale" from "valid but empty", and the keyboard has nowhere to go.
- **Spec:**
  - A2 tests focus after hiding the focused series, and traversal in the zoomed state.
  - I3 allows keyboard zoom (+ / − / Shift+arrows), which moves the focused x out of range.
  - The contract: `step` "skips hidden series"; `resolve` "else the next one that is".
- **Fix:** treat a ref as present only when all of these hold:
  - its series is visible and drawable;
  - its slot is inside `visibleSlots` (or its point inside `visiblePoints`).

  Otherwise:
  - for a hidden series, go to `primary({kind:'x', x})` when x is visible;
  - for an x outside the range, go to the series' first value at or after the range start, or its last value before the end;
  - then null.

  `step` should start from that resolved datum. Add tests for both cases.

**2. M: `ordinal` and `count` disagree with what the keyboard reaches**
- **Where:** aligned.ts:187-204.
- **Ran:**
  - A has values at x 0 and 1; B only at x 1. `step(A@0, 'series-next')` lands on B@0 ("No observation") with `ordinal` -1 and `count` 3. `pointOf` would then read "Point 0 of 3".
  - Two full series over 4 slots, walking `next` along b: ordinals 1, 3, 5, 7, so it would announce "Point 2/4/6/8 of 8".
- **Spec:** the contract says `count` is the data the keyboard can reach and `ordinal` is a datum's place among them (-1 only if absent). A3 requires the position to be conveyed.
- **Tests:** aligned.test.ts:92 pins the -1. The brief's fast-check property only holds because aligned.test.ts:114 hides the second series.
- **Fix:** needs your decision. Either:
  - count every (visible series × visible slot) cell in x-then-series order, so non-values have a place; or
  - define position per series.

  Then add a property with at least two visible series.

**3. M: the table caption is empty under `labelledBy`**
- **Where:** reader/index.ts:118 and 133. The table is built with `name`, which is `''` when `labelledBy` is set.
- **Ran:** `labelledBy: 'h'` gives `table.caption === ''`.
- **Spec:** A4 says "the title as caption". An empty caption leaves the table unnamed.
- **Fix:** take the caption as its own input (the generated name, or the heading text the caller supplies). Never `''`.

**4. M: the F12 note says changed values are "not shown"**
- **Where:** reader/index.ts:121; messages/index.ts:11-12.
- **Ran:** `disclosure {omitted: 0, changed: 1}` gives "1 values not shown. See table." reader/index.test.ts:51 pins this string.
- **Inferred:**
  - AX121 is reported with effect `'changed'` (view/donut.ts). A donut with 12 categories would therefore read "5 values not shown" while those values are drawn inside "Other (5)".
  - `valuesChanged` exists in Messages but nothing in src uses it.
  - Counts go through `String()`, so "1234", not the locale's "1,234" (F6).
- **Fix:**
  - omitted → `valuesNotShown` with `{count: omitted}`;
  - changed → `valuesChanged` with `{count: changed}`;
  - both sentences when both apply;
  - wording that reads right for 1 ("Values not shown: {count}. See table.");
  - locale-formatted counts.

**5. M: built-in English strings bypass `messages` (A10)**
- **Where:** reader/index.ts:26 and 113-116; reader/table.ts:58 and 73.
- **Ran:**
  - A wide-form line with no y label gets the name "Line chart of Value by x" and the summary "Value from 1 to 3".
  - Donut table headers are `['Category', 'value', 'Percentage']`; the scatter table header is 'Series'.
- **Inferred:** the chart type word ("Line", "Donut") is a free `type` string with no Messages key. These strings can only be replaced through the internal `ReaderInput.labels`, not the public `messages`.
- **Fix:** a contract change. Add Messages keys (category, percentage, series, value, and the chart type names), or make these required inputs with no English default.

**6. m: stack total reads "0" where there is no data at all**
- **Where:** aligned.ts:104-109.
- **Ran:** stacked area with `{x: 0, a: null, b: null}` gives total "0 (incomplete)" while every row says "No data".
- **Spec:** F2 says missing values are never shown as zero.
- **Fix:** track whether any component was a value; if none, the total is `formatters.missing(SLOT_NULL)`.

**7. m: summary wording when values are missing**
- **Where:** reader/index.ts:44, 89-91 and 97-101.
- **Ran:**
  - An all-null series gives "b: minimum No data, maximum No data, last No data."
  - An all-null chart gives "a from No data to No data."
  - An empty visible range gives "No data to show." followed by "a: minimum No data, …".
- **Fix:** one "{series}: No data." sentence per such series; drop the y range when it is not finite; no series sentences after `empty`.

**8. m: the donut summary uses the cartesian template**
- **Where:** reader/index.ts:55-64 and 95-99.
- **Ran:** "Donut chart with 10 series. Category from C0 to C11. value from 0 to 30. C0: 10 (10.526316%)…"
  - Slices are called "series".
  - There is a meaningless "from … to" range over category names.
  - The min/max include categories grouped into Other.
- **Fix:** for donuts, skip the x and y ranges and state the slice count. This may need a dedicated template (a contract change).

**9. m: series that cannot be drawn vanish from the summary**
- **Where:** reader/index.ts:83.
- **Ran:** a duplicate-x series B (AX108) gives "Line chart with 1 series. … A: …" with no mention of B.
- **Spec:** the contract on `Series.drawable` says it "stays in the frame so the table and summary can say so".
- **Fix:** add a sentence for each such series. This needs a key, for example "{series} could not be drawn. See table."

**10. m: references give no position and are missing from the caption**
- **Where:** reader/index.ts:103-106; messages/index.ts:21; reader/table.ts:58.
- **Ran:**
  - A y reference "Goal" at 3 reads "Reference: Goal."
  - The code passes `axis`, `from` and `to`, which the default template never uses.
  - The caption is just "Line chart of a by x".
- **Spec:** 3.6 says references are "listed in the summary and table caption". The test at reader/index.test.ts:25 pins the label-only wording.
- **Fix:** templates that include the position ("Reference {label}: {from}." for a line, "from {from} to {to}" for a band); add the references to the caption.

**11. m: scatter does O(n) work per key press or per rebuild**
- **Ran:**
  - scatter.ts:81-97: `series-next` scans every visible point of the target series, with two `projection.map` calls each. That is 1.5 ms per press on 100,000 points.
  - scatter.ts:20-22: any ref that did not come from this lookup sorts all rows once. That covers every ref after a resize, zoom or append rebuild. It costs 17-20 ms for 200,000 points with unsorted rows, on top of an 8 ms grid build.
- **Fix:**
  - Locate a ref with `ref.x`: binary search on `series.x`, then scan the run of equal x for the row.
  - `series-next`: binary search the target series by x and look at a pixel window (or use the grid).

**12. m: cost grows faster than linearly with series count, and with clustered points**
- **Ran, `pointOrder.at` (point-order.ts:23-54) on 200,000 points:**

  | Series | ms per call |
  |---|---|
  | 8 | 0.05 |
  | 100 | 1.2 |
  | 500 | 6.7 |
  | 2,000 | 81 |

  Every `next` and every table `row(i)` calls it. A 100-row table page therefore takes about 0.7 s with 500 series and about 8 s with 2,000.
- **Ran, scatter-grid.ts:42-85:**
  - 200,000 points in one cell: each pointer move examines 400,000 candidates (2.4 ms).
  - All points coincident: 4.3 ms.
  - The coincidence pass walks the same cells again.
- **Fix:** `next`/`previous` as a successor search (O(m log n)); table pages through a k-way merge cursor; merge the two grid passes and split dense cells.

**13. m: cross-module coupling and a silent locale fallback**
- **Where and what:**
  - reader/table.ts:2-3 and 15-28 build the data module's internal XParser and Reports with positional internals.
  - lookup/text.ts:2 and 29-30, and reader/table.ts:6, format percentages with `format.defaultReadoutNumber`. This bypasses `Formatters`, so an author `format` and the AX160 path don't apply.
  - lookup/index.ts:11 and reader/index.ts:125 fall back to `Intl.NumberFormat().resolvedOptions().locale` (the runtime default) when `locale` is omitted. Values and percentages can then come out in different locales (F6).
- **Spec:** the contracts header says modules are written against the contracts and nothing else.
- **Fix:** take `readX(XValue) → number` and a percent formatter (or the locale) as required inputs.

**14. m: inconsistent end-of-range steps; donut `resolve` has no fallback**
- **Ran:** `page-next` at the end returns null for aligned (aligned.ts:223) but returns the same ref for scatter (scatter.ts:147-148). Donut (donut.ts:80-81) clamps the same way as scatter (inferred).
- **Inferred:** in donut.ts:86, a slice whose category was folded into "Other" by an update resolves to null, not to the Other slice that contains it.
- **Fix:** one rule (null when nothing moves); donut `resolve` through `slice.members`.

**15. m: tests that can't catch the defects above**
- aligned.test.ts:109-127:
  - The property has one visible series, with the hidden one placed after it. Multi-series ordinals, a hidden series between visible ones, and `series-next` are never generated.
  - `resolve(current)` toBe `current` cannot fail for a ref taken from the same frame.
- aligned.test.ts:92 and reader/index.test.ts:51 pin defective output: -1 for a reachable datum, and "1 values not shown" for a changed value.
- scatter.test.ts:75:
  - x is each point's position in its list, so no two points in a series share an x. The within-series y order and the `i - j` tiebreak are never reached.
  - Ranges always start at 0, and nothing is hidden.
  - This is partly forced by the data module, which currently raises AX108 for duplicate scatter x, contrary to F11 (outside these files). Hand-built PointFrames avoid it.
- Untested: reversed pixel ranges, irregular time spacing, a hidden focused series, a zoomed-out ref, an all-missing stack total, the `labelledBy` caption.

---

**Areas I tried hard to break and could not**
- **Aligned picking:** exact midpoints go to the later slot on forward and reversed ranges, including irregular time spacing. Also checked: both plot edges, a single slot, zoomed range, horizontal bars by y, a pointer outside the plot (ran).
- **Bar anchors:** they match the scene's rectangles exactly for grouped bars, stacked bars with mixed signs, stacked horizontal bars and date-axis bars (ran).
- **Scatter grid:** 20,000 random in-plot queries against brute force gave zero mismatches. These covered points on 24 px cell boundaries, an offset plot, non-square scales and negative coordinates. Ties went to the later row, and coincident points were capped at 8 with the full count of 12 (ran).
- **`pointOrder`:** `at` and `ordinal` against brute force over 2,000 fast-check runs, with partial ranges and duplicates: no failure (ran).
- **Donut:** angle picks at slice boundaries and on both sides of 12 o'clock, the hole and ring edges, the Other slice, arcless slices in keyboard order, and percentages were all correct (ran).
- **Table:** a 1,000,000-row model builds in 0.4 ms and `row(999999)` is O(1). `pageForX` is right at page boundaries, before and after the range, and for date, time and category inputs (ran).
- **`fill` and `resolveMessages`:** braces, `$&` and the placeholder syntax inside values are not re-interpreted; `{toString}` is left alone; single-key overrides work (ran).
- **Aligned eviction:** `resolve` picks the next surviving datum, then the previous, and returns null for a vanished series (ran).
