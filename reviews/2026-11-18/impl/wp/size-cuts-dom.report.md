<!-- Author: Claude Opus 5.5 (high), agent aa0e6fca8e4a6224b; saved by the coordinator -->

## Size pass (interaction files): −280 B on "everything", short of the 300 B aim

The cuts save **280 B gzipped on "everything"** and **209 B on "line only"**, about 20 B short of the 300 B aim. That is all I found in my files that is a true duplicate or provably dead without changing behaviour. One more cut (sharing the listener options object in the tooltip) made "everything" 7 B larger, so I reverted it. No test was edited, nothing is committed, and the scratch directory is removed.

Measured with a release-settings build (production defines, minified stylesheet, esbuild minify, gzip level 9), the working tree before and after my edits:

| Build | Before | After | Change |
|---|---|---|---|
| everything | 118,593 B | 118,313 B | −280 B |
| line only | 99,281 B | 99,072 B | −209 B |

## What changed

1. **Exact duplicates merged.** No new import cycles; `lookup/search.ts` and `dom/attributes.ts` import nothing, so nothing new enters `line`.
   - `pageDistance`: `core/focus.ts` now imports the lookup's copy and re-exports it.
   - `setText`: one copy in `dom/attributes.ts`, used by `figure.ts` and `tooltip.ts`.
   - The child-placing loop had three copies (`tooltip.ts`, the interaction's control hosts, the slice list); it is now `placeChildren` in `attributes.ts`.
   - "Create an element and set its class" is now one `make` helper, used in `figure.ts`, `table.ts`, `tooltip.ts`, `interaction.ts` and `toolbar.ts`. This replaces figure's local `make`.
   - Smaller shared helpers:
     - `aria-hidden="true"`
     - the mousedown handler that keeps focus
     - `setLang` now goes through `setAttr`
     - the remap of an x target and of an x identity is one generic function
     - one `{ kind: 'hover', target: null }` constant
     - `redraw()` replaces eleven `dirty = true; present()` pairs
     - one clock helper
2. **Unused members removed.**
   - `TableView.showRow` and `TableView.page`, and `TooltipView.where` — no callers in source or tests.
   - `seriesPattern`'s `compact` parameter: nothing passes it, since swatches exist only on full charts.
   - `handOff`'s parameter: it is always the default.
   - The tooltip's `rectOf` helper: it now returns the bounding rectangle directly.
3. **Branch made unreachable by `Lookup.has`.** `matchesIdentity` no longer searches a point target's refs, because every caller asks `lookup.has` for points.
4. **Stylesheet** (`theme/css.ts`), with identical computed styles:
   - The first `.axylo-legend-choice` rule is gone; the later rule sets the same properties.
   - The later rule's `min-width: 24px` is gone; it repeats the combined rule's value and nothing between them sets `min-width` on that selector.
   - The two `.axylo-jump` rules are merged into one (`flex-wrap: wrap` added to the first).

## Runs (private build via `AXYLO_BUNDLE`)

| Run | Result |
|---|---|
| `npm run typecheck` | clean |
| `test/core` + `test/theme` (includes the stylesheet equivalence test) | 21 files, 327 passed |
| chart + a11y, SVG | 1 failed, 315 passed (316) |
| chart + a11y, canvas | 1 failed, 311 passed, 4 skipped (316) |

The one failure on SVG and canvas is the known `ensureStyles` test, which only fails under `AXYLO_BUNDLE` because the bundle switch always links the stylesheet.

## Files

`src/dom/{attributes,figure,interaction,pointer,swatch,table,toolbar,tooltip}.ts`, `src/core/focus.ts`, `src/theme/css.ts`.

The working tree also has test changes in `review2`, `lifecycle`, `interaction` and `final-util` (engine support). Those are another agent's, not mine.

## Not run

`tests/dist/tree-shaking.test.ts` — you said you run it.
