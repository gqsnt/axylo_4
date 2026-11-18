<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a1d73b9f46c46814f, resumed. Saved by the coordinator from the hand-back. -->

## Chart core, fifth pass: report

Nothing is committed and the tree compiles. Everything you listed is done except interaction item 13 with decision 0004 rule 4 (the readout's reserved space) and part of the part-3 weak-test list; both are explained under "Not done". I did not touch the shared `dist` to test old code: the old revision (88a8b96) is built privately at `/tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/core-fix/old5/`. A new switch in `test/browser/chart/util.ts`, `AXYLO_BUNDLE=<dir>`, loads that bundle into pages of my own suites only.

### 1. F7: the domain ends at the first drawn tick at or beyond each extreme
- **Cause:** a floating-point comparison in `core/axes.ts` `endingCandidates`. The check `b - step < hi` let the 0.1-step tick set through, because 0.2 − 0.1000…09 comes out just below 0.1.
- **Fix:** each tick set is now checked on its own tick values. The first tick at or above the maximum must be the last tick, and the last tick at or below the minimum must be the first. `scale/domain.ts` was already exact.
- **Tests:**
  - `test/core/axes.test.ts`: the [-0.8, 0.2] case (failed before the fix) and a property test.
  - `test/scale/domain.test.ts`: property "an extreme equal to k × step ends the domain there".
  - `f-domains.test.ts`: 28/28 pass.

### 2. Donut shares: at most one fraction digit
- A new `shareText` in `format/number.ts` is what `formatters.percent` now uses. It rounds the exact decimal, so 0.1235 reads 12.4%.
- Values on a percent or ratio scale keep their F6 readout digits.
- Tests in `test/format/index.test.ts`: 17.2%, the German form, 12.4%, 33.3%, and a ratio value that stays 17.241379%.

### C4: the series colour on the pattern overlay
- `render/svg.ts` `updateBars`: the overlay rects that carry the pattern also carry the series colour style. The colour is part of the cache key, so a theme change updates it.
- Test in `test/browser/render/review.browser.test.ts`: the elements carrying the series colour whose fill is a pattern. It failed before the fix and passes now; the render suite is 84 passed, 1 skipped.

### 3. Interaction review
| Item | What changed | Old bundle |
|---|---|---|
| new 9 | Choosable tooltip rows and every donut slice-list entry (zero and null slices included) are buttons named by their text, with `tabindex=-1`, so the closed chart still has two tab stops. Clicking a slice entry selects it; the press does not move focus. Opening the table by keyboard closes a pin (this already worked). | 2 of 3 tests fail on old; the pin test passes on old and stays as a guard |
| part 1 item 3 | All-zero donut with `table: false` still lists its slices. Already worked. | passes on old (guard) |
| part 1 item 9 | `minimumWidth` is now at most half the axis and at least one unit in the last place: two or three positions over [0,100] can be halved, and [1e16, 1e16+4] halves to a width of 2. | Node tests in `focus2.test.ts` failed before the fix |
| part 1 item 11 | A pinned scatter point is dropped when its point has no drawn anchor. Otherwise the group is rebuilt by picking at that anchor, so new coincident points are counted. | both tests fail on old |
| part 1 item 12 | `core/chart.ts` `measure()` now gives layout pixels rather than transformed viewport pixels. One conversion (`cssScale` in `tooltip.ts`) is used for picking, anchors, tooltip size and placement, and the readout. Ratios within 2% are treated as offsetWidth's integer rounding, not as a transform. | fails on old |
| part 1 item 15 | An open table and its control stay inside the card when the card shrinks and text doubles. Already worked: no inline heights. | passes on old (guard) |
| language watcher | Changing `lang` on the document changes number formatting to `1.234,5`, marks built-in text `lang="en"`, and runs no theme stage. | passes on old (guard) |

The new tests are in `test/browser/chart/review5.browser.test.ts`.

**24 px rows trade-off (decision for you):**
- With 24 px rows everywhere, the hover tooltip grew about 12 px. At two plot edges it then no longer fit beside the mark, so the existing test "at each of the four plot edges…" fell back to the readout and failed.
- What I did: rows are 24 px when the tooltip is pinned by a tap, in the fixed readout, and in the slice list. A mouse-hover tooltip keeps text-height rows, which are still buttons.
- So WCAG 2.5.8 is met wherever rows are acted on by touch. It is not met for mouse clicks on hover rows. If you want 24 px rows there too, tell me and I will change the edge test's fixture instead.

### 4. Tests that passed with the behaviour broken
- Click test (`review2`): now asserts the floating tooltip's title and the exact selected x at each of the four positions.
- Contrast dash test: no longer skips when every plotted SVG path is solid.
- Donut legend: a second fixture where value and share differ, expecting "3 (60%)" and "2 (40%)".
- Zoom exclusions: now covers category bar, line, area and donut, by buttons and the `+` key.
- Coarse-double loop in `focus2` (pass 4).

Expectations I changed because the requirement changed: "two or three positions cannot be zoomed" (focus2 and review2) became the attainable-minimum rule; "the legend has no buttons" became buttons outside the tab order; the note runs in `snapshot.test.ts` are now per run.

### 5. Reader helper, note runs and AX143
- The stand-in is gone; the call site imports `seriesNotDrawnSentence` from `../reader`.
- `FigureModel.noteSegments` takes the reader's runs. A run is marked `en` only on a page in another language.
- Node test: overriding only `seeTable` leaves "Siehe Tabelle." unmarked; overriding only the sentence marks the built-in "See table." `en`.
- `figure.ts` no longer adds spaces between runs; the reader's runs carry their own.
- AX143 now passes `chartType`, `xKind` (taken from the frame for scatter as well) and `horizontal` for bars. Node test: vertical category bars get the horizontal-bar hint, a category line does not.

### 6. Mixed-sign totals
`focus.ts` already takes the total text from the lookup's tooltip model and computes no net. A Node test checks a stack of +3 and −2: the tooltip total is "3 and -2" and the focused text contains "Total 3 and -2".

None of my tests depend on worker threads, so the switch to forked processes changes nothing for them.

### Edits outside `src/core` and `src/dom`
- `src/render/svg.ts`: the C4 change only.
- `src/format/number.ts` and `src/format/index.ts`: share precision only.
- `src/theme/css.ts`: the figure section (choice buttons).
- Test files: `test/scale/domain.test.ts`, `test/format/index.test.ts`, `test/browser/render/review.browser.test.ts`.

### Not done
- **Item 13 with rule 4 (reserved space for the readout).** Reserving space when the floating tooltip might not fit costs a small tile's plot room on every chart; that is why I reverted it in pass 3. Placing the readout inside the plot column stops it covering the controls but drops "reserved". I need a decision: reserve space only below some figure width (which width?), or allow the readout over the plot.
- **Part 3, remaining:**
  - the 40-move sweep at several strides;
  - a clipped fallback that passes `isVisible()`;
  - the native-range and narrowed-scatter adjustments;
  - selecting a secondary row by touch in the readout (the pinned-tooltip case is covered);
  - the area-marker oracle;
  - the speech-related tests (screen-reader output cannot be observed here).

### Runs (last lines)
- **Type check:** exit 0.
- **`npx vitest run packages/axylo/test --exclude '**/acceptance/**'`:** `Test Files 2 failed | 43 passed (45)`, `Tests 2 failed | 768 passed (770)`.
  - `data/streaming-storage.test.ts` "bounds the retained typed-array backing…": data module, under edit.
  - `simplify.test.ts` "million-slot outlier": a timing limit (38 ms against 30) under load; it passes when run alone.
- **Browser chart and a11y, SVG:** `Test Files 13 passed (13)`, `Tests 184 passed (184)`.
- **Browser chart and a11y, canvas:** `Test Files 13 passed (13)`, `Tests 184 passed (184)`.
- **Browser render:** `Test Files 5 passed | 1 skipped (6)`, `Tests 84 passed | 1 skipped (85)`.
- **`npx vitest run packages/axylo/test/acceptance/f-domains.test.ts`:** `Test Files 1 passed (1)`, `Tests 28 passed (28)`.

Logs are `p9-*.txt` in `/tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/core-fix/`.

No contract changes needed.

