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

| Running now (2026-11-18, after commit 12492de) | Who | Files |
|---|---|---|
| Interaction layer: part 1, the Select range toggle must not add a toolbar row in narrow tiles (its work is uncommitted in the tree); part 2, the verification's five blocking and eight major findings, brief `wp/interaction-verify.fix.prompt.md` (agent aa0e6fca8e4a6224b, resumed) | Claude Opus 5.5 high | `src/dom`, `src/core/focus.ts`, figure section of `theme/css.ts`, `test/browser/chart`, `test/browser/a11y`, `test/core/focus-*` |
| Engine switch in the browser harness; the acceptance suite in Playwright Firefox 159, then WebKit 27.2 (agent a61d95e46b3f0f3aa; uncommitted edits in `test/browser/harness.ts`, `a11y/util.ts`, `acceptance/util.ts`, two acceptance files) | Claude Opus 5.5 high | `test/browser/acceptance`, `harness.ts`, the two shared util files |
| Read-only check of the controller and data fixes against `wp/core-final.controller.review.md` (second attempt; the first was stopped by the provider's content filter after six minutes, log kept as `fixes-verify.controller.review.attempt1-failed.events.jsonl`) | Codex gpt-6.2-sol max | writes `wp/fixes-verify.controller.review.md` |

The shared `packages/axylo/dist` is built from 28174df. Agents use private builds through `AXYLO_BUNDLE`; the coordinator rebuilds the shared one at commit points, because the engine agent runs the acceptance suite against it.

Reviews of the fix passes: interaction layer, Codex gpt-6.2-astra xhigh (observed), `wp/fixes-verify.interaction.review.md`: the two original blockers fixed; five new blocking and eight major defects; verdict "hold the sign-off run". Decision 0004 gained "Clarifications after the verification" (all-gap anchor, the chart's own controls, Escape with several charts, a key that does not move, a gesture ends a pin, a drag while Select range is pressed). Controller and data: review not yet received.

Owner decisions on 2026-11-18: palette candidate B adopted (9861f54); size targets 96 KiB everything and 80 KiB line only (spec DX7); licence stays MIT with holder "The Axylo authors"; Playwright browser downloads allowed (Firefox and WebKit installed under ~/.cache/ms-playwright; the owner installed WebKit's system libraries); no screen-reader rehearsal for 1.0 (state it as not done, do not block on it); the React adapter is removed from 1.0 (bf93e1a; last state at dac5664; adapters later; plain TypeScript for now); Anthropic models build and fix, Codex reviews; memory budget P7 is 1.1× the caller's two columns (4a1db68; the kept failing test now passes against the new bound).

State (coordinator runs; not recorded runs):
- 28174df, shared build: every core browser suite on SVG, 876 passed, 1 skipped (877). The canvas run of `chart` and `a11y` was spoiled by in-progress test files for uncommitted work (14 failures, all seen ones in the new toggle tests against the older build); to be rerun.
- 12492de, working tree: type check clean; Node suite 1640 of 1642 under load average 11 (two million-point tests, `streaming-storage` owned bytes and `simplify` million-slot outlier; both pass alone).
- Sizes last measured before the fix passes: everything 104.24 KiB (target 96), line only 87.50 (target 80). The toggle adds about 0.3 kB (its author's measurement).
- Performance, early and weak (one loaded session at 709fcbf): first render against uPlot about 2× slower at 3×120, 3× at 10,000 points, 7× at 100,000 (`bench/results/m1-renderer-comparison.md`). Not re-measured since the borrowed static path landed.

Committed since 7208470: controller pass 8 and follow-ups (6ebdb6f, 3853361); data follow-ups (e55d984); interaction rewrite to decision 0004 revision 3 (28174df); `Messages.selectRange` (bbd7564); P7 budget (4a1db68); interaction verification review and the transformed-ancestor limit in the spec (affc7ab); palette record corrections (bb39a5f); controller scale and strip fixes (12492de).

Decisions recorded: `docs/decisions/0001-plot-interaction-pattern.md` (unrehearsed), `0002-mark-renderer.md` (SVG by default, provisional), `0003-default-palette.md` (palette B), `0004-tooltip-and-focused-text.md` (revision 3 with clarifications).

Known open items carried forward:
- View/scene review finding 10 (stack rebuilt over the whole frame per revision) is deferred to performance work.
- The acceptance matrix is stale: React rows, new and renamed tests, engines, DX1/DX7/DX8, the P7 bound (it still quotes 16,000,000 B), A3 rehearsal not done by the owner's decision.
- Docs follow-up not started: decision 0004 revision 3 and clarifications, the Select range toggle, readout modes, AX199 and AX150 wording, the transformed-ancestor limit, the A9 conformance table (placeholder at `apps/docs/pages/conformance.md`).
- `bench/history/20261118T03503*` (two files) are left uncommitted on purpose.

## Next action

1. When the interaction author reports part 1 (toggle): type check, Node suite, commit with targeted paths (`src/dom`, `src/core/focus.ts`, `src/theme/css.ts`, `test/core/focus-range.test.ts`, `test/browser/chart/final-range.browser.test.ts`, `test/browser/a11y/axe.browser.test.ts`, the one line in `acceptance/a6-a10`, decision 0004), coordinate with the engine agent, `npm run build`, then all browser suites on SVG and `chart` + `a11y` on canvas.
2. When the controller review arrives: record observed model and effort, send its findings to the controller and data authors (Anthropic), not to Codex.
3. When the engine agent reports: verify and commit the engine switch; triage Firefox and WebKit failures to the authors.
4. After part 2 of the interaction fixes: one more short read-only Codex check of the blocking items only; then record every configuration with provenance (`node acceptance/run.mjs unit|dist|dist-browser|browser`, plus engines), re-merge the matrix (Anthropic model), Codex reviews it, run the checker.
5. Size pass toward 96 and 80 KiB.
6. On a quiet machine with no agents: `node bench/decision.mjs plan` (software family about 3.2 h, gpu family about 2.2 h); then budgets P1 to P8 and the large-series path.
7. Docs follow-up; conformance table (A9) stating no screen reader was run; agent rehearsal (DX12); Phase 1 comparison rerun with Axylo included.

## Known limits that no agent can close

Corrected on 2026-11-18 after checking the machine (Ubuntu, NVIDIA RTX 2060 SUPER, Wayland session, Chrome 157, Firefox 160 as a snap with geckodriver):

- **GPU rendering can be tested here.** Headless Chrome uses software rendering by default, which is all the earlier runs used. With `--enable-gpu --use-angle=gl --ignore-gpu-blocklist`, or run headed on the desktop, Chrome reports the NVIDIA GPU. The benchmark's GPU-dependent workloads (resize, pixel ratio 2, process memory) are therefore open work, not a limit.
- **Firefox can be driven through geckodriver** (WebDriver over HTTP, no download). Playwright cannot launch the installed Firefox (it needs its own patched build: a download, which needs the owner's permission and network). A WebDriver smoke suite covers rendering, layout, keyboard and pointer in real Firefox; Chrome-only tooling (the accessibility tree through CDP, media emulation) has no equivalent there.
- **Firefox and WebKit through Playwright** are installed and launch headless (allowed and completed by the owner on 2026-11-18). WebKit on Linux is the engine, not Safari.
- **Still outside this machine:** Safari on macOS and iOS, a real phone, Windows. No screen-reader rehearsal will be done for 1.0 (owner's decision); the docs and the conformance table say so.
