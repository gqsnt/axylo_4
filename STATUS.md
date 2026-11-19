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

**Resumed 2026-11-19 07:55 on the owner's instruction** ("continue your plan" for benchmarks, agent rehearsal, Phase 1 comparison rerun, CI, release steps; "use mostly codex, 6.2 sol xhigh for coding and 6.2 astra xhigh and yourself for high level analyze / review"). The coordinator is now Claude Opus 5.5 at effort high (switched by the owner).

| Running now (2026-11-19, late morning) | Who | Files |
|---|---|---|
| Size trim: everything is 116.12 KiB, 118 bytes over the 116 KiB target since 4295681; recover at least 400 bytes, brief `reviews/2026-11-19/wp/size-trim.prompt.md` | Codex gpt-6.2-sol xhigh | `packages/axylo/src` |
| Rehearsal: Claude Code attempts on the machine's login (`--bare` accepts only an API key; a fresh config folder with a symlinked login instead), brief `wp/rehearsal-claude-login.prompt.md` | Codex gpt-6.2-sol xhigh | `rehearsal/` |

Done this morning: checker scanner fix (e871911); docs provenance fix (34ce116); first push to `https://github.com/gqsnt/axylo_4` (private, owner's grant, `main` only; the remote is `origin`); CI cannot start: GitHub reports a billing problem on the owner's account (owner's to fix, or make the repository public); Phase 1 harness with Axylo (f891171), probes rerun except timing (2bb830d), comparison `docs/05-comparison.md` by gpt-6.2-astra (b494566); the comparison found the plot's keyboard instructions wrong on bars and donuts, fixed (4295681); rehearsal harness (ae174bd), its design review by gpt-6.2-astra, its fixes (027281a); one trial attempt, not counted: Codex gpt-6.2-sol xhigh, daily-visits, pass on all 12 criteria (record in `rehearsal/records/trial-2026-11-19/`, ignored by git).

Model assignment (owner, 2026-11-19): Codex gpt-6.2-sol xhigh codes; gpt-6.2-astra xhigh designs and analyses; the coordinator (Opus 5.5 high) briefs, runs what the Codex sandbox cannot (Chrome, servers), checks Codex's code and commits.

Asked of the owner, not answered: the rehearsal's pass rule for 1.0 (proposed: 3 of 3 attempts in every agent-and-task cell, 24 attempts); which gate 1.0 uses; CI billing.

Next, in order: (1) commit the size trim after the browser suites pass on it; (2) commit the Claude login change after its tests pass; (3) the release candidate: `npm run build`, `node scripts/pack.mjs`, `node apps/docs/build.mjs`, then the counted rehearsal batch `node rehearsal/run.mjs --attempts 3 --parallel 2 --records rehearsal/records/release-<commit>` and `node rehearsal/summary.mjs --records …`; (4) with no worker running and the machine idle: Phase 1 `perf` (`cd research/harness && node probe.mjs perf` with the preview server) and `node bench/decision.mjs plan` (both families, about 5.5 h); (5) astra analyses the benchmarks and the rehearsal; sol fixes; (6) record every configuration again at the release commit.

Codex workers cannot commit; the coordinator verifies (including the browser runs their sandbox cannot do) and commits, and reviews their code (cross-provider). Benchmarks wait until no worker runs (the decision procedure requires a one-minute load under 1.0 at every block).

Recorded with provenance at commit 1e38333 on a clean, quiet tree, shared build rebuilt from it (result files and sidecars in `acceptance/results/`, log `record-1e38333.log`; not in git):

| Configuration | Passed | Failed | Not run |
|---|---|---|---|
| `unit` (Node) | 1849 | 0 | 0 |
| `dist` | 90 | 0 | 0 |
| `dist-browser` | 26 | 0 | 0 |
| `browser`, Chrome 158.0.8127.36 | 1175 | 0 | 1 |
| `browser`, Playwright Firefox 159.0 | 982 | 0 | 194 |
| `browser`, Playwright WebKit 27.2 (not Safari) | 982 | 0 | 194 |

Any commit after 1e38333, this one included, changes the tree, so these recordings answer for 1e38333 only and must be repeated at the release commit.

Release check at 1e38333 (`node acceptance/check.mjs --release --results` with the six files; output kept in `acceptance/results/release-check-1e38333.txt`): exit 1, as expected while weak cells exist. Cells: pass 94, fail 0, weak 164, not run 50, not recorded 0, cannot be verified here 11 (5 are A3, waived by the owner), not applicable 257. The matrix (208c56b) would reach 112 passes; the other 18 are a checker defect, below.

Two defects found at this step, not fixed (the owner said stop):
1. **The checker's title scanner nests a top-level describe under the one before it.** In `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` it gives "I2 legend toggles" the ancestors `["I1 tooltip under the pointer", "I2 legend toggles"]`, so every citation of a test after that point in the file (I1's new below-minimum test, I2, I5, I6: 18 cells) reads "not run" with no reason although `browser.json` passes them. Probably brace or template-literal tracking in `acceptance/titles.mjs` since the strengthening pass added code to that file. For the checker's author (a61d95e46b3f0f3aa): a failing scanner test from that file first; also make a "not run" with every report passing carry a reason.
2. **The docs conformance page does not count the recorded results.** `node apps/docs/build.mjs` at 1e38333 built the site, but the page lists all six result files as "No: provenance does not match the working tree" and every verdict as "not recorded for this revision", while the command-line checker accepts the same files in release mode from the same tree. The docs build probably changes the tree's fingerprint while it runs (it packs and installs the library) before `apps/docs/lib/conformance.mjs` calls `check()`. For the docs author (a04bfe28413f07034) with the checker's author: reproduce, then either call the checker before the build touches anything or fingerprint what the recordings fingerprint.

Other notes for whoever resumes: the recordings' sidecars say `dirty true` because of the two untracked `bench/history/20261118T03503*` files (left uncommitted on purpose); the release check accepted them. In a strip readout on a plot under about 170 px a click on a line chart does not pin (the pinned row with its buttons does not fit two lines; decision 0004 allows it): candidate for the known-limits page.

Matrix (208c56b): reachable when every cited result passes: 112 pass, 164 weak, 32 pending, 11 cannot be verified here, 257 not applicable; gap list in `wp/matrix-merge3.report.md`. Tests strengthened: Node acceptance (91d649e), browser acceptance with compact area and bar (d936ec3), Node evidence list regenerated (8e73b9f). Checker (3cbf903). Sizes on the packed files: everything 115.74 KiB (target 116), line only 96.81 (target 98).

Engines (author's runs on the shared build of d33df71, `acceptance/results/engines-d33df71/`): acceptance 560 passed on Chrome 158; 399 passed and 161 not run on Playwright Firefox 159 and on Playwright WebKit 27.2 (not Safari); `chart` + `a11y` + `render` 402 passed on Chrome, 388 passed and 15 not run on each other engine; no failure on any engine. The not-run tests need Chrome-only tooling (the accessibility tree through CDP: 151 + 5; multi-touch, pen, heap and listener inspection: the rest) and say so.

Matrix review, Codex gpt-6.2-astra xhigh (observed), `wp/matrix-review.review.md`: of 82 cells that would have read pass, 24 established, 52 weak, 6 not for this revision. Spec WCAG citations corrected after it (6772563). Stacks: owner's "keep incomplete" implemented (f3d709b). Docs follow all of it (f43b7a0). Sizes at 9611392 on the packed files: everything 115.74 KiB (target 116), line only 96.81 (target 98).

Coordinator's verification of d33df71 on the shared build built from it (logs `acceptance/results/verify-d33df71/`): core browser suites on SVG 962 passed, 1 skipped (963); `chart` + `a11y` on canvas 312 passed, 4 skipped; `tests/dist` Node 90 of 90; `tests/dist` browser 22 of 26 (the four text tests, fixture out of date); docs browser 169 of 170 (the AX160 page expects a note that the tick-only rule removed). Whole Node suite 1752 passed. Spec rows now cite the WCAG criteria they cover (71f2a02), the coordinator's mapping, to be reviewed with the matrix.

Closing pass commits: lookup (0d9532f), controller (68b3d6c), interaction (d33df71); reports `wp/closing.*.report.md`. The check they answer: `wp/final-check.review.md` (Codex gpt-6.2-sol max, of 9f9eeef). By the owner's stop rule no review follows; the evidence is each fix's own test (written first, failing on the old code) and the coordinator's runs. Verification of 9f9eeef (before the closing pass): SVG 948 passed, 1 skipped; canvas 298 passed, 4 skipped.

Found by the distribution tests (not run since before the interaction rewrite) and fixed in d33df71: a value text too long for one line hid the whole tooltip. Still expected to fail in `tests/dist/text.browser.test.ts`: the scatter fixture's premise that no sentinel x label is truncated is out of date since 6ebdb6f (a scatter's x domain ends on drawn ticks; `wp/closing.layout-labels.report.md`): the acceptance author adjusts the fixture after this run.

Sizes at d33df71, packed files: everything 116.00 KiB (118,780 B against 118,784: 4 bytes under the 116 KiB target), line only 97.02 (target 98). No margin left for "everything": remaining behaviour-neutral cuts are the duplicates in `src/dom` (`pageDistance`, `setText`, three small ones), two duplicate CSS rules, and property mangling (about −2.4 kB, needs the browser suites on the production bundle).

To be written into the docs as limits (final check section 4 and remainders): closed shadow roots (Escape may go to another chart; a closed-root slot wrapper can cut off the tooltip); a dense ring of points just beyond the coincidence radius can stall hover; a stateful formatter that throws on one call and succeeds on another can report AX160 beside a formatted label; responsive CSS scoped to the plot column can leave the readout absent; a tooltip rectangle change alone can inherit elapsed rest (I6); mixed languages on the plot's proxy; non-neighbouring compact bars may share a pattern; extreme magnitudes around 1e-43; value x axes reserve no room for the last tick label, so long labels rotate.

Round 3 commits: lookup `members` / `has` / `slot` (91adfe7), acceptance toolbar and Select range tests with checker exports (7f9965e), docs on the checker's rows (c4689bb), controller (c29e566), stores `retainedRows` (03ff5b1), interaction (9f9eeef); reports `wp/round3.*.report.md`. Sizes at 9f9eeef: everything 116.95 KiB (target 116: over), line only 97.71 (target 98: ok).

Coordinator's verification of e90d8db on the shared build (logs `acceptance/results/verify-e90d8db/`): SVG 920 passed, 4 failed, 1 skipped (925); canvas `chart` + `a11y` 280 passed, 3 skipped. The failures: three A2 toolbar tests (new button), one I1 donut hold test (real, settled by the rewritten Escape clarification). Narrow re-check, Codex gpt-6.2-sol max (observed), `wp/blockers-recheck.review.md`: hold; blocking C2, I4, I5, R1, R2; fourteen regressions R1 to R14. Round 3 answers it; common brief `wp/round3.common.md` records the coordinator's decisions (groups come from the lookup; C13 and mixed proxy languages accepted as they are; pointer tolerance in viewport pixels).

The shared `packages/axylo/dist` is built from 9611392. Only the coordinator rebuilds it; agents use private builds through `AXYLO_BUNDLE`.

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

Owner's answers on 2026-11-18 night: "Yes, settle them" (spec questions that restate behaviour: eb2de43); "Keep incomplete" (a stacked series with no row at an x is a missing component: spec af21368; the data author makes the stroke follow the band and drops the no-row bar mark, rewriting `test/view/stack-no-row.test.ts` first); "Yes, waive it" (A3: waivers recorded on the matrix row, shown in `acceptance/report.md`).

## Next action

Only on the owner's instruction. In order:

1. Fix the two defects above (scanner ancestors; the docs page's provenance), each with a failing test first; then repeat the six recordings at that commit on a quiet tree (`node acceptance/run.mjs unit|dist|dist-browser|browser`, `AXYLO_ENGINE=firefox|webkit node acceptance/run.mjs browser`; about 50 minutes), the release check, and `node apps/docs/build.mjs`.
2. The owner has been asked which gate 1.0 uses (release with documented gaps, or the spec's full gate where every cell passes); not answered yet. Time estimates given to the owner: with documented gaps 3 to 5 working days (7 to 9 if the large-series path needs restructuring); full gate 6 to 10 days (about two weeks in the bad case).
3. Benchmarks, with the machine left alone and no agents: `node bench/decision.mjs plan` (software family about 3.2 h, gpu family about 2.2 h); then budgets P1 to P8, the renderer decision (0002 is provisional), and the large-series path (first render at 100,000 points was about 7× uPlot in the only measurement, early and weak; the scatter lookup build got slower on 2026-11-18).
4. Agent rehearsal (DX12: no script, prompts or trap fixtures exist yet), 3 to 4 hours; Phase 1 comparison rerun with Axylo included, 2 to 3 hours.
5. Evidence gaps, most important first, in `wp/matrix-merge3.report.md` (164 weak cells).
6. CI has never run and no remote exists. Nothing has been pushed, tagged or published. Creating a remote, pushing, tagging and publishing each need the owner's explicit grant.

## Known limits that no agent can close

Corrected on 2026-11-18 after checking the machine (Ubuntu, NVIDIA RTX 2060 SUPER, Wayland session, Chrome 157, Firefox 160 as a snap with geckodriver):

- **GPU rendering can be tested here.** Headless Chrome uses software rendering by default, which is all the earlier runs used. With `--enable-gpu --use-angle=gl --ignore-gpu-blocklist`, or run headed on the desktop, Chrome reports the NVIDIA GPU. The benchmark's GPU-dependent workloads (resize, pixel ratio 2, process memory) are therefore open work, not a limit.
- **Firefox can be driven through geckodriver** (WebDriver over HTTP, no download). Playwright cannot launch the installed Firefox (it needs its own patched build: a download, which needs the owner's permission and network). A WebDriver smoke suite covers rendering, layout, keyboard and pointer in real Firefox; Chrome-only tooling (the accessibility tree through CDP, media emulation) has no equivalent there.
- **Firefox and WebKit through Playwright** are installed and launch headless (allowed and completed by the owner on 2026-11-18). WebKit on Linux is the engine, not Safari.
- **Still outside this machine:** Safari on macOS and iOS, a real phone, Windows. No screen-reader rehearsal will be done for 1.0 (owner's decision); the docs and the conformance table say so.
