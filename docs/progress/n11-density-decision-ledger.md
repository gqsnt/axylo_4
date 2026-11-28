# Cycle N11 ledger: high-density sweep and the 1.0 renderer decision

**Date:** `2026-11-28`
**Decision:** **Keep SVG only for 1.0. Do not open an opt-in `axylo/canvas` cycle for 1.0.**
**Inputs:** the post-Wave-4 `P1–P8` scorecard in [`bench/results/budgets-2026-11-28.md`](../../bench/results/budgets-2026-11-28.md) and the N11 density records listed below. Every number here is read from the committed records in `bench/history/20261128T*.json` and from `bench/size-latest.json`.

---

## 1. Artifacts and provenance

| Records | Artifact | Checkout | Browser and raster | Runs |
|---|---|---|---|---|
| `P1–P5`, `P7`, `P8` (nine timed records) | `20261128T081603Z-d3663b77-e14c8a`, clean sealed post-N10a | `d3663b774a2bbfc851935a3069a09f716ea4eddf` | Headless Chrome 158.0.8127.88, software raster (SwiftShader) | 20 complete pairs each |
| `P6` (`bench/size-latest.json`) | Packed tarballs, not a sealed artifact | `354b90ffcaab68fbfd1ee16d7d715d363d863934`, `dirty: true` | Not a browser measurement | Exact bytes |
| `cartesian-100k`, `cartesian-1M zoom` | `20261128T091224Z-cartesian-8b9a21` | `d3663b77` | Headless Chrome 158.0.8127.88, software raster only | 20 pairs; 6 pairs (bounded probe) |
| Density sweep, software | Not named in the record | `d3663b77` | Chrome 158.0.8127.88. The record has no `raster` field; it is the software run by its file name and by its sibling's label | 20 timed runs per case |
| Density sweep, GPU | Not named in the record | `d3663b77` | Chrome 158.0.8127.88, `raster: "gpu"`, WebGL renderer `ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 2060 SUPER/PCIe/SSE2, OpenGL ES 3.2)` | 20 timed runs per case |

The size record measures a dirty working tree at another commit, so it is kept apart from the clean timing artifact. The script that wrote the two density sweep records (`schema: "axylo-n11-density-sweep/1"`) is not in this tree; the metric meanings below are read from the record's field names and are marked as such.

---

## 2. `P1–P8` on SVG only

All ten budget rows pass: the nine timing rows on the clean artifact, and P6 on the separately recorded packed-size measurement of a dirty tree at another commit (section 1). Full table with links: [`budgets-2026-11-28.md`](../../bench/results/budgets-2026-11-28.md).

| Budget | Target | Median | Margin | Record |
|---|---|---|---|---|
| P1 | ≤ 25 ms (1.0 gate, owner decision 2026-11-27; 10 ms stretch) | 19.31 ms (uPlot 7.95 ms) | 5.69 ms | `20261128T081611Z-first-trend-uplot-vs-axylo-970b` |
| P2-100k | ≤ 60 ms | 21.88 ms (uPlot 11.15 ms) | 38.12 ms | `20261128T085620Z-first-1x100000-uplot-vs-axylo-7655` |
| P2-1M | ≤ 250 ms | 27.72 ms (uPlot 19.71 ms) | 222.28 ms | `20261128T085736Z-first-1x1000000-uplot-vs-axylo-5427` |
| P3 | ≤ 2 ms/update, 0 late frames | 1.048 / 1.020 ms, 0 of 40 runs late | 0.952 ms | `20261128T085901Z-stream-w600-aa-axylo-4136` |
| P4 | ≤ 16.7 ms | 16.00 ms (uPlot 15.90 ms) | 0.70 ms | `20261128T090345Z-hover-1x100000-uplot-vs-axylo-2faf` |
| P5 | ≤ 200 ms | 49.77 / 48.75 ms | 150.23 ms | `20261128T090728Z-page-trend-x24-aa-axylo-c109` |
| P6 | ≤ 158 KiB all, ≤ 135 KiB line | 159,006 B all, 136,096 B line | 2,786 B, 2,144 B | `bench/size-latest.json` |
| P7-mem | ≤ 17,600,000 B | 23,304 B / 23,304 B | 17,576,696 B | `20261128T090841Z-mem-1x1000000-aa-axylo-4873` |
| P7-lifecycle | ≤ 1% growth | 0.893% / 0.895%, 0 of 40 runs above 1% | 0.105 points | `20261128T081725Z-lifecycle-trend-c2500-aa-axylo-a05e` |
| P8 | ≤ 80 ms | 26.64 / 26.25 ms | 53.36 ms | `20261128T091003Z-compact-trend-x40-aa-axylo-2d65` |

P4 is the tightest row (0.70 ms) and P6 the next (2,144 B on line). Neither points to the renderer: P4 sits within a frame for both libraries (uPlot, a canvas library, measured 15.90 ms in the same runs), and P6 is bundle bytes, which a canvas renderer would add to (inferred, not measured).

---

## 3. High-density sweep: software against GPU

The sweep records name five metrics per case. Read from the field names (the producing script is not in the tree): `syncMs` is the synchronous create call; `readyFrameMs` is wall time to the frame after the chart is ready; hover is the median over runs of each run's p95 pointer-to-frame time; `svgNodes` counts elements inside the chart's SVG elements, `domNodes` all elements in the chart; `pathDBytes` is the total length of the `d` attributes of `<path>` elements. The SVG and DOM node counts, path counts, `<path d>` bytes and diagnostics were identical in all 20 runs of every case, on both rasters.

| Workload | Raster | Sync, median | Ready frame, median / p95 | Hover p95 | SVG nodes | DOM nodes | `<path>` elements | `<path d>` bytes | Diagnostics | Errors | Load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `heatmap-50k` (250 × 200 cells) | Software | 11.55 ms | 34.10 / 35.80 ms | 33.48 ms | 59 | 217 | 32 | 506,140 | none | 0 | 1.44–1.57 |
| | GPU | 12.10 ms | 34.30 / 35.70 ms | 33.49 ms | 59 | 217 | 32 | 506,140 | none | 0 | 1.78–1.79 |
| `bubble-50k` | Software | 20.95 ms | 1,468.15 / 1,497.80 ms | 33.46 ms | 15 | 101 | 4 | 1,579,412 | AX189 | 0 | 1.33–1.97 |
| | GPU | 21.35 ms | 1,464.45 / 1,508.00 ms | 33.51 ms | 15 | 101 | 4 | 1,579,412 | AX189 | 0 | 1.67–1.90 |
| `finance-10k` | Software | 13.95 ms | 36.95 / 39.80 ms | 33.52 ms | 626 | 691 | 6 | 29,507 | none | 0 | 1.82–1.97 |
| | GPU | 14.20 ms | 37.20 / 45.40 ms | 33.48 ms | 626 | 691 | 6 | 29,507 | none | 0 | 1.56–1.70 |
| `finance-50k` | Software | 16.25 ms | 41.55 / 45.30 ms | 33.59 ms | 655 | 718 | 6 | 30,302 | none | 0 | 1.82–2.07 |
| | GPU | 16.25 ms | 42.05 / 55.70 ms | 33.51 ms | 655 | 718 | 6 | 30,302 | none | 0 | 1.52–1.56 |
| `scatter-200k` (bounded probe) | Software | 55.30 ms | 194.10 / 200.40 ms | 87.16 ms | 12 | 91 | 4 | 8,535,101 | AX133 | 0 | 2.07–2.61 |
| | GPU | 55.05 ms | 195.15 / 199.50 ms | 33.52 ms | 12 | 91 | 4 | 8,535,101 | AX133 | 0 | 1.51–1.55 |

Records: software [`20261128T092608Z-n11-density-sweep`](../../bench/history/20261128T092608Z-n11-density-sweep.json), GPU [`20261128T092751Z-n11-density-sweep-gpu`](../../bench/history/20261128T092751Z-n11-density-sweep-gpu.json).

Readings:

- **Heatmap.** 50,000 cells draw as 32 paths (one batched path per color) with 59 SVG nodes. AX186 is not raised, as the source requires: it fires above 50,000 cells (`DENSE_CELLS`, `packages/axylo/src/spatial/heatmap/core.ts`), and this grid is exactly 50,000.
- **Finance.** Five times the candles add 29 SVG nodes, 795 `<path d>` bytes and 4.6 ms of ready-frame time on software raster: the adaptive candle bucketing keeps the drawing flat.
- **Scatter.** 200,000 points draw in 12 SVG nodes. The ready frame does not change with the raster (194.10 against 195.15 ms); the hover p95 does (87.16 ms software, 33.52 ms GPU). AX133 (scatter over 50,000 points, hint) was recorded in every run. This is a bounded probe, four times the AX133 threshold, not a budget.
- **Bubble.** The synchronous call is 21 ms. The ready-frame medians are similar on the two rasters (1,468.15 ms software, 1,464.45 ms GPU) for 50,000 discs in 1,579,412 `<path d>` bytes. No profile was recorded, so these records do not say where the time is spent. AX189 (more than 10,000 sized bubbles, hint) was recorded in every run.
- **Hover.** Every case except software `scatter-200k` reads 33.5 ms, two frames at 60 Hz. The sweep's hover method is not the P4 harness and is not comparable to P4's 16.00 ms.

### Cartesian probes, software raster only

| Workload | Metric | Median (A / A) | Record | Load |
|---|---|---|---|---|
| `cartesian-100k`: dual-axis 100,000-point line plus 100,000 un-decimated bars, 20 pairs | Task time, create to settle | 407.44 / 411.14 ms | [`20261128T091225Z-first-cartesian-1x100000-aa-axylo-cartesian-5631`](../../bench/history/20261128T091225Z-first-cartesian-1x100000-aa-axylo-cartesian-5631.json) | 1.14–1.56 |
| | Script time | 169.10 / 169.53 ms | | |
| | Layout and style time | 131.44 / 131.48 ms | | |
| | Ready (adapter signal) / ready frame | 171.05 / 171.35 ms; 355.90 / 357.15 ms | | |
| | Elements inside the chart container (`domNodes`) | 100,121 / 100,121 | | |
| | `<svg>` elements inside the chart root (`canvasBacking.svgElements`) | 4 in all 40 runs | | |
| | `<path>` elements inside those `<svg>` elements (`canvasBacking.svgPaths`) | 8 in all 40 runs | | |
| `cartesian-1M zoom`: bounded probe, 6 pairs | Task time per zoom step | 600.44 / 600.57 ms | [`20261128T091401Z-zoom-cartesian-1x1000000-aa-axylo-cartesian-862b`](../../bench/history/20261128T091401Z-zoom-cartesian-1x1000000-aa-axylo-cartesian-862b.json) | 2.27–3.74 |
| | Step to frame, p95 | 859.60 / 853.56 ms | | |
| | Frame interval p95 | 1,975.00 / 1,966.55 ms | | |

Field meanings for the 100k record are read from the harness (`bench/src/page.js`, `canvasBacking()`): `domNodes` is `root.getElementsByTagName('*').length`, every element in the chart root; `svgElements` is `root.querySelectorAll('svg').length`; `svgPaths` is `root.querySelectorAll('svg path').length`. The record has no count of all SVG descendants and no `<path d>` byte figure for this workload, so neither is comparable with the sweep's `svgNodes` or `pathDBytes`. The zoom probe measures zoom interaction (task time per zoom step, step to frame, frame interval), not first render. It has 6 pairs, below the harness's 20-pair calibration, so it is a bounded probe and supports no statistical claim. `cartesian/dense.ts` was not changed.

Neither Cartesian record contains any diagnostic code. AX132 ("more bars than pixels along the category axis", hint) is a root bar-view advisory: the root controller's fit pass raises it only when `view.kind === 'bar'` (`packages/axylo/src/core/controller.ts`). The `axylo/cartesian` composition builds its view with `kind: 'line'` (`packages/axylo/src/cartesian.ts`), so it does not reach that condition, and no density diagnostic covers these dense-bar probes.

### Not measured

- No GPU run of either Cartesian workload.
- No count of all SVG descendants and no `<path d>` bytes for the Cartesian workloads (the 100k record has only `<svg>` and `<path>` element counts, above).
- No hover timing for the Cartesian workloads, and no interaction timing for `cartesian-100k`; the 1M probe's zoom timing is the only Cartesian interaction figure. No zoom timing for heatmap, bubble, finance or scatter.
- No artifact ID in either density sweep record, and no copy of the script that produced them in this tree.
- No `bubble-50k` profile, so no attribution of its ready-frame time to geometry, DOM insertion, style, layout or raster.
- No canvas implementation was built or timed, so no canvas-against-SVG figure exists for these workloads.

---

## 4. Decision: keep SVG only for 1.0

1. **Every 1.0 budget passes on SVG.** The nine timing rows pass on the clean artifact and P6 passes on its separately recorded packed-size measurement (section 2). No budget gives a reason to add a renderer.
2. **High density stays bounded in SVG.** `heatmap-50k` (34.10 ms ready frame), `finance-50k` (41.55 ms) and `scatter-200k` (194.10 ms ready frame, 33.52 ms hover p95 on GPU) draw in at most 655 SVG nodes with 0 errors; the only diagnostic is the expected AX133 hint on `scatter-200k`.
3. **The slow points are outside the 1.0 budgets.** `bubble-50k` (1,468.15 ms ready frame) raises AX189. `cartesian-100k` (407.44 ms task time) and the `cartesian-1M` zoom probe (600.44 ms task time per zoom step) draw 100,000 and more un-decimated bars; neither is a 1.0 budget. The root AX132 advisory does not apply to the Cartesian composition (section 3), and `axylo/cartesian` has no density code of its own (AX170–AX176), so these two probes carry no density diagnostic, as both records show.
4. **A canvas renderer would cost the tight rows.** P6 has 2,144 B of headroom on line, and decision 0002 already removed the canvas mark renderer.

`axylo/canvas` is not opened for 1.0.

### When to reopen after 1.0

Reopen the renderer question only on a measured trigger. Every run uses a clean sealed artifact, at least 20 timed runs (or 20 complete pairs for harness records), and both software and GPU raster where raster is named. Timing endpoints, by record field (meanings read from the field names, section 3):

- **Ready frame:** the density sweep's `medianReadyFrameMs`, the median over runs of `readyFrameMs` (wall-clock time from the create call to the frame after the chart is ready). This is wall-clock time and is not comparable with P2's main-thread task time.
- **Hover:** the density sweep's `hoverP95MedianMs`, the median over runs of each run's `hover.p95Ms` (pointer move to the next frame). This is the sweep's hover method, not the P4 harness.
- **Size:** gzip level-9 bytes per entry from `scripts/size.mjs` into `bench/size-latest.json`.

The thresholds below are **proposed post-1.0 reopening thresholds**, not 1.0 gates, and no 1.0 budget changes because of them:

1. **A 1.0 budget fails.** Any `P1–P8` row fails on SVG under its spec section 5 limit, and a profile attributes the miss to drawing or rasterization rather than data, layout or the accessibility layer.
2. **Ready frame (proposed: 250 ms).** A supported workload inside a documented limit, raising no density diagnostic, has `medianReadyFrameMs` above 250 ms on either raster.
3. **Hover (proposed: 50 ms, three frames at 60 Hz).** Such a workload has `hoverP95MedianMs` above 50 ms on GPU raster.
4. **A canvas prototype pays for itself.** On the same workload, raster, artifact pairing and run count, a canvas prototype cuts `medianReadyFrameMs` (or `hoverP95MedianMs`, for a hover trigger) by at least 30% against SVG, with every run free of errors. Separately, and not traded against the timing gain, the build with the prototype stays within the DX7 gzip targets (≤ 158 KiB everything, ≤ 135 KiB line) measured by `scripts/size.mjs`. Both checks must pass.
5. **A new 1.x budget fails.** A workload is specified as a 1.x budget (for example dense bars or tens of thousands of bubbles) and fails on SVG.

The 2026-11-28 sweep is the baseline for triggers 2–4: no sweep case raising no density diagnostic exceeds 250 ms `medianReadyFrameMs` or 50 ms GPU `hoverP95MedianMs`. The Cartesian probes come from the paired harness, not the sweep, so trigger 2 applies to them only once they are rerun with the sweep's endpoints; whether un-decimated Cartesian dense bars are inside a documented limit is not settled by this ledger.

Until one of these is measured, the advice for dense input stays the diagnostics: AX133, AX186 and AX189, and AX132 for root bar charts.
