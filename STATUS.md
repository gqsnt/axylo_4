# Implementation status

Checkpoint file for the Axylo 1.0 build. Updated at every commit so work can resume after a restart. Plan: `docs/03-plan-typescript-release.md`.

## Model assignment (owner, 2026-11-18)

Code: Claude Opus 5.5 (effort high), Codex `gpt-6.2-sol` (effort xhigh). Design, review and other reasoning-heavy work: Claude Fable 5.2 (medium, the coordinator), Claude Opus 5.5 (xhigh), Codex `gpt-6.2-astra` (xhigh), Codex `gpt-6.2-sol` (max). Code written by one provider is reviewed by the other.

## Milestones

The plan's milestones were built in parallel by module, not strictly in order, because every stage had a fixed contract. State by plan milestone:

| Milestone | State |
|---|---|
| M0 Foundations | Done: workspace, toolchain, contracts, benchmark harness (first version), build and size scripts. Not done: the acceptance matrix as data, CI workflows (no remote exists) |
| M1 Vertical slice | Charts render end to end with both mark renderers. Renderer comparison: running (`bench/results/m1-renderer-comparison.md` when done). Interaction pattern: decided without a screen reader, `docs/decisions/0001-plot-interaction-pattern.md` |
| M2 Faithful data | Data layer, diagnostics, temporal kinds, formatting, domains: built and cross-reviewed |
| M3 Reading the chart | Title, states, pointer tooltip, label fitting: built. Legend, full tooltip, reference labels: in progress (chart core part 2, design pass 1) |
| M4 Accessibility | In progress (chart core part 2). Screen-reader rehearsal cannot be done here |
| M5 Bar, area, donut, compact, scatter | All render through the shared pipeline. Type-specific acceptance tests, the palette, and donut legend: in progress or not started |
| M6 Updates and scale | update, append, zoom, simplification: built. Not started: performance tuning against budgets (first indication: about 84 ms for 100,000 points in the development build against about 12 ms for uPlot), the deferred stack rebuild, the scatter worst-case pick |
| M7 Distribution and documentation | Not started: React adapter, documentation site, packed-distribution tests, size check against targets |
| M8 Release | Not started |

## Work packages

Observed model and effort are read from harness metadata (Codex session rollouts, Claude subagent transcripts). Briefs, reports, reviews and fix briefs are in `reviews/2026-11-18/impl/wp/`.

Finished and committed, each written by one provider and reviewed by the other: scales and formatting; layout and simplification; data layer, diagnostics and stores; renderers, text layer and theme; view and scene; lookup, reader and messages; chart core part 1 (review findings not yet fixed, see below); chart core part 2 (review running); benchmark harness and the M1 renderer measurements (not reviewed).

| Running now (2026-11-18, after commit a8ed211) | Who | Files |
|---|---|---|
| Palette refit after review `wp/palette.review.md` (agent abc842fd0288bc675, resumed): more even lightness, margin for 8-bit rasterisation, corrected decision record | Claude Opus 5.5 xhigh | `src/theme/palette.ts`, `test/theme`, `research/palette`, `docs/decisions/0003-default-palette.md` |
| Review of the rewritten controller at 4809516 | Codex gpt-6.2-sol max, read-only | → `wp/core3.controller.review.md` |
| Review of the interaction layer after its fix pass at 4809516 | Codex gpt-6.2-astra xhigh, read-only | → `wp/core3.interaction.review.md` |
| Acceptance suite, model level in Node, through the DOM-free controller | Codex gpt-6.2-sol xhigh | `packages/axylo/test/acceptance/` → `wp/acceptance-node.report.md` |
| Acceptance suite, browser level (agent a61d95e46b3f0f3aa) | Claude Opus 5.5 high | `packages/axylo/test/browser/acceptance/` |

Committed since the last checkpoint:
- Chart core second fix pass (4809516): 22 interaction findings plus teardown listeners, tooltip clearance (the cause of the 4-of-40 hover readouts), area swatch markers. Coordinator runs: type check clean, 86 core unit tests, browser 271 pass / 2 fail (dark-toggle test cannot tell the candidate palette’s two first blues apart; revisit after the refit).
- Benchmark harness fixes (d83dee1): 67 pure and 14 browser harness tests pass. Every 24-chart page result of the M1 session is void (no marks were drawn); decision 0002 says so.
- Performance plan section 5.1 (31f2a01): endpoints, thresholds and the renderer decision rule, declared before measurement.
- Palette candidate (51e1be5) and its review (cff0d1a).
- Contract: message keys panLeft, panRight, jumpNotFound, plotInstructions (a8ed211), not yet used.

Open items for the next core/render fix round (after the two reviews return): canvas renderer does not leave a background-colour pixel between stacked bars (pixel snapping in `render/canvas.ts` or `scene/bars.ts`); pan buttons, Jump-to error text and plot instructions using the new message keys; category-axis zoom is off (needs a band scale with an offset); the dark-toggle test should compare against each scheme’s resolved colour instead of a 40-per-channel tolerance; A7 risk that rewriting the focused range’s text after an append is spoken by a screen reader (needs rehearsal). Two aborted benchmark records (`bench/history/20261118T03503*`) from a run against the harness mid-edit are left untracked.

Decisions recorded: `docs/decisions/0001-plot-interaction-pattern.md` (unrehearsed), `docs/decisions/0002-mark-renderer.md` (SVG by default, from `bench/results/m1-renderer-comparison.md`).

Known open items carried forward:
- View/scene review finding 10 (stack rebuilt over the whole frame per revision) and lookup review finding 12 (dense coincident scatter pick) are deferred to performance work.
- Performance: about 80 ms for 100,000 points against about 12 ms for uPlot; profiles put it in normalization through the streaming store and in garbage collection. The fix pass moves static charts to the borrowed path.
- Not started: documentation site, packed-distribution tests, size check against targets, scatter renderer measurement, a dist build for `@axylo/react` (must define `__DEV__` and keep the `use client` banner).
- `docs/api/axylo.d.ts` is superseded by the real package and is to be deleted once the examples point at it.

## Next action

1. As each running package returns: verify, commit with targeted paths.
2. When both core reviews are in: one fix run on `src/core`/`src/dom` by the core’s author (Opus 5.5 high) including the open items above; a separate small run for the canvas separator by the renderer or scene author.
3. When the acceptance suites return: every failing test is a suspected product defect; triage, send fixes to the module owners, then have the matrix author merge the two `EVIDENCE.json` files into `acceptance/matrix.json` and rerun the checker with both Vitest reports.
4. When the machine is quiet: rerun the renderer comparison under plan 5.1 (20 pairs, declared endpoints), then performance work against the budgets.
5. Documentation site and examples; packed-distribution tests (npm, script tag, React), CSP test, size check; Phase 1 comparison rerun with Axylo included; conformance table (A9); final independent review of the acceptance evidence.

## Known limits that no agent can close

Screen-reader rehearsal (A3), real Safari and iOS, a real Android phone, and Firefox/WebKit runs need the owner's devices or a CI service. Only system Chrome is available here. These are recorded as not done wherever they apply.
