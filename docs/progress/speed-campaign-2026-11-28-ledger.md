# Speed campaign ledger — 2026-11-28

Archive record of the 7-hour speed campaign on Axylo 4. Gate results are historical campaign records; scorecard values come from `node bench/analyze.mjs` on the archived records in `bench/history/`.

## 1. Metadata and invariants

| Item | Value |
|---|---|
| Window | 2026-11-28, 11:06–17:05 CET (about 6 h; the cap was 7 h) |
| Branch | `speed/campaign-2026-11-28` |
| Paired scorecard baseline (A) | `a8472da` (`phase2/phase4-integration`, N11 sealed) |
| Frozen measured candidate (B) | `32779ae` |
| Archive-only HEAD | `d0c3194` (adds 14 records and `bench/size-latest.json`; no code) |
| `main` | `60d01f8`, untouched. Nothing was pushed, tagged or published |
| Environment | Chrome 158.0.8127.88 headless, Node v24.21.0, Ubuntu 26.04.1 LTS, Intel Core i5-13600K (20 threads); GPU sweep on NVIDIA GeForce RTX 2060 SUPER |

Invariants:

- `git diff --stat a8472da..32779ae -- packages/axylo/src/public.ts packages/axylo/src/core/contracts.ts` is empty.
- The output stays SVG-only, with no runtime dependencies. Accessibility and diagnostics stay on.
- Coverage reduction is render-only: hover, keyboard, table and summary always read the exact full normalized frame.
- Opacity gating differs by mark, per the source on `32779ae`:
  - Bar envelopes (C2) are built only for resolved opaque, unpatterned paint.
  - Scatter coverage (C3): `scatterPoints()` in `scene/lines.ts` calls `coveredCircles()` for circular size-6 markers when `xy.length > 4000` (more than 2,000 points). It does not check resolved opacity. `svgPoints` in `render/svg.ts` paints each series as one compound SVG path, and public `colors` accepts any CSS color string, including translucent ones.
- **Discrepancy:** the campaign's stated hard invariant ("merging only for opaque, unpatterned fills; never translucent `< 1` opacity") does not hold for scatter coverage, which has no opacity gate. This ledger records the gap; it was not fixed in the campaign.

Verification gates on `32779ae`, recorded before the freeze (historical outputs):

| Gate | Historical result |
|---|---|
| `./tools/loupe verify` | `PASS: 3180 tests`, `dist closure ok` |
| `node scripts/size.mjs --check` | PASS |
| `npm run test:dist` | 12/12 Node dist suites; `tests/dist/subpaths.test.ts` 44/44, including 0 raw bytes for a bare import of every one of the 10 entries |
| `npm run test:dist:browser` | 12/12 packed Chrome suites (45/45) |
| `node --test bench/test/*.test.mjs` | 151/151 |
| `node --test acceptance/test/*.test.mjs` | 71/71 |

## 2. Cycle audit: 7 cycles kept, 0 reverted

`git log --oneline a8472da..HEAD` also shows checkpoint commits (`ae02089` C1 pass 1, `8659ad8` C3) and merges (`3b35a19`, `e3b2caf`, `c7ff85c`, `d6c5e92`, `cb5dc18`).

**Wave 0 (S0a–S0d), profiling only.**
- Chrome CDP traces: on `bubble-50k`, 98% of JS time was in `paintedMap()`. Relative `a` arcs drew about 2× faster than cubics or octagons.
- `bench/profile.mjs` runs on P1, P5 and P8.
- An esbuild map of what each subpath exposes.

**Wave 1 (C1–C4)** ran in four parallel disjoint worktrees, merged at Gate G1 (`bac7063`). **Wave 2 (C5–C7)** ran in three parallel disjoint worktrees, merged at Gate G2.

| Cycle | Commit(s) | Files | Change | Recorded effect | Decision |
|---|---|---|---|---|---|
| C1 (Wave 1) | `ae02089`, `cf92b11`, purity fix `bac7063` (Gate G1) | `spatial/bubble/{paint,geometry,composition}.ts` | Top-down culling of fully covered cells, contiguous scan, deferred lower angles, typed-array contour hash | Seeded 50k SVG path byte-identical at 1,578,907 B (C1 receipt `runs/coordinator_speed_w1_c1_bubble_v2/astra-6.2-high__20261128T111111Z/report.md`). Timing: the Director brief cites 5.66× in Node; the C1 receipt reports `paintedMap()` median 325.85 → 224.31 ms vs checkpoint `ae02089` (−31.2%) and 5.44× vs the reported original 1,219.47 ms | KEEP |
| C2 | `30ba0e6` | `cartesian/{bar-geom,scene}.ts`, `render/svg.ts`, `bench/src/admission.js` | Opaque unpatterned bar envelopes at render time, hoisted bar geometry, strict dual-mode bar admission | 100,000 → 692 `<rect>` nodes | KEEP |
| C3 | `8659ad8`, `78077e7` | `scene/lines.ts`, `lookup/scatter-grid.ts` | Coverage bitset for filled circular size-6 disks (> 2,000 points; no resolved-opacity check, see Invariants); scatter-grid cells split lazily | spatial −311 B | KEEP |
| C4 | `fe7295f` | `core/{controller,frame-state,controller-helpers}.ts`, `dom/figure.ts`, `layout/{index,labels}.ts`, `theme/resolve.ts` | Less first-frame work in controller, compact, figure, layout and theme | cartesian −86 B, line −25 B | KEEP |
| C5 (Wave 2) | `b4f223a` | `cartesian/{axes,dense,view,lookup,scene}.ts` | Skip by pixel column; cache extrema per 256 rows, keeping the sign of the first zero; reuse bar vertical coordinates for the 1M zoom | — | KEEP |
| C6 | `ce4b53e` | `render/svg.ts`, `core/{controller-stream,environment}.ts`, `dom/{attributes,interaction,toolbar}.ts`, `data/{normalize,values}.ts`, `simplify/index.ts` | Relative `a` arcs in `denseCircles`, light-DOM fast path, borrowed column extrema, trimmed startup and stream work | line −72 B, static −56 B, cartesian −25 B | KEEP |
| C7 | `80ec53d` | `finance/{aggregate,render}.ts`, `spatial/heatmap/{core,render}.ts` | Batched pane-clipped `<path>` elements when there are more than 64 finance down-candles or volume bars (overlapping rectangles split into separate paint operations to preserve alpha); heatmap runs merged in 2D; fast column normalization | 655 → 24 SVG nodes; heatmap `<path d>` −30.9% | KEEP |

**Gate G2 (sync and challenger).**
- `68b77db`: `bench/src/adapters/axylo-common.js`, `bench/src/admission.js` and `bench/test/{multichart-stage1b,scatter-coverage}.test.mjs`. The bench now parses relative `[Aa]` circle arcs and admits dense scatter strictly as covered radius-3 disks (bench tests 151/151).
- `32779ae`: `packages/axylo/test/speed-campaign-challenger.test.ts`, 20 adversarial regression tests across C1–C7. Review: neon-4-high with opus-5.5-high, cross-provider, `Verdict: Merge`, 0 production defects.

## 3. Paired real-Chrome scorecard (`a8472da` vs `32779ae`)

Method:
- 20 randomized AB/BA pairs per endpoint, run one at a time on an idle CPU, with 0/40 failed runs.
- Provenance: `node bench/analyze.mjs <record>` was run on all 12 archived paired records; every one reports 20/20 pairs and 0 failures.
- B−A is the difference of the A and B medians, with a paired bootstrap 95% CI (`bench/src/stats.js`); the CI tests against zero only. AB | BA are differences of medians within each run order.
- Units: timing values in ms unless marked; memory in B, KiB or MiB as marked; P7 lifecycle CI and AB | BA values are on the raw fractional scale (0.001 = 0.1 percentage point).
- Verdicts are as printed by the analyzer. Stored analyses use no A/A noise band; the printed `no worthwhile difference (rule)` for uncalibrated declared endpoints is not a formal equivalence verdict.

| Endpoint | Record | Primary metric | A | B | B−A | 95% CI | AB \| BA | Verdict and notes |
|---|---|---|---:|---:|---:|---|---|---|
| cartesian-1M zoom | [`…150002Z-zoom-cartesian-1x1000000-builds-axylo-cartesian-2c15`](../../bench/history/20261128T150002Z-zoom-cartesian-1x1000000-builds-axylo-cartesian-2c15.json) | `taskMsPerStep` | 602.1 ms | 8.64 ms | −593.5 (−98.6%, 69.7×) | [−594.4, −592.4] | −593.6 \| −593.2 | **inconclusive (rule)** (see note below). `frameP95Ms` 1974.9 → 16.75 ms (−99.2%); `stepToFrameP95Ms` 858.3 → 20.63 ms (−97.6%); `frameMaxMs` 2191.6 → 33.30 ms (−98.5%); median `framesOverThreshold` 60 → 1 |
| cartesian-100k | [`…145831Z-first-cartesian-1x100000-builds-axylo-cartesian-3671`](../../bench/history/20261128T145831Z-first-cartesian-1x100000-builds-axylo-cartesian-3671.json) | `taskMs` | 413.2 ms | 35.65 ms | −377.5 (−91.4%, 11.6×) | [−386.7, −366.4] | −369.7 \| −383.8 | better. `scriptMs` 171.6 → 30.11 ms (−82.5%); `layoutStyleMs` 132.3 → 3.66 ms (−97.2%); `domNodes` 100,121 → 819 (−99.2%); `rendererPssChartBytes` 257.88 → 12.49 MiB (−245.4 MiB, −95.2%) |
| scatter-50k | [`…145715Z-scatter-1x50000-builds-axylo-eaee`](../../bench/history/20261128T145715Z-scatter-1x50000-builds-axylo-eaee.json) | `readyFrameMs` | 57.85 ms | 40.95 ms | −16.90 (−29.2%) | [−17.85, −15.85] | −16.80 \| −16.90 | better. `taskMs` 52.12 → 35.51 ms (−31.9%); `layoutStyleMs` 22.40 → 8.43 ms (−62.3%); `rendererCpuMs` 190 → 90 ms (−52.6%) |
| P7 lifecycle | [`…151913Z-lifecycle-trend-c2500-builds-axylo-31b3`](../../bench/history/20261128T151913Z-lifecycle-trend-c2500-builds-axylo-31b3.json) | `heapGrowth` | 0.891% (0.0089) | 0.809% (0.0081) | −9.2% rel. | [−0.001, −0.001] | −0.001 \| −0.001 | better. `heapSlopeBytesPerCycle` 77.55 → 66.30 B/cycle (−14.5%, better); 0/40 runs > 1%; 0 leaked listeners, observers or nodes |
| P1 | [`…144038Z-first-trend-builds-axylo-dd07`](../../bench/history/20261128T144038Z-first-trend-builds-axylo-dd07.json) | `taskMs` | 19.45 ms | 19.59 ms | +0.149 ms (+0.8%) | [−0.651, 0.933] | −0.021 \| 1.27 | no worthwhile difference. `readyFrameMs` 22.45 → 20.55 ms (−8.5%, better); `heapChartBytes` −12.2 KiB (better); `gpuPssChartBytes` −31.5 KiB (better); renderer PSS +69.5 KiB (worse) |
| P2-100k | [`…144153Z-first-1x100000-builds-axylo-cf8e`](../../bench/history/20261128T144153Z-first-1x100000-builds-axylo-cf8e.json) | `taskMs` | 22.40 ms | 21.80 ms | −0.597 ms (−2.7%) | [−2.10, 0.738] | −0.909 \| −0.662 | no worthwhile difference. `readyFrameMs` 23.10 → 21.35 ms (−7.6%, better); `heapChartBytes` −4.9 KiB (better) |
| P2-1M | [`…144310Z-first-1x1000000-builds-axylo-a5b1`](../../bench/history/20261128T144310Z-first-1x1000000-builds-axylo-a5b1.json) | `taskMs` | 26.47 ms | 25.85 ms | −0.621 ms (−2.3%) | [−2.06, 0.497] | −0.265 \| −0.772 | no worthwhile difference. `readyMs` 24.60 → 23.85 ms (−3.0%); `heapChartBytes` −7.2 KiB (better) |
| P3 stream | [`…144435Z-stream-w600-builds-axylo-1b60`](../../bench/history/20261128T144435Z-stream-w600-builds-axylo-1b60.json) | `taskMsPerUpdate` | 0.947 ms | 0.967 ms | +0.020 ms (+2.1%) | [−0.011, 0.040] | 0.017 \| 0.022 | no worthwhile difference. 0/40 late frames; `frameP95Ms` 16.70 ms; `ackDelayP95Ms` 14.92 → 14.70 ms |
| P4 hover | [`…144933Z-hover-1x100000-builds-axylo-e081`](../../bench/history/20261128T144933Z-hover-1x100000-builds-axylo-e081.json) | `inputToReadoutP95Ms` | 15.90 ms | 15.90 ms | 0.000 ms (0.0%) | [−0.100, 0.100] | 0.050 \| −0.050 | no worthwhile difference. 0 missed moves; 60 FPS held |
| P5 (24×) | [`…145317Z-page-trend-x24-builds-axylo-1bdd`](../../bench/history/20261128T145317Z-page-trend-x24-builds-axylo-1bdd.json) | `taskMs` | 48.60 ms | 47.33 ms | −1.26 ms (−2.6%) | [−2.96, 1.68] | −1.32 \| −1.06 | no worthwhile difference. `rendererCpuMs` 100 → 90 ms (−10%); `heapChartBytes` −22.2 KiB (better) |
| P7 memory | [`…145434Z-mem-1x1000000-builds-axylo-f32f`](../../bench/history/20261128T145434Z-mem-1x1000000-builds-axylo-f32f.json) | `ownedBytes` | 23,304 B | 23,304 B | 0 B (0.0%) | [0, 0] | 0 \| 0 | exact parity. `heapChartBytes` −7.2 KiB (better) |
| P8 (40×) | [`…145559Z-compact-trend-x40-builds-axylo-f8de`](../../bench/history/20261128T145559Z-compact-trend-x40-builds-axylo-f8de.json) | `taskMs` | 25.53 ms | 24.81 ms | −0.719 ms (−2.8%) | [−1.83, 0.095] | −0.794 \| −0.519 | no worthwhile difference on the primary metric. `scriptMs` 20.01 → 19.51 ms (better); `heapChartBytes` −28.5 KiB (better); `rendererPssChartBytes` −336 KiB (−3.9%, better) |

**Zoom note.** The analyzer reports `runs with framesOverThreshold > 0: A 20, B 20` and `no "better" verdict: the candidate had 20 runs with framesOverThreshold > 0`. The rule blocks "better" while any candidate run exceeds the threshold, so every zoom metric is **inconclusive (rule)**, even though the median `framesOverThreshold` fell from 60 to 1 and each CI sits far from zero.

## 4. High-density sweep (20 runs each, software and GPU)

**Baseline note.** The baseline summaries were measured on **`d3663b7`**, not on `a8472da`. `git diff d3663b7..a8472da` is empty for the library source, package manifest, build script and lockfile, which is what makes the two baselines comparable. The paired scorecard baseline is still `a8472da`. The sweep files use a different schema from the paired records and store no analyzer output, so these values are read from the archived JSON.

Records:
- Baseline (`d3663b7`): [SW](../../bench/history/20261128T092608Z-n11-density-sweep.json), [GPU](../../bench/history/20261128T092751Z-n11-density-sweep-gpu.json)
- Candidate (`32779ae`): [SW](../../bench/history/20261128T151703Z-n11-density-sweep-sw.json), [GPU](../../bench/history/20261128T151759Z-n11-density-sweep-gpu.json)

| Workload | Baseline `readyFrameMs` SW / GPU (ms) | Candidate SW / GPU (ms) | Delta | Geometry and hover |
|---|---:|---:|---|---|
| bubble-50k | 1,468.2 / 1,464.5 | 373.3 / 367.2 | −74.6% / −74.9% (3.93× / 3.99×) | Matching aggregate `pathDBytes` (1,579,412 B) in baseline and candidate sweep JSON — not a whole-SVG byte-identity claim; C1's separate seeded SVG path parity is 1,578,907 B; 15 SVG nodes; `AX189`; 0 errors |
| scatter-200k | 194.1 / 195.2 | 122.3 / 123.0 | −37.0% / −37.0% (1.59×) | `<path d>` 8.54 MB → 2.40 MB (−71.9%). Archived hover p95 median (`hoverP95MedianMs`): SW 87.16 → 33.62 ms (−61.4%); GPU 33.52 → 152.27 ms (worse) |
| finance-10k | 37.0 / 37.2 | 34.7 / 35.2 | ≈ −6.2% / ≈ −5.4% (approx., from displayed medians) | SVG nodes 626 → 23 (−96.3%); DOM nodes 691 → 88 (−87.3%) |
| finance-50k | 41.6 / 42.1 | 39.35 / 39.90 | ≈ −5.4% / ≈ −5.1% (approx., from displayed medians; p95: SW 45.3 → 42.2 ms, GPU 55.7 → 45.3 ms) | SVG nodes 655 → 24 (−96.3%); DOM nodes 718 → 87 (−87.9%) |
| heatmap-50k | 34.1 / 34.3 | 33.55 / 33.35 | −1.6% / −2.8% | `<path d>` 506,140 → 349,893 B (−30.9%); 59 SVG nodes |

**Mode-matched corrections.**
- *Heatmap `syncMs`.* The campaign summary quoted "12.1 → 10.65 ms (−12.5%)". That pairs a GPU baseline value with a software candidate value, so it is not used here. Medians over the 20 heatmap runs, read from the JSON with matched modes: SW 11.55 → 10.65 ms (−7.8%), GPU 12.10 → 10.70 ms (−11.6%).
- *finance-50k p95.* The campaign summary's "55.7 → 42.2" paired the GPU baseline with the SW candidate; matched values are in the table.
- *GPU scatter hover.* The archive records the GPU regression but no trace establishing its cause.

## 5. Packed size (`node scripts/size.mjs --check`, `a8472da` → `32779ae`)

All values are gzip-9 consumer bundle bytes (B) measured from the pack, not tarball sizes. `scripts/size.mjs --check` enforces root caps of 135 KiB and 158 KiB (138,240 B and 161,792 B); the cap column lists the `tests/dist/subpaths.test.ts` caps only.

Sources:
- Baseline: `git show a8472da:bench/size-latest.json`, an archived pre-campaign artifact (`packed.commit` `354b90f`, `dirty=true`).
- Candidate: [`bench/size-latest.json`](../../bench/size-latest.json), packed at clean `32779ae`.
- Caps: `SIZE_TARGETS` / `exceeds` in `scripts/size.mjs` and `git show 32779ae:tests/dist/subpaths.test.ts`.

| Target | Baseline (B) | Candidate (B) | Delta (B) | Cap (B, `tests/dist/subpaths.test.ts`) |
|---|---:|---:|---:|---:|
| line only (axylo) | 136,096 | 135,721 | −375 | 136,500 |
| everything (axylo) | 159,006 | 159,059 | +53 | 159,500 |
| static line | 120,499 | 120,127 | −372 | 120,729 |
| static everything | 140,812 | 140,796 | −16 | 140,988 |
| cartesian | 137,792 | 137,972 | +180 | 138,000 |
| spatial | 142,492 | 142,625 | +133 | 143,000 |
| finance | 123,865 | 124,544 | +679 | 127,000 |
| hierarchy | 21,588 | 21,588 | 0 | 21,600 |
| stats / sync / export | 3,483 / 3,494 / 3,499 | same | 0 | 3,500 each |

- *Finance baseline.* The archived artifact gives 123,865 B (+679 B). The campaign reported 124,007 B (+537 B) as an alternate baseline; no independent artifact for that value is archived.
- Bare import: 0 raw bytes for all 10 entries. This is a raw-byte check, separate from gzip framing (an empty module still gzips to a non-zero size).

## 6. Next step after the campaign

1. Fast-forward `phase2/phase4-integration` onto `speed/campaign-2026-11-28`.
2. Finish Phase 2 N10b:
   - docs and examples in `apps/docs/`, plus `STATUS.md`;
   - `acceptance/journeys.json`;
   - from a clean `HEAD`, the six acceptance runs with `acceptance/run.mjs` across four runner configurations covering three browser engines (per `acceptance/provenance.mjs`), and the `--release --pers` closeout, which is owned by `acceptance/check.mjs`;
   - the DX12 rehearsal.

   Carry the numbers above into that work.
