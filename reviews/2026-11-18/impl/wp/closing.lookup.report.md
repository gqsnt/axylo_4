<!-- Author: Claude Opus 5.5 (high), agent a5e106319fe97c022; saved by the coordinator -->

## Closing pass, lookup item (final check, section 2, item 6): fixed

Zooming or panning a large scatter no longer rebuilds indexes for points outside the view, and the work counters stay in development builds only. Nothing committed, no shared build run, and no request from the controller's author for the C2 store change has reached me, so I changed nothing there.

### The failing test, written first
In `test/lookup/scatter.test.ts`: a frame of 1,000 dates with 50 measurements each (50,000 points, explicit source rows), viewed one date at a time.
- The first view of the frame is built once.
- Then it builds the lookups for dates 500, 501 and 999 and counts the typed-array bytes and `Map` entries each build makes.
- It allows about one shown date's worth: fewer than 25,600 bytes and fewer than 500 entries.
- It also checks that a ref rebuilt by the caller still resolves through `slot` and `has`.
- On the committed code it failed: one narrow view allocated 202,352 bytes, mostly the reverse grid index for all 50,000 points.

### What changed
- **`lookup/scatter.ts`:** the row index for long same-x runs now belongs to the frame's series rather than to one view. It is cached in a weak map keyed on the `PointSeries` object and released with the frame, so later views of the same frame reuse it. The run-length scan also stops as soon as it finds a run longer than 32.
- **`lookup/scatter-grid.ts`:** the reverse index from a point to its grid entry is now sized to the visible points only, offset by each series' visible start. Points outside the view get −1, as before.
- The work counters added earlier this round are still defined only under the `__DEV__ || __BENCH__` gate; nothing here touches them.

### Runs
- `npm run typecheck`: no errors.
- My Node tests (lookup, data, reader, view, scene, layout): `Tests  426 passed (426)`.
- Whole Node suite: `Test Files  1 failed | 69 passed (70)`, `Tests  1 failed | 1512 passed (1513)`. The one failure is the load-dependent timing bound in `test/simplify/simplify.test.ts` ("keeps a million-slot outlier…"), not in my modules; it has failed intermittently in earlier runs too.
- Browser, against a private development bundle of the current tree passed through `AXYLO_BUNDLE`, then removed. It ran `render/`, `chart/interaction`, `chart/final-verify` and `chart/final-round3`: `Test Files  9 passed | 1 skipped (10)`, `Tests  156 passed | 1 skipped (157)`. That bundle includes the other authors' uncommitted work.

### Gzipped size
The analysis's measurement method, HEAD e0b1239 against HEAD plus my two files:

| Row | Before | After | Change |
|---|---:|---:|---:|
| everything | 118,387 B | 118,461 B | +74 B |
| line only | 99,046 B | 99,043 B | −3 B |
| scatter | 94,616 B | 94,666 B | +50 B |

Files: `packages/axylo/src/lookup/scatter.ts`, `packages/axylo/src/lookup/scatter-grid.ts`, `packages/axylo/test/lookup/scatter.test.ts`.
