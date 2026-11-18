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

| Running now (2026-11-18, after commit 08b469b) | Who | Files |
|---|---|---|
| Per-chart composition for tree-shaking; stylesheet minified once; benchmark instrumentation behind a build constant; duplicate helpers (agent a8a13825a6a59c62a; brief `wp/tree-shake.prompt.md`) | Claude Opus 5.5 high | `packages/axylo/src`, `scripts/build.mjs`, package metadata, package-content tests |
| Documentation fix pass after `wp/docs.review.md` (agent a04bfe28413f07034, resumed) | Claude Opus 5.5 xhigh | `apps/docs` |
| Palette candidate B (more even light scheme) with comparison images; small record fixes (agent abc842fd0288bc675, resumed) | Claude Opus 5.5 xhigh | `research/palette`, `test/theme`, decision 0003; not `palette.ts` values |

State at 08b469b (coordinator runs; not a recorded run with provenance): type check clean; Node suite 2 known failures (the kept P7 memory test; the palette test file while its author edits it); **all 834 browser tests under `packages/axylo/test/browser` pass, 1 skipped, including the 555-test acceptance suite on SVG**; distribution 106 Node and 30 browser pass; React adapter 41 unit and 39 browser pass; benchmark harness 94 pure tests pass. Sizes: everything 99.47 KiB, line only 99.38, React adapter 1.94 KiB (budget 2).

Committed since the last checkpoint: core passes six and seven (tooltip per decision 0004 revision 2 with rule 3b; scheme switch in CSS; two-tone focus ring; diagnostic name from the target id); donut minimum arc and scatter tie rule; compact charts ignore `reference` and tick formats; matrix re-merge; browser acceptance suite aligned (555 tests); React adapter second pass; benchmark harness second pass (the plan 5.1 decision procedure, `bench/decision.mjs`); reviews of the docs site (`wp/docs.review.md`) and of the benchmark, palette and React fix passes (`wp/misc-opus.review.md`).

Open decisions for the owner: size targets (analysis proposes 96 / 80 / 2 KiB; spec says 40 / 25 / 2); palette (shipped refit, or candidate B once its images exist); licence holder wording.

For the core’s author after the restructuring lands (same files): the benchmark hooks the harness asks for (`describe().series[i].breaks`, `describe().plot`, `memory()` with owned bytes, window-relative kept indexes when streaming; listed in `wp/bench.fix2.report.md`); the unexplained 24-chart resize mismatch (marks up to 13 px from the reported domain); the P7 failure when a store is opened on a large static chart (needs segmented columns); the scatter pick bound (needs a contract sentence for a device-pixel lattice).

Decisions recorded: `docs/decisions/0001-plot-interaction-pattern.md` (unrehearsed), `docs/decisions/0002-mark-renderer.md` (SVG by default, from `bench/results/m1-renderer-comparison.md`).

Known open items carried forward:
- View/scene review finding 10 (stack rebuilt over the whole frame per revision) and lookup review finding 12 (dense coincident scatter pick) are deferred to performance work.
- Performance: about 80 ms for 100,000 points against about 12 ms for uPlot; profiles put it in normalization through the streaming store and in garbage collection. The fix pass moves static charts to the borrowed path.
- Not started: documentation site, packed-distribution tests, size check against targets, scatter renderer measurement, a dist build for `@axylo/react` (must define `__DEV__` and keep the `use client` banner).
- `docs/api/axylo.d.ts` is superseded by the real package and is to be deleted once the examples point at it.

## Next action

1. As the three running packages return: verify (every suite the brief lists for the restructuring), commit.
2. Record all four configurations on a quiet tree (`node acceptance/run.mjs unit|dist|dist-browser|browser`, about 20 minutes, touch nothing meanwhile), re-merge the matrix if titles moved, run the checker.
3. Final review round by the other provider: the restructured core and passes three to seven (Codex gpt-6.2-sol max for the controller, gpt-6.2-astra xhigh for the interaction layer and the acceptance evidence); fixes by the authors.
4. On a quiet machine (no agents running; about 3.2 hours): `node bench/decision.mjs plan` prints the sequence for the renderer decision; then the budgets P1 to P8 and performance work.
5. Conformance table (A9) from the acceptance evidence; agent rehearsal (DX12) against the corrected docs; Phase 1 comparison rerun with Axylo included; final independent review of the acceptance evidence.

## Known limits that no agent can close

Corrected on 2026-11-18 after checking the machine (Ubuntu, NVIDIA RTX 2060 SUPER, Wayland session, Chrome 157, Firefox 160 as a snap with geckodriver):

- **GPU rendering can be tested here.** Headless Chrome uses software rendering by default, which is all the earlier runs used. With `--enable-gpu --use-angle=gl --ignore-gpu-blocklist`, or run headed on the desktop, Chrome reports the NVIDIA GPU. The benchmark's GPU-dependent workloads (resize, pixel ratio 2, process memory) are therefore open work, not a limit.
- **Firefox can be driven through geckodriver** (WebDriver over HTTP, no download). Playwright cannot launch the installed Firefox (it needs its own patched build: a download, which needs the owner's permission and network). A WebDriver smoke suite covers rendering, layout, keyboard and pointer in real Firefox; Chrome-only tooling (the accessibility tree through CDP, media emulation) has no equivalent there.
- **Still outside this machine:** Safari on macOS and iOS, a real phone, Windows (and its screen readers NVDA and JAWS), VoiceOver, TalkBack. Orca, Ubuntu's screen reader, is the one rehearsal the owner can do here, by ear.
