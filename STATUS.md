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

| Running now (2026-11-18 night, after commit cbcc87a) | Who | Files |
|---|---|---|
| Port of `chart`, `a11y`, `render` to Firefox and WebKit, then every browser suite on both engines against the shared build of d33df71; results to `acceptance/results/engines-d33df71/` (agent a61d95e46b3f0f3aa; uncommitted guards in `test/browser/{chart,render}`) | Claude Opus 5.5 high | `packages/axylo/test/browser/**` |
| Independent review of the re-merged matrix and of the WCAG citations, brief `wp/matrix-review.prompt.md` | Codex gpt-6.2-astra xhigh | writes `wp/matrix-review.review.md` |

Committed since the closing pass: distribution fixture (e86e54f); docs with known limits and conformance reasons (a9145e3); interaction size cuts (799cbfa); matrix re-merge (d9fa4b0, report `wp/matrix-merge.report.md`: 31 gaps, 12 questions, 10 checker defects); spec A3 channel (cbcc87a). Production-bundle check of 799cbfa in an isolated checkout (`acceptance/results/verify-prod-799cbfa/`): sizes 115.65 / 96.81 KiB (both under target), `tests/dist` browser 26 of 26, docs browser 171 of 171, `tests/dist` Node 88 of 90 (the two are the isolation test, an artefact of the checkout's symlinked node_modules). Not yet run at HEAD: core browser suites on SVG and canvas (the shared build is still d33df71 while the engine runs use it).

Coordinator's verification of d33df71 on the shared build built from it (logs `acceptance/results/verify-d33df71/`): core browser suites on SVG 962 passed, 1 skipped (963); `chart` + `a11y` on canvas 312 passed, 4 skipped; `tests/dist` Node 90 of 90; `tests/dist` browser 22 of 26 (the four text tests, fixture out of date); docs browser 169 of 170 (the AX160 page expects a note that the tick-only rule removed). Whole Node suite 1752 passed. Spec rows now cite the WCAG criteria they cover (71f2a02), the coordinator's mapping, to be reviewed with the matrix.

Closing pass commits: lookup (0d9532f), controller (68b3d6c), interaction (d33df71); reports `wp/closing.*.report.md`. The check they answer: `wp/final-check.review.md` (Codex gpt-6.2-sol max, of 9f9eeef). By the owner's stop rule no review follows; the evidence is each fix's own test (written first, failing on the old code) and the coordinator's runs. Verification of 9f9eeef (before the closing pass): SVG 948 passed, 1 skipped; canvas 298 passed, 4 skipped.

Found by the distribution tests (not run since before the interaction rewrite) and fixed in d33df71: a value text too long for one line hid the whole tooltip. Still expected to fail in `tests/dist/text.browser.test.ts`: the scatter fixture's premise that no sentinel x label is truncated is out of date since 6ebdb6f (a scatter's x domain ends on drawn ticks; `wp/closing.layout-labels.report.md`): the acceptance author adjusts the fixture after this run.

Sizes at d33df71, packed files: everything 116.00 KiB (118,780 B against 118,784: 4 bytes under the 116 KiB target), line only 97.02 (target 98). No margin left for "everything": remaining behaviour-neutral cuts are the duplicates in `src/dom` (`pageDistance`, `setText`, three small ones), two duplicate CSS rules, and property mangling (about −2.4 kB, needs the browser suites on the production bundle).

To be written into the docs as limits (final check section 4 and remainders): closed shadow roots (Escape may go to another chart; a closed-root slot wrapper can cut off the tooltip); a dense ring of points just beyond the coincidence radius can stall hover; a stateful formatter that throws on one call and succeeds on another can report AX160 beside a formatted label; responsive CSS scoped to the plot column can leave the readout absent; a tooltip rectangle change alone can inherit elapsed rest (I6); mixed languages on the plot's proxy; non-neighbouring compact bars may share a pattern; extreme magnitudes around 1e-43; value x axes reserve no room for the last tick label, so long labels rotate.

Round 3 commits: lookup `members` / `has` / `slot` (91adfe7), acceptance toolbar and Select range tests with checker exports (7f9965e), docs on the checker's rows (c4689bb), controller (c29e566), stores `retainedRows` (03ff5b1), interaction (9f9eeef); reports `wp/round3.*.report.md`. Sizes at 9f9eeef: everything 116.95 KiB (target 116: over), line only 97.71 (target 98: ok).

Coordinator's verification of e90d8db on the shared build (logs `acceptance/results/verify-e90d8db/`): SVG 920 passed, 4 failed, 1 skipped (925); canvas `chart` + `a11y` 280 passed, 3 skipped. The failures: three A2 toolbar tests (new button), one I1 donut hold test (real, settled by the rewritten Escape clarification). Narrow re-check, Codex gpt-6.2-sol max (observed), `wp/blockers-recheck.review.md`: hold; blocking C2, I4, I5, R1, R2; fourteen regressions R1 to R14. Round 3 answers it; common brief `wp/round3.common.md` records the coordinator's decisions (groups come from the lookup; C13 and mixed proxy languages accepted as they are; pointer tolerance in viewport pixels).

The shared `packages/axylo/dist` is built from d33df71. Only the coordinator rebuilds it; agents use private builds through `AXYLO_BUNDLE`.

Idle agents that can be resumed with SendMessage: controller a1d73b9f46c46814f; interaction aa0e6fca8e4a6224b; data, lookup, scene, layout a5e106319fe97c022; engines and acceptance suite a61d95e46b3f0f3aa; palette abc842fd0288bc675.

Reviews of the fix passes (both of commit bbd7564, both "not ready"): interaction, Codex gpt-6.2-astra xhigh (observed), `wp/fixes-verify.interaction.review.md`, five new blocking and eight major; controller and data, Codex gpt-6.2-sol max (observed; second attempt, the first was stopped by the provider's content filter), `wp/fixes-verify.controller.review.md`, fourteen new defects, three blocking. All assigned findings were fixed by their Anthropic authors with a failing test written first (reports `wp/*-verify.fix.report.md`, `wp/layout-x-coarser.report.md`); the narrow re-check above is the independent confirmation, not yet received. Decision 0004 has a section "Clarifications after the verification".

Engines: `AXYLO_ENGINE=chromium|firefox|webkit` (e18c149); the runner and checker name the engine of every result (efa67d8). Author's acceptance runs on an isolated build of 7208470: Chrome 157 555 passed; Firefox 159 (Playwright) 385 passed, 9 failed, 161 not run; WebKit 27.2 (Playwright, not Safari) 384 passed, 10 failed, 161 not run (results in `acceptance/results/engines-7208470/`). The causes of those failures are fixed since (plot-edge slack, corridor slack, late-font measurement, size measured in the page), but the full suite has not been rerun on Firefox or WebKit at the current commit. The chart, a11y and render suites are not yet ported to the other engines (CDP uses listed in `wp/engines2.report.md`).

Owner decisions on 2026-11-18: palette candidate B adopted (9861f54); size targets 96 KiB everything and 80 KiB line only (spec DX7); licence stays MIT with holder "The Axylo authors"; Playwright browser downloads allowed; no screen-reader rehearsal for 1.0 (state it as not done, do not block on it); the React adapter is removed from 1.0 (bf93e1a); Anthropic models build and fix, Codex reviews; memory budget P7 is 1.1× the caller's two columns (4a1db68); review rounds on the controller and interaction layers stop after round 3 with one last narrow check, leftovers become documented limits. Size targets for 1.0 raised to 116 KiB everything and 98 KiB line only (63c5b65, "Raise targets"); streaming as an opt-in import, worth about 15 KiB, is the first size item after 1.0.

State (coordinator runs; not recorded runs):
- e90d8db: type check clean; whole Node suite 1701 passed (before the restart). Browser verification running.
- Sizes at e90d8db, packed files: everything 114.99 KiB (target 96), line only 96.84 (target 80), donut only 84.51, validate only 20.60, script tag 117.98. The fix passes of the day added about 10.7 KiB to "everything" (104.24 before them).
- Performance, early and weak (one loaded session at 709fcbf): first render against uPlot about 2× slower at 3×120, 3× at 10,000 points, 7× at 100,000. Not re-measured. The scatter lookup build got slower in its author's measurement when the lattice moved into it (200,000 points: 44.8 to 78.1 ms): weigh in the performance pass (alternative: build at idle).

Committed since c0a339c: engine switch (e18c149); late-font measurer (a96835e); controller and data verification review and fix briefs (9c49487); data and lookup fixes with the plot-edge slack (315cd9e); runner and checker engines (efa67d8); controller verification fixes (d9dd81e); layout x coarser domain (2bbef28); interaction toggle and verification fixes with the decision's clarifications (e90d8db).

Known open items carried forward:
- Size: targets are now 116 / 98 KiB. Before round 3: 114.96 / 96.81; round 3 adds about 1.5 KiB, so the behaviour-neutral cuts of `wp/size2.analysis.md` are needed for margin. The data author is applying them outside `src/dom` (dead test-only members, duplicate helpers, CSS minifier). Property mangling (−2.4 KiB) is not decided: it needs the whole browser suite on the production bundle.
- View/scene review finding 10 (stack rebuilt over the whole frame per revision) is deferred to performance work.
- Extreme magnitudes (values around 1e-43 and smaller): domain and ticks can disagree by rounding, or the tick set is empty (`wp/layout-x-coarser.report.md`). Recorded, not scheduled.
- The acceptance matrix is stale: React rows, new and renamed tests, engines, DX1/DX7/DX8, the P7 bound, A3 rehearsal not done by the owner's decision.
- Not tested: the control focus-outline margin in tooltip placement; the 0.01 px held-geometry comparison (interaction author's "not done").
- `bench/history/20261118T03503*` (two files) are left uncommitted on purpose.

**Waiting on the owner (asked 2026-11-18 night):** (1) whether to record a waiver for A3 (no screen-reader rehearsal) so the release check does not block on it; (2) stacked charts where one series has no row at an x (weekly beside daily): today that x is "incomplete" and the sparse band pinches to zero while its stroke stays joined; `wp/stack-no-row.report.md`. The author's test for the other reading, `packages/axylo/test/view/stack-no-row.test.ts`, is uncommitted and has three failing cases on purpose; commit it only in the form the owner chooses.

## Next action

1. When the engine agent reports: commit the port; `npm run build`; every core browser suite on SVG and `chart` + `a11y` on canvas at HEAD.
2. When the matrix review arrives: record observed model and effort; fixes to the matrix by the merge's author (a7e48ddd0321b1b1e), to the spec's WCAG citations by the coordinator.
3. The matrix report's twelve questions: settle those that only restate implemented behaviour in the spec; bring the rest to the owner.
4. Record every configuration with provenance on a quiet tree (`node acceptance/run.mjs unit|dist|dist-browser|browser`, plus `AXYLO_ENGINE=firefox|webkit … browser`), run the checker in release mode, rebuild the docs site so the conformance page shows recorded results.
5. Close the most important evidence gaps of `wp/matrix-merge.report.md` (compact area and bar in a browser; I1 below the L8 minimum; F3 delivery rules per type), by the acceptance author, as time allows; the rest stays listed as gaps.
6. On a quiet machine with no agents: `node bench/decision.mjs plan` (software family about 3.2 h, gpu family about 2.2 h); then budgets P1 to P8 and the large-series path.
7. Agent rehearsal (DX12: no script exists yet); Phase 1 comparison rerun with Axylo included. Optional size margin: property mangling (about −2.4 kB), only with the browser suites on the production bundle.

## Known limits that no agent can close

Corrected on 2026-11-18 after checking the machine (Ubuntu, NVIDIA RTX 2060 SUPER, Wayland session, Chrome 157, Firefox 160 as a snap with geckodriver):

- **GPU rendering can be tested here.** Headless Chrome uses software rendering by default, which is all the earlier runs used. With `--enable-gpu --use-angle=gl --ignore-gpu-blocklist`, or run headed on the desktop, Chrome reports the NVIDIA GPU. The benchmark's GPU-dependent workloads (resize, pixel ratio 2, process memory) are therefore open work, not a limit.
- **Firefox can be driven through geckodriver** (WebDriver over HTTP, no download). Playwright cannot launch the installed Firefox (it needs its own patched build: a download, which needs the owner's permission and network). A WebDriver smoke suite covers rendering, layout, keyboard and pointer in real Firefox; Chrome-only tooling (the accessibility tree through CDP, media emulation) has no equivalent there.
- **Firefox and WebKit through Playwright** are installed and launch headless (allowed and completed by the owner on 2026-11-18). WebKit on Linux is the engine, not Safari.
- **Still outside this machine:** Safari on macOS and iOS, a real phone, Windows. No screen-reader rehearsal will be done for 1.0 (owner's decision); the docs and the conformance table say so.
