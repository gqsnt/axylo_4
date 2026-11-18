# Implementation status

Checkpoint file for the Axylo 1.0 build. Updated at every commit so work can resume after a restart. Plan: `docs/03-plan-typescript-release.md`.

## Model assignment (owner)

First assignment, 2026-11-18: code by Claude Opus 5.5 (effort high) or Codex `gpt-6.2-sol` (xhigh); design, review and other reasoning-heavy work by Claude Fable 5.2 (medium, the coordinator), Claude Opus 5.5 (xhigh), Codex `gpt-6.2-astra` (xhigh), Codex `gpt-6.2-sol` (max).

Changed later the same day, in the owner's words: "try to use more antropic model than openai , use openai model for another providier review". From that point: building and fixing, in every module including those Codex wrote (data, layout, simplify, view, scene, lookup, reader, messages, diagnostics, the Node acceptance suite, the acceptance matrix and checker), goes to Anthropic models (Opus 5.5 high for code; Opus 5.5 xhigh or Fable 5.2 for harder reasoning). Codex models are used read-only, as the other-provider reviewer of that work. Work done before the change keeps its recorded authors.

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

| Running now (2026-11-18, after commit a518cbb) | Who | Files |
|---|---|---|
| Engine switch in the browser harness; the acceptance suite run in Playwright Firefox 159, then WebKit 27.2 (agent a61d95e46b3f0f3aa, resumed) | Claude Opus 5.5 high | `packages/axylo/test/browser/acceptance`, `harness.ts`, the two shared util files |
| Final review of the controller and the per-chart composition | Codex gpt-6.2-sol max, read-only | → `wp/core-final.controller.review.md` |
| Final review of the interaction and accessibility layer | Codex gpt-6.2-astra xhigh, read-only | → `wp/core-final.interaction.review.md` |

Owner decisions on 2026-11-18: palette candidate B adopted (9861f54); size targets 96 KiB everything and 80 KiB line only (spec DX7); licence stays MIT with holder "The Axylo authors"; Playwright browser downloads allowed (Firefox and WebKit installed under ~/.cache/ms-playwright; the owner installed WebKit's system libraries); no screen-reader rehearsal for 1.0 (state it as not done, do not block on it); the React adapter is removed from 1.0 (bf93e1a; last state at dac5664; adapters for React, Vue, Svelte later; plain TypeScript for now).

State at a518cbb (coordinator runs; not a recorded run): type check clean; Node suite 1 known failure (the kept P7 memory test); core browser suites 834 pass, 1 skipped, on the restructured build with palette B (run before the React removal, which does not touch them); distribution 83 Node and 26 browser pass; docs 218 unit pass (160 browser per the author); benchmark harness 97 pure tests pass. Sizes from the packed files: everything 104.24 KiB (target 96), line only 87.50 (target 80), donut only 75.32, validate only 20.40.

Committed since the last checkpoint: per-chart composition and the cheap size cuts (37ed261); palette B and its independent check; docs fix pass after review and its maintenance; distribution maintenance; benchmark harness third pass (instrumented and release builds apart; `--gpu`; a second decision family for GPU workloads); React removal across packages, distribution tests, docs and dev dependencies.

For the core's author after the final reviews (one pass): review findings; the benchmark hooks in `src/core/instrument.ts` (`series[i].breaks`, `describe().plot`, `memory()` returning `{ bytes, buffers }`, `series[i].keptBasis === 'window'` for streams); the unexplained 24-chart resize mismatch (marks up to 13 px from the reported domain); library oddities from the docs author (`wp/docs.fix.report.md`: a wide-row summary uses the field key and puts the unit on the minimum only; the hidden plot control reads "No data" in the too-small state; AX199 wording); a size pass toward 96 and 80 KiB; the deferred P7 and scatter-pick items. Small record fixes for the palette author: `wp/palette-b.review.md` findings 1 to 6 (decision line 14 still says nobody else reviewed B).

Decisions recorded: `docs/decisions/0001-plot-interaction-pattern.md` (unrehearsed), `docs/decisions/0002-mark-renderer.md` (SVG by default, from `bench/results/m1-renderer-comparison.md`).

Known open items carried forward:
- View/scene review finding 10 (stack rebuilt over the whole frame per revision) and lookup review finding 12 (dense coincident scatter pick) are deferred to performance work.
- Performance: about 80 ms for 100,000 points against about 12 ms for uPlot; profiles put it in normalization through the streaming store and in garbage collection. The fix pass moves static charts to the borrowed path.
- Not started: documentation site, packed-distribution tests, size check against targets, scatter renderer measurement, a dist build for `@axylo/react` (must define `__DEV__` and keep the `use client` banner).
- `docs/api/axylo.d.ts` is superseded by the real package and is to be deleted once the examples point at it.

## Next action

1. When the Firefox and WebKit runs return: commit the engine switch; triage engine failures to module authors.
2. When the two final reviews return: one fix pass by the core's author with the list above; verify; commit.
3. Record every configuration on a quiet tree (`node acceptance/run.mjs …`; add Firefox and WebKit configurations), have the matrix's author re-merge (engines; React rows gone; DX1, DX7, DX8 amended; A3 rehearsal recorded as not done by the owner's decision), run the checker.
4. On a quiet machine with no agents: `node bench/decision.mjs plan` (software family about 3.2 h, gpu family about 2.2 h); then budgets P1 to P8 and performance work.
5. Conformance table (A9) from the acceptance evidence, stating no screen reader was run; agent rehearsal (DX12) against the docs; Phase 1 comparison rerun with Axylo included; final independent review of the acceptance evidence.

## Known limits that no agent can close

Corrected on 2026-11-18 after checking the machine (Ubuntu, NVIDIA RTX 2060 SUPER, Wayland session, Chrome 157, Firefox 160 as a snap with geckodriver):

- **GPU rendering can be tested here.** Headless Chrome uses software rendering by default, which is all the earlier runs used. With `--enable-gpu --use-angle=gl --ignore-gpu-blocklist`, or run headed on the desktop, Chrome reports the NVIDIA GPU. The benchmark's GPU-dependent workloads (resize, pixel ratio 2, process memory) are therefore open work, not a limit.
- **Firefox can be driven through geckodriver** (WebDriver over HTTP, no download). Playwright cannot launch the installed Firefox (it needs its own patched build: a download, which needs the owner's permission and network). A WebDriver smoke suite covers rendering, layout, keyboard and pointer in real Firefox; Chrome-only tooling (the accessibility tree through CDP, media emulation) has no equivalent there.
- **Firefox and WebKit through Playwright** are installed and launch headless (allowed and completed by the owner on 2026-11-18). WebKit on Linux is the engine, not Safari.
- **Still outside this machine:** Safari on macOS and iOS, a real phone, Windows. No screen-reader rehearsal will be done for 1.0 (owner's decision); the docs and the conformance table say so.
