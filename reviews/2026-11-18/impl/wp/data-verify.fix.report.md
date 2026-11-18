<!-- Author: Claude Opus 5.5 (high), agent a5e106319fe97c022; observed model in transcript: claude-opus-5-5; saved by the coordinator -->

## Plot-edge slack: fixed (commit this first)

**What failed before.** `contains()` refused any pointer position outside the plot rectangle, even by 0.27 px. Firefox and WebKit truncate pointer positions to whole pixels, so a mark on a fractional edge could not be pointed at. Two existing Node tests encoded that old rule (details under Tests).

**What changed.**
- New `pointerOnPlot(rect, x, y)` in `src/lookup/geometry.ts`, with `POINTER_SLACK = 1`. A position up to 1 CSS px outside the rectangle (inclusive) is moved onto it, then picked as usual. Anything further out, or NaN, picks nothing.
- It is used by `pick` in three lookups:
  - aligned: the slot is chosen from the clamped x, or the clamped y for horizontal bars;
  - scatter: the whole pick runs from the clamped point, on both the exact index and the lattice index;
  - donut: the radius and angle are taken from the clamped point.
- It is not used for:
  - which points go into the scatter index when it is built: still exact `contains()`, so a point outside the plot is never pickable;
  - `anchor()`, which reports where marks are drawn, not where the pointer is.
- The lattice pick and the donut's thin-slice rule run unchanged after the clamp.

**Tests.**
- In each of `test/lookup/{aligned,scatter,donut}.test.ts`:
  - 0.27, 0.99 and 1.0 px outside each edge (and corners for scatter) pick what the edge position picks;
  - 1.01 px outside picks nothing;
  - a property test: any position in the rectangle grown by 1 px picks the same as its clamped position.
- The scatter cases run at ratio 1 and 2, exact and forced lattice, and with the exact ratio. Setting the slack to 0 fails 15 tests.
- Two existing assertions encoded the old rule; I changed them to the new one, citing the decision:
  - `aligned.test.ts`: −0.1 and 100.1 now pick as the edge; ±1.01 picks nothing;
  - `scatter.test.ts`: `left − 1` now picks as `left`; `left − 1.01` picks nothing.

**Contract sentence to add to `Lookup.pick`, if you want one:** "Pointer positions are known to one CSS pixel: a position up to 1 CSS px outside the plot rectangle is picked as if on the nearest point of its edge; further out, nothing is picked."

**Files.**
- `src/lookup/geometry.ts`, `src/lookup/aligned.ts`, `src/lookup/donut.ts` (slack only).
- `src/lookup/scatter-grid.ts`: slack in the head of `pick()`.
- Tests: the edge-slack describes in the three lookup test files, plus the two changed assertions.
- `scatter-grid.ts` and `scatter.test.ts` also carry item 7 below, so the two can't be split by file. In `scatter-grid.ts`, item 7 is the lattice construction at the end of the function.

## Second pass: verification findings in my files

Every item's test was written first and failed on the current code with the reviewer's sequence.

**1 (blocker), typed append returns the wrong source row: fixed.**
- New test, the reviewer's sequence (typed x `[0,1]`, y `[0,10]`, `missing: 'zero'`, append rows x 2, 3 with y null, 4). Before the fix the rows read `[0,1,0,−1,4]`; the expected `[0,1,2,−1,4]` comes from the contract (an imputed zero has row −1).
- New property test, 500 runs: any typed opening, including NaN values; up to five batches of numbers, null, absent and NaN anywhere; both missing policies; optional `keep`. For every slot, the row index and `rowAt` give the caller's row, or −1 where the contract says so.
- A batch where no row has the y key is rejected whole (AX101), so the oracle treats its rows as not data.
- Cause: when a batch first needed an explicit row index, it filled identity rows only up to `end`. The slots that batch had already written past `end` were left at 0. They are now filled through the slot being written (`store-buffers.ts`, `setRow`). Reverting the fix fails both tests.

**7 (your half), lattice built on the first pointer move: fixed.**
- New test counts typed-array bytes allocated by the first pick on a 32,000-point ring. Before: 896,000 B at ratio 1. Now under 16 KiB at ratios 1 and 2.
- The lattice index is now built with the lookup, but only when a pick could fall back to it. An exact pick looks at most at a 4 × 4 block of 24 px cells and checks each point there at most three times. So if no 4 × 4 block holds more than (budget − 16) / 3 points, it can never run over budget and no lattice is built. A lazy build remains only as a guard in case that bound were ever wrong.
- Cost, measured in Node (median of 5): lookup build at 32,000 points goes from 8.3 to 12.2 ms; at 200,000 points from 44.8 to 78.1 ms.
- If that build cost matters when streaming, the alternative is building the lattice at idle, which needs a controller hook. Tell me if you want it.
- The payload scan over rows sharing x is still the controller's.

**12 (your half), uncounted cached copy: fixed.**
- New test: prepare a competing tail fill, then read the old frame's column. Before, the 520 B copy was not counted; now it is, exactly once.
- Frames register their getter-made copies in a weak registry, `lazyColumns` in `store-bytes.ts`. The count reads the copies already made, never the getters, so it still has no side effect.
- `ownedBytes(frames?: readonly Frame[])` now takes the other frames still held, counted in the same deduplicated set (new test).
- **Controller's author:** pass the displayed frame and any pending frame, for example `store.ownedBytes([displayed.frame])`.

**13, compact bar patterns differ only by colour: fixed, no contract change.**
- New test: three equal-height compact series; then 2, 5, 8, 9, 16, 17, 31 and 32 series. Before, series 1 and 2 were both diagonal.
- Compact series s now takes pattern (floor(s/8) + s mod 8) mod 4 of none, diagonal, cross, dots:
  - neighbours always differ in pattern;
  - each colour still gets all four patterns, so the 32 F9 combinations hold (the F9 test still passes);
  - series 0 stays plain.
- What remains: series further apart can share a pattern and differ only by colour. Avoiding that would need more values in `RectMark.pattern`, plus drawing them in both renderers and the swatch.
- **Interaction author:** `seriesPattern` in `dom/interaction.ts` implements only the full-chart rule. Compact bar swatches should use `barPattern(series, true)` from `src/scene/bars.ts`.

**14, duplicate scatter x column: fixed.**
- New test with the reviewer's sequence. Before, `x positions` was still listed after the last missing row left.
- The column is now dropped once `keep` evicts the last missing row.

**Table finding 15, your side: nothing to fix in `view/index.ts`.**
- `scatterX` there already includes `missingX` in `xFull`.
- The candidate extent that leaves out missing-y positions is `scatterXExtent` in `core/axes.ts:171`, which is the controller's. It should include each series' `missingX`, or use `view.xFull`.
- I have not touched `src/layout`. Whether the coarser-domain path needs a change there is for the controller's author to tell me through you.

**Table finding 8:** the first-pick construction test is the item 7 test.

## Runs (last lines)
- `npm run typecheck`: no errors.
- `npx vitest run packages/axylo/test/lookup`:
  ```
  Test Files  3 passed (3)
       Tests  66 passed (66)
  ```
- data, lookup, scene, view and reader together:
  ```
  Test Files  14 passed (14)
       Tests  367 passed (367)
  ```
- Whole Node suite:
  ```
  Test Files  67 passed (67)
       Tests  1454 passed (1454)
  ```
- Earlier full runs under load showed flakes outside my modules:
  - a timing bound in a simplify test ("keeps a million-slot outlier…", 30–34 ms against 30);
  - once, the interaction agent's corridor test in `core/focus-placement.test.ts`;
  - once, my owned-bytes test. It passed in 5 repeat runs of data, lookup and core, and in the final full run.

## Other files changed
- `src/data/store-buffers.ts`, `store-bytes.ts`, `store.ts`, `store-unaligned.ts`
- `src/scene/bars.ts`
- Tests: `test/data/streaming-storage.test.ts`, `test/scene/scene.test.ts`

No contract change needed. Not done: the idle-time lattice build (only if you want it), and anything in `src/layout` for finding 15. Nothing committed; no build run; scratch files removed.
