<!-- Author: Claude Opus 5.5 (high), agent a5e106319fe97c022; saved by the coordinator -->

## Round 3: lookup and data author

All three items are done. The new lookup methods compile and their tests pass; I sent `main` the one-line notice right after they compiled. Nothing is committed; no shared build was touched.

### 1. `members`, `has`, `slot`, and `rule`: done
The methods couldn't be called before they existed, so these tests are new rather than failing first.

**What each lookup does now:**
- **Scatter**, exact and lattice:
  - The pointer index now enumerates a group from its first ref: that point first, then the other points at the same position, then every other position within 0.5 px, in a fixed order that doesn't depend on where the pointer is.
  - `pick` builds its `refs` from that same enumeration, so `members(target, 0, 8)` equals `target.refs` and the tooltip's rows.
  - Paging skips whole positions and whole tree buckets by their counts. A page costs about `from + count` reads plus at most one 32-entry leaf.
  - `has` is a single distance check between two grid entries.
  - `rule` is set only on lattice picks (`rule: 'lattice'`). Absent means exact, per the contract, so existing tests comparing whole targets still pass.
  - A ref rebuilt by the caller is found without walking points that share its x: directly when the series has no row index, or through a row map built with the lookup for any series with a run of more than 32 equal x values.
  - Points clipped by the plot are not in the index, so they are never members.
  - `slot` returns the point's index in its `PointSeries`, or −1.
- **Aligned:** `members` returns the visible series at that x, in tooltip order (paged); `has` checks visible series and the same x; `slot` is the x slot, or −1.
- **Donut:** `members` returns the slice itself; `slot` is the slice's index in `view.slices`. An "Other" slice stands for several frame categories; `view.slices[slot].members` lists them.

**Tests** (`test/lookup/scatter.test.ts`):
- **Property, 800 runs:** two interleaved series of near-coincident points with shuffled rows, at ratios 1, 2, exact, and with the lattice forced. Checks:
  - `members` over the full count has each member once, starts with the first ref, and has `count` entries;
  - pages of three concatenate to the whole list;
  - `members(0, 8)` equals `refs` and the tooltip's rows;
  - `has` agrees with `members` for every ref, rebuilt refs included;
  - `slot` agrees with the frame.
- **I8:** a point clipped by the y domain next to two drawn ones. The count is 2; `has` is false for the clipped point and `members` leaves it out.
- **R3:** on the 32,000-point ring at ratio 1 the rule is lattice and the count is 14. `members(target, 8, 8)` gives the other six, none of them on page one, all with `has` true.
- **R5:** on 50,000 coincident points with an explicit row index, `has` with rebuilt refs walks no points (the walk counter `work.locations` stays 0). `members(target, 8, 8)` reads at most 32 entries (new `lastMembersRead` counter).
- Aligned and donut cases are in the same file.
- Mutation check: a wrong `has` fails the property test.

### 2. R13: fixed in `src/data`; the controller needs nothing new
- The failing test, written first: a line over two 10-entry `Float64Array` columns, memory hook read before the first frame. It reported 170 B; the expected 10 B is the slot states.
- `resolveTable` now records the buffers of every typed column a caller gives, in a weak set. `ByteCount` never counts those buffers, whatever frames or store are counted.
- `CallerBuffers` keeps its API, so `instrument.ts` works unchanged. Its `add(table)` call is now redundant but harmless.

### 3. I13: a helper for the jump field
- The interaction author's uncommitted tree already adds `missingX` to their last-resort scan in `jumpTarget`. That scan still includes rows the table doesn't print: missing-y rows outside the view, whose x `pageForX` still maps to a page.
- New `printedX(view, formatters, matches)` in `src/reader/table.ts`. It returns the smallest x among exactly the rows the table prints, formatted as the table formats them: points of every series in view, plus missing-y rows inside the x domain; slots in view on aligned charts.
- The failing test, written first (the export didn't exist yet): a date scatter with missing-y rows inside and outside the view. Every printed x is found and its page holds it; an x outside the view is not found.
- **For the interaction author** (no interface between us changes; it's a new export): replace `written()` with `printedX(view, d.formatters, w => normalized(w) === want)`.

### Size
Release-settings esbuild bundle of `src/index.ts`, minified, gzip level 9:

| Bundle | Minified | Gzipped |
|---|---:|---:|
| HEAD | 340,228 B | 119,959 B |
| HEAD plus only my files | 343,199 B | 121,036 B |

My pass adds about 1,077 B gzipped. `printedX` is tree-shaken until something imports it. The interaction author removing `groupRefs` and similar code should offset part of this.

### Runs
- `npm run typecheck`: no errors.
- `npx vitest run packages/axylo/test/lookup`: `Tests  71 passed (71)`.
- data, lookup, scene, view, reader and layout together: `Tests  421 passed (421)`.
- Whole Node suite: `Test Files  1 failed | 68 passed (69)`, `Tests  2 failed | 1499 passed (1501)`. Both failures are in `test/core/round3.test.ts`, the controller author's untracked file, still in progress; it had 6 failures earlier, and they also failed with my R13 change reverted. A later run of that file alone showed three:
  - "a retained imputed-zero row behind an evicted source index is re-read while paused" (`[5, 7]` against `[5, 7, 10]`);
  - "R7: … re-encoding reads the two rows, not 1,002 indexes" (1001 against at most 10);
  - "a 195 px scatter … zoom to −1000…1500" (`[−500, 1500]` against `[−1000, 1500]`).

  The first two may need something from the stores. If the controller's author needs a store change for them, tell me what.

### Files
- `packages/axylo/src/lookup/scatter-grid.ts`, `scatter.ts`, `aligned.ts`, `donut.ts`
- `packages/axylo/src/data/store-bytes.ts`, `options.ts`
- `packages/axylo/src/reader/table.ts`
- Tests: `packages/axylo/test/lookup/scatter.test.ts`, `packages/axylo/test/data/streaming-storage.test.ts`, `packages/axylo/test/reader/index.test.ts`

The private size-build directory is removed.
