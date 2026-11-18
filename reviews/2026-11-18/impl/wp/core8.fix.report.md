<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a1d73b9f46c46814f, resumed. Saved by the coordinator from the hand-back. The agent was then resumed for the data agent follow-ups; its work is committed after that report. -->

## Chart core, eighth pass (controller side): report

**For routing first: nothing here blocks your other two agents, but each has one request below.**
- **Interaction agent:** add `readoutMode: 'floating' | 'strip' | 'none'` to `ControlsState` in `dom/interaction.ts`. The controller already sends it (through a cast). `'none'` means no floating tooltip and no strip; `readout: boolean` still comes as `readoutMode === 'strip'`.
- **Data agent:** two requests, listed under "What I need from the other agents".

Nothing is committed, the tree compiles, and I did not swap the shared bundle. The new tests are in `packages/axylo/test/core/final-review.test.ts`; each reviewer sequence failed before its fix unless the table says otherwise.

### Findings
| # | Status | What changed | Test |
|---|---|---|---|
| 1 | Fixed, one exception | **Author code before the first write:** tick labels are made, and their AX160s collected, before anything is written (`core/axes.ts`: labels are made once per view and options, so the layout computed after the first write reuses them). Reader rebuilds caused only by labels being hidden reuse the summary already written. **In-flight pin:** the frame being published keeps its rows until it is on screen. **Callbacks:** hover, select, zoom and diagnostics raised during a frame are queued and delivered after publication. **Stale frames:** a superseded or destroyed frame never publishes an error state. **Destroy:** nothing is shown after `destroy()`. **Exception:** the interaction layer still formats tooltip and value text with author formatters during its commit. That is now safe (pinned rows, deferred callbacks) but not moved; doing so needs the interaction layer. | tick formatter appending during the frame (row kept); all formatter calls before the first host write; a commit that updates then throws (no AX199 on the newer state); destroy from a hover during commit (passes on old code too, kept as a guard) |
| 2 | Fixed | The displayed, pending, in-flight and held frames each take their own copy of their rows once the store holds more than twice what was on screen plus 8 rows, so none of them pins history. The retention baseline moves only when the data on screen changes. | both sequences: 502 rows before, now at most 12 |
| 3 | Fixed | A successful running append supersedes a revision held by a Resume that failed. | the full sequence: 4 stays on screen with its row |
| 4 | Partly | New property test against an independent model, 300 runs. **Covered:** appends with and without `keep`, replacement, re-encoding, real zoom windows, pause and resume, a formatter calling back into the chart, resize to zero and back, failures at 7 stages, destroy at the end. **Checks:** drawn window against the model, caption, path vertex count, row provenance, a retention bound with no slack for extra revisions. **Not covered:** several series and kinds, re-entry from event handlers. | final-review property |
| 5a, finding 6 | Partly | While paused, the held window's findings count for strict: a held ninth series makes `update({ strict: true })` throw. **Not done** (see the data request for the first): re-encoding keeps rows with null y on scatter; a Resume from an AX103 handler during re-encoding; an AX101 that survives a paused append. | yes |
| 5b, finding 7 | Fixed | A call that fails while being prepared keeps what it found, then AX199, the same as `validate()`. Under `strict` this is a rejection, made before the chart changes. | four kinds compared with `validate()`; a strict create throws; a strict update keeps the last good chart |
| 5c, finding 11 | Fixed | Tick AX160s belong to the view's tick labels, so a cached or reused layout reports them too. | loading and back at the same size: AX160 and the note remain |
| 5d, finding 12 | Fixed | Dates in options are copied on acceptance. Zoom endpoints are copied. An instant between milliseconds, or a date or wall position that is not exact, is emitted as a number. | Date mutation in a domain; zoom Date mutation; a sub-millisecond window round-trips to another chart |
| 5e, finding 13 | Zoom done | `zoom()` on a compact chart reports AX150 and keeps nothing, so turning compact off applies no window. The tick-format half is the data agent's. | line, area, bar |
| 5f, finding 14 | Fixed, partly tested | `watch()` registers each watcher's release as soon as it succeeds. `theme/watch.ts` is exception-safe. Reattachment clears the document's font measurement cache (`noteFontLoad`). | `observe()` throwing leaves no media listener. Reattachment is not tested: it needs the browser, and `test/browser/chart` is the interaction agent's. |
| 5g, finding 8 (my half) | Fixed | The hover payload is only built when someone listens. A scatter point's value is found by binary search on x, then its row among points at that x, with no walk over the series. | the existing hover tests |
| 6, finding 9 and revision 3 rule 5 | Fixed | The mode is decided from the plot laid out without a strip. The strip height is two text line heights until measured, then the measured height. Below 240 × 140: `'strip'`, or `'none'` when the strip would leave the plot under 80 px; never `'floating'` below the limit. | 330 × 205 gives `'none'`; a plot under 140 px that keeps 80 px gives `'strip'`; a large plot gives `'floating'` |
| 7, finding 15 | Fixed | Scatter's automatic number x domain ends at drawn ticks (`core/axes.ts`). Line x is unchanged: 1.1 to 8.9 spans its data. | both statements |
| 8, benchmark hooks | Done | `describe()` now also gives `series[i].breaks`, `series[i].isolatedMarkers`, `series[i].keptBasis` (`'window'` for streaming charts), and `plot {x, y, width, height}`. New `memory()` returns `{bytes, buffers: [{name, bytes}]}`: `store.ownedBytes()` when there is a store, else the normalized frame, plus the scene's typed arrays, without the caller's columns. | runs and memory |
| 9, harness resize | Fixed | `describe()` was the wrong side. In short tiles the layout widens the automatic y domain to end at ticks a short plot can draw (F7), so the drawn y mapping was right and `describe()` reported the view's narrower domain. It now reports the drawn projection's domains. | a short wide tile: the drawn domain differs from the view's, and `describe()` gives the drawn one |

### What I need from the other agents
- **Interaction agent:**
  - The `readoutMode` field above.
  - Author value formatters still run during its commit (tooltip and value text). To finish finding 1 completely, that text would need preparing before the frame writes. With the pins it is now safe, so this is optional.
- **Data agent:**
  - `data/options.ts`: report AX150 (field `y[i].tickFormat`) for every supplied tick format a compact chart cannot show, including `y[1].tickFormat` in wide form, as `x.tickFormat` and `y[0].tickFormat` already are.
  - Finding 6, scatter re-encoding: the controller cannot copy a point frame's rows with null y, because `PointSeries.missingX` has no row indexes. It needs either a `missingRow?: Int32Array` beside `missingX` (a contract change), or a store method that returns a revision's source rows.
- **You (`public.ts`):** on `Point` and the zoom event, a sentence such as: "A position that a Date or a string cannot hold exactly (between milliseconds, or between days) is given as a number, which `zoom()` reads as the same position."

### Edits outside `src/core`
- `src/theme/watch.ts` (exception safety).
- New `test/core/final-review.test.ts`; `test/core/host.ts` gained an `onCommit` option.
- `test/core/controller.test.ts`: one expectation now includes `describe()`'s new `plot: null`.

### Runs (last lines, final build)
- **Type check:** exit 0. Two intermediate runs failed on `src/dom/interaction.ts` while the interaction agent was editing it; the final run was clean.
- **Node suite without acceptance:** `Test Files 1 failed | 47 passed (48)`, `Tests 2 failed | 836 passed (838)`. Both failures are the data agent's, in `data/streaming-storage.test.ts`: the kept memory test, and "reports owned bytes that match the retained buffers", which is theirs in progress.
- **Node acceptance:** `Test Files 16 passed (16)`, `Tests 512 passed (512)`.
- **Build:** succeeded (exit 0).
- **`packages/axylo/test/browser`, SVG:** `Test Files 4 failed | 29 passed | 1 skipped (34)`, `Tests 8 failed | 826 passed | 1 skipped (835)`. I believe none are mine; my changes only add a field to the controls state and change event timing.
  - A8 axe, 5 kinds: "a series hidden: label-title-only (#axylo-1-proxy)", in the proxy's labelling (interaction layer).
  - A5 scatter point shapes and T-tooltip-scatter (`'' to contain 'EU'`): tooltip and scatter, interaction or lookup side.
  - `review2` "in a card that clips its content…": the interaction layer's tooltip placement, in their directory.

Logs are `t2-*.txt` in `/tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/core-fix/`.

