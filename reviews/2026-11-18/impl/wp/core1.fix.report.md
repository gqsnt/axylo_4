<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a1d73b9f46c46814f. Saved by the coordinator from the hand-back. -->

## Report: chart core review fixes (Axylo)

I followed AGENTS.md. I did not commit, and I did not touch contracts.ts, public.ts, globals.d.ts or any directory I don't own. All 20 findings are fixed and every test in my directories passes with both renderers. Two things are not done:
- **Benchmark not run.** Another agent is changing `bench/` right now (details under "Not done").
- **One finding was not reproduced in the browser:** finding 3 (see the table).

### What I built
**Core, rewritten into three files (`packages/axylo/src/core/`):**
- **`controller.ts` (new):** the controller, with no DOM. Everything the page provides is passed in, so Node tests can drive it with a manual animation-frame queue and recording stand-ins (the reviewer's method).
  - **Data path:** a chart that never appends uses `normalize` and keeps borrowed columns. The first `append` opens the store (`AlignedStore.fromFrame`, `PointStore` or `DonutStore`); the old row concatenation and `keep` counting are deleted.
    - Every append is prepared, its view built and validated, then committed.
    - Encoding changes after streaming re-encode the retained rows in a new epoch.
    - `update({ data })` always replaces the stream.
    - Older revisions are retired only after the next frame is drawn.
    - Changes to a field's `domain`, `format` or `tickFormat`, or to `reference`, `zoom` or `colors`, never renormalize.
  - **Diagnostics:** presentation diagnostics are kept per stage and per revision. Each finding is marked delivered before author code runs, and work stops if the chart was destroyed or changed meanwhile.
  - **Failures:** an internal failure shows a complete error state and clears every cached output, so recovery redraws everything.
  - **Sizing:** the too-small fallback is judged on the room a normal plot would get, and the figure is settled within the frame (for example the "labels hidden" note), so each mode is self-consistent.
  - **Lifecycle:** a destroyed handle swaps its host for an inert one and drops its state.
- **`chart.ts`:** the browser host.
  - Each setup step registers its cleanup as it succeeds.
  - Destroy removes the custom properties the chart wrote on the target.
  - Generated ids are checked against the page so they can't collide.
  - SVG is now the default renderer.
  - When the target leaves the document, the resize observer notices and document-level watchers are released, then re-attached if it returns.
- **`stages.ts` (new):** steps shared with `validate()`, so it returns the same view diagnostics as a created chart (AX110, AX130, AX131).
- **`environment.ts`:** text measurement.
  - The width cache is cleared on font load (`noteFontLoad`), with a per-document font epoch in the key.
  - It is bounded for the whole document.
  - Letter and word spacing are set on the measuring context.
- **`axes.ts`:** the second x-domain expansion for bars is removed, and visible-slot indexes are no longer part of the layout key.
- **`delivery.ts`:** a delivery pass now stops if the chart was destroyed or changed meanwhile.
- **`focus.ts`:** the value text uses `pointAll`, `seriesValue` and `position`.

**DOM (`packages/axylo/src/dom/`):**
- `figure.ts`: new `top`, `side` and `body` slots, and `update` reports whether layout could have moved.
- `interaction.ts`: `legend: 'top' | 'right' | 'bottom' | false`, `attach`/`detach` for document listeners, `plotRole` as the plot's role description, a Reset control in a zoomed empty window, and the open table freezes `body`.
- Legend swatches (`swatch.ts`): filled square for bars and areas (with the bar pattern past eight series), line plus marker for lines, marker for scatter.
- `tooltip.ts`: a labelled stack-total row using `total`.

**Other files I own:**
- `index.ts`: one `validate` overload per chart type.
- `css.ts` (figure section only): `.axylo-body` and the top/side legend areas. Reference labels get a background plate in the backdrop colour via `box-shadow` 2 px. The text layer already exposes `data-role="reference"`, so no change was needed there.

**Tests:**
- New: `test/core/controller.test.ts` and its host stand-in `host.ts`, `test/core/measure.test.ts`, `test/browser/chart/review.browser.test.ts` (26 tests).
- `lifecycle.browser.test.ts`: a new test that a kept, destroyed handle releases its data and figure, and the pointer-teardown test now dispatches on the plot.
- Running the suite on canvas: `AXYLO_RENDERER=canvas npm run test:browser` (handled in `test/browser/chart/util.ts`). Tests that give `__renderer` themselves keep their choice.
- Expectations updated where the value text is now built from `pointAll`/`position`: no trailing period in all-series mode; role description "Line chart".

**API examples:** `docs/api/examples.ts` now imports `packages/axylo/src/index`, with new `@ts-expect-error` cases (validate with mismatched options, `zoom`, `ordered`, `labelledBy`, `colors`, `compact`). `docs/api/tsconfig.json` was updated to match. **`docs/api/axylo.d.ts` can be deleted.**

### Ran and saw
- `npm run typecheck`: passes, including `docs/api` (so every `@ts-expect-error` fires).
- `npx vitest run packages/axylo/test/core`: 8 files, 76 passed.
- Owned browser directories (chart and a11y): 123/123 passed with SVG (the default), and 123/123 with canvas.
- `npm run build`: OK.
- `npm run test:browser` (whole suite): `Test Files 15 passed | 1 skipped (16)`, `Tests 237 passed | 1 skipped (238)`.
- `npm test`: 620 passed, 7 failed, all outside my directories:
  - `test/theme/palette.test.ts` (the palette is being changed; in an earlier run it was missing `research/palette/palette.json`).
  - The data module's "1M borrowed values under 100 ms" timing test.
  - In an earlier run, simplify's million-point timing test also failed while my browser tests were loading the machine.
- **Pre-fix reproduction:** before rebuilding I ran `review.browser.test.ts` against the old bundle; 20 of the 21 tests there at the time failed. The retained-handle test also failed on the old bundle (10 references still alive).
- **Gallery** (`light svg`, `dark canvas`): checked both images. Correct and readable, including the reference-label plate and the "Values not shown: 3" note; nothing to fix. Images are in `/tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/core-fix/`.

### Not done
- **Benchmark not run.** Another agent is changing the harness: `bench/lib/driver.mjs` (04:49) and `build.mjs` (04:48) now expect slots, but `run.mjs` (03:22) still calls `startServer()` with no arguments. It fails with `TypeError … startServer (driver.mjs:22)`. I did rebuild bench's copy with `node bench/build.mjs`; the 6-block runs at 3×120 and 1×100,000 are still needed once the harness is consistent. Earlier SVG figures for comparison: 3×120 17.36 ms (the "about 17.4"), 1×100,000 78.82 ms [CI 64.54, 71.94 for the difference to uPlot].
- **Bench adapter will change meaning.** `axylo-canvas` passes no `__renderer`, so with the new SVG default it would measure SVG. It must pass `__renderer: 'canvas'`.

### Findings
| # | Reproduced | Fixed | Covered by |
|---|---|---|---|
| 1 strict append | yes (browser, old bundle) | yes | controller.test "finding 1"; review "strict ninth series" |
| 2 re-encode / replace | yes | yes | "finding 2"; review "new y field…" |
| 3 hover after eviction | **no** (old bundle already had the store's retention) | yes (retire after the frame is drawn) | "finding 3"; review "hover over the frame on screen" |
| 4 failure state | yes | yes | "finding 4"; review "failures" |
| 5 controls / zoom and select events | yes (no select from a click) | yes, verified closed | "finding 5"; review "Zoom in…" |
| 6 re-entrancy | yes (958 deliveries) | yes | "finding 6" (4 cases); review |
| 7 scatter/donut append | yes | yes | "finding 7" (3, including paused); review |
| 8 empty from draw ranges | yes | yes | "finding 8"; review |
| 9 follow reconcile | yes | yes | "finding 9"; review |
| 10 validate / strict parity | yes | yes | "finding 10"; review |
| 11 presentation diagnostics | yes | yes | "finding 11"; review |
| 12 teardown | yes (properties, detach, setup failure, kept handle) | yes | review "lifecycle"; lifecycle "retains neither…" |
| 13 fallback stability | yes | yes | "finding 13" (Node model); review pixel stepping 120–229 px, both ways |
| 14 fonts / measurement | Node only | yes | measure.test; "finding 14" |
| 15 bar domain | yes (ticks −5…25) | yes | "finding 15"; review |
| 16 donut pin | yes | yes | "finding 16"; review |
| 17 borrowed columns | yes | yes | "finding 17" (buffer identity); review |
| 18 stage counts | yes | yes | "finding 18" (every stage); review |
| 19 naming | yes | yes | "finding 19"; review (3 tests) |
| 20 validate overloads | type-level | yes | docs/api examples (`@ts-expect-error`) |

### Choices I made where the brief was open
- `legend: 'top' | 'right'` moves the whole toolbar, not just the legend entries, to keep one tab stop (A2). The table stays under the plot.
- AX140 for an unresolved `labelledBy` is a presentation diagnostic, checked each frame. If a `title` exists, the title is used and AX140 is not raised.
- A zoom window that can't be read is delivered to `onDiagnostic` and the console, then ignored; `chart.diagnostics` keeps the previous state.
- A compact chart's description: state text only for loading and error; empty-state text plus the summary for empty.
- On data replacement I normalize statically and drop the old store, rather than calling `prepareReplace`, so the borrowed path is kept.

### Gaps in modules I compose
- **view:** AX110, AX130 and AX131 are reported only when they are new against the previous view; the controller tracks the full set itself (`completeViewDiagnostics`).
- **scene/bars.ts:** the bar pattern rule isn't exported, so I copied it in `interaction.ts`.
- **render/text.ts:** nothing needed; `data-role` is already exposed.
- **bench:** the `axylo-canvas` adapter issue above.
- **tooltip placement (my `dom/tooltip.ts`, not fixed):** the tooltip can land under the pointer when the pointer sits between data points, so a click there selects nothing. Not among the findings; worth handing to the interaction reviewer.
- **No contract changes needed.**

