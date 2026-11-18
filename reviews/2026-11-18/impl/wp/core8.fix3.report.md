<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a1d73b9f46c46814f, resumed. Saved by the coordinator from the hand-back. -->

## Chart core: the three items left after the eighth pass

Finding 6 and the property-test extension are done; finding 1's remaining exception cannot be finished yet, because the interaction layer has no text-preparation step to call. The full check on the shared tree has 2 failures, neither in my files. Nothing is committed, and I did not swap the shared bundle.

### 1. Finding 6, the remaining parts
The reviewer's three sequences are tests in `packages/axylo/test/core/final-review.test.ts`; all three failed first and pass now.
- **Scatter re-encoding while paused:** `freeze()` in `core/controller.ts` now also keeps the rows listed in each series' `missingRow`. Re-encoding `y` to `z` therefore keeps `{ x: 1, y: null, z: 11 }`, now as a point at `[1, 11]`. The arrival made while paused stays held until Resume.
- **Resume from an AX103 handler during a paused re-encoding:** the held arrivals are now set before anything is delivered. A handler that resumes finds them, and nothing stays held on a running chart.
- **AX101 after a valid held append and Resume:** Resume now re-reads the store with the fields as given, the same recovery a running append already had, so AX101 goes once the held rows supply the field.

### 2. The property test
- **What was added:** a second property in `final-review.test.ts`, run 200 times each on line, bar and scatter, with two series (long form, alternating).
- **Re-entry from listeners:**
  - a hover listener that calls `update` and `zoom(null)`;
  - a zoom listener that calls `append`, which the independent model also takes in;
  - hovers triggered while the sequence runs.
- **Still in it:** the earlier operations (appends with and without `keep`, replacement, re-encoding, real windows, pause/resume, failures at 7 stages, resize to zero and back, destroy at the end), the model comparison of window and caption, row provenance on line and bar, and the retention bound.
- **Not checked:** on scatter, hover provenance, because a point's source row index is not known to the test in a stream.

### 3. Finding 1's exception: left as is
- `src/dom/interaction.ts` still has no step that prepares tooltip or value text before the first write. Its only `prepare(state)` is the controls step, and the controller calls that during the arrangement, after the first write.
- So author value formatters still run during the interaction layer's commit. That remains safe: the in-flight rows are pinned and callbacks are deferred.
- If the interaction agent adds such a step, I will call it before the first host write.

`readoutMode` is now in their `ControlsState` type, so I removed my cast. The controller sends `readoutMode: 'floating' | 'strip' | 'none'`, typed by their `ReadoutMode`.

### Full check on the shared tree (after a build)
- **Type check:** exit 0.
- **Node suite (all of `packages/axylo/test`):** `Test Files 1 failed | 65 passed (66)`, `Tests 1 failed | 1409 passed (1410)`. The one failure is the kept memory test in `data/streaming-storage.test.ts` (data module).
- **Build:** exit 0.
- **`packages/axylo/test/browser`, SVG:** `Test Files 1 failed | 35 passed | 1 skipped (37)`, `Tests 1 failed | 875 passed | 1 skipped (877)`. The one failure is `test/browser/chart/review2.browser.test.ts` "in a card that clips its content, a tooltip that would be cut off…". That is the tooltip placement the interaction agent is rewriting, not a file of mine.

Logs are `t4-*.txt` in `/tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/core-fix/`.

