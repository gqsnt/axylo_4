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

| Running now (2026-11-18, after commit 156f414) | Who | Files |
|---|---|---|
| Chart core, second fix pass: the 22 findings of `wp/core2.review.md` plus teardown listeners, tooltip placement, single-pointer pan, accessibility-tree assertions (agent a1d73b9f46c46814f, resumed) | Claude Opus 5.5 high | `src/core`, `src/dom`, `src/index.ts`, css structure section, their tests |
| Default palette, both schemes, to the A5 thresholds (agent abc842fd0288bc675) | Claude Opus 5.5 xhigh | `src/theme/palette.ts`, `test/theme`, `research/palette`, `docs/decisions/0003-default-palette.md` |
| Benchmark harness fix pass: the 18 findings of `wp/bench.review.md`, missing budget workloads (agent a6075efd5cba2d5e5). No new measurements while the machine is busy | Claude Opus 5.5 high | `bench/` |

Committed since the last checkpoint:
- Chart core first fix pass (156f414): 20 findings of `wp/core1.review.md`; DOM-free controller on the store API; SVG default. Coordinator runs: type check clean, 76 core unit tests, 237 browser tests pass. Not re-reviewed: one Codex review of the controller is due after the second fix pass lands.
- React adapter (be123ee), reviewed by Codex gpt-6.2-astra xhigh (`wp/react.review.md`), fixed (a63bbee): 34 unit and 31 browser tests pass; production file 1,436 B gzipped. React 18 and Fast Refresh untested; `package-lock.json` still lists the react-dom peer.
- Acceptance matrix and checker (6bd5f9c, Codex gpt-6.2-sol xhigh, not cross-reviewed): 251 of 310 applicable cells have no qualifying evidence; see `acceptance/report.md`.
- Benchmark review by Codex gpt-6.2-sol max (`wp/bench.review.md`: 5 blocking, 12 major, 1 minor). Decision 0002 is now provisional.
- CI workflow (never run: no remote).

Unit suite at 156f414: 620 pass, 7 fail (six palette tests waiting for the palette; `normalize.test.ts` "one million ascending typed values under 100 ms" measured 125 ms on a loaded machine: rerun when quiet before judging).

Decisions recorded: `docs/decisions/0001-plot-interaction-pattern.md` (unrehearsed), `docs/decisions/0002-mark-renderer.md` (SVG by default, from `bench/results/m1-renderer-comparison.md`).

Known open items carried forward:
- View/scene review finding 10 (stack rebuilt over the whole frame per revision) and lookup review finding 12 (dense coincident scatter pick) are deferred to performance work.
- Performance: about 80 ms for 100,000 points against about 12 ms for uPlot; profiles put it in normalization through the streaming store and in garbage collection. The fix pass moves static charts to the borrowed path.
- Not started: documentation site, packed-distribution tests, size check against targets, scatter renderer measurement, a dist build for `@axylo/react` (must define `__DEV__` and keep the `use client` banner).
- `docs/api/axylo.d.ts` is superseded by the real package and is to be deleted once the examples point at it.

## Next action

1. As each running package returns: verify (type check, its tests, browser tests where relevant), commit with targeted paths.
2. After the second core fix pass: one cross-provider review of the rewritten controller and interaction layer (Codex gpt-6.2-astra xhigh), then fixes.
3. End-to-end acceptance suite: one test per criterion and chart type for the cells `acceptance/report.md` lists as no evidence, in reader priority order (data fidelity, accessible reading, legibility and interaction). Browser tests by Opus 5.5 high; Node pipeline tests can go to Codex gpt-6.2-sol xhigh. Then a cross-review of the matrix itself.
4. When the machine is quiet and the harness fixes are in: declare endpoints and thresholds, rerun the renderer comparison with scatter, many series, pan and zoom; then performance work against the budgets.
5. Documentation site and examples; packed-distribution tests (npm, script tag, React), CSP test, size check; Phase 1 comparison rerun with Axylo included; conformance table (A9); final independent review of the acceptance evidence.

## Known limits that no agent can close

Screen-reader rehearsal (A3), real Safari and iOS, a real Android phone, and Firefox/WebKit runs need the owner's devices or a CI service. Only system Chrome is available here. These are recorded as not done wherever they apply.
