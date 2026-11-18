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

| Running now (2026-11-18, after commit 13b2f63) | Who | Files |
|---|---|---|
| Chart core, third fix pass (agent a1d73b9f46c46814f, resumed): both reviews of 4809516 (`wp/core3.controller.review.md`, `wp/core3.interaction.review.md`), decision 0004, displayed-snapshot design, category zoom, canvas separators, acceptance failures in its files, x unit to the reader, missingX in the scatter domain | Claude Opus 5.5 high | `src/core`, `src/dom`, narrow edits in `src/layout`, `src/scale`, `src/format`, `src/view`, `src/scene/bars.ts`, `src/render/canvas.ts`, `src/theme/watch.ts` |
| Scatter picking at the plot edge and dense coincident points | Codex gpt-6.2-sol xhigh | `src/lookup` → `wp/lookup-fix-2.report.md` |
| Packed-distribution tests, first-chart snippets, size on packed files, CSP (agent a6f0d7846bf125638) | Claude Opus 5.5 high | `tests/dist`, `examples/first-chart`, `scripts/pack.mjs`, `scripts/size.mjs`, package metadata |
| Documentation site with runnable examples (agent a04bfe28413f07034) | Claude Opus 5.5 xhigh | `apps/docs` |

Committed since the last checkpoint:
- Both reviews of the core at 4809516 (controller: 4 blocking, 15 major; interaction: 2 new blocking, 9 major, 13 earlier findings partly fixed). Decision 0004 (tooltip across the reading axis; focused text rewritten for four reasons only).
- Acceptance suites: Node, 494 tests (689102e; 494 pass on the working tree in the coordinator’s last run, which includes the core author’s uncommitted changes); browser, 457 tests (13b2f63; author’s run 443 pass, 14 fail; not rerun by the coordinator while the core is mid-edit).
- Reader, messages, diagnostics fixes (7c46ec9); zero-copy appends in the data stores (7831371; one assertion narrowed by the coordinator and marked in the test); scatter observations with no y (c655ad5 contract, d4cbedb).
- Palette refit (52bbdf0): limits hold on 8-bit pixels; owner to judge the light scheme’s uneven lightness and the near-white dark focus ring.
- Contract additions: message keys panLeft, panRight, jumpNotFound, plotInstructions, seeTable; `PointSeries.missingX`.

Not yet cross-reviewed: acceptance matrix and both acceptance suites, data-store zero-copy work, reader fixes, scatter missing values, palette refit, benchmark harness fixes, React adapter fixes, everything in the third core pass.

Decisions recorded: `docs/decisions/0001-plot-interaction-pattern.md` (unrehearsed), `docs/decisions/0002-mark-renderer.md` (SVG by default, from `bench/results/m1-renderer-comparison.md`).

Known open items carried forward:
- View/scene review finding 10 (stack rebuilt over the whole frame per revision) and lookup review finding 12 (dense coincident scatter pick) are deferred to performance work.
- Performance: about 80 ms for 100,000 points against about 12 ms for uPlot; profiles put it in normalization through the streaming store and in garbage collection. The fix pass moves static charts to the borrowed path.
- Not started: documentation site, packed-distribution tests, size check against targets, scatter renderer measurement, a dist build for `@axylo/react` (must define `__DEV__` and keep the `use client` banner).
- `docs/api/axylo.d.ts` is superseded by the real package and is to be deleted once the examples point at it.

## Next action

1. When the third core pass returns: verify (type check, unit suite, Node acceptance, browser suite and browser acceptance on both renderers), commit, then merge the two `EVIDENCE.json` files into `acceptance/matrix.json` (matrix author, Codex gpt-6.2-sol xhigh) and run the checker with both Vitest reports.
2. One cross-provider review round of everything listed as not yet reviewed (Codex reviews Opus code and the reverse), then fixes.
3. When the machine is quiet: renderer comparison under performance plan 5.1, then performance work against the budgets.
4. Verify and commit the distribution tests and the documentation; then the agent rehearsal (DX12), the Phase 1 comparison rerun with Axylo included, the conformance table (A9) from the acceptance evidence, and the final independent review.

## Known limits that no agent can close

Screen-reader rehearsal (A3), real Safari and iOS, a real Android phone, and Firefox/WebKit runs need the owner's devices or a CI service. Only system Chrome is available here. These are recorded as not done wherever they apply.
