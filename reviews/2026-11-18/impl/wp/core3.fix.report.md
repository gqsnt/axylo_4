<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a1d73b9f46c46814f, resumed. Saved by the coordinator from the hand-back. -->

## Third fix pass: chart core (two third-round reviews, plus the later additions)

Partly done. Both page-level blockers and all four controller blockers are fixed, the displayed snapshot is in place, and most controller majors are fixed. Several interaction majors and test-strength items are not done (listed below). Nothing is committed; the tree type-checks and `npm run build` works.

### The snapshot design (`core/controller.ts`)
I did not write the invariants as a block at the top of `controller.ts`; they live in the comments on `release()`, `showing()` and `frame()`. The property test checks them.

- **Displayed snapshot.** `onScreen` holds the frame on screen, its store and, if needed, a copy of its rows. `drawn` holds the view, layout, lookup and reader for it. It changes only when a frame publishes, and becomes empty after a failed frame or a frame with no size.
- **Row ownership.** `release()` runs after every accepted call and every published frame, whether or not frames run.
  - It keeps the revision on screen and any accepted frame not yet drawn.
  - The store can only retire "everything up to revision N". So once it grows past twice its last size, the frame on screen copies the rows it uses into a map, and everything older than the newest revision is retired.
  - Result: `keep` bounds memory with zero frames or with every frame failing. This relies only on the data module's "Frame lifetime" rule (`rowAt` works until `retire()` reaches that revision).
- **One generation per frame.** Author code runs, and the lazy `reader.summary`/`note` are materialized, before the first host write. If the chart changed or was destroyed by then, the frame stops having written nothing. Once writing has started, the frame finishes for the same state, and a newer call is drawn by the next frame. A destroyed controller swaps in an inert host.
- **Error revision.** Each step runs on its own, in this order: interaction off, then the error message, then a new host `surfaces(false)` hides marks and text without calling their draw methods, then the content is cleared. The next good frame shows the surfaces again.
- **Held state.** While paused, `diagnostics` include the held rows' findings, but the error state is decided only from what is on screen. A held frame is dropped only once its replacement is accepted, so a failed Resume keeps it and the next accepted call shows it.
- **Notifications.** `onDiagnostic`, console output and events go through one in-order queue. Each delivery is fixed when it is made and delivered in full; only destruction stops it.

The fast-check property test (300 random sequences of append, title, data, pause, resume, zoom, frame, failing frame, heal) checks after every step: describe and lookup agree, every x on screen hovers to the caller's own row object, the prepared and committed views are the same, and retained rows ≤ keep + rows shown + 69.

### Controller review
"Reproduced" = the new test failed when run against 4809516 (`test/core/snapshot.test.ts` in a copy of that tree, browser tests against its bundle).

| # | Reproduced | Fixed | Test |
|---|---|---|---|
| B1 superseded frame writes | yes | yes | snapshot "blocker 1" ×2 |
| B2 Resume loses rows | yes | yes | snapshot "blocker 2" ×2 |
| B3 renderer exception | yes | yes | snapshot "blocker 3" ×2 |
| B4 keep unbounded | yes | yes | snapshot "blocker 4" ×3, property test |
| 5 re-encode while paused / failed Resume | yes (failed Resume) | failed Resume: yes. Re-encode while paused: no | snapshot "finding 5" |
| 6 append writes wrong state | yes | yes | snapshot "finding 6" ×3 |
| 7 re-entrant deliveries | yes | yes | snapshot "finding 7" ×2 |
| 8 stale AX101 after a valid append | not tested | no | — |
| 9 late setup failure / kept unsubscribe | yes (unsubscribe) | yes (controller destroyed on late failure; per-subscription cleanup in `watchEnvironment`) | snapshot "finding 9" |
| 10 two charts on one target | yes | yes (theme properties and scheme on the chart's own figure) | review3 "finding 10" |
| 11 stream copies / scans | not tested | partly: formatters no longer hold the table. Not done: statistics cached by view, title update without a row-index allocation | — |
| 12 resubmitted mutated objects | not tested | no | — |
| 13 AX160 lifecycle | not tested | no | — |
| 14 create exception → AX199 | yes | yes (delivered before anything is accepted; `validate` classifies the same way; undefined keys handled alike) | snapshot "finding 14" |
| 15 scatter percent/ratio domain | yes | yes (`core/stages.ts`) | snapshot "finding 15" |
| 16 follow at the latest datum | yes | yes (latest data x, `missingX` included) | snapshot "finding 16" ×2, missingX test |
| 17 category zoom | — | no | — |
| 18 all-missing bars | yes | yes | snapshot "finding 18" |
| 19 environment changes | not run against 4809516 | yes: DPR and font epoch reread on reattach; `lang` watched; theme changes go through the frame scheduler (one draw per frame) | snapshot "finding 19" ×2 |
| 20 weak tests | yes (host accessors) | partly: host keeps live accessors, records surfaces and writes after dispose; Node re-entrancy test rewritten. Other named tests not reworked | — |

### Interaction review
| Item | Reproduced | Fixed | Test |
|---|---|---|---|
| New B1 scatter value change hangs | yes (hung) | yes: global order, at most `count` steps | review3 "blocker 1" |
| New B2 right-hand toolbar covered by the table | yes | yes: new plot column (`figure.stage`); table overlays only it; nothing frozen in pixels; focus moves into the table; pins close | review3 ×2 |
| New 3 tooltip placement | — | partly: placed across the reading axis per decision 0004, keeps clear of pointer and mark, readout kept inside the viewport and clipping. Reserved readout space (rule 4) not done | interaction "four plot edges", acceptance I1 |
| New 4 focused text | — | yes, decision 0004 part 2: text rewritten only for a move, a changed datum, a datum that left, or regained focus | review2 B4 test (changed to match the decision) |
| New 5 data replacement and focus | not tested | yes | none dedicated |
| Part 1 #7 coincident count | — | yes: full count kept, focused point listed first | — |
| Part 1 #8 single-pointer pan | — | yes: Pan left / Pan right in the toolbar while zoomed, unavailable at an end | axe forced-colors list |
| Part 1 #18 Jump to | — | yes: parsed per locale with a unit; malformed grouping rejected; categories exact; visible `jumpNotFound` error with an example | review2 jump test |
| Part 1 #19 language | — | partly: summary, plot label and role marked `lang="en"` | acceptance A10 (passes) |
| Instructions | — | yes: `plotInstructions` is the plot's description | — |

Not done:
- New items 6–10 (too-small/compact focus handoff and overlay reset; Zoom in that can zoom out; misleading slider in loading and all-hidden states; touch-sized row actions; cancelled pinch frame).
- Part 1 items 2 (exact identity for pins and dismissal), 3 (slice list availability), 9 (attainable minimum), 10, 11, 12 (CSS transforms), 13, 15 (shrinking an open table: one test passes, nothing more done).
- Part 3, the list of weak tests.

**Edit you asked for:** the dark-toggle test now compares rendered pixels with each scheme's colour as resolved in the page, and first asserts the two colours differ.

### Acceptance-suite requests
- **F4 scatter month/year precision:** fixed (precision read from the caller's rows; the point frame has no field for it).
- **F7 domain ends at a drawn tick:** fixed in `core/axes.ts`, not in scale or layout. Layout may only choose tick sets whose first and last ticks are the domain's ends with no tick between an extreme and its end. Property test `test/core/ticks.test.ts` covers line, bar and scatter for container heights 300–700 px.
- **Below about 200 px of plot F7 can still fail:** five-interval rounding needs more ticks than fit. Fixing that needs the domain chosen in layout with the data extent, a scale/layout change.
- **A4 x unit in the table header:** wired; passes.
- **L3 zero-size:** passes (no draw call before anything was drawn).
- **A10, A5 bar gap, I1 bar, I1 scatter:** pass.
- **L8:** the visible summary is now the first sentence; the full summary moved to a separate description element, still the figure's `aria-describedby`.
- **Still failing:**
  - **L1 at 200 % text, 240 px wide (line, area, scatter, donut):** the one-line summary falls outside the figure's height.
  - **C4 compact bar:** the pattern is drawn, but the test reads cues from the series group element, and `render/svg.ts` (not mine) puts the pattern on the child rects.
- **Messages I build myself:** "Total" (tooltip and value text), `pan*`, `jumpNotFound`, `plotInstructions`. None of the sentences `seeTable` affects. The donut slice text joins value and share as `${value} (${percent})` in `dom/interaction.ts`.

### Edits outside `src/core` and `src/dom`
| File | Change | Test |
|---|---|---|
| `src/view/index.ts` | `scatterX` includes `missingX` | `test/view/missing-x.test.ts` |
| `src/scene/bars.ts` | grouped bars 1 px narrower (1 px of background between them); compact multi-series bars get the pattern cue | `test/scene/scene.test.ts`: two geometry expectations changed to the new widths, plus a gap check |
| `src/render/canvas.ts` | bar edges snapped to device pixels | browser separator test, both renderers |
| `src/theme/watch.ts` | watches `lang`; calls back synchronously per observer batch so the controller schedules its frame | existing theme tests; snapshot "finding 19" |
| `src/theme/css.ts` (figure section) | stage, table overlay, readout, swatch dash, jump error, one-line summary | — |
| `core/stages.ts`, `test/core/host.ts` | as granted | — |

The two changed expectations in `test/scene/scene.test.ts` belong to the scene module's author; they should review them.

### Last lines of each run
- **Type check:** `tsc -p packages/axylo` and `tsc -p docs/api` both clean.
- **Node core:** `Tests 114 passed (114)`. Node acceptance: `Tests 494 passed (494)`.
- **`npm test`:** `1 failed | 1209 passed`. The one failure is simplify's million-point timing test, not mine.
- **Owned browser directories:** SVG `Tests 163 passed (163)`; canvas `Tests 163 passed (163)`.
- **Browser acceptance:** SVG `Tests 5 failed | 452 passed (457)` (the five listed above).
- **Browser acceptance with canvas:** `135 failed`. The suite reads the SVG DOM (`svg.axylo-svg`, `getScreenCTM`). My suite-wide canvas switch in `chart/util.ts` also reaches these tests, so they fail by construction, not because of the library. The suite needs an opt-out or a renderer-agnostic way of reading marks.

### Not observable here
- Screen-reader speech: decision 0004 part 2, and `aria-valuetext`, which Chrome's accessibility tree does not report (it gives the number).
- Behaviour under CSS transforms.
- Real GPU rasterization.

### Contract changes needed
- **`DatumRef` comment**, corrected sentence: "x position (category: its index in the frame that produced the ref; categories can slide when a streaming window evicts them, so a holder remaps by category name across frames of one epoch)."
- **Bar cue past 32 series:** `RectMark.pattern` has only three kinds, so series 9 and 33 repeat colour and pattern. Spec F9 needs more pattern kinds in the contract.
- **`plotInstructions` default:** the current default ("Enter shows one series at a time") misdescribes the keys. Proposed: "Left and right arrows move between points, up and down between series, and Enter selects. Plus and minus zoom; 0 resets."

