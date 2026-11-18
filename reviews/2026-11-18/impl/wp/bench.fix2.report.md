<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a6075efd5cba2d5e5, resumed. Saved by the coordinator from the hand-back. -->

## Report: second fix pass on the bench harness (review part A, 11 findings)

The runner now implements plan §5.1 as its decision procedure. The P1 case of 20 identical pairs at 10.0 against 9.7 ms is "no worthwhile difference", not "better". All 11 findings are fixed or partly fixed, each with tests. Pure tests 94/94 and browser tests 15/15 pass. All edits are in `bench/**`; nothing is committed or staged. The machine sat at load 5–10 the whole time, so every browser number is a smoke run and none is evidence; every session I ran was correctly recorded as ineligible.

## The decision procedure (`bench/src/decision.js`, CLI `bench/decision.mjs`)

- **Endpoint table, as data:** the nine renderer endpoints (P1, P2-100k, P3-task, P3-late, P5, P8, scatter-50k first draw, line-10x100k, zoom-100k per step) and the budget endpoints P2-1M, P4, P7-mem and P7-lifecycle. Each has its metric and thresholds. The three without a budget get thresholds from the pilot (10% and 5% of the slower median). The decision refuses those thresholds unless they were frozen before the comparison started.
- **Intervals:** 99.44% for the family. Thresholds are floored at the noise edge; an edge at or above the tolerance means "too noisy to gate", which counts for neither side.
- **Failures:** a run that did not finish or was not admitted counts as a failure of that renderer (worse beyond tolerance), never as a missing value.
- **The rule:** rule 1, rule 2 (P3 counted as one everyday workload, the 4× retention test) and rule 3 (the canvas size check). The output is one of: renderer A, renderer B, one renderer with the other kept for a chart type, or no decision yet with what is missing.

**Outcomes on the synthetic cases** (`bench/test/decision.test.mjs`):

| Case | Result |
|---|---|
| P1, 10.0 vs 9.7 × 20 | no worthwhile difference (against zero alone it was "better") |
| SVG [+12, +18] ms on P5, equal elsewhere | canvas, rule 1 |
| SVG failed 2 runs on P3-task | canvas, rule 1 |
| Canvas wins P1 and P5; SVG wins scatter with lower bound ≥ 4 × 3 ms | canvas, with SVG kept for scatter |
| Same, but SVG's scatter gain is only 5 ms | canvas |
| SVG wins P3 task time and P8 but has 2 more late runs | canvas, 2 everyday wins to 1 |
| Same with equal late runs (2 to 2) | rule 3: SVG |
| Rule 3, canvas costs 2,048 B / 400 B / unmeasured | canvas removed / both kept behind the switch / canvas question left open |
| P5 with noise edge 12 against tolerance 10 | too noisy to gate, counts for neither |
| Carry-over, missing control, an inconclusive P1, a missing endpoint | no decision yet, each listed |
| Reviewer's carry-over pattern at 20 pairs (AB −6, BA −2, aggregate [−4, −4] "better") | withheld as carry-over |
| Reviewer's three uPlot A-versus-A records for a Canvas–SVG comparison | not a calibrated control (wrong adapter) |
| Three Canvas sessions, only one with 20 pairs | "1 qualifying session", not calibrated |

## Per finding

| # | State | Test |
|---|---|---|
| 1 §5.1 not implemented | fixed (see above; lifecycle uses the two windows and the 1% gate) | `decision.test.mjs`, `summaries.test.mjs` |
| 2 eligibility | fixed. Load is recorded at the start of every block, with an eligibility record per session and the Chrome version of every run. The decision is pinned to one environment: host, Chrome, headless, DPR, refresh rate, settle and artifact. Controls must match the adapter and the bytes, and are counted per metric; exploratory bands are never used to classify. | `decision.test.mjs`, `noise.test.mjs` |
| 3 carry-over | fixed / partly. `--isolate` gives a fresh browser per run; the pilot checks AB against BA; the decision withholds disagreements. At 20 pairs on the reviewer's distribution the false "better" rate is 5.0% at 95% and 1.3% at 99.44% (2,000 trials). Not done: an automatic pilot coverage check for skewed or binary endpoints. | `decision.test.mjs`, `inference.test.mjs` |
| 4 lost features | fixed / partly. Chart.js points carry their source index through decimation. Axylo's `kept` is used in every run. Each series needs its own stroke, and a continuous path across a gap is a bridge however many segments it uses. Scatter is checked against the drawn markers (count, extremes, the injected extreme), and the clustered fixture now clusters in x and y. Not done: Axylo gap topology without run starts (library hook below). | `drawn.test.mjs`, `axylo-adapter.test.mjs`, browser |
| 5 P4 | fixed / partly. Targets are known data at whole pixels; each move checks the exact committed datum and the exact readout text; misses count as +∞ in a nearest-rank p95 (the reviewer's case gives 100 ms); each move has its own waiter. Smoke: Axylo with its default renderer and uPlot are admitted; tuned Chart.js is rejected because its tooltip picks a neighbouring datum. Not done: presentation traces. The Canvas renderer reports "not available" for P4 (no plot rectangle without the hook). | `summaries.test.mjs`, browser |
| 6 P7 | partly. Owned bytes come only from the library's own count, so they are "not available" today. The other memory quantities are reported separately. The lifecycle runs 2,500 cycles with the two windows, the 1% gate and a live-observer count. Not done: replacement peak. | `summaries.test.mjs`, browser |
| 7 P3 | fixed. Frames are sampled on both sides of the window, and `lateWindow([160,177,194,211],40,3)` now fails. The threshold is a fixed 25 ms. Delays are labelled as acknowledgements, not presentation. Reliability gates both directions, so equal failures on different blocks give no "better". | `reliability.test.mjs` |
| 8 create/zoom | fixed / partly. `--endpoint` pins each recipe; the generic `axylo` adapter follows the public default renderer; the fixture's own title is used; scatter's metric is first draw; P8 checks compact semantics; zoom checks intermediate windows exactly. Not done: the half-pixel scatter tie rule is not exercised. | `axylo-adapter.test.mjs`, browser |
| 9 resize/theme | fixed. The 24-chart resize is one column, so no layout fallback. The narrowest-width readback goes through full admission. Frames bracket the window. Theme compares every toggle against fresh reference charts drawn in each scheme. | browser |
| 10 screening | partly. A candidate that never finishes is now its own outcome, retried and flagged. `tools/canvas-cost.mjs` measures the marginal Canvas size from matched builds: **2,186 B gzip** at the current source (a byte count, not a timing). Not done: CI and PR wiring (`.github` is not mine). | `provenance.test.mjs` |
| 11 profiles | fixed. Explicitly unmapped source-map segments stay unmapped. Not done: stage traces, a uPlot profile. | `profile.test.mjs` |

**A probable library issue the probe found:** in the 24-chart resize (1,200 × 200 px tiles at the end), both renderers draw the series with a y mapping that fits a domain of about [50, 200], while `__bench.describe()` reports [80, 180]. Marks are up to about 13 px off. Single-chart resize is admitted. I can't tell from the harness which side is wrong; it is one for the core.

## What I need from the library (`__bench`)

1. **Run starts:** `describe().series[i].breaks`, the offsets into `kept` where a new run starts (the `breaks` that `simplifyLine` already returns), plus `isolated` if those points are drawn as markers. The adapter already reads `breaks` when present.
2. **Plot rectangle:** `describe().plot` as `{x, y, width, height}` in CSS px of `.axylo-plot`, so P4 works on Canvas too.
3. **Owned bytes:** `memory()` returning `{ bytes, buffers: [{ name, bytes }] }`, the byte length of every typed array or ArrayBuffer the chart holds that is not one of the caller's columns, with canvas backing stores excluded.
4. **Streaming rows:** window-relative kept indexes for streaming charts; today they refer to rows of individual `append` calls.

## Where I interpreted §5.1 (the plan may want to say so)

- "Too noisy" means the noise edge reaches the tolerance.
- The noise edge is the larger of both renderers' controls, at the family level.
- An inconclusive primary endpoint blocks the decision (rerun).
- Two renderers that both lose under rule 1 give no decision; the plan has no rule for it.
- P3-late compares counts of late runs directly, without an interval.
- The 4× retention test applies to measured intervals only, not to counts.
- Control sessions are separate A-versus-A jobs in the same environment.

## Test runs

Pure tests:
```
ℹ tests 94
ℹ pass 94
ℹ fail 0
```
Browser tests:
```
ℹ tests 15
ℹ pass 15
ℹ fail 0
ℹ duration_ms 90864.697812
```

## Commands for the decision, on a quiet machine

Load must be under 1.0 at the start of every block. Durations are estimates from smoke runs.

```bash
node bench/build.mjs                                   # note the artifact directory <A>
node bench/decision.mjs controls --artifact <A>        # session 1, ~51 min
node bench/decision.mjs controls --artifact <A>        # session 2, separately, ~51 min
node bench/decision.mjs controls --artifact <A>        # session 3, ~51 min
node bench/decision.mjs pilot --artifact <A>           # ~14 min: freezes thresholds, checks order effects
node bench/decision.mjs endpoints --artifact <A>       # ~25–31 min (process per run where the pilot found order effects)
node bench/decision.mjs decide --artifact <A>          # seconds → bench/decision/decision-<time>.json
```

That is about 3.2 h of runs in total; `node bench/decision.mjs plan` prints the same sequence. If a session comes out ineligible, rerun that step with `--only <endpoint ids>`.

Pure tests: `node --test bench/test/*.test.mjs`. Browser tests: `node --test --test-concurrency=1 bench/test/browser/*.test.mjs`.

Main files: `bench/src/decision.js`, `bench/decision.mjs`, `bench/src/stats.js`, `bench/src/admission.js`, `bench/src/page.js`, `bench/tools/canvas-cost.mjs`, `bench/README.md` (sections "Renderer decision" and "What the harness needs from the library"). Two older history records and two artifacts from someone else's runs are still in `bench/history` and `bench/artifacts`; I left them.

