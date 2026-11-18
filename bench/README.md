# Benchmark harness

The measurement method of [docs/04-plan-performance.md](../docs/04-plan-performance.md), sections 2, 3 and 6, for the
budgets P1–P8 in [docs/02-product-spec.md](../docs/02-product-spec.md) section 5. It runs the same workload through
Axylo and comparison libraries in system Chrome. It accepts a timing only for a chart that was checked to show the
right data and to have drawn it, and it compares two configurations (or two builds) in randomized, balanced blocks.

Revised 2026-11-18 after the cross-provider review `reviews/2026-11-18/impl/wp/bench.review.md`. Records written
before that (schema `axylo-bench/1`, the M1 session) keep their stored analysis; they cannot serve as noise bands for
new records (they do not record which files they served or the host).

## Commands

```bash
node --test bench/test/*.test.mjs                                   # pure tests (Node only, no browser; builds one artifact), seconds
node --test --test-concurrency=1 bench/test/browser/*.test.mjs      # browser tests: fresh production rebuild, system Chrome, ~2 min
node bench/tools/coverage.mjs                                       # coverage check of the verdict procedure (finding 11)

node bench/build.mjs                                  # one sealed artifact in bench/artifacts/<id>/ (run.mjs does this itself)

# baseline A against candidate B; 20 blocks by default (10 AB + 10 BA), a fresh browser context per run
node bench/run.mjs --baseline axylo-canvas --candidate axylo-svg --workload first --fixture trend           # P1
node bench/run.mjs --baseline axylo-canvas --candidate axylo-svg --workload first --size 1x100000           # P2
node bench/run.mjs --baseline axylo-canvas --candidate axylo-svg --workload stream                          # P3
node bench/run.mjs --baseline uplot        --candidate axylo-svg --workload hover                           # P4
node bench/run.mjs --baseline axylo-canvas --candidate axylo-svg --workload page --fixture trend            # P5
node bench/run.mjs --baseline axylo-canvas --candidate axylo-svg --workload mem                             # P7 owned bytes
node bench/run.mjs --baseline axylo-canvas --candidate axylo-svg --workload lifecycle                       # P7 heap trend
node bench/run.mjs --baseline axylo-canvas --candidate axylo-svg --workload compact                         # P8

# smoke comparison (2 blocks: shows the harness works; never a verdict, never evidence)
node bench/run.mjs --baseline axylo-canvas --candidate axylo-svg --workload first --size 3x120 --blocks 2 --settle 200

# A-versus-A noise band, then a comparison classified against it (checked: same workload, bytes, dpr, Chrome, host)
node bench/run.mjs --aa axylo-svg --workload first --size 1x100000 --artifact bench/artifacts/<id>
node bench/run.mjs --baseline axylo-canvas --candidate axylo-svg --workload first --size 1x100000 --artifact bench/artifacts/<id> --noise <aa run id>[,<aa run id>...]

# two immutable builds of the library in one balanced job; --screen applies the plan's rerun rule
node bench/build.mjs --source <checkout of the merge base> --out bench/artifacts/base
node bench/build.mjs --out bench/artifacts/candidate
node bench/run.mjs --adapter axylo-svg --base bench/artifacts/base --candidate bench/artifacts/candidate --workload first --fixture trend --screen --tolerance 1

node bench/analyze.mjs <run id>                                     # the analysis stored in the record
node bench/analyze.mjs <run id> --reanalyze                         # recompute, re-resolving the record's noise band
node bench/analyze.mjs <run id> --reanalyze --zero-only             # recompute against zero only, labelled so
node bench/profile.mjs --adapter axylo-svg --size 1x100000          # CPU profiles, self and inclusive, active and settle
```

Other options of `run.mjs`: `--size SxN`, `--fixture trend`, `--gaps` (5% missing in runs), `--clustered` (scatter),
`--charts`, `--toggles`, `--window`/`--samples`, `--moves`, `--cycles`, `--blocks` (even), `--settle` ms (default
500), `--timeout` ms per run, `--seed` (block order) and `--bootstrap-seed` (both integers 0…2³²−1; anything else
is an error, and both are recorded), `--dpr 1|2`, `--headed`, `--history-dir`, `--artifact <dir>` (reuse a sealed
artifact), `--source <checkout>` (build the library from another checkout). `bench/results/m1-session.sh` is the
historical M1 session script; it uses options this runner no longer has.

## Provenance: sealed artifacts

`build.mjs` writes one artifact per session into its own directory and never rebuilds one in place:

- the page and one ESM bundle per adapter (esbuild), and Axylo's two script-tag builds compiled **from source**
  with the options of `scripts/build.mjs`, plus an external source map for each. The build checks that the map does
  not change the JavaScript (`source.shippedOptions`) and compares the production bundle with the checkout's
  `packages/axylo/dist` (`source.distComparison`);
- it reads every Axylo source file once into memory and compiles both builds from that snapshot, recording each
  file's sha256 (`source.axyloInputs`, `source.axyloSourceHash`), the git HEAD and the uncommitted changes of the
  source checkout, all at build time;
- `manifest.json` lists the sha256 and size of every file; then every file and directory is made read-only.
  `chmod -R u+w <dir> && rm -r <dir>` removes one.

The runner serves only files listed in the manifest. The server reads each file, hashes it, and answers 500 (and
records a violation) if it differs from the manifest; a session with a violation is recorded as `aborted`. Every
record holds, per slot, the artifact id, its manifest hash, the source provenance, the hash of every file in the
artifact, and the hash of every file **actually served** (`hashes.slots.A.served`). The artifact is verified again
from disk at the end of the session. Reports are generated from records only (`bench/results/make-m1-report.mjs`
now reads provenance from the records it lists and profiles from a pinned list checked against the records' bundle
hashes; it writes only to an explicit `--out`).

## Pieces

| File | Role |
|---|---|
| `build.mjs` | Sealed artifact: build, seal, `readArtifact` (verifies every file) |
| `src/page.html`, `src/page.js` | The one benchmark page. `?adapter=…&workload=…&params={…}&settle=…&probe=…` |
| `src/fixtures.js` | Seeded, deterministic data, including the named `trend` fixture (pure) |
| `src/admission.js` | The admission check: held readback, drawn readback, renderer identity (pure) |
| `src/drawn.js` | Drawn index paths for uPlot and Chart.js, the theme per-mark check (pure) |
| `src/stats.js` | Per-run summaries, balanced order, stratified paired bootstrap, verdict rules (pure) |
| `src/adapters/*.js` | `noop`, `uplot`, `chartjs`, `chartjs-tuned`, `axylo`, `axylo-canvas`, `axylo-svg` |
| `test/adapters/*.js` | Deliberately broken adapters, used by the browser tests only |
| `lib/driver.mjs` | Artifact server, browser, one run in a fresh context, machine record |
| `lib/refs.mjs` | Adapter references, workload names, noise-band matching |
| `run.mjs`, `analyze.mjs`, `profile.mjs` | Runner (compare, A-versus-A, two builds, screening), replay, profiles |
| `tools/coverage.mjs` | Coverage check of the verdict procedure |
| `history/<run id>.json` | One file per balanced job |

### Adapter interface

An adapter module's default export has `id`, `library`, `version`, `config`, `available(workload)` (returns
`{ ok }` or `{ ok: false, reason }`), optional `load(params)`, `setup()`, `configFor(params)`,
`expectRendererFor(params)`, and `create(container, { x, ys, names }, opts)` with `opts.window` (stream),
`opts.resize`, `opts.compact`, `opts.kind` ('line' or 'scatter'), `opts.hover`. `x` is a `Float64Array`, `ys` one
`Float64Array` per series with `NaN` for a missing value. `create` returns a handle:

- `ready`: a promise (a getter, re-evaluated) that resolves when the library itself reports that it has drawn its
  latest state (Axylo: `chart.__bench.ready()`; uPlot: its `draw` hook after the last change; Chart.js:
  `afterRender` with no animation running, after the last change). The harness never guesses readiness from frames.
- `append(x, ys)`, `drawnNewestX()`: streaming, with the newest x the chart has drawn. Axylo's is constant time: the
  `ready()` called right after an append resolves after the frame that drew it; no `describe()` scan.
- `zoom(lo, hi)`: Axylo `chart.zoom([lo, hi])` (public API); uPlot `setScale('x', …)`; Chart.js scale min/max.
- `hoverTarget()`, `hoveredIndex()`, `readoutShows(i)`: W-hover.
- `themeColors(el)`: the colors the library assigns each series in the current scheme and the colors the marks show.
- `describe({ capture, probe })`: the readback, after the measured window (below).
- `destroy()`.

Converting typed columns into what a library accepts happens inside `create`, so it is timed work for every library.

## What the compared libraries draw (feature matrix)

Shared by every adapter: the same typed columns, the same outer CSS box, viewport 1,440×900, the requested device
pixel ratio, `en-US`, UTC. Not shared: plot geometry, fonts, interaction and accessibility. A ratio between these
libraries is not a budget (spec 5, rule 2) and, because of the rows below, not a like-for-like cost either.

| | Axylo (default) | uPlot (default) | Chart.js starter | Chart.js tuned |
|---|---|---|---|---|
| Marks | one path per series; Canvas 2D or SVG (`__renderer`, always explicit); simplification per pixel column and run | one path per series, Canvas 2D; nulls break the line, clipped at whole device pixels (sub-pixel gaps are not visible as breaks) | line plus a point marker on every point, Canvas 2D | line, no point markers; min-max decimation above 4× the canvas width, which skips missing values (draws across gaps: not admitted on gappy data) |
| Text | DOM text, inherits the page font (here 12px system-ui) | canvas text, its own default `12px system-ui, …` | canvas text, Chart.js default `12px 'Helvetica Neue', Helvetica, Arial` | same |
| Legend | yes (DOM, series toggles) | yes, below the plot, with live values (30 px reserved) | yes (canvas) | yes |
| Tooltip / readout | yes, DOM; fixed readout under the plot when it does not fit | no tooltip; cursor and live legend values | yes, only when the pointer hits a point marker (default `intersect: true`): not admitted for W-hover | yes, nearest point along x (`intersect: false`) |
| Accessibility layer | yes: accessible name, generated summary, keyboard proxy, table control (spec 3; on in every measured configuration, rule 3) | none | none (canvas only) | none |
| Animation | none on first render; updates up to 200 ms (spec I5) | none | entry and update animations (1 s); readiness waits for them | none |
| Theme (W-theme) | CSS custom properties per scheme; per-mark colors checked | no theme mechanism: not admitted | none: not admitted | none: not admitted |
| Compact, scatter | `compact: true`; `scatter()` | not configured: not available | not configured: not available | not configured: not available |

`noop` is the measurement floor: same calls, draws nothing. Run it as a contemporaneous control in the same session.

## Workloads

| Workload | Budget | What runs | Containers |
|---|---|---|---|
| `first` | P1 (`--fixture trend`), P2 (`--size 1x100000`, `1x1000000`) | Create one line chart; any `SxN` (`10x100000` for the renderer decision), `--gaps` | one 800×400 |
| `page` | P5 (`--fixture trend`) | 24 charts at once (`trend` each, or `SxN` with its own seed) | 24 of 340×200, 4 columns |
| `compact` | P8 | 40 `compact: true` charts, one `trend` series each (spec 3.7, AX131) | 40 of 160×48, 8 columns |
| `scatter` | renderer decision | One scatter of 10,000 / 50,000 / 200,000 points (`--size 1xN`), `--clustered` | one 800×400 |
| `stream` | P3 | A 600-point window; 300 samples from a producer on an independent 60 Hz clock | one 800×400 |
| `hover` | P4 | 200 real pointer moves left to right across a 100,000-point chart (CDP Input) | one 800×400 |
| `zoom` | renderer decision | 60 calls to the public zoom: 20 in, 20 out, 20 pan steps, ending on a known window | one 800×400 |
| `theme` | – | 20 toggles of a class-based dark theme on `<html>` | one 800×400 |
| `resize` | – | 1,200 → 400 → 1,200 px in a fixed sequence of 123 widths, one per frame | 1,200×400, or 24 in 4 columns of 200 px |
| `mem` | P7 | Create one chart of 1,000,000 points; memory after forced collection | one 800×400 |
| `lifecycle` | P7 | 1,000 create–destroy cycles of `trend` after 20 warm-up cycles | one 800×400 |

The named `trend` fixture (3 × 120 daily points, "Direct", "Organic search", "Referral", a 7-day outage in
"Referral") is copied value for value from `research/harness/src/data.js`; a test compares the two. Its largest value
is the extreme the check reads back (it has no injected one). The synthetic line fixtures are seeded random walks, a
day apart up to 1,000 points and a minute apart above, with one extreme injected into series 0 at 37% of the range;
gaps never touch the first or last point or the extreme.

The dashboard tiles were 230×115 before this revision. At that size Axylo's plot is below the 120×80 minimum of spec
L8, so it shows its text summary instead of marks: the M1 dashboard records have `svgPaths: 0` in every SVG run. The
drawn-geometry admission now rejects such a run ("the chart drew no line strokes"); the tiles are 340×200.

## Admission

Before an adapter is timed, the runner does one untimed **probe** run per side (`probe=geometry`) and compares the
readback with facts derived in Node from the fixture (`src/admission.js`). Every timed run is checked again after its
measurement window (the readback is never taken inside it). A run that fails is `not-admitted`; its timing is
discarded and it is not paired. The checks:

- **held**: the visible x range contains the expected range (the data's, or the final zoom window) and is not wider
  than it plus 10% per side (25% for a scatter's number axis, which may round to nice ticks); the visible y range
  contains the data's y extent in that window and the extreme, and is at most 4× the data's scale; per series the
  points held, the oldest and newest x to the millisecond, and the number of missing values (**required** from every
  adapter); the page built the same data as the runner (FNV-1a checksum).
- **drawn**, index readback (uPlot, Chart.js): the source indices the library draws, as connected paths. Rejected:
  two retained neighbours joined across a missing source value, a drawn point at a missing value, drawn indices that
  do not cover the visible window, drawn extremes in the window that are not the data's extremes.
- **drawn**, pixel readback (Axylo, probe runs only): the polylines the library stroked (SVG path data; Canvas 2D
  moveTo/lineTo on the scene canvas, recorded only in the probe run), mapped through the plot clip rectangle and the
  committed domains. The series is the stroke through its first and last visible points; its highest and lowest
  vertices must sit within 1.5 px of where the data's extremes map; no single segment may cross a missing stretch at
  least 2 px wide. Gaps narrower than 2 px are not checked at this resolution (index readbacks check every gap).
  Timed runs of Axylo report `not-captured`, recorded as a limit: Axylo exposes no drawn-index readback.
- **renderer**: Axylo adapters always pass `__renderer`, and the committed chart's mark elements must be the named
  renderer (`.axylo-canvas` canvases or `svg.axylo-svg`), in probe and timed runs.
- **stream**: an unfinished stream (a sample never received or never acknowledged by the draw record, the watchdog
  fired, or a frame log that does not cover P3's 300 intervals) is outcome `incomplete`, a failure, never a timing.
- **theme** (probe): after every toggle, every series mark's color must equal the color the library assigns that
  series in the current scheme (Axylo: `--axylo-series-color-N` on the chart root, resolved on a probe element);
  one stale mark fails. Frames until the new colors show: 4 further untimed toggles. Canvas 2D calls and DOM
  mutations per toggle: a separate untimed `counters` run. Timed theme runs do neither.
- **resize**: final geometry in every run; in the probe run also at the narrowest width (after the charts report
  ready), so a chart that never follows its container is caught although it fits again at 1,200 px.
- **hover**: the readout must match the datum the chart's hover state picked for each move, move left to right,
  span the data, and show at least one distinct datum per two moves.

Not done: screenshots against untimed references (plan 3.1), tooltip text against expected strings, gap checks below
2 px for Axylo, scatter point geometry.

## Metrics

All "lower is better". Each run is summarized to one number per metric before any comparison.

**Main-thread task time** (`taskMs`, primary for create workloads): the change in CDP `TaskDuration` from just
before the create call until a fixed settle window (500 ms) after every chart reported ready. It counts main-thread
work wherever it is scheduled; not GPU-process or raster-thread work. The window includes adapter conversion and the
harness's own constant (the `noop` floor shows it); fixture generation, adapter loading and the readback are outside.

**P3** (`stream`): `taskMsPerUpdate` = TaskDuration from the producer's start until the frame in which the last
sample was visible, divided by the 300 samples, one number per run; the comparison and the budget take the median of
those per-run numbers. This is the plan's definition (3.1, "main-thread task time divided by updates"). The spec's
"median" (P3 row) could also be read as the median of individual updates' costs, which TaskDuration cannot separate;
the harness implements the plan's statistic. `lateFrames` = frame intervals over 1.5× the observed refresh interval
(25 ms at 60 Hz) among exactly 300 consecutive intervals, starting with the interval in which the first sample fell
due; the frame log keeps running after the last sample until it covers them. These are animation-frame callback
intervals, not presented frames (no trace). Per sequence number: `delay*` (scheduled time to the frame callback
whose drawn state includes it), `maxBacklog`, `coalesced`. Small backlog and coalescing counts are mostly the beat
between the two 60 Hz clocks.

**Frame intervals** (`resize`, `zoom`): every interval that overlaps the window, including those that start before
it or end after it.

**P4** (`hover`): per move, `pointermove` `event.timeStamp` to the first animation-frame callback in which the
readout shows the datum the chart's hover state picked; the 95th percentile over moves (`inputToReadoutP95Ms`). The
reader is registered from a window listener in the bubbling phase, after the chart's own listener ran. It is the
frame callback, not presentation.

**P7** (`mem`): `ownedBytes` = (JS heap used + ArrayBuffer backing storage, `Runtime.getHeapUsage` after
`HeapProfiler.collectGarbage`) with the chart minus with only the caller's columns on the page; `ownedRatio` = that
divided by the bytes of the caller's columns (budget ≤ 1). Canvas backing stores are not JavaScript memory and are
reported separately (`canvasBackingBytes`, calculated as width × height × 4). (`lifecycle`): least-squares slope of
the same heap figure over checkpoints after 0, 100, 300 and 1,000 cycles (`heapSlopeBytesPerCycle`), and the change in
JS event listeners and DOM nodes from the first to the last checkpoint. The plan says "gated on slope" but declares no
threshold; the slope is reported, not gated.

**Memory** (create workloads, outside the timed window): `heapChartBytes`, renderer and GPU process PSS (Linux
`/proc`), calculated canvas bytes, `domNodes`. Never added together. Where an instrument is missing the result says
`not available: <reason>`.

**CPU profiles** (`profile.mjs`): two CDP `Profiler` profiles of one create run (100 µs sampling): *active* (create
call to the first frame after ready) and *settle* (the settle period), summarized separately. **Self** samples go to
the leaf frame (an Axylo module, `(program)`, `(garbage collector)`, other JavaScript); **inclusive** samples count
once for every stage on the stack. Positions map through the artifact's own source maps for both builds. Inlined
frames, allocation sites behind GC, and other threads are not attributed. Profiled runs are never timings.

## Statistics

- Blocks of two (AB or BA), as many AB as BA, in an order shuffled with the recorded order seed. Before timing:
  probe runs A then B, then one untimed warm-up run per side B then A (symmetric), all in the same browser.
- For each metric: the median per configuration and the difference of medians (B − A) with a paired bootstrap 95%
  percentile interval (10,000 resamples; recorded bootstrap seed). Resampling keeps the order strata: each resample
  draws as many AB pairs from the AB blocks and as many BA pairs from the BA blocks as there are.
- **Per-order estimates** (`AB | BA` column): the difference of medians within each order. With no differential
  carry-over they agree; the reviewer's carry-over case gives −6 and −2. Carry-over is shown, not corrected.
- Outcome: `better` if the whole interval is below zero (and below the noise band), `worse` if above, else
  `inconclusive`, which never means "no difference".
- **Verdict rule**: at least 20 complete pairs (plan 3.3: "20 runs for full comparisons" until a pilot sets sample
  sizes); fewer pairs show the interval and are inconclusive by rule.
- **Reliability gates speed**: any failed timed run (not-admitted, incomplete, error, timeout, crash) makes every
  timing survivor-only, labelled *conditional*; when the candidate failed more runs than the baseline, or had more
  runs with late frames (`lateFrames`, `framesOverThreshold` > 0), no metric may be called `better`.
- **Noise bands** (`--noise`): an A-versus-A record is used only if it matches the comparison's workload, parameters,
  settle, pixel ratio, Chrome version, headless/headed, host (name, CPU, cores) and bytes (every file it served is
  byte-identical in one of the comparison's artifacts), with at least 20 complete pairs per metric. A mismatch is an
  error, not a warning. Several bands are united per metric; fewer than three sessions are labelled exploratory.
- **Replay** (`analyze.mjs`): prints the stored analysis by default. `--reanalyze` resolves the recorded bands again
  under the same rules and stops if they cannot be used; `--zero-only` asks for a zero-only analysis explicitly and
  the output says so. The band used is printed per metric.

**Coverage, measured** (`node bench/tools/coverage.mjs`, 2,000 trials per size, 2,000 bootstrap resamples each,
seed 7; run 2026-11-18). The reviewer's discrete distribution: A = 10; B = 5 with probability 0.49, else 11 (true
difference +1, so "better" is wrong).

| Complete pairs | Interval alone: better / worse / inconclusive | Reported (with the 20-pair rule) |
|---|---|---|
| 6 | 21.1% / 1.6% / 77.3% | 0% / 0% / 100% |
| 10 | 8.9% / 3.8% / 87.3% | 0% / 0% / 100% |
| 20 | 5.0% / 2.5% / 92.5% | 5.0% / 2.5% / 92.5% |
| 40 | 2.8% / 2.1% / 95.0% | 2.8% / 2.1% / 95.0% |

So at the plan's sample size the procedure still calls B better 5.0% of the time on this distribution, about twice
the nominal 2.5% for one side of a 95% interval; this is a near-tie of a discrete median, the hard case for any
median-based estimate. Calibrating the inference to the chosen estimand (plan: "set from a pilot") is not done here.

## Two builds and screening (plan 6)

`--adapter <ref> --base <artifact> --candidate <artifact>` runs two immutable builds of the library in one balanced
job: the same adapter, slot A served from the base artifact and slot B from the candidate. It refuses two artifacts
whose harness files (page, adapters) differ, so only the library differs. `--screen --tolerance <t>` applies the
pull-request rule: when the primary metric is `worse` with the lower end of its interval above `t` (the largest
regression tolerated, in the metric's unit), the job is rerun once with a new order seed; two in a row flag the
change (exit code 3, `<run id>.screening.json`). Tolerances are to be declared per workload before measuring (plan
5); none are declared yet, so `--tolerance` is required. Not built: the nightly reference-machine confirmation, the
last-release comparison, a CI job.

## History files

`bench/history/<run id>.json` (schema `axylo-bench/2`), written atomically after every run. `status` is
`interrupted` from creation until the analysis is stored, `complete` after, `aborted` when the runner failed or the
served bytes differed from the artifact. Runs have a `phase` (`admission`, `probe`, `warmup`, `timed`) and an
`outcome` (`ok`, `not-admitted`, `incomplete`, `not-available`, `error`, `timeout`, `crash`) with the reason, console
errors, raw CDP deltas, the readback and admission limits, and for streaming every per-sample array and frame
timestamp. `design` holds both seeds; `hashes.slots` the artifact provenance and served-file hashes; `probes` the
untimed probe summaries (theme counters, frames to new color).

## Limits

- Headless Chrome on this machine uses SwiftShader for WebGL; Canvas 2D and SVG raster differ from a headed browser
  with a GPU. `--headed` exists. One machine, one browser; no Firefox, WebKit, Edge, throttled or phone profile.
- The machine is not idle (other agents and builds run); the load average is recorded, not gated.
- No traces: presentation time, GPU and raster time, Long Animation Frames are not measured; P3 and P4 are frame
  callback times.
- Readiness comes from each library's hooks; screenshot validation is not implemented.
- Not built from the plan: rows vs typed columns, irregular x, the mixed page, W-replace, W-keys, W-busy, the other
  chart types of W-types, W-load, peak memory during a replacement, the CI job and the history page.

## Observed in this revision (smoke runs, machine under load; not evidence)

- At the current library source, the hover readout on a 10,000-point Axylo chart showed 4 distinct data over 40
  moves (indices 407, 2826, 5244, 7662): it does not follow the pointer datum by datum, so W-hover does not admit
  Axylo yet. uPlot is admitted. Library behaviour, not changed here.
- At 230×115 tiles Axylo drew no marks (L8 fallback), and the M1 dashboard records drew none either (above).
