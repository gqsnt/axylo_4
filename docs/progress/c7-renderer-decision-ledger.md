# Campaign 7 Ledger — Evidence-Gated SVG Density Sweep & Renderer Decision (`C7.1–C7.3`)

**Branch:** `feat/c7-renderer-decision` (branched from C6-sealed `62085f1`)  
**Decision:** **DEFER `axylo/canvas` — Retain SVG as Axylo 4's sole default renderer.**  
**Status:** Sealed & Verified (`C7.1` Density Sweep → `C7.2` Gate Not Triggered → `C7.3` Measured Decision & End-to-End Closure)

---

## 1. Pinned Measurement Environment (`C7.1`)

- **Sealed Artifact:** `20261126T132932Z-62085f18-0f0d8d` (clean commit `62085f18`, source hash `17916df62ef88fe3`, production `axylo.iife.min.js` byte-for-byte identical to `packages/axylo/dist/axylo.iife.min.js`).
- **Hardware:** `13th Gen Intel(R) Core(TM) i5-13600K` (20 logical cores).
- **Browser & Raster Mode:** Chrome `158.0.8127.88` headless, software rasterization, `1440×900` viewport, `settleMs = 500`, DPR `1` (plus DPR `2` HiDPI verification on `scatter 1x50000`).
- **Design:** Balanced A/A blocks (`--blocks 6`, 3 AB + 3 BA = 12 timed runs per primary workload; `--blocks 4` = 8 timed runs for DPR `2` check), order seed `20261126`, bootstrap seed `12345`, `0` failed runs across all 8 sessions.

---

## 2. Measured Real-Chrome SVG Density Sweep Results

| Workload | Size / Params | DPR | Primary Metric | Median A / B | 95% A/A CI | Secondary Breakdown | DOM Nodes | Product Budget | Status |
|---|---|---:|---|---:|---:|---|---:|---|---|
| **`first` (line)** | `1x100,000` | 1 | `taskMs` | **20.19 / 20.36 ms** | `[-2.02, +2.43] ms` | `readyFrameMs` 23.2 ms | **76** | P2 `<= 60 ms` | **PASS (3.0× under)** |
| **`zoom` (line)** | `1x100,000` | 1 | `taskMsPerStep` | **1.22 / 1.22 ms** | `[-0.08, +0.04] ms` | `frameP95` 16.70 ms, **0 late frames** | — | `<= 16.67 ms` | **PASS (13.6× under)** |
| **`resize` (line)** | `1x100,000` | 1 | `taskMs` (total) | **134.3 / 135.0 ms** | `[-2.00, +4.10] ms` | `frameP95` 16.70 ms, **0 late frames** | — | `0` late frames | **PASS (0 late frames)** |
| **`hover` (line)** | `1x100,000`, 200 moves | 1 | `inputToReadoutP95Ms` | **16.10 / 16.00 ms** | `[-0.25, +0.05] ms` | `taskMsPerMove` **0.71 ms**, **0 missed** | — | P4 `<= 16.67 ms` | **PASS** |
| **`scatter`** | `1x10,000` | 1 | `readyFrameMs` | **33.10 / 31.95 ms** | `[-1.95, +0.45] ms` | `scriptMs` 16.94, `layoutStyleMs` 6.05 | **73** | `<= 60 ms` | **PASS** |
| **`scatter`** | `1x50,000` | 1 | `readyFrameMs` | **56.55 / 56.55 ms** | `[-1.30, +1.10] ms` | `scriptMs` 25.91, `layoutStyleMs` 21.62 | **73** | `<= 60 ms` | **PASS** |
| **`scatter`** | `1x50,000` | **2** | `readyFrameMs` | **56.65 / 56.65 ms** | `[-0.10, +0.85] ms` | `scriptMs` 26.17, `layoutStyleMs` 21.13, `0 KiB` canvas backing | **73** | `<= 60 ms` | **PASS (+0.10 ms vs DPR 1)** |
| **`scatter` (stress)** | `1x100,000` | 1 | `readyFrameMs` | **86.55 / 86.60 ms** | `[-1.10, +1.20] ms` | `scriptMs` **36.60**, `layoutStyleMs` 41.59 | **73** | Stress probe | **No `>= 2×` Canvas headroom** |

---

## 3. Quantitative Rationale for Deferring `axylo/canvas`

1. **Zero reproducible product-budget misses on SVG:** Every declared workload clears its target budget cleanly—including `first 1x100,000` (`20.19 ms`), `zoom 1x100,000` (`1.22 ms/step`, `0` late frames), `resize 1x100,000` (`0` late frames), `hover 1x100,000` (`16.10 ms` p95, `0.71 ms/move`), and `scatter 1x50,000` at both DPR `1` (`56.55 ms`) and DPR `2` (`56.65 ms`).
2. **Constant SVG DOM complexity (`73–76` nodes):** Because Axylo's SVG renderer batches points, lines, error bars, candlestick wicks, and candle bodies into single typed-array `<path>`/`<rect>` primitives, DOM node count stays flat (`73` nodes across `10k` → `50k` → `100k` scatter) and HiDPI DPR `2` adds only `0.10 ms` with **`0 KiB`** of canvas backing-store RAM.
3. **Amdahl's-law ceiling fails the `C7.2` `>= 2×` speedup gate:** On `scatter 1x50,000` (`56.55 ms`) and `1x100,000` (`86.55 ms`), **`25.91 ms` (45.8%)** and **`36.60 ms` (42.3%)** respectively are renderer-independent JS stages (`scriptMs`: normalization, spatial grid, view, layout). Even an idealized Canvas renderer reducing paint/raster to `~10–15 ms` could achieve at most `~1.5×–1.76×` total latency improvement—strictly below the `>= 2×` threshold required to justify a second renderer's bundle, memory, HiDPI, forced-colors, and maintenance cost.
4. **Zero-tax architecture preserved:** All 8 opt-in subpaths (`axylo/static`, `axylo/stream`, `axylo/cartesian`, `axylo/stats`, `axylo/sync`, `axylo/export`, `axylo/finance`) maintain `<= 0 B` legacy gzip-9 tax (`line −52 B`, `everything −12 B`, `static line −54 B`, `static everything −27 B`, `IIFE −53 B` vs C3-sealed `b097f1a`) and `0` raw bytes on bare imports under `ignoreAnnotations: true`.

---

## 4. Explicit Re-Open Criteria

Re-open `C7.2` (`axylo/canvas` via `MarkRenderer`) **only if** a future admitted workload (for example, a deferred `axylo/spatial` 2D heatmap with `>= 50,000` independently colored cells or variable-radius multi-color bubbles that cannot batch into constant SVG elements) produces:
1. A reproducible SVG product-budget miss under `bench/decision.mjs` (complete balanced blocks + calibrated A/A controls), **and**
2. A paired prototype proving **`>= 2×`** primary-latency improvement bringing the workload back inside its product budget with exact-data/a11y/CSP/DPR parity and `0 B` legacy bundle tax.
