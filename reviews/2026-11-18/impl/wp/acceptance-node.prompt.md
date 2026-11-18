# Work package: acceptance tests at the model level (Node)

Read `AGENTS.md` first; its rules apply. You own `packages/axylo/test/acceptance/**` and nothing else. Do not edit source, other tests, `acceptance/`, docs or configuration. Do not commit.

## Why

`acceptance/report.md` (read its section "Coverage gaps in reader priority order") shows that 251 of 310 applicable criterion-by-chart-type cells have no qualifying evidence. The existing tests each check one layer (the data layer's slot tags, the scene's vertices, the lookup's text) and mostly for line charts; none follows one input through to what the reader gets, per chart type. The release gate (`docs/03-plan-typescript-release.md`, line 7) is that every cell passes. Your tests are that evidence for everything that can be established without a DOM.

## What makes this possible

The chart controller has no DOM. `packages/axylo/test/core/host.ts` exports `record(kind, options, settings)`: it runs the real controller (`packages/axylo/src/core/controller.ts`) with a manual animation-frame queue and recording stand-ins, and gives you what a real chart would hand the page: the scenes drawn (`draws`: marks with their geometry, paints and dash), the placed texts, the figure models (title, state, note, summary), announcements, and the committed state the interaction layer reads (lookup, reader model with its table, view, layout). Read it and `packages/axylo/test/core/controller.test.ts` to see how it is driven. You may import it; do not edit it. If it lacks something you need, say so in the report.

## What to write

One test file per criterion group under `packages/axylo/test/acceptance/` (for example `f-missing-values.test.ts`, `f-stacks.test.ts`, `f-time.test.ts`, `f-dense.test.ts`, `dx-diagnostics.test.ts`, `type-matrix.test.ts`, `compact.test.ts`). Cover, for **every chart type the criterion applies to** (line, area, bar, scatter, donut, compact; applicability is in `acceptance/matrix.json`):

- Spec 3.1, F1–F12: from input to the drawn marks **and** to every reader-facing text the model produces (tooltip model, value text, table cells, summary, note, announcements). For example F2 for bars: a null, an absent field, a missing row and a real zero in one fixture; assert the scene has a bar of zero height for the zero and the missing-mark or nothing for each kind of missing value exactly as the spec says; assert the tooltip and the table say "No data" or the spec's word for each state; assert no path or area joins across the gap unless the author asked.
- Spec 3.5: every diagnostic code in the registry: the input that raises it, its `effect`, that it is delivered once, and what is drawn in consequence. A code you cannot raise through public options is a finding: report it.
- Spec 3.6: each cell of the type matrix that is a property of the model (order of navigation, what a tooltip lists, stacking, zoom allowed or not, dense behaviour).
- Spec 3.7 compact, 3.8 limits, and section 4 DX criteria that are about behaviour (patch semantics, strict mode, `validate()` parity, call order): through the controller's public surface.
- Where the spec says "property test", use fast-check with at least 1,000 runs and state the invariant in the test title.

Rules for expected values: derive them from `docs/02-product-spec.md` and from fixture data you write out by hand in the test (small enough to check by eye) or from the named fixtures in `research/harness/src/data.js` (copy the generator into your directory; do not import across packages). Never run the implementation and paste what it printed. When the implementation disagrees with the spec, the test stays as the spec says and **fails**: that is the most valuable output of this package. Do not use `it.skip`, `it.fails` or loosened matchers to hide a failure; list each failing test in the report with the spec sentence, what you expected and what you got. When the spec is ambiguous, say so, choose the reading a chart reader would want, and mark the test title with "(reading: …)".

Title every test so the criterion and chart type are in the title, in this form: `F2 bar: a null, an absent field and a missing row draw no bar; a zero draws a zero-height bar; readouts say "No data"`. Also write `packages/axylo/test/acceptance/EVIDENCE.json`: an array of `{ "criterion": "F2", "type": "bar", "file": "...", "title": "..." }`, one entry per test, so the matrix can be updated from it.

## Running

`timeout 300 npx vitest run packages/axylo/test/acceptance` (Node only; you cannot launch a browser and must not try). The palette files (`src/theme/palette.ts`, `test/theme`) are being changed by another agent: do not assert on specific colours, only on paint bindings (series index, token name). Never leave a process running.

## Report

Counts of tests by criterion and chart type; the failing tests in full as described above (these are suspected product defects: for each, your best reading of where in `packages/axylo/src` the cause is, without fixing it); criteria you could not cover at this level and why (they go to the browser suite); spec ambiguities and the reading you chose; the last lines of the test run. Keep "ran and saw" apart from "expect".
