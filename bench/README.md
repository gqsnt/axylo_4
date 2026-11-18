# Benchmark harness (M0)

The measurement method of [docs/04-plan-performance.md](../docs/04-plan-performance.md), sections 2, 3 and 6, in a
first version. It runs the same workload through Axylo and comparison libraries in system Chrome. It accepts a timing
only for a chart that has been checked to show the right data, and it compares two configurations in randomized,
balanced blocks.

## Build and run

```bash
node bench/build.mjs                       # bundles the page and the adapters into bench/dist (esbuild)
node --test bench/test/*.test.mjs          # statistics, admission (with deliberately broken adapters), outcomes

# baseline A against candidate B, 6 blocks (3 AB + 3 BA in random order), a fresh browser context per run
node bench/run.mjs --baseline uplot --candidate chartjs-tuned --workload first --size 1x100000 --blocks 6
node bench/run.mjs --baseline noop  --candidate uplot --workload stream --blocks 6
node bench/run.mjs --baseline uplot --candidate chartjs-tuned --workload page --blocks 6

# A-versus-A: the same adapter in both slots builds the noise band for that workload
node bench/run.mjs --aa uplot --workload first --size 1x100000 --blocks 8
# use that band when classifying a comparison on the same workload
node bench/run.mjs --baseline uplot --candidate chartjs-tuned --workload first --size 1x100000 --blocks 6 --noise <aa run id>

node bench/analyze.mjs <run id> [--noise <aa run id>]    # re-print or re-classify a history record
```

`run.mjs` rebuilds `bench/dist` first unless `--no-build` is given. Options: `--size SxN` (first, page), `--gaps`
(5% missing in runs), `--charts` (page, default 24), `--window`/`--samples` (stream, default 600/300),
`--blocks` (even, default 6), `--settle` ms (default 500), `--timeout` ms per run (default 120000), `--seed`
(block order), `--dpr` (1 or 2), `--headed`, `--history-dir`. Scripts in `bench/package.json` wrap the same commands.

The runner serves `bench/dist` and `packages/axylo/dist` from an HTTP server on 127.0.0.1 that lives only for the
runner process. It uses `playwright-core` and `esbuild` from the repository root and system Chrome
(`channel: 'chrome'`). Nothing is downloaded.

## Pieces

| File | Role |
|---|---|
| `src/page.html`, `src/page.js` | The one benchmark page. `?adapter=…&workload=…&params={…}&settle=…` |
| `src/fixtures.js` | Seeded, deterministic data (pure; the runner builds the same data in Node and compares a checksum) |
| `src/admission.js` | The admission check (pure) |
| `src/stats.js` | Per-run summaries, balanced order, paired bootstrap, the three outcomes (pure) |
| `src/adapters/*.js` | `noop`, `uplot`, `chartjs`, `chartjs-tuned`, `axylo` |
| `test/adapters/*.js` | Deliberately broken adapters, used by the tests only |
| `lib/driver.mjs` | Server, browser, one run in a fresh context, machine record |
| `run.mjs`, `analyze.mjs` | Runner and re-analysis |
| `history/<run id>.json` | One file per runner invocation (see below) |

### Adapter interface

An adapter module's default export has `id`, `library`, `version`, `config`, `available()` (returns
`{ ok }` or `{ ok: false, reason }`), an optional `setup()` (run before the clock starts, for example to add CSS) and
`create(container, { x, ys, names }, { window })`. `x` is a `Float64Array` of epoch milliseconds, `ys` one
`Float64Array` per series with `NaN` for a missing value. `create` returns a handle with:

- `ready`: a promise that resolves when the library itself reports that it has drawn the data (uPlot: its `draw`
  hook; Chart.js: `afterRender` once no animation is running). The harness never guesses readiness from frames.
- `append(x, ys)`: add one point per series and drop the oldest (streaming window).
- `drawnNewestX()`: the newest x in the chart's state at its last draw, recorded from the library's own draw hook.
- `describe()`: what the chart shows, read from the library's own scale and data objects (each adapter says exactly
  what it reads in a comment): visible x range, visible y range, and per series the number of points held, oldest and
  newest x, and the number of missing values.
- `destroy()`.

Converting the typed columns into what the library accepts (plain arrays, `{x, y}` objects, `null` for gaps) happens
inside `create`, so it is part of the timed work for every library: the input is the same for all of them.

### Adapters in this milestone

- `noop`: the measurement floor. Same calls, draws nothing. Its numbers are the harness, the page and the browser.
- `uplot`: default configuration. Only the options uPlot needs to draw at all are set (size, stroke colours, `ms: 1`
  for millisecond timestamps); see the comment in the file.
- `chartjs`: starter default (labels + data arrays, a time x axis, everything else default, animation included).
- `chartjs-tuned`: the documented performance options that keep axes, legend and tooltip. Every option that differs,
  with its reason and documentation page, is listed at the top of the file, including the visible differences
  (no entry animation, no point markers) and one fidelity risk (min-max decimation skips `NaN`, so above its
  threshold a gap can be drawn across; the admission check reads the held data and does not catch this).
- `axylo`: loads `packages/axylo/dist/axylo.iife.js` as a classic script. While it does not export `line()`, the run is
  recorded as `not-available` with that reason. When `line()` exists the adapter still reports `not-admitted` until
  the benchmark readiness/readback hook (plan 3.1) exists, rather than guessing readiness.

## Workloads

| Workload | What runs | Containers |
|---|---|---|
| `first` | Create one line chart from typed columns. Sizes `3x120`, `1x10000`, `1x100000`, `1x1000000` (any `SxN` works). `--gaps`: 5% of each series missing, in runs | one 800×400 |
| `page` | Create 24 charts of 3×120 at once (each its own seed) | 24 of 230×115 in a 6×4 grid |
| `stream` | A 600-point window; then 300 samples from a producer on an independent 60 Hz clock | one 800×400 |

Containers are 2:1 because that is Chart.js's default aspect ratio, so its starter config fills them like the others.
The viewport is 1,440×900, device pixel ratio 1 unless `--dpr 2`. Points are a day apart up to 1,000 points and a
minute apart above. Series are seeded random walks. One extreme value is injected into series 0 (at 37% of the x
range; for streaming into a sample that stays in the final window), so a chart that clips or pins its y range fails
admission. Gaps never touch the first or last point or the extreme.

The streaming producer is a Web Worker with its own timers. Sample *k* is scheduled at `start + k × 16.67 ms`; the
worker posts its sequence number, scheduled time and send time (converted to the page's clock). It does not depend on
the page's main thread or animation frames, so when the page falls behind, samples queue up and show as backlog.

## Admission check

Before an adapter is timed on a workload, the runner does one untimed run and compares `describe()` with facts
derived in Node from the fixture (`src/admission.js`). The same check runs again on every timed run, after its
measurement window. It requires:

- the visible x range contains the data's x extent, and is not wider than that extent plus 10% per side;
- the visible y range contains the data's y extent (and so the injected extreme, which is also checked on its own),
  and its span is at most 4× the larger of the data's y span and its largest |y| (a zero-based axis passes, a
  runaway range does not);
- the number of series, and per series the number of points held (600 for the streaming window), the oldest and
  newest x to the millisecond, and the number of missing values;
- the page built the same data as the runner (FNV-1a checksum of every column).

An adapter that fails the untimed admission run is recorded as `not-admitted` with the reasons and nothing is timed
for that comparison. A timed run that fails is recorded as `not-admitted`, its timing is discarded and it is not
paired. The floor adapter is recorded as admitted with "not applicable".

What the check does not do yet: compare a screenshot with a reference (plan 3.1, sampled runs), check what was drawn
as opposed to what the chart holds (for example a decimated drawing that bridges a gap), or check tooltip text.

## Metrics

All come from one run in a fresh browser context. All are "lower is better".

**Main-thread task time** (`taskMs`, primary for `first` and `page`): the change in Chrome's `TaskDuration`
(CDP `Performance.getMetrics`) from just before the create call until a fixed settle window (500 ms) after the
adapter reported ready. It counts main-thread work wherever the library schedules it (synchronous, microtask, timer,
animation frame, ResizeObserver), including Chart.js's one-second entry animation.
It does not include GPU-process or compositor work, raster on other threads, or anything after the settle window.
It includes a small constant from the harness itself (the two CDP calls, the idle settle window); the `noop` floor
shows how much. It is time spent, not time waited: a chart can be cheap in task time and still appear late.

`scriptMs` and `layoutStyleMs` are `ScriptDuration` and `LayoutDuration + RecalcStyleDuration` in the same window.
They are a breakdown, not a sum that must equal `taskMs`: Chrome attributes some work to other buckets (for example
code that runs inside a DevTools command task is counted under `DevToolsCommandDuration`, which is why the measured
work starts inside a fresh task). `readyMs` is wall-clock time to the ready signal and `readyFrameMs` to the next
animation frame after it; neither is validated against a screenshot yet, and `readyFrameMs` mostly reflects where in
the frame the ready signal fell.

**Streaming** (primary: `taskMsPerUpdate`): `TaskDuration` from just before the producer starts until the frame in
which the last sample became visible, divided by the number of samples. Also per run:

- `delayP50Ms`, `delayP95Ms`, `delayMaxMs`: per sequence number, the time from the sample's scheduled production
  time to the animation-frame callback in which the chart's own draw record includes it. The callback that reads
  the record is registered after the append that needed it, so it runs after any frame callback the library itself
  registered for that append. This is the frame in which the chart's state includes the sample, not the moment the
  pixels reached the screen (presentation time needs a trace, not done yet). Because the producer and the display
  are two independent 60 Hz clocks, the median delay of a run carries a phase offset between 0 and one frame that
  differs from run to run; compare it across runs, not within one.
- `maxBacklog`: the most samples whose scheduled time had passed at the start of a frame but which were not shown
  after that frame.
- `coalesced`: samples first shown in the same frame as a later sample (they were never on screen as the newest).
  The producer runs at 60.00 Hz and this display at about 59.9 Hz, so when a run's phase sits near a frame boundary
  samples alternate between frames and 30–40 coalesced samples with a backlog of 1 appear even for a cheap chart
  (seen for uPlot and tuned Chart.js in the first session). Small backlog and coalescing counts are therefore mostly
  clock beat; large backlogs, delays of several frames and frames over the threshold are the signal.
- `frameP95Ms`, `frameP99Ms`, `framesOverThreshold`: intervals between animation-frame callbacks during the
  stream, summarized per run; the threshold is 1.5× the refresh interval the page observed (25 ms at 60 Hz).
- `createTaskMs`: task time to create the initial window and settle.
- `neverVisible` (recorded, not compared): samples never shown within 5 s of the last one.

**Environment record**, in every history file: Chrome version and whether it was headless, Playwright and Node
versions, CPU model and logical core count, cpufreq governor, memory, OS, load average at start and end, the WebGL
renderer string, device pixel ratio and the refresh rate the page observed (per run), library versions, lockfile and
bundle hashes, the fixture checksum. Things this harness cannot read say "not available" with the reason (the commit,
when the checkout is not a git repository; power settings).

Where a metric cannot be measured the result says `not available: <reason>`. No other number is put in its place.

## Statistics

- Runs come in blocks of two (AB or BA), as many AB as BA, in a seeded random order recorded in the file.
- Each run is summarized to one number per metric first; frames and samples are never pooled across runs.
- For each metric: the median per configuration, and a paired bootstrap 95% interval (10,000 resamples of whole
  blocks) for median(B) − median(A).
- Outcome, for each metric: `better` if the whole interval is below zero, `worse` if above, otherwise
  `inconclusive`. With `--noise`, the interval must also clear that A-versus-A interval. With fewer than 6 complete
  pairs the interval is shown but the outcome is always `inconclusive`.
- `--aa` puts one adapter in both slots. Its interval is the noise band of that workload for this session and block
  count. The plan asks for bands from at least three sessions; one session is one sample of the band.
- "Inconclusive" never means "no difference".

## History files

`bench/history/<run id>.json`, written atomically after every run. `status` is `interrupted` from the moment the
file is created and becomes `complete` only after the last block has been analysed, so a run cut short by a restart
or a kill stays marked `interrupted` (a signal also records which). `aborted` means the runner itself failed. Each run
record has its `outcome`: `ok`, `not-admitted`, `not-available`, `error`, `timeout` or `crash`, with the reason,
console errors, raw CDP metric deltas, the adapter's readback, and for streaming the per-sample arrays (scheduled,
sent, received, visible, append time) and every frame timestamp. Admission runs are kept with `phase: "admission"`.

## Limits

- Headless Chrome on this machine uses SwiftShader, a software WebGL rasterizer (recorded in every file). Nothing here
  says anything about GPU paths; canvas 2D raster also differs from a headed browser with a GPU. `--headed` exists
  but has not been used for the recorded runs.
- One machine, one browser (Chrome stable). No Firefox, WebKit, Edge, throttled profile or phone yet (plan 3.2).
- The machine was not idle: other agents and builds run on it. The load average is recorded.
- Task time is main-thread only; no GPU or raster time, no traces, no Long Animation Frames, no memory metrics yet.
- Readiness comes from each library's own hooks; screenshot validation of readiness is not implemented.
- Noise bands come from one session.
- Not built yet from the plan: rows vs typed columns, irregular x, 10×100k, the mixed page, W-replace, W-hover, W-keys,
  W-zoom, W-resize, W-busy, W-types, W-load, W-mem, bytes, the CI smoke job, and the documentation history page.
- The Axylo adapter reads `axylo.iife.js`, which `scripts/build.mjs` builds with `__DEV__ = true`; the plan asks for
  production builds, which is `axylo.iife.min.js`. Switch it when Axylo can be measured.
