<!-- Author: Claude Opus 5.5 (high), agent a5e106319fe97c022; saved by the coordinator -->

## `retainedRows(frame)` on every store: done

`AlignedStore`, `PointStore` and `DonutStore` now have `retainedRows(frame: Frame): ArrayLike<number> | null`. The two waiting controller tests pass with no change to them or to the controller. Nothing is committed and no build was run.

### What the method returns
- The source row indexes that this revision's `source.rowAt` still answers, ascending. That is two parts:
  - the rows still retained below the frame's end;
  - the evicted rows kept for that revision (archived with a last-seen revision at or after it).
- `null` when the revision is retired, or when it isn't one this store published (an uncommitted preview, another store's frame).
- Imputed-zero rows and rows with an unplaceable x are source rows, so they are listed.

### Cost
- Proportional to the rows currently retained plus the evicted rows still kept for live revisions. There is no scan over evicted history.
- When nothing is archived for the revision, the result is a view over the retained index, not a copy. Otherwise one sorted merge into a new array.

### Where
- `src/data/store-rows.ts`:
  - `RowRevisions.retainedRows` finds the window that published the frame's revision;
  - `RowWindow.retainedRows` does the work;
  - `StreamRows.retainedIndexes` and `FrameSource.limit` are small new accessors.
- `src/data/store.ts`, `src/data/store-unaligned.ts`: the public method on each store.

### Tests
In `test/data/streaming-storage.test.ts`. They were written first and failed because the method did not exist.
- **Property, for line, scatter and donut (400 runs each).** Inputs:
  - an opening as object rows or typed columns;
  - up to 8 appends with `keep`;
  - late arrivals from negative x steps;
  - null, absent and numeric y under both `missing` policies;
  - rows whose x can't be placed.

  For the current frame and every older frame still held, the list is strictly ascending and equals exactly the indexes `rowAt` answers. A frame retired along the way gives `null`.
- **A preview and another store's frame** give `null`. After commit the same store lists `[0, 1, 2]`.

### Controller tests (`test/core/round3.test.ts`, unchanged)
- ✓ "a retained imputed-zero row behind an evicted source index is re-read while paused"
- ✓ "R7: x 10000 kept with the newest of 1,000 late arrivals (keep 2): re-encoding reads the two rows, not 1,002 indexes"

### Runs
- `npx vitest run packages/axylo/test/data packages/axylo/test/core`:
  ```
  Tests  428 passed (428)
  Duration  7.63s
  ```
- `npm run typecheck`: no errors. The probe file error you mentioned did not appear.
- Whole Node suite: `Tests  1 failed | 1507 passed (1508)`. The one failure is the timing bound in `test/simplify/simplify.test.ts` ("keeps a million-slot outlier…", 32.5 ms against 30). It is a load-dependent flake I've seen before, not in my modules.
