<!-- Author: Claude Opus 5.5 (high), agent a1d73b9f46c46814f; saved by the coordinator -->

## `measure()` scale fix (`packages/axylo/src/core/chart.ts`)

The defect was real, and it is fixed and verified against a private build. The shared `dist` was not touched and nothing is committed. In the bundled runs of my browser directories, 4 tests fail with and without my change, so they are not caused by it.

### What failed before
A new test file, `packages/axylo/test/browser/chart/scale.browser.test.ts`, was run against a private build of HEAD (28174df) through `AXYLO_BUNDLE`.
- **Ancestor `scale(1.015)`:** the scene was laid out 9 px wider than the plot's layout width (SVG width 609 against a 600 px plot), so the last bars ran past the plot element.
- **Ancestor `scale(0.99)`:** the scene was 6 px narrower.
- **Picking and tooltip naming** passed on both scales even before the fix: the interaction layer's exact mapping in `src/dom/mapping.ts` and the marks share the same, wrongly sized, layout. The defect showed as plot size, not as wrong picks.
- **Unscaled, at 600.4 px:** passed.

### What I changed
- `measure()` now takes its scale from `mappingOf(figure.plot)` in `src/dom/mapping.ts`: the bounding rectangle divided by the fractional computed size. It counts as exactly 1 only when `|k − 1| < 1e-5`.
- The 2% tolerance existed only because the old code divided by the integer `offsetWidth`. With the fractional computed size it is no longer needed.
- The tolerance that remains (1e-5) is the mapping's own, which covers the six-significant-digit serialization of computed sizes. It keeps an unscaled sub-pixel width at exactly 1; the 600.4 px test checks that.
- Only `measure()` and one import changed; `src/dom/mapping.ts` was read, not edited.

### Results
- **Type check:** `tsc -p packages/axylo --noEmit` reports no errors.
- **Node core tests:** `Test Files 14 passed (14)`, `Tests 218 passed (218)`.
- **New scale tests, private build with the fix:** `Tests 5 passed (5)`.
  - For 1.015 and for 0.99: the scene width matches the layout width within 0.5 px and the last bar stays inside the plot element; a pointer on each of the last three drawn bars picks it and the tooltip names it.
  - Unscaled at 600.4 px: scale exactly 1, scene width equal to the layout width within 0.01 px.
- **`test/browser/chart`, `test/browser/a11y` and `test/browser/render`, private build of the working tree with the fix:** `Test Files 3 failed | 21 passed | 1 skipped (25)`, `Tests 4 failed | 322 passed | 1 skipped (327)`.
  - These 4 failed identically on a private build without my change (HEAD's `chart.ts`, the rest of the working tree):
    - the 220 px readout-mode strip test;
    - the axe test "trend paused, zoomed, in the narrow readout and in the internal-error state";
    - "every control and the focus indicator are visible in forced colors";
    - "works with the stylesheet applied through ensureStyles (no linked axylo.css)".
  - The last one is very likely an artefact of the private-bundle method, which removes the linked stylesheet and injects the CSS itself. The others probably come from the uncommitted interaction work in the working tree (`core/focus.ts`, `dom/interaction.ts`) that the private build included.
- **Browser acceptance:** not run. It can only load the shared `dist`, which you asked me to leave alone.

The private build directory `.core-private` has been removed.

