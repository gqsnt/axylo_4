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

| Running now (2026-11-18, after commit bf8fabf) | Who | Files |
|---|---|---|
| Chart core, fourth fix pass (agent a1d73b9f46c46814f, resumed): the items its third pass left (listed in commit 77213c0 and `wp/core3.fix.report.md`), the theme watcher regression, L1 at 240 px | Claude Opus 5.5 high | `src/core`, `src/dom`, narrow edits elsewhere |
| Documentation site with runnable examples (agent a04bfe28413f07034) | Claude Opus 5.5 xhigh | `apps/docs` |
| Size analysis: why 98 KiB, tree-shaking design, ranked reductions, realistic targets | Codex gpt-6.2-sol max, read-only | → `wp/size.analysis.md` |
| Merge of both EVIDENCE.json files and the distribution tests into the acceptance matrix | Codex gpt-6.2-sol xhigh | `acceptance/` → `wp/acceptance-merge.report.md` |
| Review of the browser acceptance suite and distribution tests (Opus code) | Codex gpt-6.2-astra xhigh, read-only | → `wp/tests-opus.review.md` |
| Review of the Node acceptance suite, matrix and checker (Codex code) (agent a2a18f27e1659b924) | Claude Opus 5.5 xhigh, read-only | hand-back → `wp/tests-codex.review.md` |
| Review of zero-copy stores, scatter missing values, reader fixes, scatter picking (Codex code) (agent in this session: "Review Codex module fixes") | Claude Opus 5.5 xhigh, read-only | hand-back → `wp/modules-codex.review.md` |

State at bf8fabf (coordinator runs): type check clean; unit suite 1,216 of 1,216 (includes 494 Node acceptance tests); browser, root config: 735 tests, 729 pass, 5 fail, 1 skipped (the five: C4 compact bar; L1 at 200% text for line, area, scatter, donut); distribution: 83 Node and 18 browser tests pass. Sizes from the packed files: everything 97.75 KiB (target 40), line only 97.61 (target 25), React adapter 1.17 (target 2); chart types do not tree-shake.

Committed since the last checkpoint: third core fix pass (77213c0, partly done: its commit message lists what is left); lookup fixes (43fc75d); distribution tests and packed-size report (bf8fabf). Result files for the checker are in `acceptance/results/` (git-ignored; regenerate before the final report).

Open decisions for the owner: the palette’s light scheme (keep or try a louder, more even one) and the near-white dark focus ring; the licence holder wording ("The Axylo authors" in both LICENSE files); the size targets, once the analysis is in.

Decisions recorded: `docs/decisions/0001-plot-interaction-pattern.md` (unrehearsed), `docs/decisions/0002-mark-renderer.md` (SVG by default, from `bench/results/m1-renderer-comparison.md`).

Known open items carried forward:
- View/scene review finding 10 (stack rebuilt over the whole frame per revision) and lookup review finding 12 (dense coincident scatter pick) are deferred to performance work.
- Performance: about 80 ms for 100,000 points against about 12 ms for uPlot; profiles put it in normalization through the streaming store and in garbage collection. The fix pass moves static charts to the borrowed path.
- Not started: documentation site, packed-distribution tests, size check against targets, scatter renderer measurement, a dist build for `@axylo/react` (must define `__DEV__` and keep the `use client` banner).
- `docs/api/axylo.d.ts` is superseded by the real package and is to be deleted once the examples point at it.

## Next action

1. As each review returns: record it with the observed model, send findings to the original authors (tests first), verify, commit.
2. When the size analysis returns: decide targets with the owner if they cannot be met; run the tree-shaking restructuring as its own pass after the fourth core pass has landed (same files).
3. When the fourth core pass and the matrix merge are in: one Codex review of the third and fourth passes together; regenerate all four result files; rerun the checker.
4. When the machine is quiet: renderer comparison under performance plan 5.1, then performance work against the budgets.
5. Verify and commit the documentation; then the agent rehearsal (DX12), the Phase 1 comparison rerun with Axylo included, the conformance table (A9) from the acceptance evidence, and the final independent review.
6. Still unreviewed after the running reviews: palette refit, benchmark harness fixes, React adapter fixes (small; one Codex review for the three).

## Known limits that no agent can close

Screen-reader rehearsal (A3), real Safari and iOS, a real Android phone, and Firefox/WebKit runs need the owner's devices or a CI service. Only system Chrome is available here. These are recorded as not done wherever they apply.
