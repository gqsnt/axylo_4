# Campaign 7 Ledger — Evidence-Gated SVG Density Sweep & Renderer Decision (`C7.1–C7.3`)

**Branch:** `feat/c7-renderer-decision` (branched from C6-sealed `62085f1`)  
**Decision:** **DEFER `axylo/canvas` — Retain SVG as Axylo 4's sole default renderer.**  
**Status:** Sealed & Verified (`C7.1` Exploratory SVG Density Sweep → `C7.2` Admission Gate Not Met → `C7.3` Measured Defer Decision & End-to-End Closure)

---

## 1. Pinned Measurement Environment & Exploratory Scope (`C7.1`)

- **Sealed Artifact:** `20261126T132932Z-62085f18-0f0d8d` (clean commit `62085f18`, source hash `17916df62ef88fe3`, production `axylo.iife.min.js` byte-for-byte identical to `packages/axylo/dist/axylo.iife.min.js`).
- **Hardware:** `13th Gen Intel(R) Core(TM) i5-13600K` (20 logical cores).
- **Browser & Raster Mode:** Chrome `158.0.8127.88` headless, **software rasterization**, `1440×900` viewport, `settleMs = 500`, DPR `1` (plus DPR `2` software-raster check on `scatter 1x50000`).
- **Scope & Statistical Status (Exploratory):** Each session ran `6` balanced SVG A/A blocks (`3 AB + 3 BA = 12` timed runs; `4` blocks / `8` runs for DPR `2`), order seed `20261126`, bootstrap seed `12345`, `0` failed runs. Because `4–6` pairs fall below `bench/src/decision.js`'s full calibration requirement (`>= 20` complete pairs per session across `>= 3` control sessions), these A/A intervals are **exploratory**—they measure identical-configuration repeatability and current SVG medians rather than calibrated A/B renderer intervals. Per the Master Plan's `C7.1` gate, **admission of `C7.2` (`axylo/canvas`) requires a reproducible SVG product-budget miss in complete 20-pair calibrated evidence; absent such a miss, `C7.2` is deferred.**

---

## 2. Exploratory Real-Chrome SVG Density Sweep Results

*(Resize/zoom lateness threshold in `bench/src/stats.js:244` is `1.5×` the observed refresh interval; `scriptMs` reflects aggregate Chrome scripting through the post-ready settle window.)*

| Workload | Size / Params | DPR | Primary Metric | Median A / B | 95% A/A CI | Secondary Observed Metrics | DOM Nodes | Reference Budget | Exploratory Reading |
|---|---|---:|---|---:|---:|---|---:|---|---|
| **`first` (line)** | `1x100,000` | 1 | `taskMs` | **20.19 / 20.36 ms** | `[-2.02, +2.43] ms` | `readyFrameMs` 23.2 ms | 76 | P2 `<= 60 ms` | Well below P2 |
| **`zoom` (line)** | `1x100,000` | 1 | `taskMsPerStep` | **1.22 / 1.22 ms** | `[-0.08, +0.04] ms` | `frameP95` 16.70 ms, `0` frames > 1.5× refresh | — | Interactive frame | Smooth, 0 late frames |
| **`resize` (line)** | `1x100,000` | 1 | `taskMs` (total) | **134.3 / 135.0 ms** | `[-2.00, +4.10] ms` | `frameP95` 16.70 ms, `0` frames > 1.5× refresh | — | `0` late frames | Smooth, 0 late frames |
| **`hover` (line)** | `1x100,000`, 200 moves | 1 | `inputToReadoutP95Ms` | **16.10 / 16.00 ms** | `[-0.25, +0.05] ms` | `taskMsPerMove` 0.71 ms, `0` missed moves | — | P4 `<= 16.67 ms` | Within P4 |
| **`scatter`** | `1x10,000` | 1 | `readyFrameMs` | **33.10 / 31.95 ms** | `[-1.95, +0.45] ms` | `taskMs` 24.93, `scriptMs` 16.94, `layoutStyleMs` 6.05 | 73 | Exploratory | Constant 73 DOM nodes |
| **`scatter`** | `1x50,000` | 1 | `readyFrameMs` | **56.55 / 56.55 ms** | `[-1.30, +1.10] ms` | `taskMs` 49.44, `scriptMs` 25.91, `layoutStyleMs` 21.62 | 73 | Exploratory | Constant 73 DOM nodes |
| **`scatter`** | `1x50,000` | **2** | `readyFrameMs` | **56.65 / 56.65 ms** | `[-0.10, +0.85] ms` | `taskMs` 49.13, `0 KiB` canvas backing (software raster) | 73 | Exploratory | `+0.10 ms` vs DPR 1 |
| **`scatter` (stress)** | `1x100,000` | 1 | `readyFrameMs` | **86.55 / 86.60 ms** | `[-1.10, +1.20] ms` | `taskMs` 80.10, `scriptMs` 36.60, `layoutStyleMs` 41.59 | 73 | Stress probe | Constant 73 DOM nodes |

---

## 3. Rationale for Deferring `axylo/canvas`

1. **Admission gate not triggered (`C7.1`):** None of the budgeted workloads (`P2` 100k first render `20.19 ms`, `P4` 100k hover p95 `16.10 ms`, `100k` zoom `1.22 ms/step` with `0` late frames, `100k` resize with `0` late frames) missed a product budget on SVG, and the exploratory scatter sweep remained fast with a flat **73 DOM nodes** across `10k → 50k → 100k` points (batched single `<path>`) and `+0.10 ms` software-raster delta at DPR `2` (`0 KiB` canvas backing memory).
2. **Batched SVG architecture across C4–C6 families:** Both `axylo/cartesian` (error bars, range bands, bars, lines) and `axylo/finance` (OHLC candlesticks + volume) batch marks into `O(N)` typed `Float32Array` `PathMark`/`RectMark` buffers so SVG node count stays independent of row count, preserving crisp vector rendering, live CSS custom property theming, forced-colors support, and `0 KiB` canvas backing RAM.
3. **Zero-tax distribution preserved:** Deferring `axylo/canvas` avoids dual-renderer maintenance, HiDPI backing-store memory, and Canvas forced-colors/theme-resolution glue while keeping every legacy bundle strictly below the C3-sealed `b097f1a` baseline (`line −52 B`, `everything −12 B`, `static line −54 B`, `static everything −27 B`, `IIFE −53 B`) and all 8 entry points at `0` raw bytes on bare import under `ignoreAnnotations: true`.

---

## 4. Executable Re-Open Protocol

Re-open `C7.2` (`axylo/canvas` via `MarkRenderer`) **only if** a concrete target workload (for example, a future admitted `axylo/spatial` 2D heatmap with `>= 50,000` distinct-color cells or multi-color variable-radius bubbles that cannot batch into constant SVG nodes) satisfies **all four** executable criteria:

1. **Predeclared endpoint registration:** Register the workload, parameters, raster mode (`software` and/or `gpu`), DPR, primary metric, and absolute product budget in `bench/src/decision.js` and `bench/decision.mjs` before running comparisons.
2. **Reproducible SVG budget miss:** Record `>= 3` eligible `>= 20`-pair A/A SVG control sessions (`sessionEligibility` pass, single Chrome version, pinned environment) demonstrating that SVG reproducibly misses the predeclared absolute budget outside the calibrated control band.
3. **Paired `>= 2×` prototype speedup:** Implement `axylo/canvas` behind an internal `MarkRenderer` factory and run a balanced `>= 20`-pair A/B comparison (with isolation if pilot detects order carry-over) proving `>= 2×` primary-latency improvement, bringing the workload inside its predeclared budget and clearing the frozen tolerance.
4. **Full product & zero-tax parity:** Pass exact datum/tooltip/table/keyboard/summary parity, DPR resize, `0/0/0` teardown, strict CSP, `<= 0 B` legacy gzip-9 tax, and `0` raw bytes on bare import (`ignoreAnnotations: true`).
