<!-- Author: agent a7e48ddd0321b1b1e (observed model in its transcript: claude-opus-5-5; requested effort xhigh, not recorded in the transcript). Applies the review matrix-review.review.md (Codex gpt-6.2-astra xhigh) and the spec changes cbcc87a, eb2de43, af21368, 6772563 to the matrix of d9fa4b0. Saved by the coordinator from the hand-back. -->

# Matrix re-merge 2: the review applied, the statements re-synced with the spec

## Result

`node acceptance/check.mjs` exits 0. Its static count is:

```
- pass · 0
- fail · 0
- weak · 213
- no evidence · 0
- not run · 95
- cannot be verified here · 11
- not applicable · 257
```

`node --test acceptance/test/*.test.mjs` runs 30 tests: 30 pass, 0 fail. `acceptance/report.md` was regenerated with `node acceptance/check.mjs --write` (static, no result files).

Reachable status means what a cell reaches once every cited result passes. The total is 576 cells.

| Reachable status | Now | After merge 1 |
|---|---:|---:|
| Pass when run | 51 | 117 |
| Weak | 213 | 151 |
| Pending (not run by a `pending` text) | 44 | 32 |
| Cannot be verified here | 11 | 11 |
| Not applicable | 257 | 265 |
| No evidence | 0 | 0 |

Of the 11 "cannot be verified here" cells, five are A3, which the owner waived (5e746fe). The waiver was kept.

**The 51 cells that can still pass:**
- F1/area, F12/donut, F11 (all five applicable cells), F5/line, F9/bar, F9/scatter.
- T-dense-line, T-dense-bar, T-dense-scatter.
- T-keyboard (all five), T-pointer (all five), T-tooltip line, bar, donut and scatter, T-zoom-donut, T-limit (all five).
- T-reference line, area, bar and scatter.
- A6 full (five cells): it now needs Chrome, Firefox and WebKit results.
- I5 full (five cells), L6/donut, DX1/line, DX2/line, DX2/donut.

**The 44 pending cells:**
- DX5, DX7, DX12, P6 and P7: six each.
- P3: six. P4 line, area, bar and scatter: four.
- P1/line, P2/line, P5/line, P8/compact: four.

**How I checked.** I checked every weakness the review names against the test file at the lines it gives before writing it into a cell. Section 1 below says what I confirmed. Where the same citation carries the same weakness in a cell the review did not sample, I added the same gap there; those cells are listed.

## Rules applied across the matrix

**Standard browser limit.** It now reads: "Browser evidence: system Chrome, SVG renderer (the default); the citations are answered by Chrome results only, and no Firefox or WebKit result is recorded for this revision." The old wording ("recorded yet") was replaced in every cell that cites a browser test. Firefox and WebKit results exist for 7208470 (`acceptance/results/engines-7208470`), so "yet" was not accurate.

**"Not measured" sentence.** In every P row and in DX5 it now reads: "Not measured for this revision: the benchmark harness in bench/ exists; the acceptance measurements wait for a quiet machine (STATUS.md, 2026-11-18)."

**WCAG citations (6772563).** No matrix text quotes a spec row's WCAG column. Only test titles mention WCAG numbers, so nothing changed.

## What changed, per row

### F rows

- **F1** (bar, compact): gap added. Every bar assertion reads vertical bars' edges, so a horizontal bar chart's zero baseline (full or compact, `horizontal: true`) is never checked. Confirmed at `f-domains.test.ts:27–32`.
- **F2**
  - The statement follows af21368: a slot a series has no row for gets no bar and no mark.
  - **bar:** cites `stack-no-row.test.ts` "stacked true: …" and "stacked false: …", which check stacked and grouped bars. A gap says this is checked on the scene only.
  - **compact:** gap. The rule is tested on full bars only.
- **F4** (line, area, bar, scatter, compact): gap added. The only mixed fixture has a calendar-date majority; no fixture mixes wall-clock times with instants and no calendar dates (`f-time.test.ts:137–147`).
- **F5**
  - The statement follows af21368: a no-row slot does not break a line "except inside a stack (F10)".
  - **area** (and **T-dense-area**): cites `stack-no-row.test.ts` "unstacked area: …" (the slot still joins outside a stack) and the stacked-geometry test (the line follows its band). This replaces the old gap "weekly beside daily is untested on area"; what remains is that both rules are checked on the scene only.
  - **compact:** gap. The stack exception is tested on a full stacked area only.
- **F7**
  - **Statement:** follows eb2de43. After an x zoom, a y axis without an author domain is fitted again to the values in view. A continuous x spans its data and the x references it draws. A scatter's date or time x spans exactly its data. A compact chart's domain is the same but is not shown to end on a tick.
  - **line:** cites `view.test.ts` "ignores hidden, non-drawable and out-of-zoom values when fitting the y axis" for the refit.
  - **scatter:** cites `view.test.ts` "keeps scatter ranges per series and uses only the points inside zoom for the value domain" (the refit) and "rounds numeric scatter x outward …" (a date x spans exactly its dates).
  - **Gaps rewritten:**
    - Line: the refit is checked at the view stage only.
    - Area, bar: no test refits their y.
    - Scatter: no time x; the refit is checked at the view stage only; the browser T-zoom-scatter window cannot show the refit.
    - Compact: "the same tick-ended domain is not asserted" replaces "ends at a tick".
- **F10**
  - The statement follows af21368: a slot a series has no row for is a missing component, and a stacked series' line follows its band.
  - **area:** cites `stack-no-row.test.ts` (incomplete, total, "No observation", table header, zero-height band, line not joined).
  - **bar:** cites the incomplete test and "stacked true: no bar …".
  - Area and bar both get two new gaps: no all-negative stack sum is required (review section 1 for area, section 2 for bar), and the stack rule is checked in Node below the controller only, with no announcement checked.
  - **compact:** gap. The summary is checked only to contain the word "incomplete" (`f-stacks.test.ts:72–94`), and the no-row rule is tested on full stacks only.
  - The stack test's `describe.each` suites carry `ancestors`, because their static ancestors are the union of both suites (checker defect 3).
- **T-dense-donut:** gap. A zero-extent path of the right colour at the right angle passes for a thin slice, and the Node test counts the angles array (`type-matrix.browser.test.ts:443–460`, `f-dense.test.ts:213–218`).

### L rows

- **L1** compact: still not applicable. The reason now names what still applies: L1's first clause reaches a compact chart's state message and C5 marker. That clause is routed to L7/compact and A6/compact, where the missing evidence is recorded.
- **L5**
  - **line, area:** gap. Every threshold fixture is evenly spaced, so a rule based on average spacing would pass, and exactly 12 px is untested (`l-legibility.browser.test.ts:507–543`).
  - **compact:** still not applicable. The reason now names the isolated-point clause, which applies to compact line and area, and where it is evidenced (F2/compact, C2/compact).
- **L7**
  - **All six cells:** gap. The browser announcement recorder de-duplicates with a `Set` (`l-legibility.browser.test.ts:634`, confirmed in review section 5), so "once" is shown on the controller's announcement list (Node) only. For line, `chart/data.browser.test.ts` counts DOM changes without de-duplication, for loading → ready only. Before this, the five full L7 cells could pass.
  - **compact:** also gets the clipping gap routed from L1.
- **T-reference-donut:** gap. Only a y line is given to the donut; no reference band is tried.

### I rows

- **I2**
  - The statement and the donut's not-applicable reason follow eb2de43: I2 does not apply to the donut's slice list.
  - **Gap** (line, area, bar, scatter): only the first legend entry is exercised, and that the other series stay drawn is not checked (`i1-pointer.browser.test.ts:534–552`).
- **I4**
  - The statement follows eb2de43: the one-finger drag clause also covers compact charts.
  - **compact** is now applicable and weak. The C1 40-tile pointer tests are cited as weak, and a gap records that no test drags a finger over a compact chart.
- **I6**
  - **Full types:** gap. The paused view is compared only with the table open, and no tooltip is compared (`i1-pointer.browser.test.ts:1016–1040`).
  - **compact** is now applicable and weak. `apps/docs/pages/accessibility.md` is cited as a weak document: it hands pausing streamed compact tiles to the author (WCAG 2.2.2). The gap says the chart has no Pause.
- **T-pointer-scatter:** I added `lookup/scatter.test.ts` "picks the nearest point within 24 px and breaks a tie by later source row" as evidence, with a limit that the rule is checked at the lookup level only. See the disagreements.
- **T-tooltip-area:** gap. After hiding a series, the total row is not re-checked (`type-matrix.browser.test.ts:143–155`).
- **T-zoom-scatter:** gap rewritten. "x only" is not asserted; the amended F7 refits y; neither test tells a refit from an independent y zoom; the browser test uses `zoom()`, not `+`.

### A rows

- **A1**
  - **Full types:** gap. A fully visible title with `clip-path: inset(0)` passes the "visually hidden" check, and the 24-chart id check runs before any table is opened (`a1-names.browser.test.ts:79–100,144–161`).
  - **compact:** cites `f-time.test.ts` "F4 compact: ISO with offset …", which checks the summary's zone for compact line, area and bar. The gap is narrowed to the missing browser projection and the unique-id check.
- **A2** (line, area, scatter): gap extended. The controls shown only while zoomed (Pan left, Pan right, Reset zoom) are not reached with the arrows.
- **A3:** the channel gap is removed. Spec A3 (cbcc87a) now names the value text of the native range as the channel. The owner's text in `cannotVerify` and the owner's waiver are kept.
- **A4** (all five): gap.
  - F6 formatting is checked only for the fixtures' own en-US values; 123.25 is the one fractional value.
  - In Chrome the caption is read as the computed name.
  - The scroll region is never scrolled.

  Confirmed at `a4-table.browser.test.ts:27–55,203–217` and `util.ts:621–634`. The review sampled line only; the same citations sit in all five cells.
- **A5**
  - Every cell that cites the AX141 test gets a gap: the test sets the background to the first series' own colour (1:1), so it cannot show the 3:1 threshold.
  - Area, bar, donut: the separators are measured in light only.
  - Donut: no test shows that a slice can be told without colour.
- **A6**
  - **Full types:** the two tests are now also cited with `engine: "firefox"` and `engine: "webkit"`, and the `pending` text is removed. A literal `pending` keeps a cell pending after results arrive; engine citations let the cell pass only when all three engines' results for this revision pass. The tests run on every engine, and the 7208470 Firefox and WebKit runs passed them. The limit notes that the titles end in "(Chrome)".
  - **compact:** unchanged (weak).
- **A7** (full types)
  - **Gap:**
    - The observer misses text changes inside an existing `role="log"` region that has no `aria-live`.
    - The focused test reads the text only after two appends.
    - On donut, the share and the position are stripped before comparison.

    Confirmed at `a6-a10.browser.test.ts:88–115,150–173`.
  - **Limit:** the L7 state announcement is L7's evidence. See the disagreements.
- **A8** (all six): gap.
  - The loading, empty and error states all pass if any message is visible.
  - The values-left-out case only checks that a figure is shown.
  - The dirty fixture is not crossed with the other states.

  Confirmed at `a6-a10.browser.test.ts:205–259`.
- **A9** (all six): gap extended. No test shows that a test listed under a success criterion supports that criterion (review section 4).

### C rows

- **C1:** gap extended. The pointer probes are judged only after all three, so a transient reaction would pass (`compact.browser.test.ts:64–89`).
- **C3:** gap. Width and height always grow together; a wide, short tile is never drawn (`compact.browser.test.ts:179–198`).
- **C4**
  - The statement follows eb2de43: compact bars differ by fill pattern between neighbours.
  - **Limit:** the bar test's texture comparison is now part of C4.
  - **Gap:** the pattern rule is exercised with two series only.
- **C5:** gap. The marker title is checked as a substring of the description after "See table." is removed, so "See table." alone passes (`compact.browser.test.ts:244–265`).

### DX and P rows

- **DX1** compact is applicable again. The two packed CSP-page citations are weak, and a gap says no compact snippet exists.
- **DX5** (all six): the pending text is extended. The Chrome heap test's 1% allowance between two window means cannot show "no growth trend" (`lifecycle.browser.test.ts:372–399`).
- **DX7 and P6** (all six each): new `pending` text: "The size record is not bound to a revision's pack: bench/size-latest.json names the packed tarball's integrity hash and the time it was written, not a commit, and the checker does not compare it with the pack of the revision being checked. A size measured from this revision's pack and bound to it is needed; until the checker binds size records to the pack, this cell reads not run." P6 no longer reads pass, and DX7 can no longer pass on the same record.
- **DX8:** gap.
  - Line: the retention test holds weak references to the outer rows array and the figure only.
  - Every cell citing the packed text test: reference labels are not among its sources (`tests/dist/pages/sentinels.ts`).
- **DX10** (all six): gap. The per-example renders have no citable titles, so they are not credited, and CI has never run.
- **DX11** (all six): gap.
  - The source audit bundles one entry.
  - The origin check matches a directory name and the `.js` suffix without tying the shipped bytes to that build.
  - "Verified at release" has not run.
- **DX12:** the pending text keeps "no trap fixtures" attached to the rehearsal.
- **P3:** now applies to all six types. The spec names a window and a clock, not a chart type. The line's pending text adds that `P3-late` counts runs that contain a late interval, while the spec counts late frames per 300. The other types are pending with no workload.
- **P4** donut: the reason now names the excluded workload: 100,000 drawn, pickable points. A 100,000-category donut is a different workload that P4 does not name.
- **P7** (all six): the pending text is extended. 2,500 cycles with a 1% allowance (harness and test) cannot show the spec's "no upward slope" over 1,000 cycles.

## Where I disagreed with the reviewer

1. **T-pointer-scatter.** The review is right that the cited tests never make the nearer of two eligible points win. But an uncited lookup test does: `packages/axylo/test/lookup/scatter.test.ts:47` picks at x = 58 between points at 40 and 60 and expects the point at 60. I cited it, with a limit that this is checked at the lookup level only, instead of recording a gap. The cell can still pass.
2. **A7, "its citations do not exercise an L7 state announcement."** I recorded this as a limit, not a gap. A7 restricts announcements to the reader's navigation and to state changes; the positive state-change announcement is L7's criterion. L7 is now weak for the duplicate-count problem the review confirmed.
3. **A3's software channel gap.** It is closed by spec cbcc87a, as you said, so I removed the gap. The review's concern that a whole-cell waiver bypasses a channel gap no longer applies.
4. **I2 donut.** The review said the spec had not granted the exclusion. eb2de43 now grants it, and the reason cites the spec.

I found no cell where a weakness the review names is false. I confirmed each at the given lines: F1, F4, I2, I6, A1, A4, A7, L5, C3, C5, DX8, DX11, T-pointer-scatter, T-tooltip-area, T-reference-donut, T-dense-donut, F10, A5, A8, C1 and DX5.

## Spec re-sync

| Commit | Rows re-synced |
|---|---|
| cbcc87a | A3 (statement already updated by the coordinator; gap removed) |
| eb2de43 | F7, I2, I4, C4, L1 and L5 compact reasons, T-zoom-scatter |
| af21368 | F2, F5, F10, T-dense-area, citing the committed `stack-no-row.test.ts` (f3d709b) |
| 6772563 | Nothing to change |

The other spec rows whose WCAG column changed (A1, A2, A4, A7, L3, L7, F12, I3, C1, C5) keep their statements.

## For the checker's author

The new citations hit three of the known defects.

- **Union ancestors (defect 3).** The stack test's `describe.each(['area', 'bar'])` suites need explicit `ancestors`, because the static ancestors are the union of both suites.
- **Engine citations.** A6's engine citations are the first in the matrix. The docs conformance page reads them through the checker's `engine` field.
- **Size records.** The size record was rewritten in the working tree during this pass (19:44), not by me. The `pending` text does not depend on which record is current.
