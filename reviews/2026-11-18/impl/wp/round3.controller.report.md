<!-- Author: Claude Opus 5.5 (high), agent a1d73b9f46c46814f; saved by the coordinator -->

## Round 3, controller items: seven of eight done; C4(b)/R7 needs a store method

C2 (the blocker), C4(a), C6, C7/R6, R8 (my half), R11 and R12 are fixed. For each I wrote the reviewer's sequence as a test in `packages/axylo/test/core/round3.test.ts`, saw it fail, then fixed it. R13 was already passing. C4(b)/R7 is not fixed: it needs a store method, and its two tests are failing (kept as written). Nothing is committed. Private builds were in `.core-private`, `.core-size` and `.core-head`, all removed; I did not touch `dist`.

### Per item
1. **C2 (blocker), hide/show cycles while paused.**
   - Before: 101 rows retained against a bound of 10.
   - Cause: the baseline was reset whenever the shown frame changed from nothing, so showing the same paused frame again reset it.
   - Change: the baseline is now tied to the revision it was taken at (a number, so a hidden chart keeps no frame alive). Showing the same revision again no longer resets it.
   - The test runs 100 cycles within the bound; Resume then shows x=102 with its own row.
2. **C4.**
   - **(a) Fixed.** With the held rows appended with `keep: 1`, strict accepted `update({y:'w'})`, and non-strict reported no AX101. The displayed window's own option findings are now kept and count for strict and for `diagnostics`. On Resume, the existing AX101 path clears it.
   - **(b) and R7: not fixed.** Both tests fail:
     - a line with x 10 (y null, `missing: 'zero'`) retained behind evicted x 1 loses x 10 after a paused re-encode;
     - the R7 sequence reads 1,001 source indexes for two displayed rows.
   - The controller cannot list the rows a revision still holds; only the store knows.
   - **Exact change I need from the data author:** each store (`AlignedStore`, `PointStore`, `DonutStore`) gets `retainedRows(frame: Frame): ArrayLike<number> | null`. It returns the source indexes that revision's `source.rowAt` still answers, in ascending order, or `null` when the revision is retired or not this store's.
   - `freeze()` already uses that method when it exists, so it reads exactly those rows. The bounded scan stays only as a fallback, and the per-frame row-end tracking can be removed once the method lands.
3. **C6.**
   - Before: a strict chart with a throwing option getter did not throw and showed AX199.
   - Change: strictness, name and handler are taken from the current options before the patch is read.
4. **C7 and R6.**
   - Before: 100,000 row-index reads for a hover over 50,000 coincident points, and a getter that throws after drawing made hover throw.
   - Change: the hover payload uses `lookup.slot(ref)` and reads x and y from the frame. The run search (`pointIndex`) and the second read of the caller's row are removed. The row object is taken once through the owned-row accessor, guarded.
   - Now: at most 4 reads, and the event carries the frame's values.
5. **R8, my half.**
   - Before: `zoom([-1000, 1500])` gave `[-500, 1500]`.
   - Change: the controller records when the layout drew a scatter on a wider automatic x domain than the view's. A zoom on the same data is then read against the drawn domain.
   - So while zoomed, `view.xFull` (what the interaction layer reads for pinch, pan and wheel) is the drawn domain too.
   - Not covered: unzoomed, `view.xFull` is still the view's own domain. The interaction layer's `drawnFull()` covers Select range; pinch and wheel starting from an unzoomed chart still read `view.xFull`, which is the interaction author's side. No contract change was needed.
6. **R11.**
   - Test: a 135 px plot with a 98 px strip gives `none`; after a resize to 134 px with a 48 px strip, the chart should reserve the strip, as a fresh chart at that size does.
   - Before: it stayed `none`. Fix: a resize marks the strip for measuring again.
   - I checked the test fails with that one line removed.
   - The test host's `strip` option can now be a function, to follow responsive CSS.
7. **R12.**
   - Before: AX160 was reported when only unused coarser candidates threw.
   - Change: tick-formatter failures are recorded per tick position, and AX160 is published after layout, only for ticks the layout draws. An option that fails as a whole still counts for every tick.
   - A companion test checks that a throw on a drawn tick still reports AX160.
   - `AxisContext.onFormatterError` is now optional and unread. It stays only so `test/core/focus2.test.ts` and `axes.test.ts` still type-check without me editing them.
8. **R13.** The test (two 10-entry `Float64Array` columns, memory read before the first frame, 10 bytes) passed on the tree as it stood, with the data author's uncommitted `store-bytes.ts` change present. I did not check whether it passes at HEAD without that change. I changed nothing.

### A test-model correction you should know about
- The first snapshot property in `final-review.test.ts` failed once with `[fail view, data, heal, unzoom, frame]`. Its model assumed the `data` update made while the view stage was failing had been accepted; the chart correctly did not accept it (DX5).
- Both properties now stop checking after a call made while a stage fails, until a `data` call on a healthy chart re-syncs the model.
- This narrows when the properties check; no assertion was loosened. With it, `final-review.test.ts` passed 5 runs in a row.

### Last lines
- `npx vitest run packages/axylo/test/core`: `Test Files 1 failed | 15 passed (16)`, `Tests 2 failed | 260 passed (262)`. The 2 are the C4(b) and R7 tests above.
- Whole Node suite (`npm test`, before the property-model fix): `Test Files 2 failed | 72 passed (74)`, `Tests 3 failed | 1739 passed (1742)`.
  - Two of the three are the C4(b) and R7 tests.
  - The third, `simplify.test.ts` "million-slot outlier", is not mine; it passes alone (`Tests 17 passed (17)`).
  - I did not rerun the whole suite after the property-model fix; only `test/core` and the 5 property runs.
- Browser `chart` and `a11y` on chromium against the private build: `Test Files 2 failed | 22 passed (24)`, `Tests 2 failed | 299 passed (301)`.
  - `render` "ensureStyles": a harness artifact of `AXYLO_BUNDLE` (it passed against the shared dist last round).
  - `axe` "trend paused, zoomed, in the narrow readout…": the readout strip is not visible. It fails the same way with HEAD's `controller.ts` and `axes.ts`, so it comes from others' in-progress changes, not mine.
- `late-font`, `reattach`, `loadingdone`: `Test Files 3 passed (3)`, `Tests 4 passed (4)` on each of chromium, firefox and webkit.
- `npm run typecheck`: one error, in an untracked file that is not mine: `test/browser/a11y/zz-r3-probe.browser.test.ts(4,10)`, "Module './util' has no exported member 'structuredPage'". There are no errors in my files.

### Size
Release-settings iife, minified, gzip -9:
- HEAD: 117,821 B gzip (335,157 B minified).
- HEAD plus only my two changed files (`core/axes.ts`, `core/controller.ts`): 118,027 B gzip (335,954 B minified), so **+206 B gzip**.
- The whole working tree, including the other authors' uncommitted work: 119,499 B.
- The R12 per-tick tracking and the R8 widened-domain read are most of my increase.

### Not done
- C4(b)/R7: needs the `retainedRows` store method above.
- The unzoomed half of R8: the interaction layer's pinch and wheel bounds.
