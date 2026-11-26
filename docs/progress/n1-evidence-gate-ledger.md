# Cycle N1 — Evidence Gate Restoration & PERS Ledger

**Phase:** Phase 2 Foundation (`phase2/n1-evidence-gate`)  
**Date:** `2026-11-26`  
**Contract & Production Boundary:** Zero edits to `packages/axylo/src/public.ts`, `packages/axylo/src/**`, `acceptance/matrix.json`, or package dependencies.

---

## 1. Evidence Gate Tightening (`acceptance/`)

Cycle N1 closed the evidence-gate holes identified in the forensic audit of `c0fcc17..c657cc6`:

1. **Strict PERS Graduation Gate (`--pers --release` and `--pers-strict`):**
   - `acceptance/check.mjs` and `acceptance/journeys.mjs` preserve backwards-compatible diagnostic `--pers` reporting (blocking on `status === 'fail'` or `provenanceError`) and ordinary `--release` matrix semantics, while adding a non-bypassable strict graduation bar under `--pers --release` or `--pers-strict`.
   - Graduation requires: at least one supplied Vitest result file, clean matching combined-inventory provenance (`dirty: false` and `changedDuringRun: false` as explicit booleans, matching commit, tree SHA-256, result SHA-256, and combined matrix + journey cited test hashes), every cited test file executed with genuinely source-registered passing assertions (and identifiable engine metadata on browser files), every exact `testCitations` entry passing on its target engine with source-backed ancestry and without skips, zero open `ownedGaps`, and passing linked matrix cells. Journeys with `matrixIds: []` (direct evidence only) pass strict graduation when all cited files and assertions pass cleanly with zero gaps.
   - Missing or malformed/invalid JSON provenance sidecars return structured provenance blockers (`missing-provenance`, `malformed-provenance`, `stale-provenance`, `dirty-provenance`) in `check()` and Markdown without throwing early. Ordinary `--release` preserves acceptance of genuinely matching legacy matrix-only sidecars; diagnostic `--pers` accepts them while documenting that evidence is bound to the matrix-only inventory (granting no strict credit or unhashed journey-file credit), and strict graduation rejects matrix-only sidecars and any corrupted or unknown extra hashes.
   - Filtered journey-only template-backed test omissions warn rather than throwing from `confirmTitles()`, surfacing `unrun-citations` in `pers.blockers` and strict exit/summary cleanly. Combined `--pers --release` reports and CLI output explicitly distinguish a passing PERS rollup from an overall release blocked by independent matrix release rules.
   - Structured `pers.blockers` (with `scope`, `code`, `journeyId`/`file`, and `message`) are returned in `check()` and rendered under `### Graduation blockers` in Markdown, with explicit CLI status summaries and `exitCode = 1` when blocked.
2. **Journey-Only Indexing & Provenance Hashing (`check.mjs`, `provenance.mjs`, `run.mjs`):**
   - `readResults()` in `acceptance/check.mjs` now indexes assertion results and `suiteFailures` for all `knownPaths` (both `matrix.json` sources and `journeys.json` journey-only files), enabling source-scanner validation (`titles.mjs`), source-backed ancestry checks, and file-only source registration checks across all cited test files.
   - `citedTestFiles(matrix, journeys)` in `acceptance/provenance.mjs` and `acceptance/run.mjs` now hashes journey-only test files alongside `matrix.json` citations so sidecars and `check()` validate the complete test surface.
3. **Mandatory Negative-Control & Graduation Tests (`acceptance/test/journeys.test.mjs`):**
   - `dirty: true` provenance sidecar (and missing/non-boolean `dirty` or `changedDuringRun`), malformed/invalid JSON sidecars, and `resultSha256` mismatches block strict graduation with structured blockers.
   - `not run` journeys (no runs supplied, absent cited test, passed-sibling-only run, skipped exact assertion, empty suite `assertionResults: []`, wrong suite ancestor, nonexistent source ancestry, unknown file-only titles, browser results lacking an identifiable engine, and filtered journey-only template omissions) block graduation.
   - `weak` journeys (passing tests with open `ownedGaps`, and an isolated weak-matrix control with clean current provenance, passing tests, and zero owned gaps where ordinary `--release` admits the documented gap while strict PERS blocks with `matrix-incomplete`) block graduation.
   - Stale / wrong-commit / tampered journey-only test hash provenance (and corrupted/extra hashes alongside legacy matrix-only hashes) blocks both `--pers` and graduation; genuinely matching legacy matrix-only sidecars pass ordinary `--release`, are documented as matrix-only in diagnostic `--pers`, and block strict graduation.
   - Journey-only assertion/suite failures (including historical failures alongside a clean run, and coexisting valid + unrelated titles) keep failures blocking while counting only valid identities positively.
   - Clean-provenance passing results with zero open gaps pass graduation (`blocked === false`, `exitCode === 0`), including direct-evidence journeys with `matrixIds: []` and archived canonical suffix Chrome/packed assertions.
   - Combined `--pers --release` where PERS passes (`16/16`) while an independent matrix criterion blocks release outputs `matrixReleaseBlocked: true`, `exitCode: 1`, and never prints overall `PASS (exit 1)`.
   - Source scanner rejection of unknown titles, nonexistent ancestry, `.skip` citations, unbacked citations, and missing/unknown `packages/axylo/package.json` opt-in manifest coverage.
   - CLI exit code and summary output checks for `--pers`, `--pers-strict`, `--pers --release`, and `--help`.

---

## 2. Before / After PERS Inventory Counts

| Metric | Before N1 (Baseline JSON) | After N1 | Notes |
|---|---:|---:|---|
| Total tracked journeys | **12** | **16** | 12 core (`J1–J12`) + 4 Axylo 4 opt-in (`J13–J16`) |
| Axylo 4 opt-in entry points covered | **0 / 7** | **7 / 7** | `static`, `stream`, `cartesian`, `stats`, `sync`, `export`, `finance` |
| Histogram-applicable journeys | **11** | **11** | `compare` remains non-applicable |
| Histogram test-backed journeys | **10** (file-level only) | **10** (exact `testCitations`) | Backed by verbatim titles in `data/histogram.test.ts`, `core/split-seams.test.ts`, `core/c3-a11y-touch.test.ts`, `browser/chart/{histogram,split-seams,c3-journeys}.browser.test.ts` |
| Histogram gap-only journeys | **1** (`mobile-touch`) | **1** (`mobile-touch`) | Emulated touch + real-device touch still unverified on histogram |
| Boilerplate `histogram-matrix-column` gaps | **11** (targeting `C3.2`) | **0** | Retired completely; replaced only where genuinely unverified |
| Core (`J1–J12`) open gaps | **17** (11 boilerplate + 6 manual/touch/contrast) | **16** | 10 specific N2/N3 histogram gaps (incl. `histogram-strict-update-rollback`, `histogram-keyboard-update-append-focus`, and `histogram-messages-font-spacing`) + 6 updated core manual/touch/contrast N3 gaps |
| Opt-in (`J13–J16`) open gaps | — | **12** | `0` in `J13`, `4` in `J14`, `3` in `J15`, `5` in `J16` (incl. `finance-strict-rollback-state-assertion` in N7) |
| **Total open owned gaps** | **17** | **28** | 16 core (`J1–J12`) + 12 opt-in (`J13–J16`) |

---

## 3. Honest Open Gap Map Across Phase 2 Cycles (`N2–N11`)

| Target Cycle | Journey(s) | Gap ID(s) | Open Obligation |
|---|---|---|---|
| **N2** | `first-impression`, `invalid-data`, `customization`, `cartesian-multiscale`, `export-finance` | `histogram-first-impression-visual`, `histogram-strict-update-rollback`, `histogram-messages-font-spacing`, `cartesian-visual-swatches`, `export-finance-visual-parity` | Visual swatches, plot-state screenshots (empty/loading/error on histogram), histogram strict `update()` rollback assertion, histogram `messages` replacement & CSS font/spacing inheritance, and dark/light/forced-colors visual review across histogram, `axylo/cartesian`, `axylo/export`, and `axylo/finance`. |
| **N3** | `reading`, `hover`, `explore`, `resize`, `mobile-touch`, `keyboard`, `screen-reader`, `customization`, `live-data`, `cartesian-multiscale`, `stats-sync`, `export-finance` | `histogram-legibility-contrast`, `histogram-hover-stability-multibrowser`, `histogram-zoom-inputs`, `explore-manual-at`, `histogram-resize-a6-multibrowser`, `histogram-touch-emulation`, `real-device-touch`, `histogram-keyboard-update-append-focus`, `a3-manual-at`, `manual-screen-reader`, `windows-forced-colors`, `histogram-live-pause-browser`, `a7-manual-at`, `cartesian-axe-multibrowser`, `stats-sync-visual-a11y-parity`, `export-finance-a11y-multibrowser` | `axe-core` coverage on C4–C6 entry points, multi-browser (Firefox/WebKit) parity, keyboard/update-append focus/touch/contrast/pause gaps on histogram & opt-in entries, native Windows High Contrast, real mobile touch, and manual assistive-technology runs. |
| **N4** | `cartesian-multiscale` | `cartesian-scale-perf-spec` | Building Cartesian benchmark fixture/adapter (current `bench/src/multichart.js` has no cartesian workload), RFC C4.1 §8 paired 100k Chrome performance proof (`<= 1.15x` startup, `<= 1.10x` zoom/hover p95), dense-line simplification/decimation, and formal `docs/02-product-spec.md` amendment (`F13`, `L9`, `AX170–AX181`). |
| **N5** | `cartesian-multiscale`, `stats-sync` | `cartesian-interval-legend-scatter`, `stats-native-boxplot-quantile-overflow` | Interval-layer (`range`/`errorBar`) legend leakage hardening, `scatter` layer in `axylo/cartesian`, native `boxplot` mark ergonomics, and `quantile()` overflow hardening. |
| **N6** | `stats-sync` | `sync-visual-peer-hover-teardown` | Real visual peer hover crosshair/readout rendering across synced charts and CDP-instrumented `0/0/0` listener/ResizeObserver/DOM teardown verification (`c5.browser.test.ts` currently verifies linked zoom, group membership, and `leftoverNodes === 0`). |
| **N7** | `export-finance` | `export-whole-figure-and-unpaginated-csv`, `finance-split-pane-volume-and-ylabel`, `finance-strict-rollback-state-assertion` | Whole-figure SVG/PNG export including chart title/legend, unpaginated closed-chart CSV export, split-pane volume y-axis ticks/gutter, `yAxis.label` rendering on `axylo/finance`, and full `titleText`/pre-failure state assertion for strict `update()` rollback in `tests/dist/finance.browser.test.ts`. |
| **N8–N11** | — | — | No pre-assigned snapshot gaps in `acceptance/journeys.json` at N1 (later Phase 2 roadmap cycles). |

---

## 4. Director Sealing Note

In this N1 snapshot, archived `acceptance/results/unit.provenance.json` and `acceptance/results/dist-browser.provenance.json` are `dirty: true` from earlier C7 work, and no current clean-HEAD `browser` or `dist` run exists on disk. Full clean-HEAD `browser`, `dist`, `dist-browser`, `unit`, and `size` provenance runs will be sealed by the Director immediately after Cycle N1 lands on `phase2/n1-evidence-gate`.
