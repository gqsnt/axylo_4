# Axylo landscape research

Evidence behind [docs/01-landscape.md](../docs/01-landscape.md). Collected 2026-11-17, with probes added and rerun on 2026-11-18 after review ([ledger](../reviews/2026-11-18/ledger.md)).

## adoption/

| File | What it is | How to refresh |
|---|---|---|
| `adoption.json` | npm weekly and yearly downloads, registry metadata, jsDelivr monthly hits and GitHub stars for about fifty charting packages | `node fetch.mjs > adoption.json && node refill.mjs` |
| `httparchive.json` | Number of origins on which the HTTP Archive crawl detected each charting technology | `node httparchive.mjs > httparchive.json` |
| `cadence.json` | Major-version dates and stable release counts for the ten studied libraries | `node cadence.mjs` |
| `ranks.json` | Each candidate's rank on every adoption channel, and what each channel alone would select | `node ranks.mjs` |

The npm downloads API rate-limits bursts; `refill.mjs` retries the packages that came back empty.

## harness/

One page runs the same tasks through the original ten libraries and Axylo. A probe drives system Chrome through all eleven.

Axylo uses the production ES module from [`tests/dist/.packed/axylo-0.0.0.tgz`](../tests/dist/.packed/axylo-0.0.0.tgz), packed on 2026-11-18 at 21:10:31 UTC. The packing manifest records `sha512-LCn3nSF7J5rmBJmwBZbcAx6J2alUgEDGg6BQ44OmkziEpuzrFCX1qQ3CG9KMqgOAaPvKzh1LtfpRPM/FC2IfFQ==`. `node packed-axylo.mjs` checks that integrity and extracts the package into `vendor/axylo/`. Vite and the size script both resolve `axylo` to that copy.

To refresh from a new tarball, rerun `node packed-axylo.mjs` and record its filename, packing date and integrity here. A coordinator can repack an already-built distribution with `node scripts/pack.mjs --no-build` from the repository root. The harness needs its locked dependencies already installed. Preparing Axylo requires only the local archive.

```bash
cd research/harness
node packed-axylo.mjs
npx vite build
npx vite preview --port 4173 --strictPort   # leave running, then run below in another terminal
```

```bash
cd research/harness
node probe.mjs                              # look, empty, a11y, env, perf
node probe.mjs dates sentinels lightonly    # added after review
LIBS=highcharts-plain,echarts-aria node probe.mjs look a11y
LIBS=noop,chartjs-tuned,echarts-tuned,recharts-tuned,highcharts-tuned,plotly-tuned node probe.mjs perf
node montage.mjs trend bars parts dirty empty kbd dark resize lightonly
node palette.mjs
node spot-checks.mjs
node sizes.mjs
cd ../..
node research/tables.mjs
```

| Path | Contents |
|---|---|
| `src/data.js` | The shared datasets. Every library receives exactly these values. |
| `src/libs/<library>.js(x)` | The least configuration each library needs for each task. Comments mark what was required beyond data. |
| `src/libs/<library>-tuned.js(x)` | The same large-data task in a tuned configuration. These change several options at once, some of them visible to the reader. |
| `packed-axylo.mjs` | Verifies and unpacks the Axylo tarball for both bundle builds. |
| `src/libs/highcharts-plain.js`, `echarts-aria.js` | Each library's accessibility switch in the other position. |
| `src/libs/noop.js` | Draws nothing: the measurement floor. |
| `probe.mjs` | DOM and accessibility-tree capture, keyboard walk, pointer hover in three time zones for instants and for date strings, one bad value at a time, resize, dark scheme, a light-only page on a dark device, motion with and without reduced-motion, timings and browser-reported main-thread time. |
| `results.json` | Probe output, merged across runs. `_runs` lists every invocation since the log was added; results from the first pass predate it. |
| `spot-checks.json` | Small checks the report quotes, including the WebGL renderer, reduced-motion mentions, accessibility switches, and what Axylo exposes after opening its table. |
| `perf.log`, `rerun.log` | Console output of the first and second performance passes. The report uses the second. |
| `shots/` | Screenshots; `_sheet-*.png` are the side-by-side sheets. |
| `palette.json`, `sizes.json` | Default palette scores and bundle sizes. |

Open one case by hand at `http://localhost:4173/?lib=axylo&task=trend`. Tasks are `trend`, `dates`, `bars`, `parts`, `dirty`, `dirty-null`, `dirty-nan`, `dirty-string`, `dirty-undefined`, `empty`, `scale&n=100000`, `stream`. Add `&scheme=light` for a light-only page. Axylo simplifies dense lines by default and has no public rendering option for a tuned run. Its adapter uses the fixture's existing arrays in the documented column format.

## palette/

`node search.mjs` searches for 6- and 8-color categorical palettes that reach 3:1 contrast on light and dark backgrounds while staying apart under simulated color-vision deficiencies. `feasibility.json` holds the result. It shows which thresholds are reachable; it is not Axylo's palette.

## tables.mjs

`node tables.mjs` prints the Markdown tables in the landscape report from the JSON files above.

### Reading the timings

Timings are from headless Chrome on one desktop machine, three runs each, and are for ranking by order of magnitude. The report uses main-thread task time as the browser reports it (through the DevTools protocol), which counts work however a library schedules it but not rasterization on other threads. The older "time to second frame" figure is still recorded as `toPaintMs`; it cannot resolve below about 35 ms and stops counting before entry animations finish. The streaming producer sends one update per animation frame, so it is not an independent 60 Hz feed. WebGL ran on a software rasterizer. The performance plan replaces all of this with a stricter method ([docs/04-plan-performance.md](../docs/04-plan-performance.md)).
