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

| Running now | Who | Files |
|---|---|---|
| Chart core fix pass: the 20 findings of `wp/core1.review.md`, on the new store API; SVG as default renderer; presentation fixes | Claude Opus 5.5 high | `src/core`, `src/dom`, `src/index.ts`, css structure section, `docs/api/examples.ts` |
| Review of chart core part 2 | Codex gpt-6.2-astra xhigh, read-only | → `wp/core2.review.md` |
| Infinite loop reached from the format tests (about 1 run in 3 hangs) | Claude Opus 5.5 high (the scales author, resumed) | `src/format`, `src/scale` |
| React adapter | Claude Opus 5.5 high | `packages/react` |
| Default palette, both schemes, to the A5 thresholds | Claude Opus 5.5 xhigh | `src/theme/palette.ts`, `research/palette`, `docs/decisions/0003-default-palette.md` |

Decisions recorded: `docs/decisions/0001-plot-interaction-pattern.md` (unrehearsed), `docs/decisions/0002-mark-renderer.md` (SVG by default, from `bench/results/m1-renderer-comparison.md`).

Known open items carried forward:
- `npm test` can hang in `packages/axylo/test/format` until the loop is fixed; run directories separately under `timeout`.
- View/scene review finding 10 (stack rebuilt over the whole frame per revision) and lookup review finding 12 (dense coincident scatter pick) are deferred to performance work.
- Performance: about 80 ms for 100,000 points against about 12 ms for uPlot; profiles put it in normalization through the streaming store and in garbage collection. The fix pass moves static charts to the borrowed path.
- Not started: acceptance matrix as data, CI workflow files, documentation site, packed-distribution tests, size check against targets, scatter renderer measurement, React adapter review, benchmark harness review.
- `docs/api/axylo.d.ts` is superseded by the real package and is to be deleted once the examples point at it.

## Next action

1. As each running package returns: verify (type check, its tests, browser tests where relevant), commit with targeted paths, and send it for cross-review if it is new code (React adapter and palette tests → Codex gpt-6.2-astra xhigh).
2. When the part 2 review returns: after the fix pass has reported, send its findings to a fix run on the same files.
3. Then, in this order: acceptance matrix as data with a checker (Codex gpt-6.2-sol xhigh); performance work against the budgets with the harness; documentation site and examples; packed-distribution tests (npm, script tag, React), CSP test, size check; regenerate the Phase 1 comparison with Axylo included; final independent review of the acceptance evidence.

## Known limits that no agent can close

Screen-reader rehearsal (A3), real Safari and iOS, a real Android phone, and Firefox/WebKit runs need the owner's devices or a CI service. Only system Chrome is available here. These are recorded as not done wherever they apply.
