# RFC C4.1 — Opt-In `axylo/cartesian` Multi-Scale & Log-Scale Composition

**Status:** Proposed (Architecture Council Verified & Revised After Semantic Audit; Awaiting Owner Authorization for Minimal Type-Only `contracts.ts` Diff & Spec Rows `F13`/`L9`)  
**Branch:** `feat/c4-cartesian-multiscale` (branched from sealed `C3` at `b097f1a`)  
**Date:** `2026-11-26`  
**Council Provenance:** Prism 6.2 `plan-council --profile arch` (`axylo-c4-1-cartesian-rfc`: Google `neon-4-medium` [Alpha, 21 grounded stream reads] + Anthropic `opus-5.5-high` [Delta, 11 grounded stream reads]) + live source verification + OpenAI `sol-6.2-medium` adversarial semantic audit (`axylo_c4_1_rfc_audit2` → revised & re-verified).

---

## 1. Executive Summary & Architectural Decisions

This RFC specifies the additive, zero-legacy-tax architecture for **`axylo/cartesian`**: a composable multi-scale Cartesian chart entry point supporting:
- **1 or 2 y-axes** (`'left'` primary and optional `'right'` secondary) addressed by **stable string axis IDs** (e.g. `'orders'`, `'latency'`),
- **`'linear'` and `'log'`** continuous value scales with IEEE-754 stable arithmetic and frozen monotonicity/round-trip bounds,
- **Mixed layers** (`bar`, `area`, `line`) sharing a single aligned `XColumn` (`AlignedFrame`) with zero copying of borrowed typed columns (`Float64Array` / `Float32Array`),
- **Single projection authority** (`projection.yAxes[]`, where `projection.y === projection.yAxes[0]`) shared identically by scene generation, pointer hit-testing, keyboard focus rings, overlays, and references,
- **Exact-data readout parity** across tooltips, keyboard `aria-valuetext`, summaries, and data tables (carrying exact axis title, series unit, axis-aware reference formatting, and raw values — including nonpositive values omitted from a `'log'` plot),
- **Static-only in C4.2–C4.3 (`createStaticChart`):** Streaming (`axylo/cartesian/stream`) is explicitly deferred until `controller-stream.ts:61` (`stream.drop()`), store-generated revisions, and `data/store.ts:1032` (`resolveEncoding`) support injected custom resolvers (`Composition.resolve`) and metadata preservation,
- **Strict `≤ 0 B` gzip-9 tax** on every existing entry (`axylo`, single-kind root imports, `axylo/static`, `axylo/stream`, `validate`, and `axylo.iife.min.js`) and **`0 B` raw bare import** under `ignoreAnnotations: true`.

### Key Architectural Findings Verified in Source
1. **Why `'log'` cannot masquerade as `'linear'` (`packages/axylo/src/scene/geometry.ts:37-46`):** `exactProjection(scale)` checks `if (scale.type !== 'linear' && scale.type !== 'time') return;` and treats every `'linear' | 'time'` scale as affine. Widening `ContinuousScale['type']` in `packages/axylo/src/core/contracts.ts:206` to `'linear' | 'time' | 'log'` is **100% type-only** (verified via esbuild: `contracts.ts` emits identical `241 B` before/after, and virtual TS 7.0.2 compilation yields 0 diagnostics) and automatically disables both `exactProjection` and `affineProjection` for `'log'`.
2. **Why `public.ts` requires ZERO edits:** `packages/axylo/src/public.ts:175-177` already types `Diagnostic['code']` as `` `AX${number}` ``. All new public Cartesian types live in `packages/axylo/src/cartesian.ts` (`dist/cartesian.d.ts`), leaving `public.ts` and `dist/public.d.ts` **100% byte-identical**.
3. **Why `AX170–AX175` MUST NOT be added to `diagnostics/registry.ts`:** `diagnosticRegistry` (`packages/axylo/src/diagnostics/registry.ts:53-164`) is retained in every bundle. Because `DiagnosticCollector.add` (`packages/axylo/src/diagnostics/collector.ts:12-44`) accepts direct `DiagnosticInput` objects without `diagnosticContext` and `readerDisclosure` (`collector.ts:55-61`) sums `count ?? rows?.length ?? 1` for any `level === 'warning'` with `effect === 'omitted'`, `packages/axylo/src/cartesian/diagnostics.ts` emits `AX170–AX175` directly into the sink at **0 B legacy tax**.

---

## 2. Legacy Stage Seam Map & Controller Carrier (`b097f1a`)

### 2.1 Carrier & Metadata Propagation Seam
- **Carrier kind:** `CARTESIAN_STATIC.kind = 'line'` (so `AlignedView.kind = 'line'`). Inherited `'line'` semantics: vertical orientation, zoom enabled, compact rendering supported, non-global-zero-baseline default (`view/index.ts:357` `zeroBaseline('line') === false`), and aligned hover/keyboard navigation. Per-axis zero baseline for `bar`/`area` layers is enforced inside `cartesian/view.ts` (never globally).
- **Per-chart state holder (`packages/axylo/src/cartesian/meta.ts`) & thin public facade (`packages/axylo/src/cartesian.ts`):** Instead of a `WeakMap<AlignedFrame, ...>` (which would lose metadata when `renamed(p.frame, resolved, rev)` at `core/controller-helpers.ts:459` creates a new frame object or retain stale domains when a domain-only `update` keeps `p.frame`), `cartesian(target, options)` allocates one small mutable state holder `stateRef = { meta: CartesianMeta }` per chart instance and passes `createCartesianComposition(stateRef)` (whose methods delegate to shared module-level functions — zero per-point closures) to `createStaticChart(composition, target, translated)`. Both `create` and the facade's `handle.update(patch)` update `stateRef.meta` synchronously BEFORE forwarding translated options to `ChartController`:
  - **`encodingChanged` (`core/stages.ts:51-69`):** `ENCODING_KEYS` checks `options.y`. Translating `{ x, axes, layers, reference, zoom, ...rest }` into `options.y` (ordered layer fields carrying `{ field, label, unit, domain, format, tickFormat }` plus non-ignored `axisId`, `mark`, `scale`, `base`, `position`, `stacked`) ensures any structural change to `axes` or `layers` triggers `encodingChanged === true` and re-normalizes cleanly with **0 edits** to `stages.ts` or `controller.ts`.
  - **`namesOnlyChanged` (`core/stages.ts:71-80`) & `renamed()` survival:** Changing only axis `label`/`unit` hits `namesOnlyChanged === true` (`controller.ts:539`) and invokes `renamed(p.frame, ...)`; because `cartesian/view.ts` and `cartesian/layout.ts` read `stateRef.meta` (never a frame-keyed `WeakMap`), axis/layer metadata and updated labels/units survive rename intact!
  - **Per-axis-ID domain invalidation (both primary & secondary):** Because `stages.ts:87,107` (`viewStateFor`/`viewKeyFor`) read only `resolved.values[0]?.domain` (and `options.y[1]` could belong to either axis), the facade computes a canonical string key over all axes sorted by `axisId` (`axesDomainSig = sortedAxisIds.map(id => id + ':' + domainOf(id)).join('|')`) and attaches `domainSig: axesDomainSig` onto `options.y[0]` (non-ignored by `PRESENTATION_PARTS` when any axis's `domain` changes in `update(patch)`). That guarantees **both** primary and secondary domain-only updates refresh `stateRef.meta` AND invalidate view/layout caches cleanly without relying on field position `y[1]` or editing `stages.ts`.
  - **Duplicate source field across axes:** Binding the same data `field` to two different axes (or two layers with conflicting axis bindings) is rejected at call time with **`AX174`**, guaranteeing a strict 1-to-1 mapping from `Series.field` to `resolved.values` and `Formatters.value(seriesIndex, v)` (`core/controller-helpers.ts:244-260`).

### 2.2 Stage-by-Stage Table

| Pipeline Stage | Source File & Lines | Current Assumption | C4.2–C4.4 Strategy (`≤ 0 B` Legacy Tax) |
|---|---|---|---|
| **Package exports & build** | `packages/axylo/package.json:23-39`, `scripts/build.mjs:58-72` | Builds `.`, `./static`, `./stream`. | Add `./cartesian` (static) entry in `package.json` & `scripts/build.mjs`. Defer `./cartesian/stream` until store resolver seam lands. |
| **Public types** | `packages/axylo/src/public.ts:1-229` | 6 legacy option interfaces; `Diagnostic.code` is `` `AX${number}` `` (`:177`). | **0 lines edited.** Export all Cartesian types from `src/cartesian.ts`. |
| **Internal contracts** | `packages/axylo/src/core/contracts.ts:93-109, 205-212, 246-252, 275-295, 381-386, 405-416` | `ContinuousScale.type: 'linear' \| 'time'`; single `yDomain`, `Projection.y`/`value`, `yTicks`, `fit.y`. | **Type-only additive diff** (Section 3): **0 B emitted JS**. |
| **Composition & layout diagnostics** | `packages/axylo/src/core/composition.ts:24-52`, `packages/axylo/src/core/controller.ts:1534-1542`, `packages/axylo/src/core/frame-state.ts:58-60` | `LayoutStage.tickFormatFailures?` returns `readonly string[]`; `controller.ts:1540` hardcodes `AX160` mapping; `frame-state.ts:60` sums `fit.x.hidden + fit.y.hidden`. | Replace `tickFormatFailures?` with `layoutDiagnostics?(view, ctx, layout): readonly DiagnosticInput[]` (moving the 1-line `AX160` mapping into `core/axes.ts`, shrinking `controller.ts:1539-1541` for **`≤ 0 B`** net root delta). `cartesian/layout.ts` returns both `AX160` (left + right) and `AX175` (`< 360 px`, auto-cleared on resize back to `≥ 360 px`). Fold right-axis hidden tick count into `fit.y.hidden` (while keeping `fit.yRight` optional) so `frame-state.ts:60` triggers `AX143` with **0 edits** to `frame-state.ts`. |
| **Options & normalize** | `packages/axylo/src/data/options.ts:8-9,50-57`, `packages/axylo/src/data/normalize.ts` | Single `y` / `y[]` field resolution. | `cartesian/options.ts` (`resolve`) validates `axes`/`layers` (`AX170`, `AX173`, `AX174`) and populates per-field `resolved.values` with each axis's `unit`/`format`/`tickFormat`/`domain`. `cartesian/normalize.ts` reuses `normalizeAligned` typed-column borrowing (`0` copies), emits aggregated full-frame `AX171` (nonpositive log values) directly into `dataSink` (so `controller.ts` retains it stably across zoom/pan/legend updates!), and updates `stateRef.meta`. |
| **Scales & ticks** | `packages/axylo/src/scale/linear.ts:65`, `packages/axylo/src/scale/domain.ts:26`, `packages/axylo/src/core/axes.ts:185-199,386` | Linear/time/band only; `axes.ts:386` applies global `zeroBaseline`. | Isolated `packages/axylo/src/scale/log.ts` (never re-exported by `scale/index.ts` or `core/axes.ts`) + `packages/axylo/src/cartesian/axes.ts`. |
| **View & readiness** | `packages/axylo/src/view/index.ts:357-387,542`, `packages/axylo/src/core/controller-helpers.ts:521` | Global `zeroBaseline(kind)`; single `yExtent()`; `hasDrawable` checks raw `SLOT_VALUE`. | `cartesian/view.ts` reads `stateRef.meta`, computes per-axis domains from `visibleSlots` of each axis's visible series, enforces `includeZero` on linear bar/area axes, rejects bar/area on `'log'` (`AX173`), checks all-nonpositive `'log'` axis (`AX172`), and marks an all-nonpositive `'log'` series `drawable: false` so `controller-helpers.ts:521` stays coherent. |
| **Layout** | `packages/axylo/src/layout/index.ts:212,283-297` | Single left y-axis. | `cartesian/layout.ts` builds `yAxes[]` (`0` = left, optional `1` = right), reserves dual gutters at width `≥ 360 px`, collapses right axis below `360 px` (`AX175`), sets `projection.y = yAxes[0]` & `projection.yAxes = yAxes`. |
| **Scene & geometry** | `packages/axylo/src/scene/geometry.ts:10-60,145-149`, `packages/axylo/src/scene/index.ts:23-46,84-102` | `exactProjection` (`:38`) already returns `undefined` for `'log'`; `position()` (`:10-20`) converts `NaN` to `±COORDINATE_LIMIT`. | **0 edits** to `scene/geometry.ts`. `cartesian/scene.ts` filters `slot === SLOT_VALUE && (scale.type !== 'log' || y > 0)` **before** calling `position()`, resolves scale via `axisScaleOf(projection, s.axisIndex)`, and paints `bar → area → line`. |
| **Lookup & focus** | `packages/axylo/src/lookup/aligned.ts:85-86`, `packages/axylo/src/core/focus.ts:183`, `packages/axylo/src/dom/interaction-nav.ts:15` | Single `projection.y` lookup. | `cartesian/lookup.ts` & `overlay.ts` filter nonpositive `'log'` samples before projection and share `axisScaleOf(projection, s.axisIndex)` — **one projection authority**. |
| **Reader & reference readout** | `packages/axylo/src/core/contracts.ts:190-192`, `packages/axylo/src/reader/index.ts:401-410` | `Formatters.value(seriesIndex, v)` is per-series, but `reader/index.ts:405` hardcodes `formatters.value(0, from)` for y-references. | In `C4.3`, `ReaderParts` exposes optional `formatReferenceValue?(view, ref, value, formatters): string`. When `ref.axis === 'y'`, `cartesian/reader.ts` resolves omitted `ref.axisId` explicitly to the **`'left'` axis ID** (`stateRef.meta.leftAxisId`, never `series[0]` which could be a right-axis layer declared first!) and formats **both** `from` and `to` band endpoints using that bound axis's own formatter/unit (works even when that axis currently has zero series). Verified `≤ 0 B` net root delta alongside the `controller.ts:1539` shrinkage. |
| **Diagnostics** | `packages/axylo/src/diagnostics/registry.ts:53-164`, `packages/axylo/src/diagnostics/collector.ts:12-62` | `AX170–179` unused; `collector.ts` handles direct `DiagnosticInput` without `diagnosticContext`. | `cartesian/diagnostics.ts` emits `AX170–AX175` via `reportCartesian(sink, ...)`, aggregating full omission counts + capped 10 row indices per field before emitting so message text and `count` always agree. **0 edits** to `registry.ts` or `collector.ts`. |

---

## 3. Minimal Type-Only Contract Diff Proposal (Owner Authorization Required)

**`packages/axylo/src/public.ts`:** **0 lines changed.**  
**`packages/axylo/src/core/contracts.ts`:** Strictly additive, type-only changes (verified: **0 B emitted JS**, `241 B === 241 B` identical via esbuild, `0` TS 7.0.2 library diagnostics):

```diff
--- a/packages/axylo/src/core/contracts.ts
+++ b/packages/axylo/src/core/contracts.ts
@@ -106,6 +106,10 @@ export interface Series {
   readonly slot: Uint8Array;
   /** Index of the caller's row each slot came from, -1 where there is none. null means "slot i came from row i" (typed columns). */
   readonly row: Int32Array | null;
+  /** Optional stable y-axis ID (multi-axis cartesian only; omitted on single-axis charts). */
+  readonly axisId?: string;
+  /** Optional index into `Projection.yAxes` (0 = primary left axis; omitted on single-axis charts). */
+  readonly axisIndex?: number;
 }
 
@@ -203,7 +207,7 @@ export interface Formatters {
 // ───────────────────────────── scales and ticks ─────────────────────────────
 
 export interface ContinuousScale {
-  readonly type: 'linear' | 'time';
+  readonly type: 'linear' | 'time' | 'log';
   readonly domain: readonly [number, number];
   /** Pixel range in CSS px; range[0] maps domain[0]. */
   readonly range: readonly [number, number];
@@ -246,6 +250,8 @@ export type TickCandidates = readonly (readonly Tick[])[];
 export interface ResolvedReference {
   readonly axis: 'x' | 'y';
+  /** Optional stable y-axis ID when `axis === 'y'` on multi-axis charts; defaults to primary y-axis (index 0). */
+  readonly axisId?: string;
   readonly from: number;
   /** Equal to `from` for a line. */
   readonly to: number;
@@ -282,6 +288,10 @@ interface CartesianViewBase {
   readonly xDomain: readonly [number, number];
   /** Value domain after the rules of spec F1 and F7. */
   readonly yDomain: readonly [number, number];
+  /** Per-axis value domains for multi-axis charts (`yDomains[0]` equals `yDomain`). */
+  readonly yDomains?: readonly (readonly [number, number])[];
+  /** Stable string IDs corresponding 1-to-1 with `yDomains`. */
+  readonly yAxisIds?: readonly string[];
   readonly references: readonly ResolvedReference[];
   readonly compact: boolean;
 }
@@ -380,9 +390,9 @@ export interface PlacedText {
 
 /** The mapping from data to pixels that scene building and lookup must share. */
 export type Projection =
-  | { readonly kind: 'xy'; readonly x: XScale; readonly y: ContinuousScale }
+  | { readonly kind: 'xy'; readonly x: XScale; readonly y: ContinuousScale; readonly yAxes?: readonly ContinuousScale[] }
   /** Bars: `band` runs along the category axis, `value` along the other; `horizontal` swaps the screen axes. */
-  | { readonly kind: 'bands'; readonly horizontal: boolean; readonly band: XScale; readonly value: ContinuousScale }
+  | { readonly kind: 'bands'; readonly horizontal: boolean; readonly band: XScale; readonly value: ContinuousScale; readonly yAxes?: readonly ContinuousScale[] }
   | { readonly kind: 'ring'; readonly cx: number; readonly cy: number; readonly r0: number; readonly r1: number };
 
@@ -409,9 +419,11 @@ export type Layout =
       readonly plot: Rect;
       readonly projection: Projection;
       readonly xTicks: readonly Tick[];
       readonly yTicks: readonly Tick[];
+      /** Ticks for the secondary (right) y-axis when rendered (multi-axis cartesian only). */
+      readonly yTicksRight?: readonly Tick[];
       readonly texts: readonly PlacedText[];
-      readonly fit: { readonly x: AxisLabelFit; readonly y: AxisLabelFit };
+      readonly fit: { readonly x: AxisLabelFit; readonly y: AxisLabelFit; readonly yRight?: AxisLabelFit };
     })
```

### Single Projection Authority Helper (`packages/axylo/src/cartesian/scale-ref.ts`)
```ts
export function axisScaleOf(projection: Projection, axisIndex = 0): ContinuousScale {
  if (projection.kind === 'ring') throw new TypeError('Ring projection has no y-axis.');
  const fallback = projection.kind === 'xy' ? projection.y : projection.value;
  return projection.yAxes?.[axisIndex] ?? fallback;
}
```
Invariant: whenever `projection.yAxes` is present, `projection.yAxes[0] === projection.y` (or `projection.value`) and `projection.yAxes.length <= 2`.

---

## 4. `'log'` Scale Mathematical Specification (`packages/axylo/src/scale/log.ts`)

### 4.1 Overflow-Safe, Branch-Continuous Mapping & Inversion
Let domain be $[d_0, d_1]$ with finite $0 < d_0 < d_1$, pixel range be $[r_0, r_1]$ with finite $r_0, r_1$, and display base $b \in \{10, 2\}$ (default `10`; runtime accepts ONLY `base === 10 || base === 2` — matching the tick algorithm — and rejects any other value with `AX170`).

**Never form `d1 / d0`** (overflows to `Infinity` across `[1e-300, 1e300]`), and **never switch log formulas mid-domain** (switching between `log1p` and `log` at $v = 1.5\,d_0$ causes a non-monotonic seam on $[10^{299}, 2 \cdot 10^{299}]$!). Choose the formula **once at scale construction time**:
- `const close = d1 - d0 <= 0.5 * d0;`
- $\ell_0 = \ln(d_0)$.
- $L = \text{close} \mathbin{?} \operatorname{log1p}((d_1 - d_0) / d_0) : \ln(d_1) - \ell_0$.
- $\text{invL} = 1 / L$, $R = r_1 - r_0$.

Mapping & inversion:
- **`map(v)`:**
  - If `!Number.isFinite(v) || v <= 0`, return `NaN` (callers MUST filter `y <= 0` before `scene/geometry.ts:10` `position()`, because `position()` maps `NaN` to `±COORDINATE_LIMIT`!).
  - If `v === d0` return `r0`; if `v === d1` return `r1`.
  - Compute $\Delta\ell = \text{close} \mathbin{?} \operatorname{log1p}((v - d_0) / d_0) : \ln(v) - \ell_0$ (uniform across the entire domain — zero branch discontinuity!).
  - Return $r_0 + (\Delta\ell \cdot \text{invL}) \cdot R$.
- **`invert(p)`:**
  - If `!Number.isFinite(p)`, return `NaN`.
  - Compare endpoints directly BEFORE division: if `R === 0 || p === r0` return `d0`; if `p === r1` return `d1`.
  - Let $t = (p - r_0) / R$.
  - Return $\text{close} \mathbin{?} d_0 \cdot (1 + \operatorname{expm1}(t \cdot L)) : \exp(\ell_0 + t \cdot L)$.

### 4.2 Frozen Numerical Admission & Tolerances (`C4.2` Property Oracle)
Admitted domain and CSS pixel range (verified in Node across extreme, narrow, and seam-boundary fixtures including `[1e299, 2e299]` at `p = 12345` and `1.5e299 → nextUp(1.5e299)`):
- **Admitted domain:** finite $d_0, d_1 \in [10^{-300}, 10^{300}]$ with log-span $L \ge 10^{-9}$ (computed without forming `d1 / d0`).
- **Admitted CSS range:** finite $r_0, r_1 \in [-10^6, 10^6]$ with $|R| \in [1, 10^5]$.
- Let $M_{\ln} = \max(1, |\ln d_0|, |\ln d_1|)$ and $P_{\max} = \max(|r_0|, |r_1|, 1)$.
- **Round-trip value tolerance:** For any finite $v \in [d_0, d_1]$,
  $$\frac{|\text{invert}(\text{map}(v)) - v|}{v} \le \max\!\bigl(10^{-11},\; 8\,\varepsilon_{\text{mach}} \cdot \bigl(M_{\ln} + L \cdot \tfrac{P_{\max}}{|R|}\bigr)\bigr)$$
  where $\varepsilon_{\text{mach}} = 2^{-52} = \text{Number.EPSILON}$, accounting for both absolute-log rounding ($M_{\ln}$) and pixel-coordinate rounding magnified by $L / |R|$ on shifted narrow pixel ranges (e.g. `[1e-300, 1e300]`, `range = [999999, 1000000]`, `v = 2`: measured `4.64e-8` vs bound `2.45e-6`, while normal `[0, 500]` plots remain tightly bounded by `1e-11`).
- **Round-trip pixel tolerance:** For any $p \in [\min(r_0, r_1), \max(r_0, r_1)]$,
  $$|\text{map}(\text{invert}(p)) - p| \le \max\!\bigl(10^{-9},\; 8\,\varepsilon_{\text{mach}} \cdot \tfrac{|R|}{L} \cdot M_{\ln}\bigr)\text{ px}$$
  accounting for both representable IEEE-754 value spacing $\varepsilon_{\text{mach}}/L \cdot |R|$ and absolute-log rounding $M_{\ln}$ (at `[1e299, 2e299]`, `range = [0, 100000]`, `p = 12345`: measured `7.71e-9 px` vs bound `1.77e-7 px`, 23× headroom).
- **Monotonicity:** For $d_0 \le v_1 < v_2 \le d_1$, $\text{map}(v_1) \le \text{map}(v_2)$ everywhere when $R > 0$ (reversed when $R < 0$) — including adjacent IEEE-754 doubles at `1.5e299 → nextUp(1.5e299)` (`diff = 0`, zero reversal) — and strictly $<$ whenever $\frac{\ln(v_2) - \ln(v_1)}{L} \cdot |R| > 8\,\varepsilon_{\text{mach}} \cdot P_{\max} \cdot M_{\ln}$.
- **Required C4.2 regression fixtures:** Include `[1e299, 2e299]` (`range = [0, 100000]`, `p = 12345` round-trip AND `1.5e299 → nextUp(1.5e299)` monotonicity), `[1e-300, 1e300]` (`range = [999999, 1000000]`, `v = 2` value round-trip AND 600-decade overflow safety), `[1, 1 + 1e-8]` (narrow `close === true` `log1p`/`expm1` stability), and `exactProjection(logScale) === undefined` / `affineProjection(logScale) === undefined`.
- **Nonpositive safety:** `map(0)`, `map(-0)`, `map(-1)`, `map(NaN)`, `map(-Infinity)` all return `NaN`.

### 4.3 Deterministic Nice Bounds & Tick Candidates
1. **Singleton domains (`d0 === d1`) handled FIRST (before span branching):**
   - Expand to $[\max(10^{-300}, d_0 / b),\; \min(10^{300}, d_0 \cdot b)]$. If $d_0$ sits at a clamp edge (e.g. $d_0 = 10^{300}$), expand the opposite side by $b^2$ so $d_0' < d_1'$ is always strictly finite and positive.
2. **Automatic nice bounds (non-singleton):**
   - Compute $S = L / \ln(b)$ (never `d1 / d0`).
   - If $S \ge 1$: floor $d_0$ to $\max(10^{-300}, b^{\lfloor \log_b d_0 \rfloor})$, ceil $d_1$ to $\min(10^{300}, b^{\lceil \log_b d_1 \rceil})$.
   - If $S < 1$: snap outward to `{1, 2, 5, 10} × 10^k` (base 10) or `{1, 1.5, 2} × 2^k` (base 2), clamped to $[10^{-300}, 10^{300}]$.
3. **Tick candidates (`TickCandidates`, densest to sparsest, bounded `≤ 13` ticks per set):**
   - **$S < 1$ (sub-decade):** Call linear nice tick generator (`scale/linear.ts:65`) filtered strictly to $(0, \infty) \cap [d_0, d_1]$. If `< 2` ticks survive, fall back deterministically to the 2 distinct endpoints `[d0, d1]`.
   - **$1 \le S < 3$ (middle span):**
     - `base = 10`: densest = `{1, 2, 5} × 10^k` in $[d_0, d_1]$; medium = `10^k` in $[d_0, d_1]$; sparsest = `[d0, d1]` if medium has `< 2` ticks.
     - `base = 2`: densest = `{1, 1.5} × 2^k` in $[d_0, d_1]$; medium = `2^k` in $[d_0, d_1]$; sparsest = `[d0, d1]` if medium has `< 2` ticks.
   - **$S \ge 3$ (wide span, up to 600 decades):** Compute the starting integer stride **BEFORE** enumerating ticks: $m_0 = \max(1, \lceil S / 12 \rceil)$ (so 600 decades starts at $m_0 = 50$, generating at most 13 ticks — never 601!). Emit candidate sets for strides $m \in \{m_0, 2 m_0, 5 m_0\}$ over integer powers $k \equiv 0 \pmod m$ within $[d_0, d_1]$, falling back to `[d0, d1]` if fewer than 2 ticks fit.

### 4.4 Nonpositive Values, Zoom Fallback & Bar/Area Compatibility (Spec `F1` / Proposed `F13`)
- **Bar and area on `'log'`:** Rejected statically via TypeScript AND at runtime with error **`AX173`** (chart enters error state; `strict: true` throws synchronously).
- **Nonpositive values on a `'log'` `line` layer:**
  - Raw values $y \le 0$ are **never mutated** in `AlignedFrame` (exact raw numbers stay intact for the table and row source).
  - **`AX171` emitted in data stage (`cartesian/normalize.ts` → `dataSink`):** Counting nonpositive `SLOT_VALUE` observations per series across the full frame in `cartesian/normalize.ts` and emitting one aggregated `reportCartesian(dataSink, 'AX171', 'omitted', { field, rows: first10, count: totalCount })` per field guarantees `ChartController` retains `AX171` in `dataDiagnostics` across ALL zoom, pan, legend-toggle, and view-rebuild cycles (bypassing `completeViewDiagnostics`'s closed carry-forward list at `core/stages.ts:115`), while still throwing synchronously under `strict: true` and feeding `readerDisclosure` stably!
  - **Scene/lookup/focus filtering:** `cartesian/scene.ts`, `cartesian/lookup.ts`, and `cartesian/overlay.ts` filter `slot === SLOT_VALUE && y > 0` for `'log'` series **before** calling `position()`.
  - **All-nonpositive data vs all-nonpositive zoom window:**
    - If **every** observation across all series bound to a `'log'` axis is $\le 0$ (and no valid author domain is given): emit error **`AX172`** (chart enters error state) and mark those series `drawable: false` (`controller-helpers.ts:521`).
    - If an x-zoom window contains **zero** positive values for an auto-domain `'log'` axis (or all visible series on that axis are hidden by legend toggle): fall back to the full-data positive domain of that axis's visible series, or (if none are visible/positive) to the full-data positive domain of all bound series on that axis. Both axes and the zoom-reset control remain visible and usable while the zoomed plot window renders an empty gap cleanly.

---

## 5. Multi-Axis Layout, Mixed Layers, Picking & Readout Semantics

### 5.1 Axis Declaration & Responsive Dual-Axis Layout (Proposed `L9`)
- `axes`: record keyed by **stable string axis ID** (1 or 2 entries in C4):
  - Exactly one `'left'` axis (primary, `axisIndex = 0`) and at most one `'right'` axis (secondary, `axisIndex = 1`). Any violation (0 `'left'` axes / right-only, `> 1` `'left'`, `> 1` `'right'`, `> 2` total axes) raises **`AX174`** at call time.
- **Responsive threshold (`L9`):**
  - Plot width **`≥ 360 px`**: both `'left'` and `'right'` y-axes render with spines, ticks, and titles; gridlines follow primary (`'left'`) ticks only.
  - Plot width **`< 360 px`** (and `≥ 120 × 80 px` per `L8`): secondary (`'right'`) y-axis ticks and spine collapse, right-axis series carry their axis label/unit annotation in legend and summary, and `cartesian/layout.ts`'s `layoutDiagnostics` emits hint **`AX175`** (`origin: 'presentation'`, automatically cleared by `#setPresentation('layout', ...)` when resized back to `≥ 360 px`).
  - Below `120 × 80 px`: unchanged `L8` (`too-small`).
- **Zoom recomputation:** On x-zoom, each auto-domain axis recomputes its `[min, max]` strictly from `visibleSlots` of its own visible series (plus `references` bound to its `axisId`); author `domain`s remain pinned.

### 5.2 Mixed Layers (`bar`, `area`, `line`), Paint Order & Pick Priority
- **Shared `AlignedFrame`:** Single `XColumn` (`Float64Array`) + per-series `y`, `slot`, `row`, `axisId`, `axisIndex` — **0 per-point objects, 0 borrowed-column copies**.
- **Paint order:** Gridlines/reference bands → `bar` layers (declared order, grouped across bars at each x-slot) → `area` layers (declared order) → `line` layers (declared order, always topmost) → reference lines & axes.
- **Pointer pick priority (`cartesian/lookup.ts`):**
  1. Shared x-slot `i` in `visibleSlots`.
  2. Nearest drawable `line` vertex at slot `i` within `12 px` y-distance (using `axisScaleOf(projection, s.axisIndex)` and filtering `y > 0` on `'log'`; tie-break: later declared layer).
  3. Else visible `bar` rectangle containing pointer at slot `i`.
  4. Else aligned slot `i` (`{ kind: 'x', x }`) listing all visible series in declared layer/series order.
- **Keyboard order:** `ArrowLeft`/`ArrowRight` step across shared `visibleSlots`; `ArrowDown`/`ArrowUp` step across visible series in declared layer order, then series order.
- **Readout parity:** Tooltip, keyboard `aria-valuetext`, summary, and table cells all use exact `Frame` values and per-series `formatters.value(seriesIndex, rawValue)`; y-references format both `from` and `to` endpoints via the bound axis's own formatter/unit (defaulting omitted `axisId` explicitly to the `'left'` axis, even when that axis has zero series, matching §2.2). Nonpositive log rows display their exact raw value in the table with a `"not plotted (log)"` qualifier.

---

## 6. Diagnostic Codes (`AX170–AX175`) — Zero Collisions

Verified free against `packages/axylo/src/diagnostics/registry.ts:53-164`:

| Code | Level | `origin` | `effect` | Strict Mode | Reader Disclosure | Trigger |
|---|---|---|---|---|---|---|
| **`AX170`** | `error` | `'call'` | `'chart-error'` | Throws sync | Error state | `'log'` axis has invalid `domain` (`<= 0`, reversed, non-finite, `d0 === d1`) or unsupported `base` (must be `10` or `2`). |
| **`AX171`** | `warning` | `'call'` | `'omitted'` | Throws sync | `"Values not shown: N. See table."` | Finite values `<= 0` on a `'log'` series (aggregated full-frame count per field, stable across zoom; raw values kept in table). |
| **`AX172`** | `error` | `'call'` | `'chart-error'` | Throws sync | Error state | Every observation across all series bound to a `'log'` axis is `<= 0` (no positive domain can be formed). |
| **`AX173`** | `error` | `'call'` | `'chart-error'` | Throws sync | Error state | `bar` or `area` layer bound to a `'log'` axis (runtime guard for JS callers; also rejected statically in TS). |
| **`AX174`** | `error` | `'call'` | `'chart-error'` | Throws sync | Error state | Unknown `yAxis`/`axisId`, duplicate source `field` across different axes, zero `'left'` axes (incl. right-only), duplicate sides (`> 1` `'left'` or `> 1` `'right'`), or `> 2` y-axes. |
| **`AX175`** | `hint` | `'presentation'` | `'none'` | Never throws | Legend/summary notes right axis | Plot width `< 360 px` collapsed the secondary (`'right'`) y-axis (`L9`); cleared automatically on resize `≥ 360 px`. |

---

## 7. TypeScript Ergonomics & Compile-Verified Type Fixtures

All positive and negative fixtures below were compile-verified under `tsc --noEmit --strict` against live `packages/axylo/src/public.ts` (`b097f1a`).

### 7.1 Proposed `axylo/cartesian` Public Types (`packages/axylo/src/cartesian.ts`)
```ts
export interface LinearAxisOptions {
  readonly position: 'left' | 'right';
  readonly scale?: 'linear';
  readonly domain?: readonly [number, number];
  readonly label?: string;
  readonly unit?: string;
  readonly format?: Intl.NumberFormatOptions | ((value: number) => string);
  readonly tickFormat?: Intl.NumberFormatOptions | ((value: number) => string);
}

export interface LogAxisOptions {
  readonly position: 'left' | 'right';
  readonly scale: 'log';
  readonly base?: 10 | 2;
  /** Strictly positive finite bounds validated at runtime (`AX170`). */
  readonly domain?: readonly [number, number];
  readonly label?: string;
  readonly unit?: string;
  readonly format?: Intl.NumberFormatOptions | ((value: number) => string);
  readonly tickFormat?: Intl.NumberFormatOptions | ((value: number) => string);
}

export type CartesianAxisOptions = LinearAxisOptions | LogAxisOptions;
export type AxesRecord = Readonly<Record<string, CartesianAxisOptions>>;

/**
 * Axis IDs provably constrained to `LinearAxisOptions` (rejects `'log'`, widened `'linear' | 'log'`,
 * and generic `AxesRecord`, while accepting both explicit `scale: 'linear'` and omitted `scale`).
 */
export type LinearAxisId<Axes extends AxesRecord> = {
  [K in Extract<keyof Axes, string>]: [Axes[K]] extends [LinearAxisOptions] ? K : never;
}[Extract<keyof Axes, string>];

export type AnyAxisId<Axes extends AxesRecord> = Extract<keyof Axes, string>;

export type CartesianReference<Axes extends AxesRecord> =
  | { readonly axis: 'x'; readonly value: XValue; readonly label: string }
  | { readonly axis: 'x'; readonly from: XValue; readonly to: XValue; readonly label: string }
  | { readonly axis: 'y'; readonly axisId?: AnyAxisId<Axes>; readonly value: number; readonly label: string }
  | { readonly axis: 'y'; readonly axisId?: AnyAxisId<Axes>; readonly from: number; readonly to: number; readonly label: string };

export type CartesianLayerOptions<Row, Axes extends AxesRecord> =
  | { readonly type: 'line'; readonly y: ValueField<Row> | readonly ValueField<Row>[]; readonly yAxis: AnyAxisId<Axes> }
  | { readonly type: 'bar' | 'area'; readonly y: ValueField<Row> | readonly ValueField<Row>[]; readonly yAxis: LinearAxisId<Axes>; readonly stacked?: boolean };

export interface CartesianOptions<Row, Axes extends AxesRecord> extends CommonOptions<Row> {
  readonly x: XField<Row>;
  readonly axes: Axes;
  readonly layers: readonly [CartesianLayerOptions<Row, NoInfer<Axes>>, ...CartesianLayerOptions<Row, NoInfer<Axes>>[]];
  readonly reference?: readonly CartesianReference<NoInfer<Axes>>[];
  readonly zoom?: boolean | 'touch';
}

/** Widens editable axis fields (`label`, `unit`, `domain`, `base`, `format`, `tickFormat`) for `chart.update(...)` while preserving each axis ID and its linear-vs-log classification. */
export type WidenAxis<A extends CartesianAxisOptions> = [A] extends [LogAxisOptions]
  ? LogAxisOptions
  : [A] extends [LinearAxisOptions]
    ? LinearAxisOptions
    : CartesianAxisOptions;

export type WidenAxes<Axes extends AxesRecord> = {
  readonly [K in keyof Axes]: WidenAxis<Axes[K]>;
};

export type StaticCartesianChart<Row, Axes extends AxesRecord> = StaticChart<Row, CartesianOptions<Row, WidenAxes<Axes>>>;

export declare function cartesian<Row, const Axes extends AxesRecord>(
  target: Target,
  options: CartesianOptions<Row, Axes>,
): StaticCartesianChart<Row, Axes>;
```

### 7.2 Compile-Verified Fixtures (`tsc --noEmit --strict`, All 7 `@ts-expect-error` Consumed)
```ts
// (a) Legacy caller — 100% unchanged
const legacyOpts: LineOptions<{ t: number; v: number }> = {
  title: 'Latency', data: [{ t: 1, v: 42 }], x: 't', y: 'v',
};

// (b) Valid create + editable update (rename label, add secondary domain, switch log base)
type MetricRow = { month: string; orders: number; latencyMs: number };
const rows: MetricRow[] = [{ month: '2026-01', orders: 1200, latencyMs: 45 }];
const chart = cartesian('#dual-log', {
  title: 'Orders vs p99 latency',
  data: rows,
  x: { field: 'month', ordered: true },
  zoom: true,
  axes: {
    orders: { position: 'left', label: 'Orders' },
    latency: { position: 'right', scale: 'log', base: 10, unit: 'ms', label: 'p99 Latency' },
  },
  layers: [
    { type: 'bar', y: 'orders', yAxis: 'orders' },
    { type: 'line', y: 'latencyMs', yAxis: 'latency' },
  ],
  reference: [{ axis: 'y', axisId: 'latency', value: 100, label: 'SLA 100 ms' }],
});

chart.update({
  axes: {
    orders: { position: 'left', label: 'Monthly Orders', domain: [0, 5000] },
    latency: { position: 'right', scale: 'log', base: 2, unit: 'ms', label: 'Latency', domain: [1, 1024] },
  },
});

// @ts-expect-error — update STILL rejects binding bar to the 'log' axis
chart.update({ layers: [{ type: 'bar', y: 'orders', yAxis: 'latency' }] });

// @ts-expect-error — update STILL rejects unknown axis ID
chart.update({ layers: [{ type: 'line', y: 'latencyMs', yAxis: 'missing' }] });

// (c) Statically rejected invalid options
const dualAxes = {
  orders: { position: 'left', scale: 'linear' },
  latency: { position: 'right', scale: 'log' },
} as const;

cartesian('#reject-bar-log', {
  data: rows, x: 'month', axes: dualAxes,
  // @ts-expect-error — bar layer cannot bind to a 'log' axis (spec F1 / AX173)
  layers: [{ type: 'bar', y: 'orders', yAxis: 'latency' }],
});

cartesian('#reject-area-log', {
  data: rows, x: 'month', axes: dualAxes,
  // @ts-expect-error — stacked area cannot bind to a 'log' axis (spec F1 / AX173)
  layers: [{ type: 'area', y: 'orders', yAxis: 'latency', stacked: true }],
});

cartesian('#reject-unknown-axis', {
  data: rows, x: 'month', axes: dualAxes,
  // @ts-expect-error — unknown axis ID (AX174)
  layers: [{ type: 'line', y: 'latencyMs', yAxis: 'missingAxis' }],
});

declare const dynamicScale: 'linear' | 'log';
cartesian('#reject-widened-scale', {
  data: rows, x: 'month',
  axes: { y: { position: 'left', scale: dynamicScale } },
  // @ts-expect-error — bar cannot bind to widened 'linear' | 'log' axis
  layers: [{ type: 'bar', y: 'orders', yAxis: 'y' }],
});

declare const widenedAxes: AxesRecord;
cartesian('#reject-widened-record', {
  data: rows, x: 'month', axes: widenedAxes,
  // @ts-expect-error — bar cannot bind to widened AxesRecord
  layers: [{ type: 'bar', y: 'orders', yAxis: 'orders' }],
});
```

---

## 8. Frozen C4.2–C4.4 Size & Performance Budgets

Baseline captured cleanly on sealed `C3` (`b097f1ab89d5c5bfecc45b67a8887662f91303b7`, `dirty: false` in `bench/size-latest.json`, `npm run size`, `esbuild 0.28.2`, gzip-9). As C4.2's first implementation step before adding `axylo/cartesian`, add an `axylo/stream` row to `scripts/size.mjs` (establishing its clean baseline) and tighten `tests/dist/subpaths.test.ts` to assert exact `<= 0 B` legacy gzip deltas AND `rawCode.length === 0` (untrimmed!) under `ignoreAnnotations: true` for every bare import (`'axylo'`, `'axylo/static'`, `'axylo/stream'`, `'axylo/cartesian'`).

| Metric / Entry | Clean `b097f1a` Baseline (`dirty: false`) | Frozen `C4.2–C4.4` Cap | Enforcement |
|---|---:|---:|---|
| Root `line only` (`examples/first-chart/npm.ts`) | `135,293 B` gz9 | **`≤ +0 B`** (`≤ 135,293 B`) | `scripts/size.mjs` + exact-byte check in `tests/dist/subpaths.test.ts` |
| Root `everything` (`export * from 'axylo'`) | `158,096 B` gz9 | **`≤ +0 B`** (`≤ 158,096 B`) | `scripts/size.mjs` + `tests/dist/subpaths.test.ts` |
| `axylo/static` `line only` / `everything` | `120,729 B` / `140,988 B` gz9 | **`≤ +0 B`** | `scripts/size.mjs` + `tests/dist/subpaths.test.ts` |
| `axylo/stream` (new row in `scripts/size.mjs`) | Capture at C4.2 start | **`≤ +0 B`** vs C4.2 baseline | `scripts/size.mjs` + `tests/dist/subpaths.test.ts` |
| `axylo.iife.min.js` (JS gzip) | `158,425 B` gz9 | **`≤ +0 B`** (`≤ 158,425 B`) | `scripts/size.mjs` |
| Bare imports (`'axylo'`, `'axylo/static'`, `'axylo/stream'`, `'axylo/cartesian'`) | `0 B` raw | **`0 B` raw** (`ignoreAnnotations: true`) | `tests/dist/side-effects.test.ts` & `subpaths.test.ts` |
| **`axylo/cartesian` standalone fixture** (static dual-y line+bar+log) | — (new) | **`≤ 127,000 B` gz9** (`axylo/static` line `+ ≤ 6,271 B`) | New row in `scripts/size.mjs` + `tests/dist/subpaths.test.ts` |
| Dual-axis 1×100k line + 1×100k bar startup | Paired vs `first-1x100000` | **`≤ 1.15×`** paired baseline | `bench/run.mjs` paired A/B |
| Dual-axis 100k zoom p95 / hover p95 | Paired vs `zoom-1x100000` / `hover-1x100000` | **`≤ 1.10×`** paired baseline | `bench/run.mjs` paired A/B |
| Hot-path allocation invariant | Zero per-point objects | **0 per-point objects; 0 copies of borrowed typed columns** | Unit + memory profile check |

---

## 9. Owner Authorization Packet (Before Starting `C4.2` Implementation)

Per `AXYLO4_LONG_TERM_MASTER_PLAN.md` and `AGENTS.md`, `C4.2` is ready to begin as soon as the owner approves these 3 scoped decisions (recommended default listed first):

1. **Minimal Type-Only `contracts.ts` Diff (Section 3):** Authorize the 6 additive, strictly type-only additions to `packages/axylo/src/core/contracts.ts` (`'log'` in `ContinuousScale.type`, optional `axisId`/`axisIndex` on `Series`, optional `axisId` on `ResolvedReference`, optional `yDomains`/`yAxisIds` on `CartesianViewBase`, optional `yAxes` on `Projection`, optional `yTicksRight`/`fit.yRight` on `Layout`). **0 edits to `public.ts`; 0 B emitted JS.**
2. **Product Spec Amendment (`F13` & `L9`) + Bar/Area on Log Rejection:** Authorize adding row **`F13`** (log scale rules, nonpositive omission via `AX171`, bar/area incompatibility via `AX173`) and row **`L9`** (dual y-axis `≥ 360 px` / narrow collapse via `AX175`) to `docs/02-product-spec.md`, confirming that `bar`/`area` on `'log'` is rejected rather than drawn from a domain floor.
3. **Static-Only `axylo/cartesian` in C4.2–C4.3 & 1–2 Y-Axes Scope:** Confirm **`axylo/cartesian` ships static-only** in C4.2–C4.3 (`createStaticChart`, `≤ 127,000 B` gz9 matching §8, deferring `axylo/cartesian/stream` until store-resolver injection lands) and confirm **1–2 y-axes** (`'left'` and `'right'`) with duplicate-field-across-axes rejected via `AX174`.
