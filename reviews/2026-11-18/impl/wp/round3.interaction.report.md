<!-- Author: Claude Opus 5.5 (high), agent aa0e6fca8e4a6224b; saved by the coordinator -->

## Round 3 (interaction): result

Every item has a change and a test, except where noted. I wrote each test against the committed code first; on a bundle of HEAD before my edits, 13 browser tests and 1 Node test fail and pass after the fix. Several tests also passed on the old code, so they prove less — listed in the table and under "What this does not cover". Nothing is committed, the shared `dist` was not touched, and every probe and scratch file is removed. The a11y probe that broke `npm run typecheck` for everyone has been deleted.

Two things are not mine or not done:
- **R8, controller's half:** two clicks at −1,000 and 1,500 now request `[-1000, 1500]`. On the build I tested (before c29e566) the controller clamped that to `[-500, 1500]`, so the drawn domain stayed `[-2000, 2000]`. My test asserts only that the request is made; it needs your re-check on the shared build.
- **R5 cost test:** dismissal now goes through `lookup.has`. I did not write a test that 49,999 appended points are not walked.

## Per item

New browser tests are in `test/browser/chart/final-round3.browser.test.ts` unless named otherwise.

| Item | Test written first | Old code | What changed |
|---|---|---|---|
| 1 Groups from the lookup | "nine exactly coincident points with clipped points interleaved: page two lists the ninth" | **fails** | `groupRefs` deleted from `core/focus.ts`. Paging uses `lookup.members`, dismissal uses `lookup.has`. Rebuilt targets keep the pick's `rule`. Node tests in focus-reading now call `lookup.members`. |
| 1 (ring) | "32,000-point ring: page two in the winning device pixel" | passes | Does not reproduce in the browser at this size; kept as a guard. |
| 2 Escape | Donut replica of the acceptance sequence; "R4: pin A, over B, Escape, move within B: B opens" | **both fail** | A dismissed datum now lapses only when the pointer or keyboard reaches a datum other than itself. Escape from a hold closes the held datum and the one under the pointer. Escape from a pin closes only the pin, which stays shown until the pointer moves. |
| 3 R1 | "pin Q3, press its row, append Q5 with keep 4, release: Q3"; "pointer press on one row, then Enter on another: both selected" | **both fail** | A press captures the row entry, and release selects that entry's current (remapped) row. Only the pointer's own click (`detail > 0`) is swallowed. |
| 4 R2 | "A in a shadow root, created first: pin A, hover B, Escape: A's pin closes, B stays" | **fails** | New `activeElementOf` in `dom/attributes.ts` follows `shadowRoot.activeElement`; used for Escape ownership (decided before the drag branch), focus hand-off and teardown. With focus in no chart, a dragging chart owns Escape. |
| 5 I4 | "long category name in a narrow strip: title cut, row and pager inside, or nothing"; "a strip of which only a sliver is visible is not shown" | **both fail** | The strip is shown only if its title, first row and pinned "+N more" lie wholly inside its box and its ancestors' clip. The viewport does not count, because a strip in the page flow can be scrolled to. The strip's title is one line with an ellipsis (`theme/css.ts`). |
| 6 I5 | "chart slotted into a component whose shadow wrapper clips: tooltip stays inside" | **fails** | The clipping walk goes through `assignedSlot`. The control focus-outline allowance is 3 px times the mapping's scale; no test for that. |
| 7 R8 | "195 px scatter, unzoomed: a wheel zooms around the pointer within the drawn domain" | **fails** (off by 1,000 units) | One helper, `zoomBounds`, now serves Select range, drag, pinch, wheel, keys and pan: `view.xFull` while zoomed, the projection's domain unzoomed. |
| 7 R8 (two clicks) | "Select range −1000 to 1500 asks for that zoom" | passes | My half only; see above. |
| 8 R9 | "scaled to 0.5: whole viewport pixel left of the edge picks the edge mark" | **fails** | Points within 1 viewport px outside the plot rectangle are moved onto its edge before converting to layout pixels, for picks and range ends. |
| 9 R10 | Node test (focus-reading): Q3 and Q4 formatted alike read differently | **fails** | `datumReading` uses the raw category key, and the last spoken datum is remapped exactly. |
| 10 R14 | "first end set, drag, append before release: selection stays the drag's" | **fails** | No first-end repaint during a drag. |
| 11 I6 | "after a switch into the strip and a 300 ms rest there, the corridor holds" | passes | A presentation switch restarts the rest for the still pointer; a committed anchor change on the same pick restarts it too. A tooltip-rectangle change alone does not yet restart it. |
| 12 I13 | "reordered all-zero slices keep focus" | **fails** | Focus is restored after reordering the slice list. |
| 12 I13 (jump) | "missing-y date can be jumped to" | passes | The last-resort scan in "Jump to" now calls the reader's `printedX`. |
| 13 | I2 narrowed secondary ref survives a redraw and Resume (Pause and Resume from the keyboard, since a click elsewhere ends a pin by rule 4); I3 pinch with no zoom ends the pin and hover works | both pass on old | Missing tests added. Still missing: a scaled control outline. |

## Runs (private bundle, then removed)

| Run | Result |
|---|---|
| `npm run typecheck` | clean |
| `npx vitest run packages/axylo/test/core` | 16 files, 262 passed |
| chart + a11y, SVG | 301 passed, 1 failed (302) |
| chart + a11y, canvas | 297 passed, 1 failed, 4 skipped (302) |
| `final-*`, Firefox | 94 passed, 3 failed, 2 skipped (99) |
| `final-*`, WebKit | 94 passed, 3 failed, 2 skipped (99) |
| round3 + partials after fixing those 3 | chromium 28 passed; Firefox 26 passed, 2 skipped; WebKit 26 passed, 2 skipped |

- The single SVG and canvas failure is the known `ensureStyles` artefact under `AXYLO_BUNDLE`; the 4 canvas skips are SVG-only tests.
- The 3 Firefox/WebKit failures were the R9 test using a fractional pointer (now whole pixels) and two CDP pinch tests. The pinch tests now carry `requireEngineFeature(['chromium'])`, so they are skipped there.
- Acceptance was not run, since it needs the shared build.
- `test/core/round3.test.ts` (the controller author's) had 2 failures mid-run; the final core run passed all 262.

**Size**, release-settings rebuild of HEAD c29e566 against HEAD plus my files: everything 118,941 → 119,275 B (+334 B gzipped); line only 99,405 → 99,716 B (+311 B).

## What this does not cover

- Fully confirming R8 (controller's half).
- Tests for R5's cost, a scaled control outline, and the I6 tooltip-rectangle case.
- The ring, I6, the two-click R8 request and the missing-y jump tests pass on the old code too, so they guard against regressions but do not prove those fixes.

## Files

- **Source:** `src/dom/{interaction,tooltip,mapping,attributes,table,toolbar}.ts`, `src/core/focus.ts`, `src/theme/css.ts`.
- **Tests:** `test/browser/chart/final-round3.browser.test.ts` (new), `test/browser/chart/final-partials.browser.test.ts`, `test/core/focus-reading.test.ts`.
