<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a5e106319fe97c022, resumed. Saved by the coordinator from the hand-back. -->

## Follow-ups: `missingRow`, and memory beyond the first append

Both follow-ups are done; nothing is committed. The bound and the contract are untouched. The kept P7 test is still the only Node failure.

### 1. `PointSeries.missingRow`
- **Where it is filled:**
  - Static normalisation (`pointFrame` in `src/data/normalize.ts`), in the same loop and order as `missingX`, from `table.rowIndex`.
  - The point store, as a `Column` beside `missingX`: appended, dropped by the same count on `keep`, shared through the same offset views, and rebuilt on replace and re-encode.
  - `ownedBytes()` counts it as "missing row", plus "frame series … missingRow".
- **Tests:**
  - The streaming model test (1,000 runs per store) checks that `missingRow` is present exactly when `missingX` is, with one source row per entry.
  - The shared-storage test checks the shared buffer and offsets, including the competing preview.
  - The test comparing the store with one normalization of the retained rows now remaps `missingRow` the same way it remaps `row`.
- **Re-encode by the store itself, tested:** a store holding `{x: 1, y: null, z: 11}` and an appended `{x: 3, y: null, z: 13}` keeps both rows retained. After `prepareReencode(store.resolveEncoding({x, y: 'z'}), version)` they come back as points: x `[1, 3]`, y `[11, 13]`, row `[1, 3]`. The row whose `z` is null becomes the missing one: `missingX [2]`, `missingRow [2]`.
- **What the controller must call or read:** either of these.
  - Let the store re-read: `store.prepareReencode(store.resolveEncoding(options, sink), version)`. It reads every retained row, missing-y rows included.
  - Or, if it builds the paused re-encode from a frame itself, include `frame.source.rowAt(series.missingRow[i])` for each `i`, next to the drawn rows from `series.row`. When `row` is null, point `i` came from row `i`.

### 2. Memory cases other than the first-append bound

**What changed:**
- **One copy of x per window.** For a wide chart over one sorted typed x column, the x history and the eviction seed now read from the store's own window buffer instead of each slicing its own copy. They re-point after every trim and after growth, so they never keep an old buffer alive. If the window ever didn't match the remaining prefix (checked at both ends), they fall back to the old copy-at-halfway rule.
- **Compaction:** after eviction, any buffer more than 2.25 × its window is cut to the window plus an eighth. Previously the rule was 4× and cut to 2×.
  - Why 2.25: growth doubles to 2 × (window + appended), so a window sliding by small appends stays at about 2× and is never cut and regrown in turn.
  - A cut costs one copy of the window, paid for by the evictions that made it necessary. This rule is shared by the aligned buffers, the point and donut columns, the labels and the x history.
- **Scatter: no index that only repeats the points.**
  - The per-row `positions` column is dropped while no retained row lacks a y, because it is then identical to the points' x.
  - The row index stays implicit while point i came from row i + shift. The frame gets `row: null` while the shift is 0, and an explicit index once points have left the front, as the contract requires.

**Measured `ownedBytes()` at 1,000,000 rows, versus what the contract needs:**

| Case | Before | Now | Contract floor |
|---|---:|---:|---:|
| Line, `keep: 400,000`, old revision retired | 34,687,704 B | 15,853,200 B | ≈14.8 MB |
| Scatter, one append | 28,114,816 B | 16,065,728 B | 16,000,016 B |
| Scatter, `keep: 400,000`, retired | 19,003,264 B | 15,219,648 B | ≈14.4 MB |

- **Line, `keep: 400,000`:** x 3.6 MB, y 3.6 MB, slot 0.45 MB, row index 1.8 MB, rows kept for `rowAt` 6.4 MB. The caller's columns are collected. The floor is x, y, slot and the row index for the 400,000-slot frame (the index is needed because slot i no longer came from row i), plus the x and y values that events and the table need once the caller's columns are released.
- **Scatter, one append:** only x and y, each 8,032,768 B. The floor is the same as line's: x and y must be contiguous arrays.
- **Scatter, `keep: 400,000`:** x 3.6 MB, y 3.6 MB, row 1.6 MB, rows 6.4 MB. The floor is x, y and the row index, plus the kept rows' x and y.
- **Line, `keep: 2`:** 464–1,530 B.

**What remains above the floor:** the one-eighth spare in each buffer. And whenever some rows lack a y, scatter keeps its `positions` column; that is about one extra x copy.

**Tests that count owned bytes:**
- Line keeping 80,000 and 150,000 of 200,000 typed rows: the caller's columns are collected, the x history and seed hold at most 1 KiB, and the total is within the floor plus an eighth spare plus 64 KiB.
- Scatter over typed columns: after one append there is no "x positions" or "row" entry and the frame's row is null; the total is at most 16 B per point plus the opening tail.
- Scatter keeping 80,000: the total is within its floor plus spare plus 64 KiB. Before the old revision retires, the store holds "rows kept for earlier frames", and the test asserts that entry.
- Disabling the sharing, or going back to the 4× rule, each makes these tests fail.

**Test oracles I changed:** two scatter oracles assumed an explicit `row` array; they now read a null row as point i came from row i, which is what the contract says null means:
- `checkFrame` in `test/data/streaming-storage.test.ts`
- the normalization-agreement test in `test/data/transactions.test.ts`

No expected value changed.

**Who is affected:** store frames for scatter can now have `row: null`. The lookup and the controller already handle that (`row?.[i] ?? i`).

### Files
- `packages/axylo/src/data/normalize.ts`
- `packages/axylo/src/data/store-unaligned.ts`
- `packages/axylo/src/data/store.ts`
- `packages/axylo/src/data/store-rows.ts`
- `packages/axylo/src/data/store-window.ts`
- `packages/axylo/src/data/store-bytes.ts`
- `packages/axylo/test/data/streaming-storage.test.ts`
- `packages/axylo/test/data/transactions.test.ts`

### Runs
- `npm run typecheck`: no errors; only the `tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist` line printed.
- Node suite:
  ```
  Test Files  1 failed | 65 passed (66)
       Tests  1 failed | 1403 passed (1404)
  ```
  The one failure is the kept P7 test: 17,069,760 B against 16,000,000 B.
- Browser render and type-matrix, after `npm run build`:
  ```
  Test Files  7 passed | 1 skipped (8)
       Tests  134 passed | 1 skipped (135)
  ```
  T-tooltip-scatter, which failed in my last pass with or without my lookup change, now passes. The shared `dist` is rebuilt from the current tree, other agents' work included.

Scratch files are removed.
