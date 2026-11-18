<!-- Author: Claude Opus 5.5 (high), agent aa0e6fca8e4a6224b; saved by the coordinator -->

## Part 1: Select range toggle (done)

- **Footprint.** The toggle is a 24 × 24 symbol button. Its name stays "Select range", as visually hidden text and as its `title`. The symbol is an inline SVG stroked in `currentColor`, so forced colours restyle it. The toolbar is also tighter: 2 px column gap instead of 6, 5 px inline control padding instead of 8.
  - I measured toolbar row counts against HEAD at every 1 px from 200 to 900 px. That covered line, area and scatter with three series, and a one-series line, each plain, zoomed and streaming (12 configurations). The toggle adds no row anywhere.
  - The symbol alone did not do it: it still added a row at 250–270, 310–330, 480–500, 540–560, 600–620 and 770–790 px depending on state.
  - The 220 × 300 fixtures pass unchanged. A new test re-checks the row count against the old spacing at 220, 240, 280, 320 and every 10 px to 900. There is one form at all widths, so there is no switch width.
- **A drag while the toggle is pressed** zooms as a drag and releases the toggle; test added.

## Part 2

### What I could not run

- **Acceptance suite on SVG: not run.** It loads only the shared `dist`, which you told me not to rebuild. Everything else ran on a private bundle via `AXYLO_BUNDLE`, now removed.
- **`node scripts/size.mjs`: not run**, because it packs `dist`. Instead I rebuilt with the release settings (production defines, minified stylesheet, gzip level 9): HEAD versus HEAD plus only my files.

| Build | Everything (gzip) | Line only (gzip) |
|---|---|---|
| HEAD | 113,969 B | 95,888 B |
| HEAD + my files | 116,259 B | 98,057 B |
| Difference | **+2,290 B** | **+2,169 B** |

The toggle accounts for about 280 B of that. The full working tree, with the other agents' changes, is 117,463 B.

### Per item

"Old" means a bundle built from committed HEAD.

1. **Activation.** Tests "a touch down 1 px inside A's half and lifted 2 px away in B's … selects B" and "Enter selects the datum the focused range describes", both failing on old. A tap now uses the release event's coordinates; Enter and Space select `focus`. (`dom/interaction.ts`)
2. **Pin identity.** Test "pin aligned A at x = 1, hide A from the keyboard legend … the pin ends", failing on old. `stillPinned` keeps the exact ref and requires `lookup.resolve(ref)` to be that same ref; it no longer substitutes the primary.
3. **Invisible pin.** Test "pin a point, start a drag, Escape, move over another point", failing on old. My first version of this test pressed on the pinned tooltip itself; it now starts the drag on the plot. Drag start and pinch start end a pin. A pin whose content cannot be shown ends. Escape is spent on a pin whether or not its content is visible.
4. **Fit.** Tests "a chart clipped to a short visible band, eight series pinned …" and "a strip its card clips away entirely is not shown …", both failing on old. The floating fit now rejects content overflow (scroll size against client size). `strip()` returns false when its rectangle does not meet its visible region. (`dom/tooltip.ts`)
5. **Visible region.** Test "a chart in a shadow root inside a clipping card …", failing on old (tooltip bottom 150.7 against card bottom 131.8). `visibleRegion` now crosses shadow roots to the host, and placement intersects the plot's clipping chain with the tooltip's. Control obstacles now include their 3 px focus outline; that part has no dedicated test. (`dom/mapping.ts`)
6. **Rest clock.**
   - Test "a redraw that puts another datum under the still pointer restarts the rest …", failing on old. My first version used `update({ data })`, which is an epoch change, so it passed on old too; it now uses `zoom`, which stays in the same epoch.
   - Test "Escape while held: … the datum under the still pointer is the one reported at once", failing on old.
   - A commit that changes the pick restarts the rest on the performance clock, and a presentation change clears it.
   - Held geometry is compared at 0.01 px; no test.
   - On Escape, the physical pick updates and both the held datum and the datum now under the pointer stay dismissed until the pointer reaches another one.
7. **Dismissal identity.** Test "dismiss scatter A, append fifteen coincident B …", failing on old. Escape records the chosen ref (the pin's, the focus, or the primary). Matching checks membership in the complete group, not the eight sampled rows. (`dom/pointer.ts`)
8. **Group enumeration.** Node test "twelve near-coincident points interleaved …" (focus-reading), failing on old. `groupRefs` walks the lookup's x order within 2 px of the first point, skips interleaved non-members instead of stopping at them, and takes the `count` nearest. (`core/focus.ts`)
9. **Rows.** Tests "pin scatter A near the top, press its row, append a later coincident B above it, release: A is selected, once" and "a focused pinned row keeps focus when the plot changes from floating to the strip", both failing on old.
   - Rows are keyed by series (aligned) or by series and source row (points), not by formatted text.
   - A press completes on the row it started on, at pointer release.
   - Focus is carried across presentations by row key, with a fallback to the plot.
   - Outside-press detection uses `composedPath()`.
   - Teardown records focus before the tooltip is hidden.
10. **Single-mode category slide.** A browser test and a Node test, both failing on old. `datumReading` compares series and the x as read, not the category index.
11. **Fallback placement.** Node tests for the reviewer's 729 px² case and a property test against a whole-pixel scan; both fail on old. Every legal edge position is scored. (`dom/placement.ts`)
12. **Slice list, jump field, language.** Three browser tests (focused slice survives a redraw; the chart's own Arabic negative and German date; reading language and jump-error language), all failing on old.
    - The slice list is reconciled by key.
    - Bidirectional marks are stripped before parsing numbers.
    - As a last resort the jump field matches the column's own formatted values.
    - The proxy's `lang` is written with each reading.
    - The jump error and missing-value rows carry their template's language.

### The later additions

- **Corridor slack.** Node test for 0.5 px and 1.0 px outside an edge (in) and 1.01 px (out), failing on old. The corridor is now the hull plus 1 px of true distance.
- **Firefox focus ring.**
  - Fixed: "click Zoom in, focus the plot from script, ArrowRight". It failed on old Firefox and now passes on chromium, firefox and webkit.
  - "Click the plot, then ArrowRight" did not reproduce: old Firefox already showed the ring. I kept that test for the datum ring's position.
  - The ring now shows when the plot has focus and the last input was a key the plot handled, or on `:focus-visible`.
  - All three engines show the plot outline after a click alone, so a test asserting "no ring after a click alone" would fail in Chrome too. Your note expected no ring there. I did not assert it.
- **Clarifications.** Two tests, both failing on old:
  - "Home on the first point keeps the pin and the text"
  - "an x with no marks anchors at that x on the plot's middle"
- **Compact bar swatches.** `seriesPattern(index, compact)` now passes through to `barPattern`. No swatch is ever drawn for a compact chart, since it has no interaction layer, so I added no test for it.
- **Epoch test (DOM half).** Passes on old. It was a coverage gap, not a defect.

### Weaker tests fixed

- The resize test now asserts its expected datum.
- The dense sweep uses whole pixels, an exact nearest x within 1, and that x's own value.
- The narrow-strip test checks that the title and the first row lie inside the strip's box.
- The scale and eight-area-marker tests now use `it.skipIf(canvas)` and say "(SVG)" in their titles.
- The old pressed-row test is renamed to what it checks; the reviewer's sequence is the new test in item 9.
- The pen and AX-tree tests call `requireEngineFeature(['chromium'])`.

## Runs (private bundle)

| Run | Result |
|---|---|
| `npm run typecheck` | clean |
| `npx vitest run packages/axylo/test/core` | 15 files, 248 passed |
| chart + a11y, SVG | 1 failed, 282 passed (283) |
| chart + a11y, canvas | 1 failed, 279 passed, 3 skipped (283) |
| final-hold/pin/verify/range, Firefox | 69 passed, 2 skipped (71) |
| final-hold/pin/verify/range, WebKit | 69 passed, 2 skipped (71) |

- The single failure on SVG and canvas is `ensureStyles` under `AXYLO_BUNDLE`, which you said to leave.
- The two skips on each engine are the CDP-only tests.
- The hold tests pass with Firefox's and WebKit's whole-pixel pointer.

## Files

- Source: `src/dom/{interaction,tooltip,placement,mapping,pointer,table,toolbar}.ts`, `src/core/focus.ts`, `src/theme/css.ts`.
- Tests: `test/core/focus-{placement,reading,range}.test.ts`, `test/browser/chart/final-{hold,pin,partials,range,verify}.browser.test.ts`, `final-util.ts`, `a11y/axe.browser.test.ts` (control list).
- Other: the `WHERE` entry in `acceptance/a6-a10.browser.test.ts`, and the addendum line in decision 0004.

## Not done

- The acceptance suite on SVG and `size.mjs` (both need the shared `dist`).
- Tests for the control focus-outline margin and for the sub-pixel geometry comparison.
- The engine port of my older suites, which you said is a later task.
- The size budget is worse by about 2.2 KB gzipped.

## Still unclear in the decision

- Whether a click alone should show the plot's ring; all three engines currently do.
- After Escape from a hold over B, I keep both the held datum and B closed. The clarification says only that the dismissed content stays dismissed, which does not settle whether B's own tooltip should open.
