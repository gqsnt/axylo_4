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

| Running now (2026-11-18, after commit 3d547c4) | Who | Files |
|---|---|---|
| Chart core, sixth pass (agent a1d73b9f46c46814f, resumed): tooltip per decision 0004 revision 2, focus rings inside the figure, theme change painted in the first frame, relayout on a late font, short summary in the too-small state, category remap keeps focused text, note runs leaking as JSON | Claude Opus 5.5 high | `src/core`, `src/dom`, narrow edits elsewhere |
| Browser acceptance suite, alignment to decision 0004 revision 2, readout mode, L8, A10 applicability (agent a61d95e46b3f0f3aa, resumed) | Claude Opus 5.5 high | `packages/axylo/test/browser/acceptance` |
| Donut slice under 0.2% not drawn; scatter tie not decided by source row | Codex gpt-6.2-sol xhigh | `src/scene`, `src/lookup`, `src/view` → `wp/scene-lookup-fix-3.report.md` |
| Matrix re-merge after both suites were rewritten | Codex gpt-6.2-sol xhigh | `acceptance/` → `wp/acceptance-merge-2.report.md` |

Recorded state (all four configurations with provenance, quiet tree, commit d8b4150; files in `acceptance/results/`, git-ignored):
- Node (root config): 1,450 tests, 1,449 pass, 1 fail (memory bound after opening a store on a million points; kept).
- Browser (root config): 937 tests, 899 pass, 37 fail, 1 skipped. All 37 are in the strengthened browser acceptance suite: tooltip not hoverable (5), tooltip or readout over controls (5), tooltip rows under 24 px (5), focus indicators covered or cut (5), theme change one frame late (6), late font (3), short summary wraps (2), bar tooltip at the top edge (1), focused text rewritten on a sliding category axis (1), scatter tie (1), thin donut slice (1), A10 applicability (2).
- Distribution: 106 Node pass; browser 28 pass, 2 fail (note runs leaking into the page as JSON).
- Sizes: everything 99.47 KiB, line only 99.38, React adapter 1.17.
- Checker: exits 1; the matrix cites the browser suite’s old titles until the re-merge lands.

Reviews recorded since the last checkpoint: browser acceptance and distribution tests (Codex astra xhigh, `wp/tests-opus.review.md`), Node acceptance suite and checker (Opus xhigh, `wp/tests-codex.review.md`), stores, reader, lookup (Opus xhigh, `wp/modules-codex.review.md`), size analysis (Codex sol max, `wp/size.analysis.md`). All four have fix runs committed. Decisions: 0004 revision 2 (tooltip anchored to the datum, pointer-transparent while hovered; readout mode by layout); spec amendments to F8, F9, F10, I1, L8 and the zoom row of the type matrix.

Open decisions for the owner: size targets (analysis proposes 96 / 80 / 2 KiB; spec still says 40 / 25 / 2); palette (keep the refit or try a louder, more even light scheme; near-white dark focus ring); licence holder wording.

Deferred to the performance work: P7 when a store is opened on a large static chart (24.8 MB beyond the caller’s 16 MB; needs segmented columns); the scatter pick when all points are equidistant (needs a contract sentence allowing a device-pixel lattice); the renderer comparison rerun under performance plan 5.1.

Not yet reviewed: core passes three to five (one Codex review after the sixth), docs site, palette refit, benchmark harness fixes, React adapter fixes, the strengthened suites themselves.

Decisions recorded: `docs/decisions/0001-plot-interaction-pattern.md` (unrehearsed), `docs/decisions/0002-mark-renderer.md` (SVG by default, from `bench/results/m1-renderer-comparison.md`).

Known open items carried forward:
- View/scene review finding 10 (stack rebuilt over the whole frame per revision) and lookup review finding 12 (dense coincident scatter pick) are deferred to performance work.
- Performance: about 80 ms for 100,000 points against about 12 ms for uPlot; profiles put it in normalization through the streaming store and in garbage collection. The fix pass moves static charts to the borrowed path.
- Not started: documentation site, packed-distribution tests, size check against targets, scatter renderer measurement, a dist build for `@axylo/react` (must define `__DEV__` and keep the `use client` banner).
- `docs/api/axylo.d.ts` is superseded by the real package and is to be deleted once the examples point at it.

## Next action

1. As the four running packages return: verify, commit; then record all four configurations again on a quiet tree (`node acceptance/run.mjs unit|dist|dist-browser|browser`, about 20 minutes, touch nothing meanwhile) and run the checker.
2. Then the per-chart composition for tree-shaking and the three cheap size cuts from `wp/size.analysis.md` (a fresh Opus 5.5 high agent with cross-module rights), with the acceptance suites as the safety net.
3. One Codex review round: core passes three to six (sol max), docs site and React fixes (astra xhigh), palette refit and benchmark fixes (astra xhigh). Fixes by the authors.
4. When the machine is quiet: benchmarks under performance plan 5.1 (renderer comparison, budgets P1 to P8), then performance work, including the two deferred items.
5. Conformance table (A9) from the acceptance evidence; agent rehearsal (DX12); Phase 1 comparison rerun with Axylo included; final independent review of the acceptance evidence.

## Known limits that no agent can close

Screen-reader rehearsal (A3), real Safari and iOS, a real Android phone, and Firefox/WebKit runs need the owner's devices or a CI service. Only system Chrome is available here. These are recorded as not done wherever they apply.
