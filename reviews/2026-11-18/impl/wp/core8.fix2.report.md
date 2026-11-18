<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a1d73b9f46c46814f, resumed. Saved by the coordinator from the hand-back. -->

## Chart core, eighth pass: follow-up on the data agent's items

All six items are settled. Whole browser suite on SVG: 849 of 851 tests pass, 1 skipped; the one failure is in the interaction layer, not mine. Nothing is committed, the tree compiles, and I did not swap the shared bundle.

### The six items
1. **The caller's columns are now collectible.** Two new tests in `packages/axylo/test/core/final-review.test.ts` use a `WeakRef` and forced garbage collection; both failed before the fix and pass now.
   - **(a) After a replacement:** `onFormatterError` is made once, outside `formatSpec`, so it no longer shares a scope with `valueFor`, which captured `resolved` and its borrowed table. The test replaces the columns and checks they are gone without a locale change.
   - **(b) Streaming with `keep: 2`:** once the store exists, the accepted options drop `data`, and `resolved` and `source` go through the data module's `withoutTable`. This is done on both the running and the paused append paths; the paused path also commits the trimmed options to the options store. The test appends with `keep: 2` and checks the opening columns are gone.
   - The tests trim the recording host's own history first, because the stand-in keeps every state it was given.
2. **`memory()` uses `ownedBytes()`.** It returns `store.ownedBytes()` when there is a store. It adds the normalized frame only for a static chart, and the scene's typed arrays in both cases, leaving out the caller's columns. It gives `{ bytes, buffers: [{ name, bytes }] }`.
3. **Finding 13, my half:** `zoom()` on a compact chart is a reported no-op, with tests for line, area and bar.
4. **Finding 8, my half:** the hover payload is built only when someone listens, and a scatter point's value is found by binary search, with no walk over the series. There is nothing to pass for the pick budget.
5. **AX199 message:** no core test pins the old text, so nothing changed.
6. **T-tooltip-scatter is not mine, and passes now.**
   - I built a private tree of HEAD (11fe6da) plus only my uncommitted core changes (`src/core/*`, `src/theme/watch.ts`; that copy also carried the interaction agent's `core/focus.ts`) and ran the acceptance test there: it passed. HEAD alone also passed.
   - The failure came from changes elsewhere in the shared tree that were in progress at the time; on the final shared build it passes.

### Runs (last lines, final build)
- **Type check:** exit 0.
- **Node suite without acceptance:** `Test Files 1 failed | 49 passed (50)`, `Tests 1 failed | 887 passed (888)`. The one failure is the kept memory test in `data/streaming-storage.test.ts`.
- **Node acceptance:** `Test Files 16 passed (16)`, `Tests 512 passed (512)`.
- **Build:** exit 0.
- **`packages/axylo/test/browser`, SVG:** `Test Files 1 failed | 33 passed | 1 skipped (35)`, `Tests 1 failed | 849 passed | 1 skipped (851)`. The failure is `test/browser/chart/review2.browser.test.ts` "in a card that clips its content, a tooltip that would be cut off…", which is tooltip placement in the interaction agent's directory.

The A8 axe, A5 scatter and T-tooltip-scatter failures from my previous report all pass in this run.

### Still open from the eighth pass
- The interaction agent still needs to add the `readoutMode` field to `ControlsState`.
- Finding 6: re-encoding a paused scatter needs the new `PointSeries.missingRow` (now in the contract) wired into the controller's row freezing. That is not done yet.

Logs are `t3-*.txt` in `/tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/core-fix/`.

