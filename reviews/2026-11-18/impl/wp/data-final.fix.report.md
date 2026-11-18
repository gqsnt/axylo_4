<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a5e106319fe97c022. Saved by the coordinator from the hand-back. -->

## Report: data / lookup / scene / view / reader / diagnostics pass

Items 2 to 8 are fixed. Item 1 is not: the kept P7 test still fails, at 17,069,760 B against the 16,000,000 B bound (it was 24,750,128 B). That bound cannot be met under the frame contract as written. No existing test's expected value was changed; I only added tests. Nothing committed.

### Item 1: memory on the first append. Not fixed; it needs a contract change
- **Why it cannot pass.** `XColumn.values` and `Series.y` must each be one array of N+1 doubles. The caller's buffers can't be extended; `ArrayBuffer.transfer` would detach the caller's arrays. So x and y alone need 16 × 1,000,001 = 16,000,016 B, which is already over the bound before slot, row or spare.
- **The two options you offered:** "copy only once the window has slid past the borrowed prefix" doesn't help here. After one append without `keep`, the window still spans the whole prefix plus the new row, so it needs a fresh contiguous array. With contiguous columns, nothing passes the bound. Only segmented columns pass, and they need a contract change.
- **Contract change I'd propose (not made):**
  ```ts
  /** Slots [0, head.length) may be the caller's typed column and are never written; tail holds the appended slots. */
  export interface SplitColumn<T> { readonly head: T; readonly tail: T }
  ```
  `XColumn.values`, `Series.y`, `Series.slot` and `Series.row` would accept `T | SplitColumn<T>`. Every reader would have to handle two segments: view domains and ranges, lookup binary searches, scene builders, reader statistics and table, focus, controller events. One append would then cost about 1 MB (the slot head) plus small tails. The other route is for you to set the first-append budget at about 17/16.
- **What I did change**, which brings it close to the 17 × N floor:
  - Typed-column rows stay implicit: `row: null` is kept through in-order appends. An explicit index is built only once the window slides.
  - The observed flags are dropped when every slot is observed.
  - The spare tail when the store opens is capped at 4,096 slots. Later growth still doubles.
  - x history and seed positions are views on the caller's own x column, so they don't pin a superseded copy.
  - Point and donut columns open with the same small tail instead of 2×.

**Retained bytes** (measured with forced collection; `ownedBytes()` agrees):

| Case | Retained | Caller's columns |
|---|---:|---|
| One append | 17,069,760 B (x 8,032,768 + y 8,032,768 + slot 1,004,096 + 128) | — |
| 1,000 appends, no `keep` | 17,078,832 B | — |
| `keep: 2`, then retire | 1,488 B | collected |
| `keep: 400,000` (smaller than the prefix) | 34,687,704 B | collected |
| Explicit replacement, then retire | 485 B | collected |

The `keep: 400,000` case is large because:
- the x, y and slot buffers are not compacted, since compaction only happens below a quarter of capacity;
- the row index is 4.0 MB, which the contract requires once the window slides;
- the x history copy is 4.0 MB;
- the seed positions are 3.2 MB;
- the retained row blocks are 6.4 MB, copied at the halfway point to free the caller's buffers.

These duplicate copies of x are a possible follow-up.

**Scatter at 1M points:** 28.1 MB, down from 56.0 MB. It is still over P7: positions, x and y are copied and the row index is dense. Not fixed.

**What pins the caller's columns is in the controller, not my modules.** I reproduced it in Node with the recording host:
- **Replacement:** columns stay alive until a locale change. In `formatSpec` (controller.ts:925–928), the `onFormatterError` closure shares its scope with `valueFor`, which captures `resolved` and so its borrowed table. The formatters are reused across frames. Fix: create `onFormatterError` once, outside `formatSpec`.
- **`keep: 2`:** columns stay alive even after a locale change. After an append, controller.ts:679 keeps `options: previous.options` (its `data` is the caller's columns object) and `source: previous.source` (the borrowed table). controller.ts:1756 reads `source.table` too. Fix: drop the static data and `source` once the store exists.

### Item 2: bounded scatter pick. Fixed
- **Design.** A pick first compares exact positions with a budget of (ceil(49 × dpr) + 1)² distance checks. If it runs over, it is redone on a second index in which every point is rounded to the device-pixel lattice. That index merges the points of each lattice point, keeping their count and latest source row, and is built lazily on the first fallback. This stays within the `Lookup.pick` contract.
- **Why not lattice everywhere:** that would break three existing tests (the 24.125 px radius edge, the dense non-coincident pick at dpr 1, and 10,000 + 190,000 points in one cell). With exact-first, every existing lookup test passes unchanged.
- **Visits** (`lastPickCandidates`), the same at 32,000 and 200,000 ring points:

| dpr | Visits | Exact budget | Lattice |
|---|---:|---:|---:|
| 1 | 2,679 | 2,500 | 179 |
| 2 | 10,137 | 9,801 | 336 |
| 3 | 22,407 | 21,904 | 503 |

  Before: 32,048 and 200,045. A dense random 200,000-point cluster stays on the exact path with 136–299 visits. The first fallback costs a one-time lattice build of about 20 ms at 200,000 points (Node).
- **Tests:** ring tests (32,000 and 200,000 points at dpr 1 and 2), dense-cluster tests (dpr 1, 2, 3, exact and forced lattice), and a 1,500-run property test against a brute-force lattice oracle. Using floor instead of round, or dropping the later-row tie-break, makes them fail.
- **API:** `scatterLookup` takes an optional `GridOptions { exactBudget }` (used by tests) and exposes `lastPickLattice`. Nothing is needed from the other agents. The event-payload half of finding 8 is still the controller's.

### Item 3: cues. Fixed
- New exported `barPattern(series, compact)` in `src/scene/bars.ts`. Full bars are unchanged. Compact bars use the same 32 combinations, with the pattern group computed as `(floor(s/8) + (s % 8 ? 1 : 0)) % 4` over none, diagonal, cross, dots.
- Compact series 25 to 31 are unpatterned and differ from series 0 only by colour. Avoiding that needs a fourth pattern, which is a change to `RectMark.pattern` in the contract.
- Scatter verified: colour and shape stay distinct for 64 series.
- Test from the scene's marks: 32 distinct cues each for line, area, bar, compact line, compact area, compact bar and scatter. The old compact rule fails "bar (compact: true)".
- **Interaction agent:** `seriesPattern` in `dom/interaction.ts` implements only the full rule. Compact bar swatches should use `barPattern(series, true)`.

### Item 4: "incomplete" once. Fixed
- **Tooltip model now:** rows are never qualified; `total` is qualified once (for example "45 (incomplete)").
- `datum()` now qualifies only the component that has no value ("No data (incomplete)"). A present value no longer reads "1 (incomplete)".
- With the current `focus.ts`, the all-series reading says it once: "… S8 9; S9 No data; Total 45 (incomplete)".
- **Interaction agent:** keep building overflow rows plain, as `alignedRows` does now, not from `datum()`.

### Item 5: wide-row summary. Fixed
- A wide frame is now named by its series labels joined in the chart's locale ("Visits and Signups"). The chart-level range lists only the series that have values.
- The chart-level y range is left out when those series have different units or scales; each series' own sentence keeps its unit on min, max and last.
- Long form is unchanged: one label, unit on both ends.
- Tests cover a shared unit, mixed units and long form.

### Item 6: diagnostics wording. Fixed
- New AX199 text (code, level and outcome unchanged): "Axylo failed while building this chart: an error was thrown, printed above. If it comes from your code (a row getter, a callback), fix it there; otherwise it is a defect in Axylo: please report it with that error."
- **Docs to update:** `apps/docs/data/diagnostics.mjs` and the generated `apps/docs/dist/diagnostics/AX199.html` still quote the old message.
- AX143 was already correct. I added end-to-end tests:
  - Vertical category bars get the suggestion.
  - Horizontal category bars, category line and category area get the general advice without it.
  - Bars on dates never get it.

### Item 7: tick formats with no output. Fixed
AX150 is now raised for:
- on compact charts: `x.tickFormat` and every `y[i].tickFormat`;
- on full wide charts: `y[i > 0].tickFormat` ("The y fields share one value axis, labelled by y[0].tickFormat.");
- on donuts: `value.tickFormat` and `label.tickFormat` ("Donut charts draw no axis ticks.").

I counted the shared-axis case as "no output". The docs can say so.

### Item 8: byte count. Done
- `ownedBytes(): OwnedBytes` on `AlignedStore`, `PointStore` and `DonutStore`. The types `OwnedBytes` and `OwnedBuffer` are exported from `src/data/index.ts`.
- It returns `{ total, buffers: [{ name, bytes, buffers }] }`, with entries grouped by name. Each buffer is counted once at its full byte length, spare capacity included.
- The caller's typed buffers are excluded; the store remembers them weakly, from the first table and from replacements.
- It never reads frame getters, so calling it has no side effect. As a result, a frame's lazily copied tail snapshot is not counted.
- Cost grows with the number of series and retained row blocks (about 4,000 blocks at 1M rows).
- The test agrees with the measured retained bytes within 64 KiB for all three stores at 200,000 rows.
- **Controller's author:** expose this through the benchmark hook.

### Runs (last lines)
- `npm run typecheck`: no errors.
- Node suite:
  ```
  Test Files  1 failed | 65 passed (66)
       Tests  1 failed | 1396 passed (1397)
  ```
  The one failure is the kept P7 test. At the start there were 7 failures: 6 in `core/final-review.test.ts` (controller work in progress, since fixed) plus this one.
- Browser, after a fresh `npm run build`: render plus type-matrix gave 1 failed, 133 passed, 1 skipped. The failure is T-tooltip-scatter (the tooltip comes up empty). It fails the same way with the committed lookup files, so it isn't my change; it is probably the interaction layer, and I didn't chase it. The shared `dist` is now built from the current tree, including the other agents' in-progress code.

### Files
Source:
- `src/data/`: `store-buffers.ts`, `store.ts`, `store-rows.ts`, `store-window.ts`, `store-unaligned.ts`, `options.ts`, `index.ts`, and the new `store-bytes.ts`
- `src/lookup/`: `scatter-grid.ts`, `scatter.ts`, `aligned.ts`
- `src/scene/bars.ts`, `src/reader/index.ts`, `src/diagnostics/registry.ts`

Tests, added only:
- `test/data/streaming-storage.test.ts`
- `test/lookup/scatter.test.ts`, `test/lookup/aligned.test.ts`
- `test/scene/scene.test.ts`, `test/reader/index.test.ts`, `test/diagnostics/registry.test.ts`

All paths are under `/home/canarit/projects/axylo/packages/axylo/`. Scratch files are removed.

### What remains
- P7 on the first append: needs the segmented-column contract change, or your decision on the budget.
- The two controller pins on the caller's columns.
- Scatter store memory at 1M points.
- The duplicate x copies in the `keep`-smaller-than-prefix case.
- A fourth bar pattern for compact series 25 to 31 (contract change to `RectMark.pattern`).
