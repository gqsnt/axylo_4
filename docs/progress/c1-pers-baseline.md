# Campaign C1 — PERS & Split-Protection Baseline Ledger

**Sealed Commit:** `ccb5698` on `feat/c0-c1-pers-baseline` (`2026-11-26`)
**Purpose:** Frozen pre-C2 Product Experience Regression Suite (PERS) baseline and split-protection verification gate before consolidating `packages/axylo/src/core/controller.ts` (3,211 LOC) and `packages/axylo/src/dom/interaction.ts` (1,769 LOC).

## 1. Delivered Artifacts

- **C1.1 PERS Gate & 12-Journey Index (`c538758`, `602a7ee`, `7ea7848`, `ccb5698`):**
  - `acceptance/journeys.json` — all 12 product journeys with named owners, outcome guarantees, applicable kinds (including `histogram`), matrix IDs, canonical test citations, screenshots, benchmark workloads, rehearsal tasks, separated automated ARIA vs manual AT status, and owned gaps aligned to `C3.2`/`C3.3`.
  - `acceptance/journeys.mjs` + `acceptance/check.mjs` (`--pers`) + `acceptance/titles.mjs` (`tokens`) — additive PERS evaluation gating on both matrix cell failures and any assertion/suite failure in journey-cited `testFiles[]` or `accessibilityEvidence.automated[]` (even outside `acceptance/matrix.json`), with canonical repo-relative path validation, confined docs/rehearsal slug checks, and tokenized `bench/lib/refs.mjs` + `bench/run.mjs` `workloadParams` switch validation.
  - `acceptance/test/journeys.test.mjs` — negative controls covering missing/duplicate/unknown journeys, non-test/non-canonical/escaping citations, commented-out and string-literal benchmark cases, journey-only archived test failures, automated ARIA suite crashes, and stale provenance blocking.
- **C1.2 Split-Protection Regression Suites & Precision Fix (`d6625f0`, `076f505`, `7ea7848`, `ccb5698`):**
  - `packages/axylo/test/core/split-seams.test.ts` (15 tests, including `fast-check` properties): reentrant diagnostic delivery (`AX103` append, throwing listener in strict/non-strict, destroy-on-diagnostic), queued microtask zoom cancellation & readiness settlement, histogram count/probability/density conservation through sample eviction, exact arithmetic bin midpoints (incl. float64 overflow & adjacent-ULP boundaries), controller zoom domains (`line`, `scatter`, `histogram`), and stateful strict streaming through Pause/Resume (`line`, `scatter`).
  - `packages/axylo/test/browser/chart/split-seams.browser.test.ts` (7 Chrome Playwright tests): strict DOM rollback from non-empty baseline, keyboard focus survival across `zoom()`/`update()`/floating↔strip resize with exact 2-stop `proxy → toolbar → #after` exit, 5-way `Frame`-backed readout parity on Histogram (`bins: [0, 2, 5, 10]` under count, probability, and verified `[1, 8]` zoom) & Donut (pointer + keyboard + select + table), 3-cycle Pause → total-window eviction → Resume (separate pinned-tooltip + fresh row select vs frozen-table cycles, post-Resume focus recovery, CDP `document`/`window`/`document.fonts` zero listener leak), and `destroy()` mid-held-corridor, mid-Select-range, and during in-flight `ResizeObserver` + real async `FontFace` `loadingdone`.
  - `packages/axylo/src/data/histogram.ts:195-196` — eliminated 1-ULP double rounding in histogram bin midpoint calculation (`const sum = lo + hi; values[i] = Number.isFinite(sum) ? sum / 2 : lo / 2 + hi / 2;`), discovered by `split-seams.test.ts`'s `fast-check` midpoint property.

## 2. Live Verification Snapshot (`ccb5698`)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS |
| Acceptance checker + PERS tests | `node --test acceptance/test/*.test.mjs` | **60/60 PASS** (1 expected skip) |
| Full Node unit & property suite | `node acceptance/run.mjs unit` | **2,036 / 2,036 PASS** (379 suites, 0 failed) |
| Packed dist browser suite | `node acceptance/run.mjs dist-browser` | **26 / 26 PASS** (28 suites, 0 failed) |
| Full Chrome browser suite | `node acceptance/run.mjs browser` | **1,181 / 1,183 PASS** (100% of `packages/axylo/test/browser/**` PASS, incl. `split-seams.browser.test.ts` 7/7; 2 pre-existing `apps/docs/test/theme.browser.test.ts` failures) |
| Live PERS check | `node acceptance/check.mjs --pers --results unit browser dist-browser` | **Exit 0** (`0 fail · 0 not run · 0 stale · 12 weak · 19 owned gaps`) |

## 3. Frozen 12-Journey PERS Baseline (`ccb5698`)

Summary: `0 pass · 12 weak · 0 fail · 0 not run · 11 histogram-applicable (8 test-backed, 3 gap-only) · 5 with manual AT open · 19 owned gaps`
Matrix rollup: `94 pass · 170 weak · 12 fail (DX7/P6 size targets only) · 0 no evidence · 32 not run · 0 stale · 11 cannot be verified here · 257 n/a`

| Journey | Owner | Matrix Pass/Weak/Fail (Not Run) | Auto ARIA vs Manual AT | Owned Gaps | Status |
|---|---|---|---|---|---|
| `first-impression` | core-experience | 11/17/0 (1) | 2 automated · not-applicable | `histogram-matrix-column` | weak |
| `reading` | core-experience | 9/23/0 (0) | 2 automated · not-applicable | `histogram-matrix-column` | weak |
| `hover` | interaction | 14/1/0 (0) | 1 automated · not-applicable | `histogram-matrix-column` | weak |
| `explore` | interaction | 0/19/0 (0) | 2 automated · gap-open | `histogram-matrix-column`, `explore-manual-at` | weak |
| `compare` | core-experience | 13/11/0 (0) | 1 automated · not-applicable | — | weak |
| `resize` | core-experience | 0/17/0 (5) | 1 automated · not-applicable | `histogram-matrix-column`, `histogram-resize-test` | weak |
| `mobile-touch` | interaction | 0/13/0 (5) | 1 automated · gap-open | `histogram-matrix-column`, `real-device-touch` | weak |
| `keyboard` | a11y | 5/5/0 (0) | 2 automated · gap-open | `histogram-matrix-column`, `a3-manual-at` | weak |
| `screen-reader` | a11y | 17/13/0 (0) | 3 automated · gap-open | `histogram-matrix-column`, `manual-screen-reader` | weak |
| `invalid-data` | diagnostics | 9/26/0 (0) | 1 automated · not-applicable | `histogram-matrix-column` | weak |
| `customization` | theme | 0/24/0 (0) | 2 automated · not-applicable | `histogram-matrix-column`, `histogram-theme-test`, `windows-forced-colors` | weak |
| `live-data` | streaming | 10/2/0 (12) | 1 automated · gap-open | `histogram-matrix-column`, `a7-manual-at` | weak |

## 4. Packed Size Baseline Entering C2 (`bench/size-latest.json`)

- `line only`: **134,868 B** gzip-9 (`131.71 KiB`) — C2 cumulative cap `≤ +307 B` (`≤ 135,175 B`)
- `everything`: **157,656 B** gzip-9 (`153.96 KiB`) — C2 cumulative cap `≤ +307 B` (`≤ 157,963 B`)
- `histogram only`: **114,240 B** gzip-9 (`111.56 KiB`)
- `bare import`: **0 B** minified (`20 B` empty gzip)

## 5. Cross-Provider Sign-Off

- **Anthropic `opus-5.5-medium`** (`axylo_c1_2_node_review`): **`Verdict: Merge`** on OpenAI-authored `split-seams.test.ts` + `histogram.ts` midpoint fix + `journeys.json` wiring.
- **OpenAI `sol-6.2-medium`** (`axylo_c1_final_signoff_v2`): **`Verdict: Merge`** on Anthropic-authored `C1.1` PERS + `split-seams.browser.test.ts` + all final fixes on `ccb5698`.
