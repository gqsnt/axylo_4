<!-- Author: Claude Opus 5.5 (high), agent a1d73b9f46c46814f; saved by the coordinator -->

## Controller verification pass: everything assigned to me is fixed except two items routed to the layout and lookup authors

The two blockers (defects 2 and 3) are fixed. All majors in my files are fixed except the coarser-domain half of defect 10, which needs a layout change (below). For every item I first wrote a test with the reviewer's sequence, saw it fail on the code as it was, then fixed it. Nothing is committed. I did not run `npm run build`. The private build was in `.core-private` and is removed.

New test files:
- `packages/axylo/test/core/verify-pass.test.ts`
- `test/browser/chart/reattach.browser.test.ts`
- `test/browser/chart/loadingdone.browser.test.ts`
- `test/browser/chart/entries/reattach.entry.ts` (a chart and the measurer from one bundle, so the test reads the chart's measurement cache)

### Per item (failure seen before the fix, then the change)
- **Defect 2 (blocker), hidden paused chart retaining history.** Before: 502 rows retained against a bound of 10.
  - Change in `showing()`: an absent displayed frame is now treated as `null`, and the baseline moves only when a real frame comes on screen.
  - The test also checks that after Resume x=503 is shown with its own row.
- **Defect 3a, stale AX160.** Before: `[['AX160','New']]` was delivered under the new title.
  - Change: the controller checks the frame is still current before publishing tick-formatter findings. A value formatter's AX160 from a frame its own call superseded is dropped (`formatterFailed`).
- **Defect 3b, a tick formatter calling `update({title})` on every call.** Before: nothing was ever published (no figure model at all).
  - I judged reuse cheap, so I fixed it rather than documenting a limit.
  - `axisParts` in `axes.ts` is now keyed on the axis inputs it reads (x field, tickFormat, unit, has-domain; the same for the first value field; locale, compact, xLabelGiven, valueTitle) instead of the whole `resolved` object. A title-only update reuses the labels, so the formatter does not run again.
  - Now the new title is drawn and no frame stays pending.
- **Defect 4, paused re-encoding.** All three cases failed:
  - AX130 disappeared after the re-encode;
  - a row with old x `null` and u=5 did not appear while paused;
  - a typed `NaN` produced the note "Values not shown: 1".

  Changes:
  - The held frame's view is built and validated in the same call, so AX130 stays and `update({strict:true})` rejects.
  - The displayed table is read from the displayed revision's raw window. The controller tracks each store frame's source-row end (rows are numbered in arrival order) and how many opening rows came from typed columns. `freeze()` copies that window: the referenced rows, everything up to the revision's end, and the retained rows just below.
  - A static frame is read from its own table, so typed provenance is kept.
- **Defect 5, month precision on a frozen scatter frame.** Before: "Mar 1, 2026". `pointDateUnit` now reads through `rowOf`, the same accessor hover uses.
- **Defect 6, throwing or re-entrant getters.** All three cases failed:
  - a strict append with a throwing getter did not throw;
  - a getter running a nested update ended the outer strict check;
  - a getter calling `destroy()` left AX150 on the destroyed handle.

  Changes:
  - Preparation state is now local to each call (`guarded(run(call))`); `append` sets its own.
  - Liveness is checked before acceptance (in `accept`, `update`, `append` and the guard's catch).
- **Table finding 7.** Before: an untitled create with a throwing getter gave `[AX199]` where `validate()` gives `[AX199, AX140]`. A create that fails now lists its AX140 after AX199. The append preparation context is closed by defect 6.
- **Defect 7, my half.** Before: 50,001 row-index reads to build the hover payload. Now at most 4.
  - `pointIndex()` reads the y value from the caller's row, binary-searches it within the run of points at that x, and checks the row index.
  - If the guess does not lead to the datum (a `parse` option, ties), it walks the run as before.
  - This needed no lookup or contract change.
- **Defect 9.** The donut case (112 px of plot room, 48 px strip) passes on the code from 12492de for both the measured and the estimated strip. It is now a test: `none` mode, the ring is drawn, no AX142.
- **Defect 10, narrow scatter x endpoint.** Before: ticks ended at 10 on a domain ending at 12.
  - Change: `scatterXExtent` now uses the same extent as the view's domain (every series, missing-y x positions included, x references); it is memoised and added to the layout key. The reviewer's case passes.
  - Not fixed: a probe still finds x −3.3, 7.7, 1001.5 at 195–215 px wide drawing domain [−500, 1500] with ticks [−500, 0, 500, 1000]. That needs the coarser-domain path for x in `src/layout`.
  - I already pass `x.coarser` for scatter from `axes.ts`; layout ignores it for now.
  - **Exact change for the layout author:**
    1. The bottom-axis fit of a continuous x reports `partial: true` when it keeps no whole candidate set (as `fitValue` does at labels.ts:465).
    2. `layoutAxes` returns that x flag next to `valueFit.partial`.
    3. `computeLayout` tries `input.x.coarser` when the x fit is partial, as it does for y at index.ts:256–261.
- **Defect 11, watcher reattachment.** Before: the theme watcher's 3 media listeners stayed live and the next resize skipped setup (listener count 3 where 0, then 5, was expected).
  - `watch()` in `chart.ts` now rolls back that attempt's subscriptions and resets `watching` on failure.
  - The browser test fails before the fix and passes after, on chromium, firefox and webkit.
- **Defect 12, my half, memory accounting.** Before: 8,714 B reported against 42,042 B held by the displayed frame.
  - `memory()` passes every live frame (displayed, drawn, accepted, held, in flight) to the data author's `ownedBytes(frames)`, so all are counted in one deduplicated set.

### Claims not confirmed
- **In-flight pin.** New test: during the first stream frame's commit, an append with `keep:1` evicts the frame's rows and a hover is sent from inside the commit. It passes with the pin. With the pin removed (temporarily, then restored) it got `row: null`.
- **Held datum evicted (controller half).** New test: on the paused screen the evicted held datum still gives its own row; after Resume it gives `null`.
- **Throwing value formatter running again after the first write.** This was a real double call. The summary is lazy, so the formatter's AX160 changed the disclosure after the reader had settled, and the reader was rebuilt during the figure write. `settleReader` now builds the summary before checking the disclosure. The new test fails before the fix and passes after.
- **Font measurement after reattachment.** A regression test, passing before and after. It fails only when both the reattach `noteFontLoad` and the font-probe observer are disabled (checked temporarily, then restored).
- **The two snapshot properties in `final-review.test.ts`:**
  - Zoomed marks are checked on their own: every path vertex, read back through the drawn projection, is a model row (x and the current field's value) inside the domain or the nearest row beyond each edge.
  - Collapsed frames must leave no marks. Error-state frames must show AX199 and no marks.
  - Scatter hover provenance: every point gives its own row and y.
  - Retention is checked at the policy's real bound: running, exactly the model's window (0 for static data); paused, at most `max(2 × baseline + 8, window)`.

### Coordinator's two additions
- **Empty `loadingdone`.** `watchEnvironment` ignores an event with zero `fontfaces`.
  - New browser test (no CDP): dispatching an empty event moved the layout counter before the fix ("expected 2 to be 1" on chromium and firefox). After the fix it does not move.
  - A real late font still reruns layout, and its tick labels then measure within 0.5 px of their rendered width.
  - Passes on chromium, firefox and webkit. I did not establish whether the font's own `loadingdone` or the font-probe observer triggers that rerun; either is fine for the test.
- **Type check of `reattach.browser.test.ts`.** Fixed (`playwright-core`, typed parameter). `npm run typecheck` is clean.

### Last lines of each run
- `npm run typecheck`: exit 0.
- `npx vitest run packages/axylo/test/core`: `Test Files 15 passed (15)`, `Tests 248 passed (248)`.
- Whole Node suite (`npm test`): `Test Files 72 passed (72)`, `Tests 1696 passed (1696)`.
- `late-font`, `reattach` and `loadingdone` (built from source with `openEntry`): `Test Files 3 passed (3)`, `Tests 4 passed (4)` on each of chromium, firefox and webkit.
- `test/browser/chart` on chromium against the private build (`AXYLO_BUNDLE`): `Test Files 4 failed | 18 passed (22)`, `Tests 4 failed | 252 passed (256)`. The four failures:
  - `render` "works with the stylesheet applied through ensureStyles": fails only under `AXYLO_BUNDLE`, because the harness adds the bundle's CSS as a style tag. It passes against the shared dist (`Tests 1 passed`).
  - `final-hold` "a resize into readout mode while the pointer is in the corridor" and `final-verify` "click the plot, then ArrowRight": the interaction author's tests, with their `src/dom` edits in progress in the tree. Not investigated.
  - `zz-rows-probe`: not mine; it timed out.

### Not done
- The layout half of defect 10 (exact change above).
- The lookup half of defect 7 (lattice on first pointer move) and the store half of defect 12: with their authors.

No contract change was needed.
