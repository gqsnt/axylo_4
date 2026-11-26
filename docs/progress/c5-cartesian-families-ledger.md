# Campaign 5 Ledger — Cartesian Feature Families (`axylo/stats`, Ranges/Error Bars, Annotations, `axylo/sync`)

**Branch:** `feat/c5-cartesian-families` (branched from C4-sealed `94d6df4`)  
**Status:** Sealed & Verified (C5.1 Stats & Intervals → C5.2 Annotations → C5.3 Sync → C5.4 Hygiene & Cross-Provider Review)

---

## Summary of Delivered Capabilities

1. **Opt-In `axylo/stats` (`C5.1`, `packages/axylo/src/stats.ts`):**
   - Deterministic `quantile()`, `quantiles()`, `summarizeBox()`, and `boxplot()` transform with explicitly documented **Hyndman & Fan Type 7 (R-7)** quantile interpolation and **Tukey `1.5 × IQR`** whisker/outlier fences.
   - Zero DOM access, zero runtime dependencies, zero borrowed-column mutation, and typed columnar output directly consumable by `axylo/cartesian`.
2. **Range Bands & Error Bars in `axylo/cartesian` (`C5.1`):**
   - Added `range` (`low`/`high` flat borrowed typed columns) and `errorBar` (`y?`/`low`/`high`/`capWidth`) layer types sharing the single `axisScaleOf` projection authority.
   - Batched all error-bar whiskers and end-caps into a single typed `Float32Array` `PathMark` (`O(N)`, 1 SVG `<path>` even at 100k rows), preserved singleton valid range slots across zoom, and emitted warning diagnostic `AX176` with offending row indexes for reversed bounds (`low > high`) while keeping raw values intact in tooltips and accessible tables.
3. **Opt-In Annotations in `axylo/cartesian` (`C5.2`, `packages/axylo/src/cartesian/annotations.ts`):**
   - Added `annotations` supporting point event markers, labelled thresholds, and shaded x/y ranges with `axisId` binding, `positionReader` x-parsing (supporting `wall`, `date`, `time`, `number`, and `category` with `AX107` on invalid coordinates), strict plot clipping across zoom/resize, greedy label collision avoidance seeded with existing placed labels (`Reference` / ticks / titles), `fit.y.hidden` overflow tracking (zero silent loss), and accessible summary descriptions.
4. **Opt-In `axylo/sync` (`C5.3`, `packages/axylo/src/sync.ts`):**
   - Linked hover and zoom (`createSyncGroup`, `syncCharts`) with reentrancy guard (single propagation, zero feedback loops), `xKind`/`xUnit` compatibility gating across events, clears, and resets (`onMismatch`), ISO-8601/Date instant normalization, deterministic `unmatchedHover` (`'clear' | 'ignore' | 'nearest'`), scoped per-attachment `detach()`, and full `destroy()` leaving `0/0/0` listeners/observers/DOM nodes in real Chrome.

---

## Verified Size & Regression Ledger (vs Clean C3-Sealed `b097f1a`)

| Entry | `b097f1a` gz9 | C5 Sealed gz9 | Delta vs `b097f1a` | Cap / Guard |
|---|---:|---:|---:|---|
| `line` (`examples/first-chart/npm.ts`) | 135,293 B | **135,241 B** | **−52 B** | `<= +0 B` PASS |
| `everything` (`export * from 'axylo'`) | 158,096 B | **158,084 B** | **−12 B** | `<= +0 B` PASS |
| `axylo/static` `line` | 120,729 B | **120,675 B** | **−54 B** | `<= +0 B` PASS |
| `axylo/static` `everything` | 140,988 B | **140,961 B** | **−27 B** | `<= +0 B` PASS |
| `axylo.iife.min.js` | 158,425 B | **158,372 B** | **−53 B** | `<= +0 B` PASS |
| `axylo/cartesian` standalone | — | **<= 127,000 B** | — | PASS |
| `axylo/stats` standalone | — | **<= 3,500 B** (~1.5 KiB) | — | PASS |
| `axylo/sync` standalone | — | **<= 3,500 B** (~1.5 KiB) | — | PASS |
| Bare imports (`ignoreAnnotations: true`) | 0 B | **0 B** | **0 B** | `=== 0 B` PASS (all 6 entries) |
