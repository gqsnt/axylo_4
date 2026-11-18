# Phase 3 plan: continuous performance work

Revision 2, 2026-11-18. Revised after three independent reviews ([ledger](../reviews/2026-11-18/ledger.md)).

The repeated improvement work starts when the TypeScript release from [03-plan-typescript-release.md](03-plan-typescript-release.md) works end to end, and that release is its baseline. The **measurement harness is built earlier, in milestone M0**, because the release's own budgets (P1–P7 in [02-product-spec.md](02-product-spec.md)) cannot be checked without it and two design decisions in M1 depend on its numbers.

## 1. What Phase 1 established, and what it did not

| Observation | What it supports | What it does not support |
|---|---|---|
| uPlot, plain JavaScript on Canvas 2D, was the fastest library at every size in the harness. | Tuned TypeScript sets a high bar. Any other technology has to beat that, not a naive implementation. | A specific per-update cost. The first run timed only the synchronous part of each call, and uPlot defers its redraw; see the corrected figures in 01, section 5.3. |
| Chart.js and ECharts were one to two orders of magnitude faster in their documented fast configuration than by default. | Whole configurations differ enormously; look for avoided work before low-level tuning. | Attribution to any single option. Several options changed at once, including ones that change what the reader sees. |
| Recharts and Nivo, which create a DOM node per point by default, were the slowest. | Node count is worth watching. | That SVG is slow. A single SVG path per series was among the fastest. |
| Two WebGL configurations ran on a software rasterizer in headless Chrome. | Nothing about WebGL. | Any conclusion about GPU paths, which need a headed browser on real hardware. |

The Phase 1 timings rank configurations by order of magnitude on one machine. They are not the baseline for this plan; the M0 harness produces that.

## 2. Workloads

Each workload is a page in `bench/` that takes a library adapter, so the same page runs Axylo and the comparison libraries. Every adapter is admitted only after a check that it shows the right thing: the visible x and y range, the newest and oldest timestamp, the window length, and one injected extreme value are read back and compared with the fixture. Phase 1's D3 adapter failed exactly this check after the fact.

| ID | Workload | Sizes and shapes | What a reader would notice | Budget |
|---|---|---|---|---|
| W-first | Create one line chart | 3×120; 1×10k; 1×100k; 1×1M; 10×100k. Rows and typed columns measured separately. Dense, gappy (5% missing in runs) and irregular-x variants | Delay before the chart appears | P1, P2 |
| W-page | Create a dashboard | 24 × `trend`; and a mixed page: 10 line, 6 bar, 4 area, 4 donut | Dashboard load | P5 |
| W-stream | Append on an independent 60 Hz clock, with sequence numbers | Window 600; 10k; 100k | Stutter; the display falling behind the data | P3 |
| W-replace | Replace all data (a filter change) | 10k; 100k; and all 24 charts at once | Delay after changing a filter | – |
| W-hover | Move the pointer to known data points, 200 moves | 10k; 100k; 1M | Tooltip lag | P4 |
| W-keys | Hold an arrow key across the plot; open the table | 10k; 1M | Keyboard lag; table delay | – |
| W-zoom | Zoom in and out 60 steps, then pan | 100k; 1M | Jerky zoom | – |
| W-resize | Animate container width 1,200 → 400 → 1,200 px over 2 s | 24 charts; 1×100k | Jank while a sidebar opens | – |
| W-busy | The mixed page with one chart streaming, one table open, a resize in progress and a filter change arriving | – | Everything at once, as on a real dashboard | – |
| W-types | Stacked bars 12×50 and 5×2,000; stacked area 5×10k; donut 8; scatter 10k uniform and 10k clustered | – | Delay before the chart appears | – |
| W-load | Cold page load with the script-tag build and one chart, on a named network profile | – | Time until the first chart is visible | – |
| W-mem | Memory, as defined in 3.1 | – | Tab memory; slow leak | P7 |

Workloads without a budget get one when their first baseline exists. Sizes are the ones named in the spec; there is no usage telemetry and none is planned, so they are revised from issue reports, with the reason recorded.

## 3. How to measure

### 3.1 Metrics

Every workload has one primary metric with a defined start, a defined end state that can be verified, and a statistic.

| Metric | Start | End | How |
|---|---|---|---|
| Time to first correct chart | The create call | The first presented frame in which the chart shows the fixture's data: readiness is signalled by the adapter (Axylo exposes a revision counter for this in benchmark builds), and the signal is validated on sampled runs against a screenshot compared with a reference | `performance.mark`, a `requestAnimationFrame` after readiness; screenshot sampling in separate, non-timed runs |
| Main-thread task time | Same | A fixed settle window after readiness | Chrome DevTools Protocol `Performance.getMetrics` (task, script, layout and style durations). This counts work wherever the library schedules it: synchronous, microtask, timer or animation frame |
| Update cost when streaming | First append | Last append displayed | Main-thread task time divided by updates; plus, per sequence number, the delay until the frame that displays it, the backlog, and the count of coalesced updates |
| Frame pacing | – | – | Intervals between animation-frame callbacks, summarized per run: 95th and 99th percentile, and the count over 1.5 refresh intervals (25 ms at 60 Hz, 12.5 ms at 120 Hz). The refresh rate is recorded |
| Input to display | A real pointer or key event dispatched at a known datum, timestamped | The first presented frame in which the readout shows that datum | A lightweight hook in benchmark builds, validated against Chrome traces on sampled runs. The Event Timing API is not used for this: it does not report `pointermove` or `wheel` |
| Long stalls | – | – | Long Animation Frames entries, which report frames of 50 ms and more. Used for stalls only, not for the one-frame budgets |
| GPU and raster time | – | – | Chrome tracing on selected headed runs |
| Memory | – | – | Four separate numbers, never mixed: bytes in buffers Axylo owns (counted directly); JavaScript heap after forced collection (CDP); process memory including canvas backing stores (browser task manager figures via CDP where available); peak during a data replacement. Baselines: a blank page, and the page holding only the input data. Leaks: heap after 100, 300 and 1,000 create–destroy cycles following warm-up, gated on slope, plus a count of remaining listeners and observers |
| Bytes | – | – | Minified, gzip and brotli size of each entry point from the packed distribution, CSS included; parse and compile time from a trace |

Where a browser lacks an instrument, the result file says "not available" for that browser. It is never filled with a number from another metric.

### 3.2 Environment

| Dimension | Values |
|---|---|
| Browsers | Chrome and Edge stable, Firefox stable, headed, with a real GPU. Safari on macOS by hand at releases. Playwright's WebKit build in CI, reported under its own name, not as Safari. |
| Hardware profiles | "Desktop": the reference machine, recorded with CPU, GPU, OS, display refresh rate and power settings. "Throttled": 4× CPU throttling through CDP, Chromium only. "Phone": one real mid-range Android phone, used at baseline calibration and at releases, when the device is available; when it is not, the result says so. |
| Display | Fixed 1,440×900 window; device pixel ratio 1 and 2. |
| Build | Production build of every library; pinned versions; adapter and fixture hashes in the result file. |
| Isolation | Fresh browser context per run; no extensions; machine otherwise idle. |
| Runnable combinations | Desktop × {Chrome, Firefox, WebKit}; Throttled × Chrome; Phone × Chrome. Nothing else is claimed. |

The reference machine restarts often and has no permanent temporary storage, so every run writes its raw samples and environment record to `bench/history/` in the repository as it goes. A run cut short by a restart is kept, labelled interrupted, and never merged with a later one.

### 3.3 Statistics

- **Design:** baseline and candidate run in randomized, balanced blocks (AB and BA in equal numbers) inside one session, so drift and order effects fall on both.
- **Unit of analysis:** the run. Frames inside one run share a browser, a thermal state and a history, so they are summarized per run before any interval is computed.
- **Summary:** median of per-run values with a paired bootstrap 95% interval for the difference; tail and count metrics get their own intervals from the same per-run values.
- **Noise:** an A-versus-A distribution, built from repeated blocks across at least three sessions, gives the noise band for each workload. A single A–A difference is not a noise floor; it can be near zero by chance.
- **Sample sizes** are set from a pilot in M0 that measures each workload's variance and run time. Until then: 20 complete pairs for a verdict, that is 20 runs of each configuration. With fewer, the result is reported as exploratory, with no verdict. (The first harness used six pairs; a reviewer showed that six can give a confident answer in the wrong direction about one time in ten on a skewed metric.)
- **Three outcomes:** better, worse, or inconclusive. "No significant difference" is reported as inconclusive, never as "no regression".
- **Scope of a number:** a result holds for its commit, browser version and machine. Comparisons against stored history are valid only on the same machine and browser version; otherwise both sides are rebuilt and rerun together.

### 3.4 Comparison libraries

| Library | Configurations | Role |
|---|---|---|
| uPlot | Default | Speed reference. |
| Chart.js | Starter default; feature-equivalent tuned | The most deployed. |
| ECharts | Starter default; feature-equivalent tuned | Canvas with built-in large-data modes. |
| Highcharts | Default; Boost | SVG with a WebGL path; evaluation use only, subject to its license terms for publishing benchmarks. |
| Recharts | Starter default; tuned | What most React users have. |
| Nivo | SVG line; Canvas line | A node-per-point library with a canvas alternative. |
| D3 | One SVG path per series, with current axes | A control for "SVG without per-point nodes". |

For each library, up to three configurations are published where they exist: the starter default, the least configuration that completes the same reader task, and a tuned configuration that keeps the same visible features (axes, legend, tooltip). Every option that differs from the default is listed with the documentation page that recommends it. A causal claim about one option needs a run that changes only that option. Node counts and the active renderer are recorded during the run.

Axylo is compared with a comparably equipped library as well as with uPlot, since uPlot does less. Versions are pinned and bumped once a quarter in a commit of their own. Comparison numbers are published with method, versions and configuration files, including the ones Axylo loses.

## 4. The improvement loop

One iteration, written up as a short record in `bench/experiments/NNNN-title.md`:

1. **Pick the target.** A workload failing its budget comes first. Otherwise rank by what readers meet most: missed frame deadlines in frequent interactions (hover, streaming, resize) before a rare wait, and a 40 ms stall that happens on every dashboard before a second saved on a million-point chart.
2. **Find the bottleneck.** Record a profile of that workload on the production build with source maps. Attribute time to stages (normalize, lookup, layout, scene, mark drawing, DOM text, raster) with `performance.measure` spans available in benchmark builds. Record each stage's share of the workload's critical path.
3. **State a hypothesis that can fail,** with a number: "Layout takes 41% of W-page because every tick label is measured twice; caching by font and string will cut W-page by at least 25%."
4. **Build the smallest experiment** behind a flag or on a branch, with no refactoring mixed in.
5. **Measure** candidate against baseline on the target workload and on every other tracked workload.
6. **Decide** by section 5 and write the record, including when the hypothesis was wrong. Negative results stay in the repository.
7. **Review.** Someone other than the author of the change checks the measurement and the record before it merges.

Likely order of attack. Each is a hypothesis, not a commitment:

| Order | Area | Why it is likely to matter |
|---|---|---|
| 1 | Work avoided: explicit invalidation, no relayout when tick labels do not change, simplification bounded by pixels and runs | The large gaps in Phase 1 were between whole configurations that did or did not avoid work. |
| 2 | Allocation in hot paths: typed columns end to end, reused buffers, no per-point objects | Streaming and hover run every frame. |
| 3 | Drawing command volume: one path per series, batched state changes | uPlot's approach; cheap to try. |
| 4 | Text: measurement cache, batched DOM reads and writes, reused label elements | 24 charts multiply every text cost. |
| 5 | Lookup: binary search on sorted x; a grid index for scatter that degrades gracefully on clustered data | Bounds hover and keyboard cost. |
| 6 | Partial redraw: a separate layer for cursor and focus | Removes full redraws from hover. |
| 7 | Startup: module structure, lazy code for zoom and the table | Affects every page. |
| 8 | Off-main-thread drawing | High integration cost; only if 1–7 leave a budget failing. |
| 9 | WebGL or WebGPU marks | Only if raster time is the measured bottleneck at sizes in the workload table. |

## 5. What makes a gain worth shipping

Each tracked workload has, written down before any candidate is measured: its primary metric, the smallest improvement worth having in absolute terms, and the largest regression tolerated. All of the following must hold.

| Condition | Rule |
|---|---|
| The gain is real and large enough | The lower bound of the 95% interval for the improvement is above the workload's smallest worthwhile improvement. Excluding zero is not enough. |
| The gain is perceptible or structural | It moves a workload across a budget, removes missed frame deadlines (shown with an interval over runs, not one frame in one run), or saves at least the workload's declared minimum in milliseconds. A percentage alone does not qualify: 5% of 0.1 ms is nothing. |
| Nothing else pays for it | No other tracked workload's interval shows a regression beyond its tolerance, in each browser where it can be measured. Inconclusive on a workload with a tight budget triggers a rerun, not a pass. |
| Bytes are accounted for | The size budget still holds. A change that adds more than 0.5 KiB gzipped needs a workload crossing a budget. |
| Correctness is unchanged | Scene snapshots identical, or every difference reviewed. All fidelity property tests pass, in particular F2 and F5. |
| Complexity is paid for | A new code path, mode or public option needs a workload crossing a budget or a gain at least four times the smallest worthwhile improvement. Otherwise the simpler code stays. |

Thresholds a reader can perceive rank above percentages: one frame for interaction and animation, 100 ms for a response to input, 1 s for a chart to appear.

### 5.1 Declared endpoints (provisional until the pilot)

Written on 2026-11-18, before any candidate was measured with the corrected harness, so that results cannot choose their own thresholds.

**Per workload.** The primary metric is the one its budget names (spec section 5). The smallest worthwhile improvement is 10% of the budget's limit; the largest tolerated regression is 5% of it. Neither may be smaller than the upper edge of that workload's A-versus-A noise band: where the band is wider, the band is the threshold and the workload is listed as too noisy to gate at its nominal tolerance.

| Budget | Workload in the harness | Primary metric | Smallest worthwhile | Tolerated regression |
|---|---|---|---|---|
| P1 | `first`, fixture `trend` | Task time, median over runs | 1 ms | 0.5 ms |
| P2 | `first`, 1 × 100,000 | Same | 6 ms | 3 ms |
| P2 | `first`, 1 × 1,000,000 | Same | 25 ms | 12.5 ms |
| P3 | `stream`, window 600 | Task time per update: one value per run (task time in the window divided by updates), median over runs | 0.2 ms | 0.1 ms |
| P3 | Same | Runs with any interval later than 25 ms | Fewer runs with late intervals | No more runs with late intervals than the baseline |
| P4 | `hover`, 1 × 100,000 | Input to the frame showing the matching readout, 95th percentile per run, median over runs | 1.7 ms | 0.8 ms |
| P5 | `page`, 24 tiles of 340 × 200 px, fixture `trend` | Total task time, median over runs | 20 ms | 10 ms |
| P8 | `compact`, 40 tiles of 160 × 48 px, one series each | Same | 8 ms | 4 ms |
| P7 | `mem`, 1 × 1,000,000 | Bytes owned beyond the caller's columns | 10% of the two columns | 5% of the two columns |
| P7 | `lifecycle` | Heap after forced collection, cycles 1,500–2,000 against 2,000–2,500 | n/a | Growth above 1% between the two windows |

**For the mark renderer (decision 0002).** Primary endpoints: P1, P2 at 100,000, P3 (both metrics), P5, P8, and three workloads that could reverse the choice: `scatter` at 50,000 points (first draw), `first` at 10 × 100,000, and `zoom` (task time per step at 1 × 100,000). The scatter, ten-series and zoom endpoints have no budget; their thresholds are 10% and 5% of the slower renderer's median in the pilot, fixed before the comparison runs. Because nine endpoints are judged together, each interval is computed at 99.4% (Bonferroni), not 95%.

The rule, in order:
1. A renderer that is worse beyond tolerance on any primary endpoint, and better beyond the smallest worthwhile improvement on none, loses.
2. If each renderer wins somewhere, the default goes to the one that wins on more of P1, P3, P5 and P8 (the everyday cases), and the other is kept for the chart type where it wins only if its gain there is at least four times the smallest worthwhile improvement (section 5, "complexity is paid for").
3. If nothing separates them, SVG stays and canvas is removed from the 1.0 bundle only if the size report shows it costs more than 0.5 KiB gzipped; otherwise both stay behind the switch.

For rule 2, P3 counts as one everyday workload: a renderer wins it only if it is better on task time per update beyond the smallest worthwhile improvement and has no more runs with late intervals than the other; a renderer with more late runs loses it whatever its task time. If the two renderers win the same number of the four everyday workloads, rule 3 applies. A result is a verdict only when the session's A-versus-A control for that workload and those two builds, with at least 20 complete pairs in each of three sessions, puts the noise band below the threshold; otherwise the workload is "too noisy to gate" and counts for neither side. A pilot must show, for each endpoint, that the per-order (AB and BA) estimates agree within the noise band; where they do not, runs for that endpoint use a fresh browser process per run. A run that does not finish, or whose admission fails, is a failure of that renderer on that workload, not a missing value.

How the harness reads these rules (`bench/src/decision.js`), accepted as part of the plan: a workload is too noisy when the noise edge reaches the tolerance; the noise edge is the larger of the two renderers' controls; an inconclusive primary endpoint blocks the decision and is rerun; if both renderers lose under rule 1 there is no decision yet; the late-interval endpoint of P3 compares counts of late runs, without an interval; the four-times retention test applies to measured intervals only; control sessions are separate A-versus-A jobs in the same environment as the comparison.

A session counts only if the machine was otherwise idle (one-minute load average under 1.0 at the start of every block) and Chrome's version did not change during it. The GPU-dependent workloads (resize, pixel ratio 2, process memory) form a second family, "gpu", measured with Chrome rasterising on the machine's GPU (headless with `--enable-gpu --use-angle=gl --ignore-gpu-blocklist`, or headed), judged by the same rules with its own intervals: the 100,000-point resize (task time and late runs), the 24-chart resize, P1, P2 at 100,000 and P5 at pixel ratio 2, and the dashboard's renderer and GPU process memory at pixel ratio 2. Its everyday workloads for rule 2 are P1 and P5 at pixel ratio 2 and the two resizes; a resize is won as P3 is, with its task-time win and no more late runs. GPU and software sessions are different environments and never serve the same family. (An earlier version of this plan said this machine could not measure them; that was wrong: only the default headless mode renders in software.)

## 6. Catching regressions

| When | What runs | Compared with | Action |
|---|---|---|---|
| Every pull request | Smoke set: W-first at 3×120 and 1×100k, W-stream at 600, W-hover at 100k, bytes. Chromium on a shared CI runner. | The merge base, built and run in the same job in balanced blocks | Screening only. A result worse than the workload's tolerance triggers one automatic rerun; two in a row flag the pull request. A size-budget breach fails it. Inconclusive is reported as such. |
| On flag, and nightly | Full workload set on the reference machine, runnable combinations from 3.2 | The merge base or previous night, and the last release, each rebuilt and run in the same session | Confirms or clears a flag. Opens an issue with the commit range for any workload outside its tolerance against the last release. |
| Cumulative drift | Each nightly also compares with the last release | – | Small regressions that each pass per-change screening are caught when their sum crosses the tolerance. |
| Before a release | Full set, plus Edge on Windows, Safari by hand, the phone profile when available, and all comparison libraries | Budgets P1–P7 and the previous release | A failed budget blocks the release, or the budget is changed in the spec with the measurements and a written reason. Never silently. |
| Quarterly | Comparison library versions bumped | – | Publish the updated comparison. |

Results are appended to `bench/history/` as one JSON file per run with an immutable run id, commit, lockfile hash, adapter and fixture hashes, browser versions, machine record, and ordered raw samples, with crashes, errors and timeouts recorded as distinct outcomes. A page in the documentation site charts that history with Axylo itself.

Performance tests follow the same honesty rules as functional tests: a budget is not relaxed to make a run pass, a slow workload is reported as failing until it is fixed, and a comparison Axylo loses is published as measured.

## 7. Where Rust could be justified, and what it would take

No Rust experiment starts before TypeScript 1.0 has shipped and its bottlenecks have been measured.

### 7.1 Candidates

A Rust experiment is worth running only for a stage that is a measured bottleneck on a tracked workload and is compute-bound on numeric data. Stages that mostly call browser APIs cannot gain: each call crosses the JavaScript–WebAssembly boundary and the browser does the work either way.

| Stage | Could Rust help? | Reasoning |
|---|---|---|
| Simplification and aggregation over typed columns (per-column extremes, binning, cumulative sums) at 1M+ points | Possibly | Tight numeric loops over contiguous memory; SIMD is available. JavaScript engines already compile such loops well. |
| Spatial index build and query for scatter at 1M+ points | Possibly | Memory layout control matters; no browser API involved. |
| Parsing large text inputs into columns | Unlikely | Strings must be copied into WebAssembly memory and decoded; the copy often costs as much as the parse. |
| Layout, ticks, label fitting | No | Small inputs; dominated by text measurement, a browser call. |
| Canvas 2D or DOM drawing | No | One boundary crossing per command. |
| Rendering to a pixel buffer or to WebGL/WebGPU from Rust | Only as a separate product decision | It replaces the renderer, brings its own text rendering, and does nothing for the DOM-based accessibility layer. |

### 7.2 Preconditions for starting

1. **The arithmetic allows a win.** If the stage is a fraction *f* of the workload's critical path and Rust makes it *s* times faster, the workload improves by at most *f* × (1 − 1/*s*), before any overhead. A stage at 30% needs a threefold speedup to reach 20%; a stage at 50% needs 1.7 times. The experiment starts only when a measured *f* and a defensible *s* (from a prototype of the kernel alone) give at least 25%, leaving room for transfer and startup.
2. **The workload matters.** It fails its budget, or it is the largest remaining wait, at a size in the workload table.
3. **TypeScript is already tuned for that stage** (typed arrays, no allocation in the loop, pixel-bounded work), and a reviewer other than the author has confirmed it from a profile.
4. **A written hypothesis with a number and a time ceiling.**

### 7.3 Evidence required to adopt

The comparison is always end to end, on the workload, against the tuned TypeScript build, with section 3's method.

| Question | Evidence required |
|---|---|
| Is the workload faster for the reader? | The lower bound of the 95% interval for the improvement in the workload's primary metric is at least 20%, and the absolute saving is at least the workload's declared minimum, in Chrome, Firefox and Safari or WebKit. A function-level microbenchmark is not evidence. |
| What does startup cost? | Fetch, compile and instantiate time of the module, cold and warm, on desktop and throttled profiles, included in W-load and in the first render of the affected workload. Break-even stated for a page that draws one such chart once (cold) and for one that redraws it repeatedly (warm). |
| What does data transfer cost? | Time and peak memory to move columns into WebAssembly memory and results back, included in the end-to-end number. If columns live in WebAssembly memory to avoid copies, the effect on `update`, `append` and P7 is measured too. |
| Where is the crossover? | The data size above which the Rust path wins end to end. It must be at or below sizes in the workload table. |
| Do small charts pay? | W-first at 3×120, W-page and W-load must not regress beyond tolerance, so the module loads lazily and only above the crossover. The byte, correctness and tail-latency gates of section 5 apply to the module as to any change. |
| What happens while it loads, and when it cannot? | `line()` stays synchronous. The TypeScript path draws until the module is ready; the switch happens on a later revision and is invisible. Tested: fetch failure, instantiation blocked by a Content Security Policy without `wasm-unsafe-eval`, `update` and `destroy` during loading, and a stale result arriving after newer data. In every case the chart is correct and no error reaches the page. |
| Does it run everywhere Axylo runs? | Script-tag build, Vite, webpack, Next.js. No reliance on threads, which need cross-origin isolation that embedded dashboards rarely have. |
| Are both paths the same chart? | Differential tests feed identical inputs to both and compare the selected source indexes, gaps, order and ties exactly, and floating-point results within a stated tolerance; the F2 and F5 property tests run on the Rust path; rendered output is compared within a stated pixel tolerance. |
| What does it cost to keep? | Recorded: the toolchain every contributor and CI needs; a native Windows build verified on Windows, not by cross-compiling; lazy bytes; CI minutes; lines of Rust; a named owner for rollback; and the permanent duty to maintain two implementations of one stage. |

### 7.4 Decision

Adopt only if every row passes. The adoption record names the workload, the crossover size and the conditions for reversal:

- tuned TypeScript comes within 10% on a later browser release, checked at each quarterly comparison;
- the differential tests cannot be kept green without disproportionate effort;
- among charts large enough to be eligible, the fallback path is the one that usually runs.

If the experiment misses, the record is kept with its numbers, the tuned TypeScript stays, and the idea is not reopened without a new profile.

A large win on the isolated stage with a small win on the workload is the expected failure. It does not show the profile was wrong: with a stage at 30% of the path, even a perfect kernel saves 30% before copies and startup take their share. The record for such a result measures where the remainder went (transfer, compilation, contention, a bottleneck that moved) before anything else is tried.
