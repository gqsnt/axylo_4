# Closing fix pass (no review round follows)

The last cross-provider check is `reviews/2026-11-18/impl/wp/final-check.review.md` (Codex gpt-6.2-sol, max, of commit 9f9eeef). The owner has decided there is no further review round on these layers: what this pass fixes is verified by its own tests and by the coordinator's runs; what it does not fix is written into the documentation as a limit. So be exact, keep each fix as small as the reviewer's "smallest fix", and do not widen the work.

Result of the check: R2 closed; R3 to R14 and the earlier majors closed except two small remainders; four of the five blocking items still have one sequence each that goes wrong (section 1); six defects came in with round 3's own changes (section 2). Section 4 of the review (closed shadow roots, a dense ring just beyond the coincidence radius, a stateful formatter, responsive CSS scoped to the plot column) becomes documented limits: do not work on those.

Rules as always (`AGENTS.md`): stay in your files; for each item write the test that fails on the current code first with the reviewer's sequence (expected values from the spec or decision 0004), then the fix; if a sequence does not fail as described, report what you saw and change nothing. Since your last pass, a size commit (ab82dad) moved test-only and benchmark-only members of the stores, `Delivery` and the scatter lookup out of production builds (they are installed under `__DEV__ || __BENCH__`): production code must not call them; read that commit's report `size-cuts-a.report.md` if you touch those classes. The library is at its size target with little margin: add as little code as you can and report the gzipped difference.

Shared build: only the coordinator rebuilds `packages/axylo/dist`; use a private directory with `AXYLO_BUNDLE` and remove it. Do not commit; never kill by pattern; leave no probe files.

## Controller author (`src/core` except `focus.ts`)

1. **C2, last sequence.** Scatter x=101 with `keep: 1`, pause, then 100 times: hide, append a late x=0, show. One row is retained but 101 revision sources are (`controller.ts` about 1641 and 1665; `data/store-rows.ts` about 434). The row-count threshold never fires because the rows do not grow; bound the span of retained revisions as well (freeze when it exceeds a small bound). If the cleanest bound lives in the store, tell me the exact store change and the data author makes it.
2. **Section 2, item 1: AX160 keeps a fixed-height chart redrawing.** An explicit y domain [0, 10], a tick formatter that throws at 2, a height where the disclosure note forces sparser ticks: the note removes tick 2, which removes the note, which brings tick 2 back. A tick-only AX160 is a diagnostic whose effect on the figure is none, so the note cannot change the fit (`controller.ts` about 1552, `chart.ts` about 239). The test must show the layout settles (a bounded number of layouts after the resize notification).
3. **Section 2, item 4: an append undoes a narrow scatter zoom.** On the R8 fixture, zoom to [−1000, 1500], append x=1600: the window jumps to [−500, 2000]. Keep the drawn bounds for the current zoom across appends and extend them when the data grows (`controller.ts` about 504).

## Interaction author (`src/dom`, `src/core/focus.ts`)

1. **I4, last sequence.** Two short series pinned on one strip line, in a card that clips just after the first row: the strip passes with the second button cut off. Check every displayed row and the pager against the clipped rectangle, inside the row-reduction loop (`tooltip.ts` about 435).
2. **I5, last sequence.** A toolbar button with a 32 px outline, a tooltip that fits 24 px from it: the tooltip covers the outline because placement budgets 3 px. Use the control's computed outline width and offset, in its own scale (`mapping.ts` about 95, `interaction.ts` about 879), with the regression test that was missing.
3. **R1 and section 2, item 3: a press across a presentation change.** Press Q3's floating row, shrink the chart into strip mode while holding, release over the new Q3 strip button: no selection fires. Keep the row's identity for the life of the press, resolve it in the current presentation on release, and bind the click suppression to that press.
4. **Section 2, item 2: a pinned scatter pager repeats page one** after appends near the pin (pin at offset 0.8 px; eight appended at 0, the latest at 0.4 px). Keep the lookup's anchor, sample and count together, and track the pinned ref separately (`interaction.ts` about 1947 and 778).
5. **Section 2, item 5: changing `x.format` leaves stale keyboard text.** The comparison key keeps only the raw x since round 3; include the raw x and the formatted x (`focus.ts` about 176, `interaction.ts` about 948).
6. **R9 remainder.** Clamp a snapped Select range end to the exact local bounds so floating-point roundoff cannot put it just outside (`interaction.ts` about 720 and 1434). One line; test with the 0.5-scaled chart.

Not for this pass: the I6 remainder (a tooltip rectangle change alone inheriting elapsed rest) becomes a documented limit.

## Lookup and data author (`src/lookup`, `src/data`)

1. **Section 2, item 6: a scatter zoom or pan rebuilds indexes for off-screen data.** With more than 32 measurements sharing an x, each zoom or pan rebuilds the full-series row map and allocates a reverse grid index for all points (`scatter.ts` about 40, `scatter-grid.ts` about 74, built from `controller.ts` about 1568). Reuse the row maps across views of the same frame (a cache keyed on the frame's series, released with the frame) and size the grid's reverse index to the visible ranges. Test: the work of building a lookup for a one-day view of a multi-month frame does not grow with the points outside the view (count typed-array bytes or use the existing work counters, which now exist only in development builds).
2. Whatever the controller's author asks of the store for C2's revision bound, through me.

## Report

Per item: the failing test written first, what changed, or what you saw instead. Last lines of the type check, your Node tests, your browser tests (interaction: also `final-*` on firefox and webkit). Gzipped size before and after. What is not done.
