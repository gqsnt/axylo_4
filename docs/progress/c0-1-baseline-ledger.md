# Cycle C0.1 — Reconciled Size & Longitudinal Baseline Ledger

**Date:** 2026-11-26  
**Branch:** `feat/c0-c1-pers-baseline` (forked from `c0fcc17`)  
**Source of Truth:** Packed consumer bundles (`scripts/size.mjs`, esbuild `0.28.2`, `minify: true`, `conditions: ['production']`, `target: 'es2022'`, gzip level 9).

---

## 1. Ratified Owner Decisions (2026-11-26)

1. **Continuous Optimization Without Hard Release Caps:** `SIZE_TARGETS` (`108 KiB` line / `128 KiB` everything) and `P1`/`P7` remain tracked optimization benchmarks, not release-blocking stop gates.
2. **Prism 6.2 Multi-Provider Verification Authorized:** Cross-provider `plan-council`, `coordinator-run`, parallel disjoint waves, `perf_size_loop`, `sharded_audit`, and read-only `cross_pr_review` are formally authorized (superseding the `2026-11-20` Codex-only note in `STATUS.md`).
3. **Contract Compatibility Boundary:** Root `.` preserves backward-compatible 1.x behavior (including synchronous `append`); new post-1.0 capabilities ship via `0 B`-tax opt-in subpaths; targeted `contracts.ts`/`public.ts` changes require C4's RFC.
4. **Release & Framework Adapters Deferred:** Release freeze/tag/publish and `@axylo/react`/`vue`/`svelte` adapters are parked until release time.

---

## 2. Reconciled Packed Consumer Size Baseline (`c0fcc17`)

Previously, `scripts/size.mjs` (`108/128 KiB`, updated `2026-11-24`), `docs/02-product-spec.md` DX7 (`98/116 KiB`), `acceptance/matrix.json` P6 (`98/116 KiB`), and `acceptance/test/check.test.mjs:635` (`[98, 116]`) were out of sync, and `scripts/size.mjs` omitted standalone `histogram` and `bare import` rows. C0.1 reconciles all four to the single `108/128 KiB` reference in `scripts/size.mjs` and adds both missing rows:

| Packed Consumer Entry | Minified B | JS Gzip-9 B | CSS Gzip-9 B | Total KiB | Reference Target |
|---|---:|---:|---:|---:|---:|
| `line only (examples/first-chart/npm.ts)` | `375,223` | `134,860` | `—` | `131.70` | `108 KiB` (`110,592 B`) |
| `everything (export * from axylo)` | `432,823` | `157,645` | `—` | `153.95` | `128 KiB` (`131,072 B`) |
| `area only (export { area } from axylo)` | `382,007` | `137,578` | `—` | `134.35` | `—` |
| `bar only (export { bar } from axylo)` | `366,322` | `130,884` | `—` | `127.82` | `—` |
| `histogram only (export { histogram } from axylo)` | `320,902` | `114,234` | `—` | `111.56` | `—` |
| `scatter only (export { scatter } from axylo)` | `339,741` | `122,494` | `—` | `119.62` | `—` |
| `donut only (export { donut } from axylo)` | `269,480` | `93,947` | `—` | `91.75` | `—` |
| `validate only (export { validate } from axylo)` | `70,343` | `26,473` | `—` | `25.85` | `—` |
| `bare import (import 'axylo')` | **`0`** | `20` | `—` | `0.02` | `0 B raw` |
| `script tag (axylo.iife.min.js + axylo.css)` | `433,367` | `157,963` | `3,275` | `157.46` | `—` |

- Rebuilt vs packed `dist/axylo.js`: **`432,875 B`** identical (`0 B` drift).
- Top minified directories (`everything`): `core/` `88,427 B` (`20.4%`), `data/` `88,420 B` (`20.4%`), `dom/` `74,245 B` (`17.2%`), `theme/` `31,370 B` (`7.2%`), `render/` `25,709 B` (`5.9%`), `lookup/` `24,600 B` (`5.7%`).
- Historical reconciliation note: `bench/size-latest.json` (`2026-11-24`, `107.05 / 127.83 KiB`) was measured on a dirty `edc3e9d` tree prior to R2 Speed Cycle 2 (`9e1301f`) and Memory Cycle 3 (`f127488`); R2 Size Cycle 4 (`c0fcc17`) clawed back `-31.4 / -32.0 KB` minified (`-4.22 / -4.35 KiB` gzip-9) with zero speed or memory regressions. Opt-in streaming separation (`C3.1`) is the next structural size lever.

---

## 3. Longitudinal Chrome A/B Baseline (`93191f7` -> `c0fcc17`)

- `mem 1x1000000`: `ownedBytes` `999.3 KiB -> 22.8 KiB` (`-97.7%`, `ownedRatio 0.001`), `backingStorageChartBytes` `1.09 MiB -> 60.7 KiB` (`-94.5%`).
- `compact 40x`: `taskMs -8.7%` (plus `-2.6%` in Size 4), `heapChartBytes -15.7%`, `rendererPssChartBytes -10.5%`.
- `page trend 24x`: `taskMs -10.0%` (plus `-2.9%` in Size 4), `heapChartBytes -11.7%`, `rendererPssChartBytes -6.1%`.
- `page bar 24x`: `taskMs -6.8%` (plus `-2.0%` in Size 4), `heapChartBytes -11.1%`, `rendererPssChartBytes -4.6%`.
- `first 1x100000`: `taskMs -13.5%` (flat `+0.4%` in Size 4), `heapChartBytes -7.2%`.
- `stream w600`: `-8.7%..-13.7%` in Speed 2, `-3.1%` in Memory 3, `-5.5%` in Size 4; `0` late frames.
- `zoom 1x100000`: `-9.3%` in Speed 2, flat (`0.0%`) in Size 4.
- `lifecycle 2500c`: `0 / 0 / 0` net listener/observer/node leaks.

---

## 4. Acceptance Matrix Baseline (`acceptance/matrix.json`)

- **96 criteria total:** `A` (10), `C` (5), `DX` (12), `F` (12), `I` (6), `L` (8), `P` (8), `T-*` (35 across 6 matrix columns: `line`, `area`, `bar`, `scatter`, `donut`, `compact`).
- **Known pre-C1 gap:** `histogram` is exported and tested (`packages/axylo/test/browser/chart/histogram.browser.test.ts` + unit tests) but is not a column in the 1.0 6-column matrix; `C1.1` explicitly tracks `histogram` applicability and test evidence across all 12 PERS user journeys.
