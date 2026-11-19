<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh. workspace-write. Reviewed by the coordinator (Claude Opus 5.5 high, cross-provider); browser tests run by the coordinator: plot-description + a6-a10 57 pass, chart + a11y 323 pass. Saved by the coordinator. -->

The plot’s accessible description now follows the chart. It describes points or donut slices, adds series navigation when multiple series are available to the arrow keys, and includes zoom shortcuts when the toolbar offers Zoom in. The description updates after legend toggles and `zoom` option changes independently of the focused datum’s value text. [Interaction code](/home/canarit/projects/axylo/packages/axylo/src/dom/interaction.ts)

| Message | Default text |
|---|---|
| `plotInstructions` (updated) | Left and right arrows move between points along x. Enter selects. |
| `donutInstructions` (new) | Arrow keys move between slices. Enter selects. |
| `seriesInstructions` (new) | Up and down arrows move between series. |
| `zoomInstructions` (new) | Plus and minus zoom. Press 0 to reset. Hold Shift with left or right to pan the zoomed view. |

The three new `Messages` keys are optional. An existing `plotInstructions` override stays whole. Authors can explicitly add applicable series or zoom instructions, or supply a donut-specific replacement. [Message defaults](/home/canarit/projects/axylo/packages/axylo/src/messages/index.ts) · [Messages contract](/home/canarit/projects/axylo/packages/axylo/src/public.ts:188)

Added Node and browser coverage for the chart variants, zoom and visibility updates, and author overrides. The browser suite also checks for writes to the focused range’s `aria-valuetext`. Updated the A10 `WHERE` table and both docs references. [Node tests](/home/canarit/projects/axylo/packages/axylo/test/core/plot-description.test.ts) · [Browser tests](/home/canarit/projects/axylo/packages/axylo/test/browser/chart/plot-description.browser.test.ts) · [A10 table](/home/canarit/projects/axylo/packages/axylo/test/browser/acceptance/a6-a10.browser.test.ts:354) · [Messages table](/home/canarit/projects/axylo/apps/docs/data/messages.mjs) · [Accessibility docs](/home/canarit/projects/axylo/apps/docs/pages/accessibility.md:21)

**Verification**

`npm run typecheck` exited 0. Its last output line was:

```text
> tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist
```

`npx vitest run packages/axylo/test/messages packages/axylo/test/core`

```text
 Test Files  19 passed (19)
      Tests  274 passed (274)
   Duration  2.18s
```

`npx vitest run --config apps/docs/vitest.config.ts`

```text
 Test Files  5 passed (5)
      Tests  244 passed (244)
   Duration  1.82s
```

The new chart browser suite and updated A10 browser acceptance tests were discovered but could not run because Chrome cannot launch in this sandbox. The shared bundle build was skipped as requested.