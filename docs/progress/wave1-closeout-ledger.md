# Wave 1 Closeout Ledger (`N1` + `N2` + `N7a`)

**Date:** `2026-11-27`  
**Branch:** `phase2/wave1-integration`  
**Merged Cycles (all Sol 6.2 High Coordinator + unconditional cross-provider `Verdict: Merge`):**
- **Cycle N1 (`phase2/n1-evidence-gate`, `816c3ad`):** Restored strict PERS graduation gate (`--pers-strict` / `--pers --release`), expanded from 12 → 16 journeys covering all 7/7 Axylo 4 opt-ins with 28 honest tracked gaps, formalized C4 RFC ratification (`axylo_p2_n1_evidence_gate`).
- **Cycle N2 (`phase2/n2-visual-responsive`, `60b04cf`, merged at `3568c9c`):** Fixed the 2 failing docs painted-color tests (`apps/docs/test/theme.browser.test.ts`), closed `F-RESP-1` (`legend: 'right'` pure-CSS container-query fallback at `<= 480px` including fixed `320px` height & shrink-to-fit intrinsic width), shipped mark-aware `cartesian` legend/tooltip swatches (`src/dom/mark-swatch.ts`, `0 B` in root/static), hardened tooltip overflow & dominant 90/10 donut hole/side placement, and added an 82-test Chrome visual/responsive matrix (`axylo_p2_n2_visual_responsive` + `axylo_p2_n2_finish`, 90/90 configured Chrome tests passing).
- **Cycle N7a (`phase2/n7a-finance-panes`, `c3beeaa`, merged at `2714129`):** Reworked `axylo/finance` from the `-36%` price-domain hack into a true split-pane layout (`src/finance/layout.ts`, independent price + volume panes, clips, ticks, and preserved explicit `yAxis.domain`), wired `yAxis.label`, added semantic CSS tokens (`--axylo-up`/`--axylo-down`/`--axylo-volume`), added `O(plotWidth)` dense-candle OHLCV pixel-bin aggregation (`src/finance/aggregate.ts`), hardened AX199 preview-boundary rollback & `#deliverRejected` strict handler delivery (`src/core/controller.ts`), and kept **`0 B` finance code** in root/static bundles (`axylo_p2_n7a_finance_panes` + `axylo_p2_n7a_finish` + `axylo_p2_n7a_finish2`).

---

## 1. N2 Visual Screenshot Gallery Capture & Human/Agent Visual Inspection

- **Capture command:** `AXYLO_BROWSER=1 AXYLO_N2_SHOTS=docs/progress/screenshots/n2 npx vitest run --configLoader native --no-cache packages/axylo/test/browser/chart/n2-visual-responsive.browser.test.ts`
- **Artifacts saved:** **78 fresh Chrome PNGs** under `docs/progress/screenshots/n2/` covering all 7 chart kinds (`line`, `area`, `bar`, `histogram`, `scatter`, `donut`, `cartesian`) × 3 schemes (`light`, `dark`, `forced`) × 3 viewports (`960px`, `360px`, `320×256` @ DPR 4), plus `F-RESP-1` (`legend-right-*`), `cartesian-swatches-*`, narrow `220px` strips (`strip-*`), and `repair-*` regressions.
- **Direct visual inspection completed across 12 representative PNGs** (`line-light-960`, `cartesian-dark-960`, `cartesian-forced-360`, `cartesian-forced-320x4`, `legend-right-960-before`, `legend-right-360-fixed-height`, `repair-donut-dominant-360`, `histogram-dark-360`, `scatter-light-960`, `donut-forced-960`, `strip-cartesian-dark-360`, `repair-strip-stacked-total-220`):
  - **Confirmed crisp / passing visually:** Light/dark/forced contrast on `960px` and `360px`; French/German/Japanese typography & number formatting; `F-RESP-1` right-rail (`960px`) → bottom strip (`360px` fixed `320px` height) with zero clipping; mark-aware `cartesian` swatches (bar square, area wave, line+marker, range band, errorBar whisker); rotated & middle-truncated category labels with `"Some labels hidden. See table."` disclosure; dominant 90/10 donut and 220px narrow strip legibility.
  - **Open visual/a11y observations logged honestly for downstream cycles:**
    1. **Cycle N3 (`forced · 320x4` `GrayText` contrast):** In the `AXYLO_N2_SHOTS` run (`74/82` passed), all 7 `forced · 320x4` matrix cases failed contrast checks on `subtitle` and disabled `Zoom out` (`rgba(128,128,128)` `GrayText` on white `rgba(255,255,255)` = `3.95 < 4.5`), visibly confirmed in `cartesian-forced-320x4.png` (whereas `forced · 960` and `forced · 360` passed with dark system text). Investigate Chromium DPR-4 `forced-colors` `GrayText` mapping and ensure muted/disabled forced-colors contrast `>= 4.5:1` in N3.
    2. **Cycle N3 (reference-line label right-edge clearance):** In `line-light-960.png` and `legend-right-960-before.png`, the right-aligned reference-line label slightly touches the last right-edge data marker.
    3. **Cycle N5 (interval legend grouping — already planned):** `cartesian-dark-960.png` and `cartesian-forced-360.png` visibly confirm that `range` (`Low`, `High`) and `errorBar` (`Lower`, `Upper`, `Mean`) still emit per-field legend entries; N5 consolidates each interval layer into one legend entry/toggle.

---

## 2. Wave 1 Packed Size Baseline (`bench/size-latest.json`)

| Entry | Pre-Wave 1 (`816c3ad`, gz9 B) | Wave 1 (`2714129`, gz9 B) | Delta | Notes |
|---|---:|---:|---:|---|
| `line only` (root) | `135,241` (`132.07 KiB`) | `135,671` (`132.49 KiB`) | `+430 B` | Core `F-RESP-1` CSS + tooltip hole/overflow fixes + `controller.ts` `#deliverRejected` strict AX199 fix |
| `everything` (root) | `158,084` (`154.38 KiB`) | `158,539` (`154.82 KiB`) | `+455 B` | `0 B` from `mark-swatch.ts` and `0 B` from `finance/*` |
| `axylo/static` (`line only`) | `120,675` (`117.85 KiB`) | `121,111` (`118.27 KiB`) | `+436 B` | Same core CSS/tooltip/controller fixes |
| `axylo/cartesian` | `124,168` (`121.26 KiB`) | `125,477` (`122.54 KiB`) | `+1,309 B` | Includes new mark-aware `dom/mark-swatch.ts` |
| `axylo/finance` | `118,472` (`115.70 KiB`) | `124,473` (`121.56 KiB`) | `+6,001 B` | Real split-pane price+volume layout + OHLCV pixel-bin aggregation |
| `bare import` | `20 B` | `20 B` | `0 B` | Zero import-time side effects preserved |

*(Global size optimization toward the advisory `108 / 128 KiB` targets remains scheduled for Cycle N10 `perf_size_loop`.)*

---

## 3. Clean-HEAD Verification & Provenance Status

Immediately after committing this ledger, the 78 N2 screenshots, and `bench/size-latest.json`, the Director runs the full clean-HEAD verification & provenance suite (`dirty: false`):
- `npm run typecheck`
- `node --test acceptance/test/*.test.mjs`
- `node acceptance/run.mjs unit`
- `node acceptance/run.mjs dist`
- `node acceptance/run.mjs dist-browser`
- `node acceptance/run.mjs browser` (full Chrome library browser suite)
- `node acceptance/check.mjs --pers --results acceptance/results/unit.json acceptance/results/dist.json acceptance/results/dist-browser.json acceptance/results/browser.json`

Pre-existing C3–C6 `dist` release-hygiene gaps (`THIRD-PARTY-NOTICES.md` missing the 21 new packed subpath files; `tree-shaking.test.ts` expecting `view/stack.ts` in `line`/`histogram`; `isolation.test.ts` symlink check) remain tracked honestly as open until release/N10 cleanup.

---

## 4. Next Step (Paused Pending Prism 6.3)

Execution pauses cleanly at the end of Wave 1 (`phase2/wave1-integration`, synced into `/home/canarit/projects/axylo`) while **Prism 6.3** ships (Codex resume metering, full `verify()` logs, `_parse_action`/`No Merge` parser fixes, coordinator resume/turn budgets, and workspace GC). Once Prism 6.3 is ready, Phase 2 resumes directly at **Wave 2 (`N3` Interaction/A11y/3-Engine ∥ `N4` `axylo/cartesian` Decimation & RFC §8)** using the pre-staged briefs and sealed `axylo_p2_n6_council` / `axylo_p2_n8_council` proposals.
