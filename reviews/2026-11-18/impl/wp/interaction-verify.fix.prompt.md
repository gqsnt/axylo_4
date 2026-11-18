# Fix pass: the cross-provider verification of the interaction rewrite

Your rewrite (28174df) was verified read-only by a reviewer from the other provider (Codex gpt-6.2-astra, xhigh): `reviews/2026-11-18/impl/wp/fixes-verify.interaction.review.md`. Read all of it. It confirms the two original blockers you were asked about are fixed and most of the earlier findings with them, and it found five new blocking and eight major defects, each with an event sequence. Its verdict is "hold the sign-off run". This pass closes them.

Rules as before (`AGENTS.md`): your files are `packages/axylo/src/dom/**`, `packages/axylo/src/core/focus.ts`, the figure section of the stylesheet source, `packages/axylo/test/core/focus-*.test.ts`, `packages/axylo/test/browser/chart/**` and `test/browser/a11y/**` that you own. Contracts are fixed; tell me the exact change if you need one. Expected values come from decision 0004 and the spec, never from the implementation. Do not commit.

## Decision 0004: clarifications made by the coordinator

The reviewer found places where revision 3 says nothing. They are now written in `docs/decisions/0004-tooltip-and-focused-text.md` under "Clarifications after the verification" (read them there; this is the summary):

- **An x where no series has a mark** (every value missing): the anchor is the point at that x on the plot's vertical middle.
- **Several charts on a page and Escape:** a chart spends an Escape only when focus is inside its figure, or, when focus is in no chart, when it is the chart that most recently showed content. One key press is spent by at most one chart.
- **A key that leaves the reader on the same datum** (an arrow at the end of the data, Home on the first point) does not release a pin.
- **The controls a tooltip must not cover** are the chart's own, each with its painted focus outline; page controls are out of scope.
- **A gesture and a pin:** starting a drag or a pinch ends the pin (this settles item 3 below).
- **A drag while Select range is pressed** zooms as a drag and releases the toggle.

## What to fix, in the reviewer's order ("New defects" table)

For each: first write the test that fails on the committed code with the reviewer's sequence, then fix. If you find a sequence does not fail as described, say what you observed instead of changing code.

1. **Wrong activation.** A tap's displacement and its pick use the release event's own coordinates. Enter and Space on the focused range activate the datum the range describes, whatever the pointer is over.
2. **Pin follows a different datum.** A pin is one `DatumRef`. On every reconciliation (redraw, legend hide, Resume) check that exact ref is still displayed and visible; rebuild the listed rows around it; end the pin when it is gone. Never replace it with the primary.
3. **Invisible pin.** No path may leave `pinned` with nothing shown and pointer moves ignored: drag start, pinch start, a failed placement, Escape during a drag. The rule is in the decision's clarifications: a gesture start ends the pin. Escape in the pinned state works whether or not the content is visible.
4. **Hidden rows pass the fit test.** Fit is judged on what is physically visible: intrinsic content overflow for the floating tooltip, the visible intersection for the strip. Drop rows until the title, one value and any paging control needed are visible. A wholly clipped strip is not "shown".
5. **Visible region and covered controls.** Walk the composed clipping chain (across a shadow root: `getRootNode().host`), and intersect the plot's chain with the tooltip's. A chart control's obstacle rectangle includes its painted focus outline. Page controls outside the figure are not Axylo's to know: do not attempt them; the decision's rule 4 is about the chart's own controls.
6. **Rest clock.** A committed change of the picked datum or of the presentation restarts the rest; held geometry is compared at layout precision (not half a pixel); after Escape from `held`, the physical pick under the stationary pointer is updated at once while the dismissed content stays dismissed.
7. **Dismissal identity.** Escape records the chosen ref, and reopening is suppressed by that ref's displayed membership, not by the eight sampled rows.
8. **Scatter group enumeration.** `groupRefs` enumerates by the lookup's own coincidence predicate, so count and paging agree (the reviewer's twelve near-coincident points interleaved with distant ones).
9. **Pressed or focused row.** Key rows by datum identity, not formatted text; a press completes against the ref captured at pointer down; focus survives a change between floating and strip; inside-press detection uses the composed event path.
10. **Focused text.** In single-series mode a category that slides to another ordinal is not rewritten: compare the category's identity and spoken values; the numeric index only synchronises the range.
11. **Fallback placement.** Score the free-axis bounds and obstacle edges as well as the centred position, and take the legal position that covers least of the active box.
12. **Slice list, jump field, language.** Reconcile the all-zero slice list by slice key so a focused entry survives. The jump field accepts every string the chart itself formats for that field in the chart's locale (the reviewer's Arabic negative and German date); derive the test strings by formatting with `Intl` in the test, not by pasting. Language attributes are written with each reading, and a jump error and a missing-value cell carry the language of their text.

Finding 12 of the first table (strip height from an estimate) and the epoch-replacement test gap are with the controller's author; the DOM half of the epoch test (after a full data replacement: focused text, ring and Enter agree) is yours.

## Tests the reviewer says establish less than their titles

"Claims not confirmed", second bullet: the resize test that computes and discards its expected datum; the dense sweep that checks only the title; the narrow-strip test that counts DOM entries; the pressed-row test with fixed domains; scale and eight-area-marker tests that skip canvas. Fix each so it checks what its title says, or rename it to what it checks. Do not delete coverage.

## Keep it small

The library is over its size budget. Prefer removing a special case to adding one. Report the gzipped size before and after (`node scripts/size.mjs`, on a private pack if the shared build is not free).

## Verify

`npm run typecheck`; `npx vitest run packages/axylo/test/core`; browser `chart` and `a11y` on SVG and on canvas; the browser acceptance suite on SVG. Ask me whether the shared `packages/axylo/dist` is free before `npm run build`; otherwise use a private directory with `AXYLO_BUNDLE`. Never kill by pattern.

## Report

Per item: the failing test you wrote first (name), what changed (file), or what you observed if the sequence did not fail. Then the last lines of each run, the size before and after, what is not done, and anything in the decision that is still unclear.
