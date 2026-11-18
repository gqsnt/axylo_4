<!-- Author: Claude Opus 5.5 (high), agent a1d73b9f46c46814f; saved by the coordinator -->

## Closing pass, controller author: all three items fixed

All three items are fixed, each proven by its own test in the new file `packages/axylo/test/core/closing.test.ts`. Item 2 follows the brief's decision that a tick-only AX160 has no effect on the figure. That meant changing the expected note in three existing tests of mine, listed below. Nothing is committed; private builds are removed and I left no probe files. The store needed no change.

### Per item
1. **C2, last sequence: late appends while paused and hidden.**
   - The reviewer's sequence, run as written: draw x=101 with `keep: 1`, Pause, then 100 times hide, append a late x=0 and show.
   - Before: 101 revision sources kept. The count comes from a new development-only hook, `__dev.retainedSources()`, which reads the store's private revision bookkeeping.
   - Change, in `release()`: the existing bound (2 × baseline + 8) now also applies to how many revisions are kept, not only to rows. When the span from the oldest pinned revision to the store's head exceeds it, the pinned frames copy their own rows. Freezing now also moves the floor to the head.
   - After: within the bound. The paused screen and hover still give x=101's own row, and Resume works.
   - The freeze cost stays spread over the appends that caused it, because the bound grows with what was on screen.
2. **AX160 keeping a fixed-height chart redrawing.**
   - The test sets y domain [0, 10], a tick formatter that throws at 2, heights 120 to 320 px, and one resize notification per frame (as the page's observer gives them).
   - Before: at 226 px, 6 layouts for 6 notifications, alternating.
   - Change: the AX160 published from drawn ticks now has effect `none`, so it adds no note and cannot change the fit. `presentationList` keeps the finding with an effect when the same code and field appear twice. So a throwing **value** formatter still shows the note; a separate test checks that.
   - After: at most 1 layout, nothing pending, at every height.
   - **Expected values changed in three existing tests of mine.** They asserted the note for a tick-only AX160, and now assert no note:
     - `controller.test.ts`: "a tick formatter that throws gives AX160 …"
     - `final-review.test.ts`, finding 11: "… survives a loading state …"
     - `test/browser/chart/review.browser.test.ts`: "a throwing tick formatter …"

     Each still checks that AX160 is reported and later retired, and each change carries a comment citing the decision. The spec has no wording yet that a fallback tick label is not a value shown differently under F12; you may want that in the documentation.
3. **An append undoing a narrow scatter's zoom.**
   - The test uses the R8 fixture at 195 px: zoom to [−1000, 1500], then append x=1600.
   - Before: the window jumped to [−500, 2000].
   - Change: the widened drawn domain is remembered for the frame's epoch rather than for the view's exact domain. A zoom on the same data, appends included, reads windows against the union of that domain and the current data domain.
   - After: the window stays [−1000, 1500], and `xFull` reaches past 1600.

### Last lines
- `npm run typecheck`: exit 0.
- `npx vitest run packages/axylo/test/core`: `Test Files 17 passed (17)`, `Tests 266 passed (266)`.
- Whole Node suite (`npm test`): `Test Files 1 failed | 74 passed (75)`, `Tests 1 failed | 1751 passed (1752)`. The failure is the data author's `streaming-storage.test.ts` "reports owned bytes …". Alone it passes (`Tests 57 passed (57)`); I did not find out why it failed in the full run.
- Browser `chart` and `a11y` on chromium against the private build: `Test Files 2 failed | 23 passed (25)`, `Tests 2 failed | 306 passed (308)`.
  - `review.browser.test.ts` was the tick-note expectation above. After updating it: `Tests 27 passed (27)`.
  - The other is `render` "ensureStyles", which fails only under `AXYLO_BUNDLE` (a harness artifact).
- `late-font`, `reattach`, `loadingdone`: `Test Files 3 passed (3)`, `Tests 4 passed (4)` on each of chromium, firefox and webkit.

### Size
Release-settings iife, gzip -9: HEAD 118,574 B; HEAD plus only my files (`core/controller.ts`, `core/instrument.ts`) 118,645 B, so **+71 B**. The new hook is in development builds only.

### Not done
Nothing from my section.
