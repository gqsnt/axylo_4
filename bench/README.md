# Benchmark harness

The measurement method of [docs/04-plan-performance.md](../docs/04-plan-performance.md), sections 2, 3 and 6, for the
budgets P1–P8 in [docs/02-product-spec.md](../docs/02-product-spec.md) section 5. It runs the same workload through
Axylo and comparison libraries in system Chrome. It accepts a timing only for a chart that was checked to show the
right data and to have drawn it, and it compares two configurations (or two builds) in randomized, balanced blocks.

Revised twice on 2026-11-18 after cross-provider reviews (`reviews/2026-11-18/impl/wp/bench.review.md`, then
`misc-opus.review.md` part A). The second pass implements plan section 5.1 as the decision procedure
(`src/decision.js`, `decision.mjs`). Records written before (schema `axylo-bench/1`, the M1 session) keep their
stored analysis; they cannot serve as noise bands or endpoint results (no served files or host).

Axylo 1.0 draws marks only with SVG ([decision 0002](../docs/decisions/0002-mark-renderer.md)).
Canvas comparisons below describe historical artifacts. Use the original sealed artifact when
replaying the 2026-11-21 decision or running the Canvas adapter. New artifacts contain only
the default Axylo and fixed SVG adapters.

## Commands

```bash
node --test bench/test/*.test.mjs                                   # pure tests (Node only, no browser; builds one artifact), seconds
node --test --test-concurrency=1 bench/test/browser/*.test.mjs      # browser tests: fresh production rebuild, system Chrome, ~2 min
node bench/tools/coverage.mjs [--level 0.99444]                     # coverage check of the verdict procedure
node bench/tools/canvas-cost.mjs                                    # marginal gzip size of the Canvas renderer (rule 3)

# the renderer decision (plan 5.1): see "Renderer decision" below
node bench/decision.mjs plan

node bench/build.mjs                                  # one sealed artifact in bench/artifacts/<id>/ (run.mjs does this itself)

# a declared endpoint's pinned recipe (workload and parameters from src/decision.js; Canvas against SVG by default)
node bench/run.mjs --endpoint P1            # also P2-100k, P2-1M, P3-task, P5, P8, scatter-50k, line-10x100k, zoom-100k
node bench/run.mjs --endpoint P4 --baseline uplot --candidate axylo        # budget paths: `axylo` = the public default
node bench/run.mjs --endpoint P7-lifecycle --aa axylo
node bench/run.mjs --endpoint gpu-dpr2-P1 --gpu            # GPU rasterization (headless, --enable-gpu --use-angle=gl --ignore-gpu-blocklist)
node bench/run.mjs --endpoint gpu-resize-24 --gpu --headed # GPU on the desktop (DISPLAY :0)
# any workload by hand; 20 blocks by default (10 AB + 10 BA); --isolate = a fresh browser process per run
node bench/run.mjs --baseline axylo-canvas --candidate axylo-svg --workload first --size 1x100000

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
artifact), `--source <checkout>` (build the library from another checkout), `--endpoint <id>`, `--isolate`, `--gpu`.

**GPU mode** (`--gpu`): headless Chrome with `--enable-gpu --use-angle=gl --ignore-gpu-blocklist`, or with
`--headed` the desktop browser. Every session records `environment.raster`: the WebGL unmasked renderer, Chrome's
feature status for 2D canvas, rasterization and GPU compositing (CDP `SystemInfo.getInfo`, the data behind
`chrome://gpu`), the GPU devices and GL strings, and the flags. The label is "gpu" only with a hardware WebGL renderer
and accelerated 2D canvas and rasterization; a `--gpu` session that comes out software (SwiftShader) is refused, and a
run whose own page reports SwiftShader is an error. The raster mode is part of the environment key: GPU and software
sessions never serve the same decision family. On this machine: software (default) reports SwiftShader; `--gpu`
reports "ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 2060 SUPER/PCIe/SSE2, OpenGL ES 3.2)". `bench/results/m1-session.sh` is the
historical M1 session script; it uses options this runner no longer has.

## Renderer decision (plan 5.1)

`src/decision.js` holds the declared endpoints as data and the decision as pure functions; `decision.mjs` runs the
jobs and applies them. Endpoints (B − A = SVG − Canvas, lower is better):

| Endpoint | Workload, parameters | Metric | Worthwhile / tolerated | Everyday |
|---|---|---|---|---|
| P1 | `first`, `trend` | task time | 1 / 0.5 ms | yes |
| P2-100k | `first`, 1×100,000 | task time | 6 / 3 ms | |
| P3-task | `stream`, 600 + 300 | task time per update (per run) | 0.2 / 0.1 ms | P3 |
| P3-late | same job | runs with an interval later than 25 ms | fewer / no more runs | P3 |
| P5 | `page`, 24 × `trend`, 340×200 | task time | 20 / 10 ms | yes |
| P8 | `compact`, 40 × 160×48 | task time | 8 / 4 ms | yes |
| scatter-50k | `scatter`, 50,000 uniform | first draw (create → first frame after ready) | 10% / 5% of the slower pilot median | |
| line-10x100k | `first`, 10×100,000 | task time | same | |
| zoom-100k | `zoom`, 1×100,000 | task time per step | same | |

Second family, **gpu** (`--family gpu`; GPU sessions only; eight endpoints at 99.375%; same rules): the workloads
decision 0002 left open because they depend on raster. gpu-resize-100k (task time, pilot thresholds) with
gpu-resize-100k-late (runs with a frame interval over the threshold), gpu-resize-24 (24 stacked charts), gpu-dpr2-P1
(1 / 0.5 ms), gpu-dpr2-P2-100k (6 / 3 ms), gpu-dpr2-P5 (20 / 10 ms), and the DPR 2 dashboard's renderer and GPU
process memory (PSS, chart minus data; pilot thresholds). Interpretation: its everyday workloads are DPR 2 P1, DPR 2
P5 and the two resizes (a resize won only with its task-time win and no more late runs).

Budget endpoints outside both families: P2-1M (25 / 12.5 ms), P4 (1.7 / 0.8 ms, nearest-rank p95), P7-mem
(10% / 5% of two 1,000,000-value columns), P7-lifecycle (heap growth over 1% between cycles 1,500–2,000 and
2,000–2,500 fails).

On 2026-11-21 the owner dropped the idle-machine rule, saying “pc under 10% usage is like not really used. stop
with your crazy rules.” One-minute load is recorded at every block start and carried into the decision results for
context only. The owner accepted the 2026-11-21 run as release evidence, saying “count it as release evvidence”.

How one endpoint becomes a result (`assessEndpoint`), in order; anything but "measured" leaves the decision open:
1. **missing**: no comparison record. **ineligible**: the session is incomplete, it recorded anything other than one
   Chrome version, or its environment (host, Chrome, headless, DPR, settle, artifact) differs from the family's
   (pinned to the first endpoint record).
2. Not admitted, or any timed run not finished or not admitted: a **failure of that renderer** on that endpoint,
   which counts as worse beyond tolerance (a result, not a missing value).
3. **thresholds**: a budget-less endpoint whose thresholds were not frozen by the pilot before the comparison started.
4. **no-control**: fewer than three eligible A-versus-A sessions of *each* renderer, same workload, parameters,
   environment and bytes, each with at least 20 complete pairs for this metric (counted per metric).
5. The interval is computed at 99.44% (Bonferroni for nine endpoints). Thresholds are floored at the noise edge
   (largest |end| over the qualifying control intervals at the same level); an edge at or above the tolerance makes
   the endpoint **too noisy to gate**: it counts for neither side. **exploratory**: fewer than 20 complete pairs.
6. **carry-over**: the AB and BA estimates differ by more than the noise edge; withheld (rerun with `--isolate`).
7. Classification (`classifyEndpoint`): better / worse beyond the worthwhile margin, worse beyond tolerance, or no
   worthwhile difference, else inconclusive. Twenty identical pairs at 10.0 against 9.7 ms on P1 are "no worthwhile
   difference".

The rule (`decideRenderer`): any primary endpoint missing, withheld or inconclusive → **no decision yet** with the
list. Rule 1: a renderer worse beyond tolerance somewhere and better by the worthwhile margin nowhere loses. Rule 2:
both win somewhere → the default is the one winning more of P1, P3, P5, P8 (P3 is won only with the task-time win and
no more late runs; more late runs lose it); the other is **kept for the chart type** of an endpoint where its gain's
lower bound is at least 4× the worthwhile threshold. Rule 3 (nothing separates them, or equal everyday counts): SVG
stays; Canvas leaves the 1.0 bundle only if its marginal size (`tools/canvas-cost.mjs`) exceeds 512 B gzipped.

Interpretations where 5.1 is not explicit (flagged in the report to the owner): "too noisy" means the noise edge
reaches the *tolerance*; the noise edge comes from both renderers' controls at the family level; an inconclusive
primary endpoint blocks a decision (section 5: "triggers a rerun, not a pass"); two losers under rule 1 give no
decision (the plan has no rule); P3-late compares counts of late runs directly, with no interval; a kept second
renderer needs the 4× gain on a measured interval, not on a count; the control sessions are separate A-versus-A
jobs in the same environment, not part of the comparison job.

Command sequence per family (`node bench/decision.mjs plan` prints both with estimated
durations: about 3.2 h for "renderer" and 2.2 h for "gpu"; the gpu family adds `--family gpu` to every step):

```bash
node bench/build.mjs                                     # artifact <A>; the whole family uses it
node bench/decision.mjs controls --artifact <A>          # three times, as separate sessions (~51 min each)
node bench/decision.mjs pilot --artifact <A>             # ~14 min: freezes thresholds, checks AB/BA agreement
node bench/decision.mjs endpoints --artifact <A>         # ~25-31 min: --isolate where the pilot found order effects
node bench/decision.mjs decide --artifact <A>            # writes bench/decision/decision-<time>.json
```

### Replay the 2026-11-21 decisions

Run from the repository root. `--dir` selects the saved `ledger.json`, `pilot.json` for `renderer`, and
`pilot-gpu.json` for `gpu`. Replay reads raw jobs from `bench/history`, recomputes their eligibility, and writes new
decision files beside the old ones. The earlier decisions record a 2,269-byte gzip cost for Canvas on this artifact.

```bash
A=bench/artifacts/20261119T091624Z-b643862f-b78698
D=bench/decision/no-idle-2026-11-21
node bench/decision.mjs decide --family renderer --artifact "$A" --dir "$D" --history-dir bench/history --canvas-bytes 2269
node bench/decision.mjs decide --family gpu --artifact "$A" --dir "$D" --history-dir bench/history --canvas-bytes 2269
```

### Measure the remaining budgets on the same artifact

Run from the repository root. `axylo` uses the artifact's public default options. The runner defaults to 20 blocks.

```bash
A=bench/artifacts/20261119T091624Z-b643862f-b78698
node bench/run.mjs --endpoint P2-1M --artifact "$A" --baseline uplot --candidate axylo
node bench/run.mjs --endpoint P4 --artifact "$A" --baseline uplot --candidate axylo
node bench/run.mjs --endpoint P7-mem --artifact "$A" --aa axylo
node bench/run.mjs --endpoint P7-lifecycle --artifact "$A" --aa axylo
```

Use the Axylo candidate numbers for P2-1M and P4. Judge Axylo's absolute results against the product budgets.
[Product spec §5](../docs/02-product-spec.md#5-performance-budgets)

| Endpoint | Budget check |
|---|---|
| P2-1M | Axylo's median `taskMs` over 20 runs must be at most 250 ms. |
| P4 | Take the median of Axylo's per-run `inputToReadoutP95Ms` and compare to one frame (16.7 ms at 60 Hz). Each run uses the nearest-rank p95 over 200 moves, with misses counted as infinite. |
| P7-mem | Compare `ownedBytes` to 1.1 × the two caller columns. Two million Float64 values take 16,000,000 bytes, so the cap is 17,600,000 bytes (`ownedRatio` ≤ 1.1). |
| P7-lifecycle | The spec requires no upward heap trend after forced collection over 1,000 create–destroy cycles. The plan's per-run `heapGate` fails if median heap at cycles 2,000–2,500 is more than 1% above cycles 1,500–2,000. Review the checkpoints through 1,000 cycles, `heapSlopeBytesPerCycle`, and listener, node and observer deltas alongside that gate. |

## Provenance: sealed artifacts

`build.mjs` writes one artifact per session into its own directory and never rebuilds one in place:

- the page and one ESM bundle per adapter (esbuild), and Axylo's script-tag builds compiled **from source** with the
  library's own recipe (`PRODUCTION`/`DEVELOPMENT` defines and `stylesheetPlugin` from the checkout's
  `scripts/build.mjs`, the stylesheet evaluated and minified from the snapshot), each with an external source map:
  `axylo/axylo.iife.min.js`, the **release** copy (shipped recipe, `__BENCH__` false, no hook) for the byte check,
  size and sanity runs (adapter `build=release`); `axylo/axylo.bench.iife.min.js`, the **instrumented** production
  build (`__BENCH__` true, hook attached when `globalThis.__AXYLO_BENCH__` is true) for every workload (default
  `build=prod`); `axylo/axylo.iife.js`, development (`build=dev`, profiles). The build checks that the release copy
  is byte-identical to the recipe without a map (`source.shippedOptions`) and compares it with the checkout's
  `packages/axylo/dist` (`source.distComparison`); `source.recipe` records the defines. Each run records the bundle it
  loaded (`result.adapter.bundle`), and endpoint results accept only the instrumented build;
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
| `src/decision.js` | Declared endpoints, eligibility, controls, the plan 5.1 decision rule (pure) |
| `decision.mjs` | Runs controls, pilot and endpoints; writes the decision (`bench/decision/`) |
| `tools/canvas-cost.mjs` | Marginal gzip size of the Canvas renderer from matched builds |
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
- `hoverGeometry()` (plot rectangle in client px and committed x domain), `hoveredIndex()` (the datum the chart's
  hover state committed), `readoutShows(i)` (exact text of datum i's value in the visible readout): W-hover.
- `memory()`: bytes the library counts in its own buffers (P7); Axylo needs `__bench.memory()` for it.
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
| Marks | one path per series; Canvas 2D or SVG (`__renderer` in the fixed adapters; the public default, SVG today, in the generic `axylo` adapter); simplification per pixel column and run | one path per series, Canvas 2D; nulls break the line, clipped at whole device pixels (sub-pixel gaps are not visible as breaks) | line plus a point marker on every point, Canvas 2D | line, no point markers; min-max decimation above 4× the canvas width, which skips missing values (draws across gaps: not admitted on gappy data); every point carries its source index `i` for the readback (one extra property per point, inside the timed work) |
| Pointer | reads the pointer in CSS px; tooltip anchored to the datum, pointer-transparent; plots under 240×140 use a readout strip | cursor at whole pixels | tooltip on a hit marker | nearest decimated point: on 10,000 points it commits a neighbour of the datum under the pointer on some moves (not admitted for W-hover) |
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
| `scatter` | renderer decision | One scatter of 10,000 / 50,000 / 200,000 points (`--size 1xN`); `--clustered`: five clusters in x and y | one 800×400 |
| `stream` | P3 | A 600-point window; 300 samples from a producer on an independent 60 Hz clock | one 800×400 |
| `hover` | P4 | 200 real pointer moves (CDP Input) to known data across a 100,000-point chart, at whole client pixels | one 800×400 |
| `zoom` | renderer decision | 60 calls to the public zoom: 20 in, 20 out, 20 pan steps, ending on a known window | one 800×400 |
| `theme` | – | 20 toggles of a class-based dark theme on `<html>` | one 800×400 |
| `resize` | – | 1,200 → 400 → 1,200 px in a fixed sequence of 123 widths, one per frame | 1,200×400, or 24 stacked in one column, 200 px tall (every chart stays above Axylo's 240×140 layout switch) |
| `mem` | P7 | Create one chart of 1,000,000 points; memory after forced collection | one 800×400 |
| `lifecycle` | P7 | 2,500 create–destroy cycles of `trend` after 20 warm-up cycles; heap every 100 cycles over 1,500–2,500 | one 800×400 |

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
discarded and, for the decision, it is a failure of that configuration. The checks:

- **held**: the visible x range contains the expected range and is not wider than it plus 10% per side (25% for a
  scatter's number axis; exactly the requested window, to the millisecond, for a zoomed view); the visible y range
  contains the data's y extent in that window and the extreme, and is at most 4× the data's scale; per series the
  points held, the oldest and newest x to the millisecond, and the number of missing values (**required**); the page
  built the same data as the runner (FNV-1a checksum).
- **drawn, index paths** (uPlot; Chart.js through decimation, by the source index each point carries; Axylo when the
  library reports run starts): rejected for two retained neighbours joined across a missing value, a drawn point at a
  missing value, drawn indices that do not cover the visible window, drawn extremes that are not the data's.
- **drawn, kept indexes** (Axylo's `__bench.describe().series[i].kept`, in probe and timed runs): in range, in order,
  none at a missing value, covering the window, the data's extremes kept. A flat kept list cannot say whether two kept
  indexes either side of a gap are joined, so gap topology comes from the strokes (next) in the probe run.
- **drawn, strokes** (Axylo, probe runs): the polylines stroked (SVG path data; Canvas moveTo/lineTo on the scene
  canvas), mapped through the plot clip rectangle and the committed domains. Each series gets its own stroke (one
  stroke cannot stand for two series), through its first and last visible points; its extreme vertices within
  1.5 px of the data's extremes; no continuous pen-down path across a missing stretch at least 2 px wide, however many
  segments it uses.
- **drawn, scatter points** (Axylo, probe runs): the marker centres (SVG circle paths, Canvas `arc` calls): one per
  point, spanning the mapped data extremes in x and y, and a marker at the injected extreme. An empty shell fails.
- **renderer**: the committed chart's mark elements, and the library's own report, must be the renderer the adapter
  named; when the two disagree the kind is `inconsistent`.
- **stream**: a sample never received or never acknowledged, the watchdog fired, or a frame log without a frame at or
  before the first due time and 300 intervals after it: outcome `incomplete`, a failure.
- **theme** (probe): a fresh reference chart is drawn in each scheme first; after every toggle every series mark of the
  toggled chart must show the reference color of the scheme now set, and the color the library assigns. A chart frozen
  in either scheme fails on the next toggle. Frames until the new colors show: 4 further untimed toggles. Canvas 2D
  calls and DOM mutations: a separate untimed `counters` run. Timed theme runs do neither.
- **resize**: final geometry in every run; in the probe run, at the narrowest width, the outer geometry and the full
  readback (strokes, renderer, ranges) admitted like the final one.
- **hover**: every move's pointermove arrives; the committed datum is the one under the pointer (within half a device
  pixel); the readout shows exactly its value; misses beyond 5% fail the run (its p95 is a missed deadline).
- **compact** (P8): no text labels or controls, an element with `role="img"`, an accessible name and a description,
  no tab stop.

Not done: screenshots against untimed references (plan 3.1), gap topology below 2 px for Axylo without run starts.

## Metrics

All "lower is better". Each run is summarized to one number per metric before any comparison.

**Main-thread task time** (`taskMs`, primary for create workloads): the change in CDP `TaskDuration` from just
before the create call until a fixed settle window (500 ms) after every chart reported ready. It counts main-thread
work wherever it is scheduled; not GPU-process or raster-thread work. The window includes adapter conversion and the
harness's own constant (the `noop` floor shows it); fixture generation, adapter loading and the readback are outside.

**P3** (`stream`): `taskMsPerUpdate` = TaskDuration from the producer's start until the frame callback in which the
chart acknowledged the last sample, divided by the 300 samples, one number per run; the comparison and the budget
take the median of those per-run numbers (plan 3.1 and 5.1; the spec's P3 "median" read the same way). The window
includes dispatch, append, the chart's work and the harness's tracking. `lateFrames` = frame intervals later than
**25 ms (fixed)** among exactly 300 consecutive intervals starting with the one that holds the first sample's due
time; the pacing loop starts before the start mark and runs past the last sample, and a log without a frame at or
before the first due time fails the run. `lateRun` (0 or 1) feeds the P3-late endpoint. Per sequence number
`ackDelay*`: scheduled time to the frame callback in which the chart **acknowledged** a revision including it (its
`ready()`), which is not a presented frame (no trace); a coalesced revision acknowledges several sequences at once.

**Frame intervals** (`resize`, `zoom`): every interval that overlaps the window, including those that start before
it or end after it.

**P4** (`hover`): per move, `pointermove` `event.timeStamp` to the first animation-frame callback in which the chart's
committed hover datum is the target (the datum under the pointer at the event's clientX) and the visible readout shows
its value exactly; the **nearest-rank** 95th percentile over the 200 moves, with every miss kept as +Infinity
(`inputToReadoutP95Ms`); `missedMoves`. Each move has its own waiter, so a callback left over after a timeout cannot
release the next move. Frame callback, not presentation (no trace).

**P7** (`mem`): the instrumented production build's `__bench.memory()` returns `{ bytes, buffers: [{ name, bytes }] }`.
It counts Axylo-owned typed-buffer storage in the store, retained frames and displayed scene marks, with a breakdown
by name. The count excludes the caller's typed columns and canvas backing stores. The harness records the total as
`ownedBytes`.
Reported separately and never added: isolate JS heap after forced GC (chart minus data), isolate backing storage
(ArrayBuffers and external strings), renderer PSS, calculated canvas bytes. (`lifecycle`): `heapGrowth` = median heap
after forced GC over checkpoints at cycles 2,000–2,500 divided by the median over 1,500–2,000, minus 1; above 1% the
gate fails (`heapGate`). Also the slope over all checkpoints, and from after warm-up to the end the change in JS event
listeners, DOM nodes and live Resize/Mutation/Intersection observers (constructors wrapped in this workload only).
Not built: peak memory during a data replacement.

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
  probe runs A then B, then one untimed warm-up run per side B then A, in the same browser; with `--isolate`, every
  run in a fresh browser process. The one-minute load at the start of every block is recorded for context (`blocks`).
  The record also stores the session's `eligibility` (complete, with one Chrome version).
- For each metric: the median per configuration and the difference of medians (B − A) with a paired bootstrap
  percentile interval (10,000 resamples, recorded bootstrap seed, 95% by default, 99.44% in the decision family),
  keeping the order strata. Per-order estimates (`AB | BA`) are printed; the decision withholds an endpoint whose two
  estimates differ by more than the noise edge.
- A declared endpoint's metric (`--endpoint`) is classified against its thresholds (above); other metrics against
  zero (or a calibrated band), labelled secondary.
- **Verdict rule**: at least 20 complete pairs (plan 3.3).
- **Reliability gates both directions**: a configuration can be shown better than the other only if it had no failed
  run (not admitted, incomplete, error, timeout, crash) and no run with a late frame in the job. Every timing is
  labelled conditional when any run failed.
- **Noise bands** (`--noise`): an A-versus-A record is used only if it is an eligible session of one of the compared
  adapters, with the same workload, parameters, settle, pixel ratio, Chrome, headless/headed, host and bytes. A band
  gates a metric only with three such sessions of at least 20 pairs **for that metric**; otherwise it is shown as
  exploratory and not used.
- **Replay** (`analyze.mjs`): prints the stored analysis by default; `--reanalyze` resolves the recorded bands again
  under the same rules and stops if they cannot be used; `--zero-only` is explicit and labelled.

**Coverage, measured** (`node bench/tools/coverage.mjs`, 2,000 trials per size, 2,000 bootstrap resamples each,
seed 7). The reviewer's discrete distribution: A = 10; B = 5 with probability 0.49, else 11 (true difference +1, so
"better" is wrong). Interval alone, better / worse / inconclusive:

| Complete pairs | 95% | 99.44% (decision family) |
|---|---|---|
| 6 | 21.1% / 1.6% / 77.3% | not run |
| 10 | 8.9% / 3.8% / 87.3% | not run |
| 20 | 5.0% / 2.5% / 92.5% | 1.3% / 0.7% / 98.1% |
| 40 | 2.8% / 2.1% / 95.0% | 0.4% / 0.4% / 99.3% |

Below 20 pairs the rule reports inconclusive. At the plan's sample size the family interval still calls B better 1.3%
of the time on this near-tie of a discrete median, above the nominal 0.28% for one side; in the decision a win must
also clear the worthwhile threshold. Calibrating the inference to the estimand is left to the pilot.

## Two builds and screening (plan 6)

`--adapter <ref> --base <artifact> --candidate <artifact>` runs two immutable builds of the library in one balanced
job: the same adapter, slot A served from the base artifact and slot B from the candidate. It refuses two artifacts
whose harness files (page, adapters) differ, so only the library differs. `--screen --tolerance <t>` applies the
pull-request rule: when the lower end of the primary metric's interval is above `t` (the largest regression
tolerated, in the metric's unit), or the candidate could not be measured (not compared, failed runs, metric not
available: outcome `failed`, never "within tolerance"), the job is rerun once with a new order seed; two in a row
flag the change (exit code 3, `<run id>.screening.json`). Tolerances are to be declared per workload before measuring (plan
5); none are declared yet, so `--tolerance` is required. Not built: the nightly reference-machine confirmation, the
last-release comparison, a CI job.

## History files

`bench/history/<run id>.json` (schema `axylo-bench/2`), written atomically after every run. `status` is
`interrupted` from creation until the analysis is stored, `complete` after, `aborted` when the runner failed or the
served bytes differed from the artifact. Runs have a `phase` (`admission`, `probe`, `warmup`, `timed`) and an
`outcome` (`ok`, `not-admitted`, `incomplete`, `not-available`, `error`, `timeout`, `crash`) with the reason, console
errors, raw CDP deltas, the readback and admission limits, and for streaming every per-sample array and frame
timestamp, and the Chrome version of every run. `design` holds both seeds, `isolate` and `endpoint`; `blocks` the
load at every block start; `eligibility` the session's; `hashes.slots` the artifact provenance and served-file
hashes; `probes` the untimed probe summaries (theme counters, frames to new color). The decision writes
`bench/decision/ledger.json` (which job is which), `pilot.json` (frozen thresholds, order checks) and
`decision-<time>.json`.

## Limits

- Headless Chrome on this machine uses SwiftShader for WebGL; Canvas 2D and SVG raster differ from a headed browser
  with a GPU. `--headed` exists. One machine, one browser; no Firefox, WebKit, Edge, throttled or phone profile.
- No traces: presentation time, GPU and raster time, Long Animation Frames are not measured; P3 and P4 are frame
  callback times.
- Readiness comes from each library's hooks; screenshot validation is not implemented.
- Not built from the plan: rows vs typed columns, irregular x, the mixed page, W-replace, W-keys, W-busy, the other
  chart types of W-types, W-load, peak memory during a replacement, the CI job and the history page.

## What the harness needs from the library

- **Run starts in the kept selection**: `__bench.describe().series[i].breaks`, the offsets into `kept` at which a new
  run starts (the `breaks` of `simplifyLine`'s `JoinedRuns`, which the hook already computes), and `isolated` if those
  are drawn as markers. With them the adapter checks gap topology index-exactly in every run (it already reads
  `breaks` when present).
- **Plot rectangle**: `__bench.describe().plot`, `{ x, y, width, height }` in CSS px of the plot container, so W-hover
  can place the pointer on the Canvas renderer too (today only the SVG clip rectangle gives it; Canvas reports "not
  available" for W-hover).
- **Stream rows**: the kept indexes of a streaming chart refer to rows of individual `append` calls; a window-relative
  index (or the x of each kept slot) would let the stream be checked like a static chart. The adapter will use
  `series[i].keptBasis === 'window'` when present (until then the stream's kept list is not used).

These land in `Probe` / `attachHooks` (`packages/axylo/src/core/instrument.ts`). The adapter uses each when present
(`breaks`, `plot`, `keptBasis`) and reports "not available" otherwise.

## Observed in this revision (smoke runs, machine under load; not evidence)

- Load average was 5–10 during these smoke runs.
- P4 at the current source, public default (SVG): admitted with exact datum and readout on 1×100,000 (the earlier
  4-distinct-readouts behaviour is gone). uPlot admitted. Chart.js tuned committed a neighbour of the datum under the
  pointer on 1–2 of 40 moves (decimated tooltip): not admitted.
- 24-chart resize (one column, 1,200 × 200 px tiles at the end): both Axylo renderers drew the series with a y mapping
  that matches a domain of about [50, 200] while `__bench.describe()` reported [80, 180] (marks up to ~13 px off), so
  the probe rejects it. Single-chart resize is admitted. Library behaviour, to be looked at in the core.
- Marginal Canvas renderer size at the current source: 2,186 B gzip (6,250 B minified, 1,758 B brotli), from matched
  production builds; a byte count, not a timing.
- At 230×115 tiles Axylo drew no marks (L8 fallback), and the M1 dashboard records drew none either.
