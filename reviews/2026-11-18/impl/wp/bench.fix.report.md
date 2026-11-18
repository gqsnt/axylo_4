<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a6075efd5cba2d5e5. Saved by the coordinator from the hand-back. -->

## Report: bench harness fixes for the 18 review findings

Every finding in your list (items 1–11) is fixed or partly fixed, each with tests. Both suites pass. All browser numbers below come from smoke runs on a loaded machine and are not evidence. I wrote nothing to `bench/results/*.md` or the decision documents. All edits are in `bench/**`; nothing is committed or staged.

Three things you should know first:

1. **The M1 dashboard comparison measured no charts.** Every SVG run in `20261118T023718Z-page-3x120-x24-axylo-canvas-vs-axylo-svg-41e7` has `svgPaths: 0`. At 230×115 tiles Axylo's plot is below the 120×80 minimum of spec L8, so it shows its text summary instead of marks. The Canvas runs presumably drew nothing either. Decision 0002 uses the DPR 2 dashboard memory result, which comes from these runs. The new drawn-geometry check rejects such runs ("the chart drew no line strokes"). I changed the dashboard tiles to 340×200 in 4 columns, and the 24-chart resize grid to 4 columns of 200 px; Axylo draws marks there.
2. **The verdict rule is now 20 complete pairs** (plan 3.3: "20 runs for full comparisons"; I read that as 20 per configuration). It was 6. Even at 20 pairs, the coverage tool measured a false "better" 5.0% of the time on the reviewer's distribution (2,000 trials). This is stated in the README; I did not invent a new method to fix it.
3. **Someone else ran the harness while I was editing it.** Two aborted records appeared at 04:50 (`bench/history/20261118T035036Z-…-956e.json`, `…035037Z…-5708.json`; old command line with `--no-build`), plus two artifacts in `bench/artifacts/`. They are not mine, so I left them. A Chrome process still running belongs to another agent's vitest browser run; I did not touch it.

## Per finding

| # | State | Covered by | Ran myself vs. expect |
|---|---|---|---|
| 9 renderer | fixed | `test/axylo-adapter.test.mjs` (spy), `test/drawn.test.mjs`, browser test after a fresh production rebuild, `test/adapters/axylo-wrong-renderer.js` | Ran: both adapters always pass `__renderer`. The renderer is read from the committed chart's elements and must match, in probe and timed runs. A canvas-labelled adapter drawing SVG is rejected. |
| 6 replay | fixed | `test/noise.test.mjs` (runs the CLI, including the reviewer's exact M1 command) | Ran: the stored analysis prints by default, and that record shows `inconclusive` as published. `--reanalyze` re-resolves the band or stops with exit 2; `--zero-only` is explicit and labelled. The band used is printed per metric. |
| 7 failed work | fixed | `test/reliability.test.mjs` (the reviewer's three counterexamples), browser `uplot-stalls` | Ran: an unfinished stream gets outcome `incomplete`. Failures label every timing "conditional". More failures or more late-frame runs on the candidate block "better". Failure rates are reported. |
| 4 drawn | fixed | `test/drawn.test.mjs` (literal fixtures), browser test | Ran: `missing` is required. uPlot and Chart.js report the indices they drew; bridges, points at missing values, coverage gaps and lost extremes are rejected. Axylo is checked from captured strokes at pixel resolution in the untimed probe run. Tuned Chart.js on 1×100,000 with gaps is rejected ("185 drawn segments join retained neighbours across missing source values"); uPlot and both Axylo renderers are admitted. Partly: Axylo gaps under 2 px and Axylo timed runs are not checked (no library hook); uPlot's sub-pixel gap clipping is invisible to its index readback. |
| 2 lateness | fixed | `test/reliability.test.mjs` | Ran: intervals that cross a window boundary are counted (the 150 ms case counts). P3 uses exactly 300 intervals from the first due time (smoke: 300 every run). The statistic is stated in code and README. Not done: checking that a frame was actually presented (no traces). |
| 10, 11, 12 | fixed / partly | `test/noise.test.mjs`, `test/inference.test.mjs`, `tools/coverage.mjs` | Ran: a noise band must match workload, parameters, settle, DPR, Chrome, headless/headed, host and the hashes of the files it served, with ≥20 pairs; a mismatch is an error. Fewer than 3 sessions is labelled exploratory. Both seeds are validated and recorded. The bootstrap keeps the AB/BA strata; per-order estimates are printed (reviewer's carry-over case: −6 vs −2). Warm-up is symmetric. Not done: separate browser processes, a load or session-validity gate. |
| 17 provenance | fixed | `test/provenance.test.mjs` | Ran: each session gets its own read-only artifact. Axylo is compiled from a snapshot of the sources, with every input hashed, and HEAD and uncommitted changes recorded at build time. The server checks each file's hash as it serves it and records what it sent. `make-m1-report.mjs` now reads only the records and a pinned profile list, and needs `--out`; I regenerated it to scratch only. |
| 3 profiles | fixed | `test/profile.test.mjs` | Ran: source maps live in the artifact; self and inclusive samples are reported separately; the settle period is a separate profile. A smoke production profile was fully mapped (M1 left 71–73% unmapped). Not done: stage spans, raster traces, a uPlot profile. |
| 8 create | fixed | `test/provenance.test.mjs` (trend checked value for value against `research/harness/src/data.js`), adapter spy test | Ran: P1/P5 use `--fixture trend`; the default is 20 blocks; Axylo's stream draw record no longer calls `describe()`. Not done: screenshot or trace validation of readiness. |
| 14 workloads | fixed / partly | browser test "new workloads run end to end" | Ran: `hover` (P4), `compact` (P8), `mem` and `lifecycle` (P7), `scatter` (10k/50k/200k, `--clustered`), `--size 10x100000`, and `zoom` through `chart.zoom()`. Axylo is **not admitted** on hover (see library needs). Not done: P6, row input, irregular x, mixed page, W-replace/keys/busy/load. |
| 13, 15, 16, 18 | fixed / partly | browser tests (`uplot-fixed-width`, `axylo-stale-mark`), `test/summaries.test.mjs`, README | Ran: resize uses a fixed width sequence and checks geometry at the narrowest width too. uPlot readiness waits for its next draw. Theme checks every mark's colour; counters run separately. The feature matrix is in the README. `--base`/`--candidate` two-build mode refuses different harness files; `--screen --tolerance` reruns once and flags on a second failure. Not done: presentation latency for theme, nightly and last-release jobs, CI. |
| 1, 5 | not addressed | – | Outside your list. Finding 5 needs a headed GPU rerun. |

## Test runs (machine under load)

Pure tests:
```
ℹ tests 67
ℹ pass 67
ℹ fail 0
```
Browser tests:
```
✔ new workloads run end to end: hover (P4), zoom, compact (P8), scatter, mem and lifecycle (P7) (11433.858273ms)
ℹ tests 14
ℹ pass 14
ℹ fail 0
ℹ duration_ms 81944.577955
```

## Commands

- Pure tests: `node --test bench/test/*.test.mjs` (builds one artifact from `packages/axylo/src`, so it can fail while the core is broken).
- Browser tests: `node --test --test-concurrency=1 bench/test/browser/*.test.mjs`
- Smoke comparison: `node bench/run.mjs --baseline axylo-canvas --candidate axylo-svg --workload first --size 3x120 --blocks 2 --settle 200 --history-dir <scratch dir>`
- Coverage check: `node bench/tools/coverage.mjs`

## What I need from the library

- A drawn-index readback in `__bench.describe()` (the source indices the simplifier kept per series), so Axylo can be checked index-exactly, in timed runs, and for gaps under 2 px.
- **Hover:** on a 10,000-point chart the readout showed 4 distinct data over 40 moves (indices 407, 2826, 5244, 7662), so P4 cannot admit Axylo. Please tell me whether that is a bug or intended.
- Optionally, renderer kind in the production `__bench` hook (the DOM readback works without it).
- At the current source, `.axylo-summary` is visible in the L8 fallback. That looks intended, but it is why the dashboard tiles drew nothing.

## What I need from the plan

Declared tolerances and smallest worthwhile improvements per workload (screening requires `--tolerance` until then), a slope threshold for the P7 lifecycle gate, tile sizes for P5 and P8, and confirmation that "20 runs" means per configuration.

## Where the spec and the plan disagree

P3: the spec says "Main-thread task time per update; Median". The plan defines the metric as task time divided by updates, one number per run, which I implemented (median over runs). The spec could also mean the median of individual updates' costs, which TaskDuration cannot separate.

Other places where the spec is silent and I chose: P8 is 40 tiles of 160×48, each showing one series of `trend` (spec AX131 suggests one series per compact chart). For P4, Chart.js starter only shows a tooltip when the pointer hits a point marker, so it is not admitted for hover.

Main files: `bench/build.mjs`, `bench/run.mjs`, `bench/analyze.mjs`, `bench/src/stats.js`, `bench/src/admission.js`, `bench/README.md`. The old `bench/dist` is stale and no longer used; I left it.

