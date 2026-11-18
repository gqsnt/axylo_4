<!-- Author: Claude Opus 5.5 (high), agent a5e106319fe97c022; saved by the coordinator -->

## Size cuts, class (a): items 1 and 2 done, item 3 not done

The production bundle shrinks by 1,363 B gzipped for everything and 1,002 B for line only, with no behaviour change: the Node suite passes and no test was edited. The CSS minifier change is not done (reason below). Nothing committed; no shared build run.

### Measured sizes
Method: the analysis's own `measure.mjs`, run on a private copy (release build settings, esbuild minify, gzip level 9).
- **Before:** HEAD d4249fd.
- **After:** HEAD plus only my files. The interaction author's uncommitted `src/dom/**`, `core/focus.ts` and `theme/css.ts` are left out.

| Row | Before | After | Change |
|---|---:|---:|---:|
| everything | 119,365 B (116.57 KiB) | 118,002 B (115.24 KiB) | −1,363 B |
| line only | 99,756 B (97.42 KiB) | 98,754 B (96.44 KiB) | −1,002 B |

The analysis predicted −1,236 / −944 for its items 2 and 4 together (−1,132 / −890 and −104 / −54). Mine is slightly larger because I also moved two things out: the stores' in-place append branch, which only `append` reached, and the scatter lookup's work counters.

Against the targets, everything is 115.24 KiB (116 target) and line only is 96.44 KiB (98 target).

### 1. Test- and benchmark-only members out of production
**How it works:**
- The members are declared through interface merging, so the types and tests are unchanged.
- They are installed on the prototype the first time a store or a `Delivery` is constructed, inside `__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)`. That is the controller's existing gate for the benchmark hooks.
- So development, test and benchmark builds have them, importing a module still does no work, and the production build folds them away.

**What moved:**
- **The P7 byte count.** The `count()` methods of eight classes (`FrameBuffers`, `Column`, `RawRows`, `StreamRows`, `RowWindow`, `RowRevisions`, `Observations`, `Points`, `Slices`) and `Storage.count` are gone from the classes. They are now functions in `store-bytes.ts` (`countBuffers`, `countColumn`, `countRevisions`) that read the private fields with bracket access.
- **The stores' `caller` field and its `add` calls** are removed. The caller-buffer registry is global since R13, so they were redundant. The `borrowColumns` call in `resolveTable` and the `lazyColumns.set` in the frame getters are gated too, so `store-bytes.ts` leaves the production bundle.
- **`ownedBytes`, `append`, `replace`, `prepareReplace`, `reencode` and the `diagnostics` getter** on `AlignedStore` and on the point and donut store base. The aligned in-place append branch moves with `append`, so private `prepare` loses its `sink` overload.
- **`Delivery.deliver`** (`core/delivery.ts`).
- **The scatter lookup's counters:** `lastPickCandidates`, `lastPickCells`, `lastPickLattice`, `lastMembersRead`, and the grid's `examined`, `cellsExamined`, `membersRead`. They are now added with `Object.defineProperties` under the gate.

**How I showed they are gone from production and still present elsewhere:**
- **Built output:** I built HEAD and my tree privately with `scripts/build.mjs`'s settings and searched the files.
  - In HEAD's production ESM and IIFE files every marker is present. In mine none is: `ownedBytes`, `prepareReplace`, `reencode`, `deliver`, `lastPickCandidates`, `lastMembersRead`, and the byte-count names ("rows kept for earlier frames", "x positions of the first rows", "x history", "missing row", "frame series").
  - All of them are still in my development build.
- **Production callers:** the controller and other production code call none of the moved members. The `get diagnostics()` left in the production file is the public chart handle's.
- **New distribution test** `tests/dist/instrumentation.test.ts`: each marker must appear in the packed `axylo.dev.js`, and must not appear in `axylo.js` or `axylo.iife.min.js`.
  - I ran its regexes against my private builds: they pass on my tree and fail on HEAD.
  - I did not run the test itself, because it packs the shared `dist` into the fixtures. Run against the current packed files it will fail until you rebuild at the commit point.

### 2. Exact duplicates merged
- `sameRemainder`: `store.ts` now imports it from `store-rows.ts`.
- `once`: `format/time.ts` imports it from `format/number.ts`.
- `object`: `core/stages.ts` imports it from `data/options.ts` and re-exports it, because `core/chart.ts` imports it from stages.
- `lowerBound`: moved to a new neutral `src/data/search.ts`. `lookup/search.ts` re-exports it (data still does not import lookup) and `store-unaligned.ts` imports it.
- `sameStyle` in `core/controller.ts` is replaced by `sameTextStyle` from `core/environment.ts`. The one call becomes `if (!sameTextStyle(textStyle, next))`, which is the same as the old `!textStyle || !sameStyle(...)` because `textStyle` is either null or a style.

**Left for later** (one copy is in a file being edited):
- `pageDistance`: `core/focus.ts` and `lookup/search.ts`.
- `setText`: `dom/figure.ts` and `dom/tooltip.ts`.
- The analysis's smaller items in `dom/`: `TableView.showRow`, `get page`, `TooltipView.where`.

### 3. CSS minifier: not done
- Switching `scripts/build.mjs` to esbuild's minifier would make the shipped `axylo.css` differ from `minifyCss(AXYLO_CSS)`, which the docs guard compares against.
- It also merges duplicate rules, which can change the cascade order, so it is not guaranteed to be behaviour-neutral.
- Changing `minifyCss` itself to drop the space after `:` and commas would break an exact-output assertion in `test/theme/minify.test.ts`, which I may not edit.
- The analysis's alternative is removing the two duplicate rules by hand in `theme/css.ts`, which is excluded this round. It was worth −64 / −60 B.

### Runs
- `npm run typecheck`: no errors; only the `tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist` line printed. The new dist test type-checks.
- Package Node suite: `Test Files  69 passed (69)`, `Tests  1508 passed (1508)`.
- Root `npx vitest run`, docs tests included: `Test Files  74 passed (74)`, `Tests  1747 passed (1747)`.

### Files
- **Data:** `store.ts`, `store-unaligned.ts`, `store-buffers.ts`, `store-rows.ts`, `store-window.ts`, `store-bytes.ts`, `options.ts`, and the new `search.ts`.
- **Core:** `delivery.ts`, `stages.ts`, `controller.ts`.
- **Format:** `number.ts`, `time.ts`.
- **Lookup:** `scatter.ts`, `scatter-grid.ts`, `search.ts`.
- **Tests:** `tests/dist/instrumentation.test.ts` (new).

All under `packages/axylo/src/` except the test. The private measurement directory is removed.
