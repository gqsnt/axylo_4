# N9a — `violin` / KDE density distribution layer (`axylo/stats` + `axylo/cartesian`)

Leaf role: `ts_builder`. Requested model/effort: `opus-5.5-high` (the brief's routing policy). Observed model and
effort: take them from the Prism harness metadata of this run; this ledger does not self-report them. Workspace without `.git`: the changes below were found by diffing
against a copy of `packages/axylo/src` taken at the start of the leaf (`.prism-cache/tmp/size/base-src`).

Repair round 2 (this revision) repairs the sealed candidate `trees/opus-5.5-high__20261127T195743Z` against the six
findings of cross-provider review `sol-6.2-medium__20261127T202902Z`. Round-2 changes were found by
`diff -rq` against that tree. The table below describes the final state.

Repair round 3 (`bounded_ts_fix`, requested `opus-5.5-medium`; observed model/effort: from the harness metadata, not
self-reported) touches only `src/stats.ts`, `src/stats/kde.ts`, the stats tests and this ledger: see "Repair round 3"
below. Its starting point was the coordinator view `runs/coordinators/p2_n9a/view` (stats files identical to tree
`opus-5.5-high__20261127T203448Z`).

Repair round 4 (`ts_builder`, requested `opus-5.5-high` per the routing policy; observed model/effort: from the
harness metadata, not self-reported) repairs the four blockers of cross-provider review
`sol-6.2-medium__20261127T211253Z`. Its starting point was the sealed tree `trees/opus-5.5-medium__20261127T210115Z`
(`diff -rq` of `packages/axylo/src` against it: only `stats.ts`, `stats/kde.ts`, `cartesian/violin.ts`,
`cartesian/options.ts` differ). See "Repair round 4" below; where it and earlier sections disagree, round 4 holds.

## What was built

| File | Change |
| --- | --- |
| `packages/axylo/src/stats/kde.ts` (new) | Numeric core: Gaussian cell-mean density on a bounded grid; reflection in finite bounds (one mirror per bound when the support is wider than 16.6 h, otherwise the exact cosine series of all images). Internal, so the packed `dist/stats.d.ts` names nothing from it. |
| `packages/axylo/src/stats.ts` | `kde()`, `violinData()`, `kdeConvention()` (lazily frozen defaults; replaces the candidate's mutable `KDE_CONVENTION`), their types; runtime option checks; overflow-safe moments and Silverman rule; grid range and representability rules. Boxplot grouping moved into a shared `groupFinite()` helper (same behaviour, reused by `violinData`). |
| `packages/axylo/src/cartesian/violin.ts` (new) | Payload reader (CSR typed arrays per source row), shared geometry (scene, pick, anchor), scene marks, outline hit distance, readout cells shared by tooltip, keyboard and table. |
| `packages/axylo/src/cartesian.ts` | **Types only:** `ViolinLayerOptions` added to the `CartesianLayerOptions` union, `NumberKey` type import. Wrapper, return, export hooks and the `cartesian()` doc line untouched (the candidate's doc-line edit was reverted in repair round 2). |
| `packages/axylo/src/cartesian/options.ts` | Parses `type: 'violin'` as a five-number compound (published series = median carrier), default field names (also for fields given as `undefined`), `inner`, linear-only (AX173), non-string payload fields (AX174), `__layerSig` includes the violin key (a JSON encoding of the field names and `inner`). |
| `packages/axylo/src/cartesian/boxplot.ts` | `LogicalKind` gains `'violin'`; `LogicalMark.violin`; `OptionIssue` gains `AX102`, an optional `outcome` and an optional `effect: 'omitted'`; `isCompoundKind` includes violin. |
| `packages/axylo/src/cartesian/annotations.ts` | Option issues pass their own `outcome` sentence and `effect` (the violin payload checks report `'omitted'`, which the reader counts). |
| `packages/axylo/src/cartesian/view.ts` | AX176 unordered-five-number check also for violins; a visible violin's drawn grid widens its axis in the visible window. |
| `packages/axylo/src/cartesian/scene.ts` | Violin marks painted after boxplots (step 2b). |
| `packages/axylo/src/cartesian/lookup.ts` | Violin readout; outline-aware pick over every slot whose x pixel is within the violin half width + 3 px of the pointer (bisection, then a bounded scan); anchor box. |
| `packages/axylo/src/cartesian/reader.ts` | Table columns per violin reading; summary "median …" for violins. |
| `packages/axylo/src/cartesian/mark-swatch.ts` | Violin swatch; `legendForOne` is true for a lone violin layer (one toggle). |
| `packages/axylo/test/stats/n9a-kde.test.ts` (new) | 19 tests (round 2: `KDE_CONVENTION` references now call `kdeConvention()`, same expected values): defaults, bandwidth rule and fallbacks, analytic shape, support/reflection, representability, fast-check properties, `violinData`. |
| `packages/axylo/test/stats/n9a-kde-repair.test.ts` (new, round 2) | 16 tests for review findings 1–3 (see below). Round 3 changed the two rejection lines of the representability test (see "Repair round 3"). |
| `packages/axylo/test/stats/n9a-kde-support.test.ts` (new, round 3) | 6 tests: overflowing clamp width and tight representable clamps (see "Repair round 3"; round 4 changed its rejection test, see "Repair round 4"). |
| `packages/axylo/test/stats/n9a-kde-repair4.test.ts` (new, round 4) | 6 tests for review findings 1–2 of round 4. |
| `packages/axylo/test/cartesian/n9a-violin-repair3.test.ts` (new, round 4) | 4 tests for review findings 3–4 of round 4. |
| `packages/axylo/test/cartesian/n9a-violin-repair.test.ts` (new, round 2) | 10 tests for review findings 4–5 (see below). |
| `packages/axylo/test/cartesian/n9a-violin.test.ts` (new) | 14 tests: payload, geometry, inner box, SVG serialization, zoom, axis fit, hidden layer, legend, pointer/keyboard/table parity, row mapping through sorting, payload diagnostics, AX173/AX174/AX176/AX150, strict rollback and updates through the controller. |
| `tests/dist/subpaths.test.ts` | Cartesian cap 134,000 → 138,000 B (137,000 B in the candidate); packed type assertions for `kde`, `violinData`, `kdeConvention()` and the violin layer (including four `@ts-expect-error` cases). |
| `tests/dist/n9a-violin.browser.test.ts` (new) | Chrome test (written, **not run** in this leaf). |
| `docs/progress/n9a-violin-ledger.md` (new) | This ledger. |

`packages/axylo/dist` was rebuilt by `npm run build` (a build output).

## Public API and frozen defaults

### `axylo/stats`

```ts
kde(values: ArrayLike<number | null | undefined>, options?: KdeOptions): KdeResult
violinData<Row>(data: Data<Row>, options: { group, value } & KdeOptions): ViolinResult
kdeConvention(): KdeConvention // one Object.freeze'd { kernel: 'gaussian', bandwidth: 'silverman', normalize: 'area', points: 128, cut: 3, quantile: 'R-7' }, made on first call
KdeOptions = { bandwidth?: number; normalize?: 'area' | 'width'; clamp?: readonly [number, number]; points?: number }
KdeResult = { grid: Float64Array; density: Float64Array; bandwidth: number; normalize; summary: { n, missing, outside, min, q1, median, q3, max, mean } }
ViolinResult = { convention, normalize, groups: { x, label, kde }[], data: { columns: { x, n, min, q1, median, q3, max, mean, bandwidth, grid: Float64Array[], density: Float64Array[] } } }
```

- **Bandwidth:** Silverman `h = 0.9 · min(sd, IQR/1.34) · n^(-1/5)` per sample (per group), sd with n − 1, IQR
  from the existing R-7 quartiles. Fallback chain (R's `bw.nrd0`): if `min(...)` is not > 0 use sd, then `|x|` of a
  constant sample, then 1. When the sample reaches 2^960 every sum, sd, IQR and their minimum are taken at 2^-64 of
  their size (a power of two, exact), and the magnitude is restored only after `n^(-1/5)`: a representable rule value
  is returned even when sd or IQR alone overflow (two copies each of ±MAX_VALUE: h = 0.9 · √(4/3) · 4^(-1/5) · MAX).
  A rule value past MAX_VALUE or below MIN_VALUE is held there. An explicit `bandwidth` must be a finite number > 0
  (RangeError otherwise, including `'1'` and `true`) and is used exactly.
- **Mean and sd:** the mean is a compensated (Neumaier) sum, so `[-1e16, 1, 1e16]` has mean 1/3. The sd is two-pass
  about the rounded mean with the correction term `(Σd)²/n` (Chan–Golub–LeVeque), deviations taken relative to the
  largest magnitude: `[1e16, 1e16, 1e16, 1e16 + 2]` has sd exactly 1.
- **Grid:** `points` (default 128, integer 2–4096) evenly spaced values from `min − 3h` to `max + 3h`, cut to
  `clamp` and to ±`Number.MAX_VALUE`. The ends are `min − h − h − h` and `max + h + h + h`: each partial end lies
  between the sample and the true end, so none overflows unless the true end does (`[1.5e308]`, h = 6e307 starts at
  −3e307). Grid values are weighted means of the ends and cell edges are sums of halves, so a grid across
  ±MAX_VALUE does not overflow.
- **Representability (round 3; superseded for finite clamps by "Repair round 4": a clamp is now checked on its own grid and density, and `[1, 1 + 2^-44]` and `[0, 1e-306]` are estimated):** a grid narrower than `max(|lo|, |hi|) · 2^-40 · points` (2^12 ulps a step) or
  than `2^-960 · points` is widened to that width around its centre inside the clamp, keeping the bandwidth: the grid
  stays strictly increasing and evenly spaced within 0.05 %. A finite clamp narrower than that width becomes the grid
  itself. It is accepted when `b − a >= max(|a|, |b|, 2^-974) · 2^-48 · (points − 1)`: every step is at least 2^-48 of
  the magnitude m (16 times m · 2^-52, which bounds the ulp; each grid value `(1 − t)·lo + t·hi` rounds by at most
  1.5 · m · 2^-52, so neighbours stay more than 12 ulps apart and every cell has a width) and at least 2^-1022 (an
  area density is at most 2 / step, so it stays finite). Below either it is a RangeError. Accepted now:
  `[1, 1 + 2^-40]` (128 values ~32 ulps apart, area density 2^40), `[0, 1e-300]` (area density 1e300),
  `[0, 127 · 2^-1022]`. Still rejected: `[1, 1 + 2^-44]` at 128 points, `[1, 1 + 2^-40]` at 4096 points (one ulp a
  step), `[0, 1e-306]` (area density past MAX_VALUE). `[999999999, 1000000001]` is accepted as before.
- **Density values:** each grid value carries the KDE's **mean over its cell** (the half steps around it, cut to the
  grid ends). Without two finite bounds within 16.6 h of each other: from the normal CDF (Numerical Recipes `erfcc`,
  fractional error < 1.2e-7) or, for a cell narrower than h/10, Simpson's rule on φ; work O(cells within 8.3 h) per
  sample after a bisection. Otherwise (two finite bounds, L = b − a ≤ 16.6 h, decided from 2πh / L computed from
  the half-difference b/2 − a/2, since b − a overflows for finite bounds near ±MAX_VALUE): the cosine series of the kernel
  reflected in both bounds, `1 + 2 Σ_{m=1..48} exp(−(mπh/L)²/2) cos(mπθ) cos(mπs)` (θ, s as fractions of [a, b];
  terms past 48 are below 1e-17 there), with each cosine's exact cell mean; O(48 · (n + points)). A bandwidth far
  above L (e.g. h = MAX_VALUE on [0, 1e-20]) leaves the constant term: a flat, finite density, no NaN.
- **Normalization:** `'area'` (default) divides by the trapezoid integral over the returned grid (weights computed
  as halves relative to half the grid width) → unit trapezoid area (the ≤ 0.27 % of mass past ±3h is given back to
  the grid; a documented rescaling, not R's `density()` output). `'width'` divides by the largest value → peak 1.
- **Clamp / support:** `clamp: [a, b]`, exactly two numbers with `a < b`; either side may be infinite (`[0,
  Infinity]` for a non-negative metric; the only place open infinities are accepted). Anything else (a string, a
  three-element array, a non-number element, NaN, an array-like object) is RangeError. Samples outside are
  **dropped** and counted in `summary.outside`; summary and bandwidth describe the retained samples only. Kernels are
  reflected in each finite bound: no mass is placed past a bound and, with two bounds, none is lost through the far
  one (`[0]`, h = 1 on [0, 1] is nearly uniform: ends ≈ 1.0144 and 0.9856 instead of the one-mirror ≈ 0.887 slope).
- **Defaults:** private primitive literals inside the option reader; `kdeConvention()` returns one frozen object
  (made on first call, cached in a module `let`), also returned as `ViolinResult.convention`. Mutating it throws in
  strict code and never changes an estimate. Options given as `undefined` take the defaults.
- **Empty input** (no finite value inside the clamp): empty `grid`/`density`, n 0, NaN summary values, and a NaN
  bandwidth unless one was given; nothing is thrown. Option errors still throw even when empty. `violinData` on data
  with no valid group (including data that is neither rows nor `{ columns }`) gives empty columns, as `boxplot()`
  does.

### `axylo/cartesian`: `{ type: 'violin' }`

```ts
interface ViolinLayerOptions<Row, Axes> {
  type: 'violin'; yAxis: LinearAxisId<Axes>; label?: string;
  min?, q1?, median?, q3?, max?: ValueField<Row>;          // default: the column of the same name
  grid?, density?: NumberListKey<Row>;                      // default 'grid', 'density'
  n?, bandwidth?: NumberKey<Row>;                           // default 'n', 'bandwidth'; read out only if present
  inner?: 'box' | 'none';                                   // default 'box'
}
```

Usage: `cartesian(el, { data: violinData(rows, { group, value }).data, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'violin', yAxis: 'v', label: 'Spread' }] })`.

- **One published series per layer** (the median carrier, labelled with the layer label; default label is the
  median field name, as for boxplot). The five numbers are carriers, so the row mask, visibility of parts, the
  per-field formatters and the axis fit are the boxplot's. Grid, density, n and bandwidth are read once per parse
  into typed CSR arrays indexed by **source row** (through the median carrier's `row`), so they follow sorting,
  updates, zoom and visibility; caller arrays are not retained.
- **Supported axes:** x of any kind (category, number, date/time); y **linear only** (types: `LinearAxisId`;
  runtime: AX173), since the density is estimated on a linear scale.
- **Geometry:** mirrored about the slot; half width = 1.5 × the boxplot half width × `density / layerPeak`. All
  violins of a layer share the layer's largest density as scale, so `normalize: 'area'` compares areas and
  `'width'` compares shapes. Fill opacity 0.3 + 1.5 px outline in the series paint; inner box (quarter width,
  Q1–Q3), min–max line (`WHISKER_WIDTH`) and median bar in the background token (`MEDIAN_WIDTH`). The outline is
  cut on data values at the plot's vertical span (pick and anchor) or 1e6 px past it (scene), and only grid values
  inside the cut are projected, so Float32 coordinates stay finite for grids far outside a pinned domain and scene,
  pick and anchor read the same segments (repair round 5).
- **Axis fit:** the first and last grid value of each visible drawn violin in the visible window widen its axis (as
  boxplot outliers do); a hidden violin does not.
- **Pick and anchor:** the pointer is mirrored onto the right half and measured to the outline segments and end
  caps (0 inside), plus the inner box and line, all **cut to the plot's vertical span** (the outline is monotone in
  y, so each plot edge is crossed once), and never nearer than the shown box, which is also cut to the plot's
  horizontal span. A violin with nothing shown (e.g. a grid at [5.01, 5.02] on a pinned [0, 5] axis) is never
  picked and has no anchor box. Candidates are every slot whose x pixel lies within the violin half width + 3 px
  of the pointer, found by bisection over the slot pixels (monotone in the slot index) and a scan that stops past
  the last; so irregular x (slots far narrower than a violin) finds every overlapping violin, and ordinary data
  tests only a handful (40 slots: ≤ 3; 4,000 slots at ~0.22 px: < 80). 3 px slack; ties go to the violin centred
  nearer the pointer. Later declared layers still win at distance 0 (unchanged compound-pick order).
- **Readout (one path):** `violinCells()` gives `[median, n, IQR, min, max, bandwidth]` (n/bandwidth only when the
  data has those fields), each through the carriers' own value formatter (`formatters.count` for n). Tooltip and
  keyboard: `median 3 (n 5, IQR 2 – 4, min 1, max 5, bandwidth 0.973585)`; table: one column per reading
  (`Spread median`, `Spread n`, `Spread IQR`, …).
- **Payload diagnostics** (effect `'omitted'`, so the reader's "values not shown" count includes them; rows are
  source rows, sampled ≤ 10; outcome "Those rows' density outlines are not drawn; their summaries stay in tooltip
  and table."), each on the **field at fault**: absent grid or density cell AX102 on that field; non-finite number
  AX103; any other malformed cell (not a list, lengths differ, a single point, non-numbers, grid not strictly
  increasing, negative density) AX106. Lists are any array-like object (`Data` columns and cells are `ArrayLike`):
  plain arrays, typed arrays and `{ length, 0: … }` objects. The source row count is the x column's length (or the
  data's row count), so a payload whose grid and density columns are both absent is reported for every row. An
  empty pair is `violinData`'s encoding of a group with no finite value and is not reported, nor are its n of 0 and
  NaN bandwidth, unless the row has a positive n or a median the normalized frame holds as a value (then AX106 on
  the grid field, reported by `normalizeCartesian`; see repair round 8). When given, n must be a positive integer and bandwidth a finite number > 0: otherwise AX106 (AX103
  for a non-finite value) on that field, outcome "Those rows' n / bandwidth is not read out.", and the reading shows
  as missing; an absent (`undefined`/`null`) n or bandwidth is optional metadata and silent. Unordered five numbers
  AX176 (as boxplot); unknown `inner` AX150; a payload option that is not a string AX174. No new codes.
- **Legend:** violin swatch (`key 'violin'`); `legendForOne` is true for a lone violin layer, so it has one toggle.

## Measurements (observed, repair round 2, final build)

Three trees built by the same recipe (`node scripts/build.mjs` in a copy with `scripts/`, the package files and a
`node_modules` symlink, under `.prism-cache/tmp/n9a-r2/`): **baseline** = `runs/coordinators/p2_n9a/initial`,
**candidate** = the sealed tree `trees/opus-5.5-high__20261127T195743Z`, **round 2** = this workspace (its
`npm run build` dist measured identically). Consumers built as `tests/dist/subpaths.test.ts` builds them (esbuild
bundle + minify, esm, es2022, from the dist files), gzip level 9 (`.prism-cache/tmp/n9a-r2/measure.mjs`).

| Consumer (gzip-9) | Baseline | Candidate | Round 2 | Round 2 − baseline | Cap |
| --- | ---: | ---: | ---: | ---: | ---: |
| `export { cartesian } from 'axylo/cartesian'` | 133,990 | 136,709 | 137,278 | +3,288 | 138,000 (was 134,000; candidate 137,000) |
| `export * from 'axylo/stats'` | 1,692 | 3,309 | 3,493 | +1,801 | 3,500 |
| `import 'axylo/stats'`, `ignoreAnnotations: true` (raw bytes) | 0 | 0 | 0 | 0 | 0 |
| `import 'axylo/cartesian'`, `ignoreAnnotations: true` (raw bytes) | 0 | 0 | 0 | 0 | 0 |
| `dist/axylo.js` | 159,089 | 159,089 | 159,089 | 0 | — |
| `dist/static.js` | 140,922 | 140,922 | 140,922 | 0 | — |
| `dist/stream.js` | 159,087 | 159,087 | 159,087 | 0 | — |
| `dist/axylo.iife.js` / `.min.js` | 241,461 / 159,309 | same | same | 0 | — |

`cmp`: round 2's `axylo.js`, `static.js`, `stream.js`, `axylo.iife.js` and `axylo.iife.min.js` are
**byte-identical** to the baseline build → **0 B legacy root/static/stream tax**. The legacy absolute line /
everything / IIFE caps were already exceeded by the baseline (earlier ledgers); unchanged here.

Cartesian cap: round 2 measures 137,278 B, 278 B over the candidate's 137,000 B cap, so the cap is raised to
138,000 B (722 B headroom; allowed ceiling 139,000 B). The +569 B over the candidate is the clipped pick/anchor
geometry, the bisection candidate search and the stricter payload reader. Stats: the cosine-series reflection,
compensated moments and runtime checks first measured 3,912 B; lossless cuts (one reflection path instead of an
image sum plus a series, no extra max-deviation pass, in-place normalization, three-argument `Math.min/max` for the
ends, redundant clamp comparisons removed) brought it to 3,493 B, 7 B under the cap. One cut changed behaviour:
`kde()` no longer checks that `values` is array-like (−14 B): `null` still throws (TypeError, not RangeError), and
a non-list such as `5` reads as an empty sample. This is recorded as a deviation below.

## Verification (observed: ran and saw, repair round 2)

- `npm run typecheck` (library + `docs/api` + `tests/dist`): exit 0, no tsc output.
- `npx vitest run --configLoader native --no-cache --no-fsModuleCache packages/axylo/test/stats packages/axylo/test/cartesian`:
  `Test Files 25 passed (25)`, `Tests 283 passed (283)`.
- Full Node suite, same flags: `Test Files 148 passed (148)`, `Tests 2571 passed (2571)` (it generates
  `apps/docs/.cache/types/{probe.ts,tsconfig.json}`, outside the fence; removed afterwards by literal path).
- `npm run build`: exit 0; sizes above.
- Packed declarations without `npm pack`: the package `files` copied into `.prism-cache/tmp/n9a-r2/dts/node_modules/axylo`,
  the `check.ts` lines of `subpaths.test.ts` extracted verbatim, compiled with tsc under `Bundler` and `NodeNext`
  (strict, `skipLibCheck: false`): both exit 0, so every `@ts-expect-error` line is a real error.
- Timing sanity check (not a gate): `kde()` of 100,000 values from the built dist took 166 ms (open), 176 ms
  (one-sided) and 203 ms (two-sided) in Node on this machine.
- **Mutation check:** with the sealed candidate's `stats.ts`, `stats/kde.ts` and `cartesian/*.ts` swapped back in
  (restored afterwards, `cmp` clean), the new tests fail: 11 of the 16 in `n9a-kde-repair.test.ts` (with
  `KDE_CONVENTION` aliased in for the import) and 8 of the 10 in `n9a-violin-repair.test.ts`. The two
  Cartesian tests that pass on the candidate as well are "an outline crossing the pinned top is picked and anchored
  only where it is shown" and "visits only the violins near the pointer"; they guard the new code rather than
  reproduce a finding.
- **Not run:** Chrome (`n9a-violin.browser.test.ts`), the packed `tests/dist` Node suite (its global setup packs and
  installs into `tests/dist/fixtures`, outside this fence), axe-core, Director `verify`.

### Review findings → repair → test (sol-6.2-medium__20261127T202902Z)

1. **Moments and grid ends overflow-safe.** Scaled sums at 2^-64 for samples ≥ 2^960, magnitude restored after
   `n^(-1/5)`; Neumaier mean; corrected two-pass sd; ends by three steps of h. Expected values derived in the test:
   ±1.1e308 ×2 → h = 0.9 · 1.1 · √(4/3) · 4^(-1/5) · 1e308 ≈ 8.66348e307 (the candidate's value was already
   right: sd = 1.1e308 · √(4/3) is below IQR/1.34. The review's 1.11982e308 is not used as an expected value); ±MAX
   ×2 → 0.9 · √(4/3) · 4^(-1/5) · MAX; `[1e16 ×3, 1e16 + 2]` → sd 1, with R-7 Q3 = 1e16 + 0.5 rounding to 1e16, so the
   rule falls back to sd: h = 0.9 · 4^(-1/5); `[-1e16, 1, 1e16]` → mean exactly 1/3; `[1.5e308]`, h 6e307 → grid
   from −3e307.
2. **Flat kernels, representable grids, two-sided reflection.** Cosine series (exact image sum) when L ≤ 16.6 h;
   representability threshold 2^12 ulps a step (was 2^22); explicit RangeError below it. Tests: `[5e-21]` on
   [0, 1e-20] with h = MAX is uniform 1e20 (area) / 1 (width); `[999999999, 1000000001]` accepted; `[1, 1 + 2^-40]`
   and `[0, 1e-300]` rejected; `[0]`, h 1 on [0, 1] against a brute-force image sum and the analytic series values
   at 0 and 1; two-sided fixtures at L/h = 4, 10, 16.7 and 1/3, one-sided fixtures on [0, ∞) and (−∞, 0], all in both
   normalizations; scale invariance at 1e-20, 1e-250 and 1e300; a fast-check property (40 runs, seed 9) against
   the brute-force image sum on [0, 1] for h in [0.02, 4].
3. **Frozen defaults and runtime validation.** `kdeConvention()` (lazily frozen, cached; estimates read private
   literals); bandwidth by type; clamp an exact two-element numeric tuple; options must be an object. Tests: frozen,
   mutation throws, defaults unaffected; explicit `undefined` options equal the defaults; 22 malformed option sets
   throw RangeError in `kde` (and the object ones in `violinData`); empty semantics.
4. **Cartesian payload types and omissions.** Array-like lists; source row count from the x column; issues per
   field at fault with source rows and effect `'omitted'`; n / bandwidth checks with the empty-group exception;
   defaults for fields given as `undefined`; JSON layer signature. Tests: plain array-like columns and cells; both
   payload columns absent (columnar and rows) → AX102 on `grid` and `density` for rows [0, 1, 2], reader omitted 6;
   per-field attribution (AX106 grid, AX103 density, AX102 density); `n: -2.5`, `'4'`, `0` with an outline, and
   `bandwidth: 0`, `Infinity`, NaN with an outline reported, `null` n and the empty group silent; explicit `undefined`
   fields; signature with separators in field names. The candidate's existing test that expected every issue on
   `density` was updated to the field at fault (grid for an absent or reversed grid). That expectation encoded the
   reviewed defect.
5. **Pick and anchor on the shown geometry.** Clipped outline / inner box / whisker, box cut to the plot;
   bisection over slot pixels with the half-width + slack radius. Tests: pinned [0, 5] with the outline at
   [5.01, 5.02] (with and without the inner box): a pointer at 4.99 falls back to the scatter, and the violin has no
   1 px edge anchor; an outline crossing the top anchors from the plot top to y(3); irregular x
   `[0, 50, 50.1, 50.2, 100]` at 640 px (the review's `[0, 0.1, 0.2, 100]` case moved off the plot's left edge so the
   pointer stays inside the plot): a pointer left of x = 50's slot and inside x = 50.2's outline picks the violin at
   50.2, not the scatter fallback; candidate counts with 40 and 4,000 slots.
6. **Ledger commands.** Corrected below (browser and packed Node runs are two separate commands, the browser one
   needs `AXYLO_BROWSER=1`); the out-of-fence `cartesian()` doc-line edit was reverted (`cartesian.ts` differs from
   the baseline only in the violin types and the `NumberKey` import).

## Not verified here (expected, not observed)

- **Chrome:** `tests/dist/n9a-violin.browser.test.ts` type-checks but was **not run** (worker rule: no browser in a
  leaf). Coordinator commands, after `npm run build`:

  ```bash
  # 1. packed Chrome test (browser mode is selected only by AXYLO_BROWSER=1)
  AXYLO_BROWSER=1 npx vitest run --config tests/dist/vitest.config.ts tests/dist/n9a-violin.browser.test.ts
  # 2. packed subpath size, bare-import and declaration checks (Node mode, separately)
  npx vitest run --config tests/dist/vitest.config.ts tests/dist/subpaths.test.ts
  ```

  In prism workspaces the packed runs need `HOME=<workspace>/.prism-cache/tmp/<own>/home` (the pack script strips
  `npm_*` variables), and earlier ledgers report baseline-only failures of the legacy absolute caps in
  `subpaths.test.ts`. The root `npm run test:browser` does not select the packed-dist test.
- **Canvas:** this build has no canvas renderer (`src/render/` is SVG only). Violins are standard
  `area`/`path`/`rects` marks; their SVG serialization was checked in Node.
- axe-core 0 violations, light/dark/forced-colors rendering, real pointer hover and the keyboard legend toggle are
  covered only by the unrun Chrome test.

## Decisions and assumptions (where the brief left room)

- `violinData(rows, { group, value })` per the brief (boxplot keeps `{ x, y }`); its columns are named so every
  violin layer field defaults to them.
- Bandwidth per group (no shared bandwidth option).
- Frozen defaults (round 2): a top-level `Object.freeze(...)` would survive `ignoreAnnotations: true` and break the
  0 B bare import, so the convention is frozen lazily inside `kdeConvention()`; the exported constant name
  `KDE_CONVENTION` (candidate only, never released) is gone, as the repair brief allowed.
- "IQR" is read out as the interval `Q1 – Q3` (the same `' – '` as interval layers), not as the width Q3 − Q1; the
  table has the same cell.
- In-place mutation of arrays under the same column identity is not an update for any layer (the core keeps the
  accepted frame for unchanged borrowed columns); a new column array — or new data — re-reads the violin payload
  (tested: only the changed group's outline narrows, by exactly half).
- A violin and a boxplot in one chart need their own fields (one field binds to one layer, AX174), so a mixed
  chart copies the five columns under other names.
- Paint order puts violins above boxplots; the compound pick keeps its existing declared-order rule, so a boxplot
  declared after a violin wins inside its own box.
- `stats.ts` keeps all public KDE types (the packed `stats.d.ts` may only reference packed files); the numeric core
  is internal in `stats/kde.ts`.

- Round 2: reflection uses one mirror per bound when the bounds are more than 2 · 8.3 h apart (every further
  image is past 8.3 h, mass < 1e-16) and the exact cosine series otherwise, rather than a truncated image loop:
  the series stays bounded (48 terms) for any h / L, including h = MAX_VALUE, where an image sum would need
  unboundedly many images.
- Round 2: the representability threshold is 2^12 ulps a step. Area normalization uses the actual grid's
  trapezoid weights, so the step's rounding no longer bears on the unit-area guarantee and the old 2^22 margin was
  not needed.
- Round 2 deviation: `kde(values)` does not validate `values` (cut for the 3,500 B stats cap); `null` throws a
  TypeError, and a non-array-like value reads as no values. `violinData` likewise treats data that is neither rows nor
  `{ columns }` as no groups, as `boxplot()` does, rather than throwing.
- Round 2: the review's mixed-chart x `[0, 0.1, 0.2, 100]` was moved to `[0, 50, 50.1, 50.2, 100]` in the test,
  because at x = 0 the overlapping region lies left of the plot, where `pick` returns null by contract. Same slot
  spacing (0.1 on a 100-wide axis at 640 px).
- Round 2 uncertainty: the candidate search assumes slot pixels are monotone in the slot index (true for the
  sorted aligned frame and band slots, both orders handled); a non-monotone x mapping would make the bisection miss.
  The pick cost test checks counts with the `__DEV__` counter, not wall time.

## Repair round 3 (finite-support numerics and tight clamps)

**Findings repaired.**

1. *Overflowing support width.* `densityOnGrid` computed `width = b − a`, which is Infinity for finite bounds of
   opposite sign near ±MAX_VALUE, so `width / h` was Infinity and the one-mirror branch ran even at L/h = 2
   (`kde([-MAX], { bandwidth: MAX, clamp: [-MAX, MAX] })`). Now `span = (b/2 − a/2) / π` (L / 2π, finite for every
   finite pair) and `c = h / span` (2πh / L, 0 for an open side); the series runs when `c · REACH >= π`
   (L ≤ 16.6 h). Fourier coordinates are `angle(p) = (p/2 − a/2) / span` (π times p's fraction of [a, b]): divided,
   never multiplied by an inverse that could overflow for tiny L, and exact (Sterbenz) for p close to a, so a narrow
   same-sign support far from 0 keeps its fractions without cancellation. The series terms are
   `exp(−(m · c)² / 8)` = `exp(−(mπh/L)² / 2)`. Halving loses at most one subnormal bit (2^-1075), negligible
   against the accepted L ≥ 2^-1022. The series is computed at half scale (constant term n / 2); the factor cancels
   in both normalizations.
2. *Tight representable clamps rejected.* The clamp check required 2^12 ulps a step (the comfortable width used for
   widening data-driven grids). It now requires only what is needed for a distinct grid with finite area density
   (rule above), reported as RangeError below it. Cells and trapezoid weights already used the stored grid values,
   so the uneven rounding of a tight grid's steps moves no mass; no interpolation change was needed.

**Test changes.** `n9a-kde-repair.test.ts`: the two lines that expected `[1, 1 + 2^-40]` and `[0, 1e-300]` to throw
encoded the old acceptance rule, which this round was asked to widen; they now expect `[1, 1 + 2^-44]` and
`[0, 1e-306]` to throw (still unrepresentable by the rule), and the accepted cases are tested for values in the new
file. `n9a-kde-support.test.ts` (expected values from scale/shift invariance and an independent brute-force image
sum, `Σ_k φ((y − x − 2kL)/h) + φ((y + x − 2a − 2kL)/h)`, averaged by 32-part Simpson over the returned grid's cells):

- `kde([-1], { bandwidth: 1, clamp: [-1, 1] })` against the image sum, then `kde([-MAX], { bandwidth: MAX,
  clamp: [-MAX, MAX] })` against the same image sum (grid mapped by g / MAX) and against the ordinary result, in both
  normalizations (relative 1e-5 against the reference, 1e-9 against the ordinary result after × MAX for area).
  Unit area checked with a half-difference trapezoid `Σ (g_k/2 − g_{k−1}/2)(f_k + f_{k−1})`; the far-bound value
  equals the image sum's.
- Asymmetric `[MAX/4]`, h = MAX/2 on `[-MAX, MAX/2]`, and the default (Silverman) bandwidth of `[-MAX, MAX/2, MAX]`
  on `[-MAX, MAX]`, against the image sum in unit coordinates.
- `[1, 1 + 2^-40]`: series (L/h = 5) and one-mirror (L/h = 50) cases against the image sum in coordinates
  (g − 1) · 2^40 (exact); a cell's ends there are the stored midpoints `g/2 + g'/2`, since the exact midpoint is not
  a double (half an ulp is 2^-13 of the clamp; with exact midpoints the reference differs by 1.3e-5, observed).
  The sample `1 + 0.1 · 2^-40` is mapped from its stored value for the same reason. Default bandwidth there: uniform
  2^40.
- `[0, 1e-300]` uniform 1e300; `[0, 127 · 2^-1022]` against the image sum.
- Rejections listed above, plus the mirrored `[-1 − 2^-44, -1]` and `[0, 5e-324]`.
- fast-check (200 runs, seed 3): any exponent −1000…1000, sign, 2…4096 points, h from 0.001 to 100 clamp widths, at
  twice the acceptance limit: strictly increasing grid, finite non-negative density, unit area within 1e-9 or peak 1.

**Mutation check (observed).** With the coordinator view's `stats.ts` and `stats/kde.ts` swapped in (restored,
`cmp` clean), 5 of the 6 new tests fail (both overflow tests, both tight-range tests, the property); the rejection
test passes on both, as intended. A scratch fuzz of 3,493 accepted clamps at 1.0001–1.01 × the limit (2–4096 points,
magnitudes 2^±1000) found no non-increasing grid or non-finite density after the fix (one case, a cell divided by an
overflowing π / span at L ≈ 2^-1022, was found and fixed by dividing instead).

**Measurements (observed, round 3).** `npm run build` in this workspace; a baseline build of
`runs/coordinators/p2_n9a/initial` by the same `scripts/build.mjs` under `.prism-cache/tmp/n9a-r3/base`; consumers
built as `tests/dist/subpaths.test.ts` does (esbuild bundle + minify, esm, es2022, from dist), gzip-9.

| Consumer | Baseline | Round 2 | Round 3 | Cap |
| --- | ---: | ---: | ---: | ---: |
| `export * from 'axylo/stats'` | 1,692 | 3,493 | 3,497 | 3,500 (unchanged) |
| `export { cartesian } from 'axylo/cartesian'` | 133,990 | 137,278 | 137,278 | 138,000 (unchanged) |
| `import 'axylo/stats'` / `'axylo/cartesian'`, `ignoreAnnotations` (raw bytes) | 0 / 0 | 0 / 0 | 0 / 0 | 0 |

`cmp`: this workspace's `axylo.js`, `static.js`, `stream.js`, `axylo.iife.js`, `axylo.iife.min.js` and
`axylo.css` are byte-identical to the baseline build (gzip-9 159,089 / 140,922 / 159,087 / 241,461 / 159,309) →
0 B legacy root/static tax. Byte cuts that paid for the repair (lossless): one `Math.max` with power-of-two scaling
for both width rules (`max(m · 2^-48, 2^-1022)` = `max(m, 2^-974) · 2^-48`, exact; same for the widening rule),
the `narrowest` helper inlined at its one remaining use, π folded into `span`, the series' factor 2 dropped.

**Verification (observed, round 3).** `npm run typecheck`: exit 0. `npm run build`: exit 0. Scoped Vitest
(`--configLoader native --no-cache --no-fsModuleCache packages/axylo/test/stats packages/axylo/test/cartesian`):
26 files, 289 tests passed. Not run in round 3: Chrome, `npm pack` / packed `tests/dist` suite, full Node suite,
Director `verify`.

## Repair round 4 (review sol-6.2-medium__20261127T211253Z)

| Finding | Repair | Regression (all fail on the sealed round-3 tree, observed) |
| --- | --- | --- |
| 1. Arbitrary clamp minimum | `kdeSettings` only requires `a < b`. `estimate` checks the grid it made: every value strictly above the previous one and every density `<= Number.MAX_VALUE` (NaN fails), else `RangeError` (`invalid clamp`). A peak-normalized density is at most 1, so `'width'` never meets the area overflow. Angles come from `b − a` when it is finite (exact for subnormal supports, whose halves round onto each other), else from half-differences as before. A cell whose half steps round onto its grid value has no width: the cosine path takes `cos(mu)` (the limit of the cell mean) and the reflected-kernel path the point density (`between(u, u)` is φ(u) and the width is replaced by h, so the units match). | `n9a-kde-repair4.test.ts`: `[0, 1e-306]` with `5e-307`, h = MAX is 128 distinct values, area density 1e306 (also with the default bandwidth), width 1; two points 8 ulps apart at 1 and straddling 1 are the grid, flat, area 1; one-ulp grids (`[1, 1 + u]` at 2 points, `[1, 1 + 4u]` at 5 points with h = u / 10) and subnormal supports `[0, 5e-324 / 1e-323 / 1e-320]` by width are finite; `[0, 1e-320]` by area, `[1, 1 + u]` at 3 points, `[1, 1 + 1e-15]` at 128 and `[0, 5e-324]` by area are RangeErrors; open and ±MAX supports still well formed. |
| 2. Mean residual lost by 2^-64 scaling | Values below 2^-900 are summed unscaled in a bucket of their own (plain sum; the scaled bucket keeps Neumaier). mean = big / n / p + small / n; the sd pass uses big / n + small / n · p. | `[-MAX, 1e-307, MAX]` → `1e-307 / 3` (rel. 1e-14), also through `violinData`; `[MAX, -MAX, -1e-300, 4e-300]` → `3e-300 / 4`; `[-1e16, 1, 1e16]`, `[MAX, MAX]`, `[1e-310, 3e-310]` kept. |
| 3. `[]`/`[]` on a row with data | An empty pair is silent only when the row's median (the published carrier, `names[0]` in `options.ts`) is not a finite number and its n is not > 0 — violinData()'s no-data group (n 0, NaN median). Otherwise AX106 on the grid field with the source rows, effect `'omitted'`, outcome "density outlines are not drawn". `readViolin` takes the median field name as a fifth name. | Rows with n 5 + finite summary, finite summary without n, and NaN summary with n 4 are reported (`['AX106', 'grid', [0, 2, 3], 'omitted']`) and only the good row is drawn; violinData() output with an all-null group stays silent and draws one outline. |
| 4. Scene vs pick/anchor geometry | The scene no longer caps vertex pixels before interpolation. It draws `visible(i, visit, FAR)`: the same exact segment cut as pick and anchor (`visible(i, visit)`), with the cut placed 1e6 px past the plot, so cut ends are off the plot (no stroke along the plot edge) and Float32 stays finite. The inner box/whisker/median keep their capped drawing (the plot clips them, and `shown` already matches that). | `grid [-1e6, 1e9]`, `density [0, 1]` on a pinned `[0, 5]` axis, `inner: 'none'`: the drawn half width at mid-plot and at the top matches the true half width (~0.02 px) and the anchor half width; 10 px off centre falls to the scatter series. An ordinary outline inside the margin keeps its three vertices at full width. |

Tests changed to the new rule (not weakened; the review ruled the old expectation wrong): `n9a-kde-repair.test.ts`
and `n9a-kde-support.test.ts` expected RangeError for `[1, 1 + 2^-44]` (128 values ~2 ulps apart, distinct) and
`[0, 1e-306]` (area density 1e306, finite). They now expect estimates; the rejections kept there are indistinct or
unrepresentable grids (`[1, 1 + 2^-52]` at 3 points, `[0, 1e-320]` and `[0, 5e-324]` by area, `[1, 1 + 2^-40]` at
4096 points, `[1, 1 + 1e-15]`). One test call in `n9a-violin-repair.test.ts` passes the new fifth field name.

Behaviour notes: a clamp that cannot hold the grid is now found on the grid, so it throws only when there is a sample
to estimate (`kde([], { clamp: [1, 1 + 1e-15] })` returns the empty result); invalid option types still throw first.

Lossless stats byte cuts that paid for the repair (needed: the repair first measured 3,626 B): `summarizeBox`
outliers by `Float64Array.filter` (one pass, same values and order); `boxplot()` checks its factor through
`summarizeBox([], options)` (same RangeError, also with no group) and fills its nine columns from one key list
(same keys and values); `extractSortedFinite` is one pass into a full-length buffer whose finite prefix is sorted
in place and returned as a tuple. The boxplot, quantile and C5 stats tests pass unchanged.

**Measurements (observed, round 4).** `npm run build`, then consumers as `tests/dist/subpaths.test.ts` builds them
from the dist files (esbuild bundle + minify, esm, es2022), gzip-9 (`.prism-cache/tmp/n9a/size.mjs`):

| Consumer | Round 3 (review) | Round 4 | Cap |
| --- | ---: | ---: | ---: |
| `export * from 'axylo/stats'` | 3,497 | 3,491 | 3,500 (unchanged) |
| `export { cartesian } from 'axylo/cartesian'` | 137,278 | 137,314 | 138,000 (unchanged) |
| `import 'axylo/stats'` / `'axylo/cartesian'`, `ignoreAnnotations` (raw bytes) | 0 / 0 | 0 / 0 | 0 |

Legacy delta: `src/index.ts`, `src/static.ts`, `src/stream.ts` built minified (ESM) and as a minified IIFE from
this tree and from the round-3 tree, both copied to the same path depth (`.prism-cache/tmp/n9a/d1`, `d2`;
`legacy.mjs`): sha256 identical for all four, so the legacy root/static/stream delta is 0 B. Unminified builds differ only in
their path comments. Built at different path depths, the IIFE differs by 13 B, all from the paths: copies at the
same depth are byte-identical. The absolute legacy line / everything / IIFE caps in `tests/dist` were already
exceeded by the baseline (root line 135,970 / 135,293 B, root everything 158,962 / 158,096 B, minified IIFE
159,309 / 158,425 B per the review); round 4 does not change them.

**Verification (observed, round 4).** `npm run typecheck`: exit 0. `npm run build`: exit 0. Full Node suite
(`npx vitest run --configLoader runner --no-cache --no-fsModuleCache`): 151 files, 2,587 tests passed. The 10 new
tests run against a copy of the round-3 `src`: 7 failed (the targeted regressions), 3 passed (the preservation
cases). Not run in round 4: Chrome / axe (`tests/dist/n9a-violin.browser.test.ts`), `npm pack` and the packed
`tests/dist` suite, Director `verify`, cross-provider review.

## Repair round 5 (two overflow edges)

| Edge | Change | Tests (`n9a-kde-repair5.test.ts`, `n9a-violin-repair5.test.ts`) |
| --- | --- | --- |
| 1. Collapsed cell on a skinny clamp: `densityOnGrid([16], h = Number.MIN_VALUE, [16, 16 + 16ε], 2 points)` gave `[NaN, 0]` (both modes), so `kde` threw | A cell of no width still takes the point value, but its stand-in width is `h + half · 1e-289` (~2^-960 of the grid's half width) instead of `h`: `half / h` overflowed to Infinity before the normalization; now that cell is at most ~2^960 times the others and their sum stays finite. Where `half / h` was finite before, the value changes by at most a relative 1e-289 (the round-4 point-value test is unchanged and passes). | That call: grid `[16, 16 + 16ε]`, width `[1, 6.3e-290]` (peak 1), area finite with trapezoid area 1 ± 0.02; public `kde([16])` over clamps of 1, 2, 3, 5, 8 ulps at 2 and ulps + 1 points, both modes. |
| 2. Outline far past a small pinned y span | `visible` cuts on data values (logs on a log axis): crossings are `w0 + t · (w − w0)` with `t = (e/2 − s0/2) / (s/2 − s0/2)` clamped to [0, 1] (halves, so ±Number.MAX_VALUE differences stay finite), `e` the inverted cut pixel; only grid values inside the cut are projected. Before, the pixels of such grid values were clamped or overflowed and the crossing ratio could be Infinity / Infinity. | Grid `[−MAX, MAX]` and `[−MAX, 0, MAX]` with density rising linearly, pinned `[0, 5]`, `inner: 'none'`: every area and stroke coordinate finite; every drawn half width = half / 2 (the true value); pick at half / 4 off centre takes the violin; anchor finite, half width half / 2, spanning the plot height. |

Skinny-clamp audit: duplicated midpoint rounding (several half steps rounding onto one value, e.g. 1 + 4u at five
points) gives cells of no width in the middle as well as at the ends; each now takes the finite point value above. A
grid with more points than the clamp has ulps is still a RangeError (not strictly increasing), as before.

**Measurements (observed, round 5).** `npm run build`, then esbuild bundle + minify (esm, es2022) of the dist files,
gzip-9 (`.prism-cache/tmp/n9a/size.mjs`, aliases `axylo/*` to `packages/axylo/dist/*.js`):
`export * from 'axylo/stats'` 3,498 B (cap 3,500); `export { cartesian } from 'axylo/cartesian'` 137,399 B (cap
138,000, unchanged); `import 'axylo/stats'` / `'axylo/cartesian'` with `ignoreAnnotations`: 0 / 0 raw bytes. This
recipe was not cross-checked against round 4's 3,491 / 137,314 B on the round-4 tree. Legacy root/static/stream:
no file they import changed (only `src/stats/kde.ts`, `src/cartesian/violin.ts` and tests), so the delta is 0 B by
construction; not rebuilt and hashed in round 5.

**Verification (observed, round 5).** `npm run typecheck`: exit 0. `npm run build`: exit 0. Scoped Node suite
(`npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/stats
packages/axylo/test/cartesian`): 30 files, 311 tests passed. Not run: full Node suite, the new tests against the
round-4 `src`, Chrome / axe, `npm pack` and the packed `tests/dist` suite, Director `verify`, cross-provider review.

## Contract changes needed

None. `src/public.ts` and `src/core/**` untouched.

## Final command tails (repair round 2, after the last edit)

See the end of the worker report for the final typecheck and scoped Vitest tails; the numbers in "Verification" above
come from the same runs.

## Repair round 6 (cross review sol-6.2-medium__20261127T214223Z)

- kde.ts grid: `lo + t·(hi − lo)` when the span is finite, weighted mean of the ends otherwise; `grid[last] = hi` exact. `[1.25, 1.25+3ε]`, 4 points → four consecutive doubles (test/stats/n9a-kde-repair6).
- violin.ts clipping: crossing test is now strict order comparisons (no product of tiny differences); pinned `[2e-200, 4e-200]` on `[0, 6e-200]` anchors and wins the pick (test/cartesian/n9a-violin-repair6).
- stats.ts mean: the small-value bucket is Neumaier-compensated by the same step as the scaled bucket; `[-MAX, -1e-275, 1e-307, 1e-275, MAX]` → mean `1e-307 / 5`.
- violin.ts empty payload: median read with data/values `valueMode` decimal semantics; `'2'` + empty grid/density → AX106 on `grid`, rows `[0]`; no-data row silent.
- Measured (quick src recipe, esbuild minify + gzip-9): **stats 3,543 B — OVER the 3,500 B cap by 43 B** (grid fix +12 B, compensation +~33 B; not resolved). cartesian 137,434 B (≤ 139,000). Bare imports `axylo/stats`, `axylo/cartesian`: 0 raw bytes (two-step, ignoreAnnotations).
- Failing: `test/stats/n9a-kde-support.test.ts:147` expects RangeError for `kde([1], { clamp: [1, 1 + 2^-40], points: 4096 })`; that span is 4096 ulps, so the exact grid is now distinct and estimated. Expectation left unchanged for the owner/coordinator.

## Repair round 6b (`bundle_cutter`: `axylo/stats` gzip-9 cap repair)

- **Scope:** `packages/axylo/src/stats.ts` and this ledger only (`src/stats/kde.ts`, `src/cartesian/**`, tests, and caps untouched). All numeric behaviors and tested runtime `RangeError` rejections preserved.
- **Byte cuts in `packages/axylo/src/stats.ts` (−60 B gzip-9, −194 B raw):**
  1. Shared 0-argument `fail = (): never => { throw new RangeError('axylo/stats'); }` for KDE-only validations (dropped interpolated `what`/`value` strings and `[a, b]` allocation); combined the `bandwidth`/`normalize`/`points` checks into one `if (...) fail();` and shortened `options === null` to `!options`.
  2. Single shared return object `{ grid, density, bandwidth: h, normalize, summary }` in `estimate()` for empty and non-empty samples.
  3. Single `keys` list (`Object.fromEntries(keys.map(...))`) for the seven `Float64Array` summary columns in `violinData()`, matching `boxplot()` and removing the duplicated key list and `column` closure.
- **Latest repaired test cases (already present in workspace, all passing):**
  - `packages/axylo/test/stats/n9a-kde-support.test.ts`: `kde([1], { clamp: [1, 1 + 2^-40], points: 4096 })` now asserts 4,096 strictly increasing grid points and finite non-negative density; `kde([1], { clamp: [1, 1 + 2^-50], points: 4096 })` (4 ulps) asserts `RangeError`.
  - `packages/axylo/test/stats/n9a-kde-repair6.test.ts`: `[1.25, 1.25 + 3ε]` at 4 points (consecutive doubles), `[-MAX, MAX]` exact ends/midpoint, and `[-MAX, -1e-275, 1e-307, 1e-275, MAX]` compensated mean `1e-307 / 5`.
  - `packages/axylo/test/cartesian/n9a-violin-repair6.test.ts`: pinned `[2e-200, 4e-200]` on `[0, 6e-200]` anchor/pick, and decimal-string median `'2'` with empty `grid`/`density` reporting `AX106` on `grid` while no-data row stays silent.
- **Measurements (observed, two-stage production consumer matching `tests/dist/subpaths.test.ts`: `npm run build`, then esbuild `bundle: true, minify: true, format: 'esm', target: 'es2022', conditions: ['production']` over `packages/axylo/dist/*.js`, `gzipSync(..., { level: 9 })`):**
  - `export * from 'axylo/stats'`: **3,483 B gzip-9** (7,260 B raw) — down 60 B from 3,543 B, **17 B below** the unchanged 3,500 B cap.
  - `export { cartesian } from 'axylo/cartesian'`: **137,519 B gzip-9** (unchanged; 481 B below the 138,000 B cap).
  - `import 'axylo/stats'` (`ignoreAnnotations: true`): **0 raw bytes**.
  - `import 'axylo/cartesian'` (`ignoreAnnotations: true`): **0 raw bytes**.
  - Legacy root/static/stream: 0 B delta by construction (no file they import changed).
- **Verification (observed, ran and saw after the final code edit):**
  - `npm run build`: exit 0 (`built axylo.css, ..., stats.d.ts, stats.dev.js, stats.js, ...`).
  - `npm run typecheck`: exit 0 (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist`).
  - `npx vitest run --configLoader native --no-cache --no-fsModuleCache packages/axylo/test/stats packages/axylo/test/cartesian`: exit 0 — `Test Files  33 passed (33)`, `Tests  317 passed (317)` (`Duration  6.49s`).
  - **Not run here (left for Coordinator):** Chrome / browser tests (`tests/dist/n9a-violin.browser.test.ts`, `npm run test:browser`), packed tarball `tests/dist/subpaths.test.ts`, full Node suite.

## Repair round 8 (review sol-6.2-medium__20261127T220111Z: median admission for empty outlines)

- **Finding:** `readViolin` decided "empty outline on a row with data" with its own median parser, which disagreed
  with the chart: `['', '3']` coerced `''` to 0 (spurious AX106 on `grid`), and `['2', NaN]` in row form treated the
  row NaN as a column null (spurious AX106 on `grid` beside the chart's AX106 on `median`).
- **Fix (no second parser):** `readViolin` no longer reads the median (its fifth name and the `valueMode` import
  are gone). It records `empty: Uint8Array` per source row (1 = empty pair, 2 = empty pair with n > 0) and the grid
  field name in `ViolinColumns`. `normalizeCartesian` (which `validateCartesian` and the chart's data stage both
  call) reports one AX106 on the grid field, effect `'omitted'`, for rows marked 2, and for rows marked 1 whose
  median slot is `SLOT_VALUE` in the normalized frame (`series.row` maps slot → source row). Rows are then scanned
  in source order, so the sample is the first 10 source rows and `count` is the full total; each row is counted
  once. The chart's own rules therefore decide missing values (`''`, `null`, column NaN), row vs column NaN,
  whole-column decimal strings, `parse`, and x admission (a row with a non-admitted x is not in the frame).
- **Behaviour notes:** an n-positive empty pair is still reported whatever its median or x. Strict mode rejects
  the new data-stage AX106 (level warning), and the update rolls back synchronously; this is asserted in the
  controller harness of `n9a-violin.test.ts`. One side effect: on an empty pair with n 0 whose median the chart
  reads, the n of 0 is now treated as the no-data group's own value and stays silent. The AX106 on `grid` still
  reports the row. Before this round, that row also got AX106 on `n`; no test covered it.
- **Tests:** new `test/cartesian/n9a-violin-repair8.test.ts` covers `['', '3']` (silent), row-form `['2', NaN]`
  (AX106 on median only, with and without `parse: 'number'`), column-form NaN (silent on its own row; `['2', NaN]`
  columns still decimal → grid `[0]`), mixed `['2', 2]` (median only), accepted `['2', '3']` (grid `[0]`, warning,
  count 1, reader omitted 1, with and without `parse`), and a non-admitted x. A raw-row parser would report the
  non-admitted-x row; the frame does not. It also covers n-positive rows reported once (`[0, 2, 3]`), source-order
  sampling with descending numeric x (rows `0..9`, count 14), and `validateCartesian` parity. Mutation checks
  (observed): dropping the `SLOT_VALUE` condition fails 5 of 9 tests, and reversing the row sample order fails 2.
- **Fixture change, flagged:** `n9a-violin-repair6.test.ts` "decimal string '2'" used a no-data row with row-form
  `NaN` medians. That fixture is the reviewer's counterexample: the chart rejects `'2'` there. Its no-data row now
  uses `null` (missing) summaries, which keeps the test's intent and its expected value `[['AX106', 'grid', [0]]]`
  unchanged. The `NaN` variant is covered in repair 8 with the reviewer's expected result. The `readViolin` call
  shape in `n9a-violin-repair.test.ts` (separator-signature test) dropped the fifth (median) name.
- **Measurements (observed, copied-tree `node scripts/build.mjs` for sealed `trees/neon-4-medium__20261127T215745Z`,
  `initial/` and this candidate; consumer esbuild minify esm es2022, `legalComments: 'none'`, gzip-9):**
  - `export { cartesian } from './cartesian.js'`: sealed 137,519 B (matches the review) → **137,532 B (+13 B)**,
    468 B under the 138,000 B cap (cap unchanged).
  - `export * from './stats.js'`: **3,483 B** (unchanged; `stats.js` byte-identical to sealed), under 3,500 B.
  - Bare `import './cartesian.js'` and `import './stats.js'` over built dist, with and without `ignoreAnnotations`:
    **0 raw bytes** each.
  - `axylo.js`, `axylo.dev.js`, `static.js`, `static.dev.js`, `axylo.iife.js`, `axylo.iife.min.js`: byte-identical
    to `initial/` → **0 B legacy root/static delta**. Versus sealed, only `cartesian.js`, `cartesian.dev.js` and
    `cartesian/violin.d.ts` differ.
- **Verification (observed):** `npm run typecheck` exit 0; `npx vitest run --configLoader runner --no-cache
  --no-fsModuleCache packages/axylo/test/cartesian packages/axylo/test/stats` → `Test Files  34 passed (34)`,
  `Tests  326 passed (326)`.
- **Not run (left for Coordinator):** Chrome/axe browser tests, packed `tests/dist` suites, `npm pack`, full suite,
  Director `verify`.

## Repair round 9 (review sol-6.2-medium__20261127T221205Z: one AX106 per grid field, ascending rows)

- **Finding (reproduced):** an AX106 on a violin grid could come from two stages. A malformed grid went out as an
  option issue at the view stage. An empty pair with data went out from `normalizeCartesian`. The collector merges
  same-key reports by adding counts and appending rows. So a one-point grid on row 0 plus 12 admitted empty pairs
  gave rows `[1..10]` (data stage first) instead of `[0..9]`. Two layers reading the same payload field also
  doubled every violin count: probed with shared grid/density/n, each fault had `count` 2 for one row.
- **Fix:** (1) `readViolin` no longer reports grid AX106 itself. A non-list grid, a one-point grid, and a grid that
  is not increasing or not numbers all set `empty[r] = 2`. That is the same mask value as an n-positive empty pair.
  `normalizeCartesian` ORs the masks of all violin layers into one `Uint8Array` per grid field, adds the empty-pair
  rows whose median the frame holds, and emits one AX106 per field. That report has the full distinct-row count and
  the first ten source rows ascending. Slot order (x sorting) does not affect it. (2) The other violin payload notes
  (AX102 / AX103 on grid and density, AX106 on density, n and bandwidth) keep their codes, fields, outcomes and option
  stage. They are now pooled across layers in a per-(code, field) source-row mask (`ViolinNotes`, created in
  `parseCartesianInput`). They are flushed once after the layer loop (`flushViolin`), so a shared field gets one
  report with distinct rows ascending. `readViolin` keeps its old 5-argument call shape: with no pool it flushes its
  own notes, so the existing separator-signature fixture is unchanged.
- **Ordering side effect:** violin option issues now come after the other option issues of later layers in the
  option-issue list, not straight after their own layer. No existing test depended on that order (all passed
  unchanged).
- **Tests:** `test/cartesian/n9a-violin-repair9.test.ts` (7 tests). It uses numeric x descending, so slot order is
  the reverse of source order. Cases:
  - one-point grid on row 0 plus 12 admitted empty pairs → `count` 13, rows `[0..9]`, with `validateCartesian`
    parity;
  - 8 empty pairs, then a non-list grid, a one-point grid, a non-increasing grid and a non-number grid → 12,
    `[0..9]`;
  - column form with n-positive and median-read empties → 12, `[0..9]`;
  - two layers on one grid, with row 11/12/13 medians missing per layer → 13, `[0..9]`, also with separate densities;
  - shared grid/density/n faults counted once; a shared density whose mismatches come from different grids →
    `count` 2, rows `[1, 3]`;
  - AX102/AX103 on grid and AX106 on density unchanged;
  - a strict update with a one-point grid throws `AX106` and rolls back, and an accepted update leaves no grid
    diagnostic.

  Mutation checks (observed): with the round-8 `violin.ts`/`normalize.ts` restored, 3 of 7 then-existing tests
  fail (the first, third and fourth). With the shared pool not passed from `options.ts`, the shared-field test fails.
- **Measurements (observed, quick src recipe: esbuild `src/<entry>.ts` with `PRODUCTION` + minified stylesheet
  plugin, minify esm es2022, `legalComments: 'none'`, then re-bundle and gzip-9; on the round-8 tree it gave
  137,532 B, the dist figure above):**
  - `export { cartesian }`: 137,532 → **137,713 B (+181 B)**, 287 B under the 138,000 B cap (cap unchanged). Of the
    181 B, +105 B is the normalize aggregation and +76 B the cross-layer pool.
  - `export * from stats`: **3,483 B** (unchanged; no stats file touched).
  - Bare `import` of built `cartesian.js` / `stats.js`, with and without `ignoreAnnotations`: **0 raw bytes**.
  - Legacy root/static: the `index.ts` / `static.ts` metafile inputs from `cartesian/` are only `repeats.ts`
    (untouched), so the changed files are not in those bundles: **0 B delta** by input graph. The packed dist was
    not rebuilt here.
- **Verification (observed):** `npm run typecheck` exit 0. `npx vitest run --configLoader runner --no-cache
  --no-fsModuleCache packages/axylo/test/cartesian packages/axylo/test/stats` → `Test Files 35 passed (35)`,
  `Tests 333 passed (333)`.
- **Not run (left for Coordinator):** Chrome/axe browser tests, `npm pack` / packed `tests/dist` suites, the full
  suite, and Director `verify`.

## Repair round 10 — cross-role AX106 aggregation (review sol-6.2-medium__20261127T222130Z)

- **Finding:** a field read as one layer's grid and another layer's density, n or bandwidth gave two AX106 reports.
  The option-stage pool flushed the density, n and bandwidth faults, and normalization then flushed the grid faults
  separately.
- **Fix (reuses `ViolinNotes`; no second aggregation path):** `flushViolin` takes the set of grid fields of the parse
  and leaves their AX106 entries in the pool. `ViolinColumns.notes` carries the per-parse pool (null when `readViolin`
  runs standalone and flushes everything itself, as before). `normalizeCartesian` seeds each grid field's mask with
  the pool's `AX106`+field row mask. It reads the mask and never writes to it, so repeated normalizations and data
  updates of one parse stay idempotent. It then unions the readViolin `empty` 2 rows and the normalized empty-grid
  rows, and emits once with the full distinct count and the first ten ascending source rows. AX106 on a field that no
  layer uses as a grid, and every AX102/AX103, keep their option-stage reports unchanged.
- **Assumptions:** the merged report uses the grid outcome text ("density outlines are not drawn …"), also when the
  other role was n/bandwidth ("… is not read out"). It now happens at the normalize stage, as grid AX106 already did,
  so strict mode still throws `AX106` synchronously and rolls back.
- **Tests:** `test/cartesian/n9a-violin-repair10.test.ts` (5 tests). Each runs `n5run` and `validateCartesian`
  twice, and the results must match. Numeric x is descending. Cases:
  - A grid `shared`, B grid `grid2` and density `shared`. Row 0 is `shared=[2,1]`, `density=[1,1]`,
    `grid2=[0,1,2]`, so both roles fault → count 1, rows `[0]`. The parse has no option-stage issue on `shared`.
  - Only density fails on row 0 and only the grid on row 1 → count 2, rows `[0,1]`, in both layer orders.
  - Admitted empty grids (rows 0–5, also B density mismatches), B density only (6–11) and A empty only (12, 13) →
    count 14, rows `[0..9]`; `grid2` separately gets 2, `[12,13]`. The column form gives the same.
  - B's n and bandwidth aliased to A's grid → count 3, rows `[0,1,2]`, one report. An unaliased bad n stays
    `AX106 n [0]`, and AX102/AX103 on the grid are unchanged.
  - A strict update whose only fault is B density on A's grid field throws `AX106` and rolls back the meta; the
    accepted update after it has no stale report.

  Mutation checks (observed): without the seed union in `normalize.ts`, 4 of 5 fail. Without the grid set passed to
  `flushViolin`, 4 of 5 fail.
- **Measurements (observed).** Quick src recipe as in round 9, with a path-agnostic css onLoad plugin. Both trees
  were copied to the same depth under `.prism-cache/tmp`, with the base reconstructed by reverse-applying this
  round's edits.
  - `export { cartesian }`: 137,715 → **137,776 B (+61 B)**, 224 B under the 138,000 B cap (unchanged). The workspace
    path gives 137,772 B.
  - `export * from stats`: **3,483 B** (unchanged).
  - Bare `import`, with and without `ignoreAnnotations`: **0 raw bytes** for cartesian and stats.
  - Root `index.ts` / `static.ts`: byte-identical before and after (444,131 / 390,809 raw esbuild bundles), and the
    only `cartesian/` input is `repeats.ts`, so the delta is **0 B**.
- **Not run (left for Coordinator):** Chrome/axe browser tests, `npm pack` / packed `tests/dist` suites, the full
  suite, and Director `verify`.

## Repair round 11 — AX106 outcome follows the faulting roles (review sol-6.2-medium__20261127T222826Z)

- **Replay:** the eleven `p2_n9a` patches were applied in order onto the `b217e58` workspace, each with
  `git apply --check` followed by `git apply`. All 11 checked and applied cleanly.
- **Finding:** round 10 merged a grid field's AX106 rows from every role, but always gave the outline outcome. Take
  layer B reading layer A's grid field as `n` or `bandwidth`, with valid grids and densities. Both outlines render
  and the value is only left out of B's readout, yet the report said the outlines were not drawn. The pool also kept
  the first-noted outcome for a non-grid field used in two roles (one layer's density, another's n), so that report
  could be wrong too.
- **Fix (`violin.ts`, `normalize.ts`):** each `ViolinNotes` row now records the roles it faulted in: `OUTLINE` (1)
  when read as a grid or density, `SCALAR` (2) when read as n or bandwidth. The pool entry no longer stores an outcome
  string. One helper, `violinReport(field, mask)`, serves both the option-stage `flushViolin` and the normalize-stage
  grid masks. It returns the count of distinct rows, the first ten rows ascending, and the outcome:
  - outline only: "Those rows' density outlines are not drawn; their summaries stay in tooltip and table."
    (unchanged);
  - scalar only: "Those rows' <field> is not read out." (the unaliased scalar text, unchanged);
  - mixed: "Density outlines are not drawn for <o> of those rows and <field> is not read out for <s>; their
    summaries stay in tooltip and table." Here `o` and `s` count all faulted rows per role, not only the ten-row
    sample. Per-role counts are given because a row need not lose both.

  `normalizeCartesian` ORs the pool's role bits with its own outline faults (readViolin `empty` 2, and an empty grid
  whose median is admitted). It still reads the pool and never writes to it. These are unchanged: one report per
  field, the union of rows, row sampling, effect `'omitted'`, codes, strict-mode throw/rollback, drawing and readout.
- **Assumption:** the exact mixed-outcome wording is mine; spec 3.5 fixes the code, rows and count, not this
  sentence. Field names in the outcome stay unquoted, as in the existing scalar sentence.
- **Tests (`test/cartesian/n9a-violin-repair10.test.ts`, 5 → 12 tests).** A new `said` helper compares the full
  message across two `n5run` and two `validateCartesian` runs, and checks effect `'omitted'` on the live reports.
  Expected messages are built from the registry's AX106 text (singular/plural forms) plus the outcomes above. The
  round-10 cases keep their `[code, count, rows]` assertions and now also assert the exact message: outline-only for
  the A-grid/B-density cases (in both layer orders, with 2 + 2 violins drawn), mixed `(1, 3)` for the n+bandwidth
  alias. New cases:
  - scalar-only `n` and `bandwidth` (each in both layer orders): 3 + 3 violins drawn, B's readout
    `median 2 (n No data, …)` / `(…, bandwidth No data)`, and no message mentions outlines;
  - mixed n / bandwidth: A's grid is bad on 2 of 4 rows, giving `(2, 4)`, 2 + 4 drawn;
  - n and bandwidth on one field: one scalar-only report;
  - 12 rows: counts over all rows (`(1, 12)`) with a ten-row sample, and 11 rows scalar-only;
  - a non-grid field read as A's density and B's n: mixed `(1, 3)` at the option stage (also checked on
    `optionIssues`), and scalar-only when A's density is valid.

  Mutation check (observed): with `violinReport` forced back to the outline sentence, 8 of 12 tests fail.
- **Measurements (observed).** Quick src recipe: esbuild `src/<entry>.ts`, minify esm es2022, `PRODUCTION` defines,
  minified-CSS onLoad plugin, `legalComments: 'none'`, then re-bundle and gzip-9. Both trees were copied to the same
  depth under `.prism-cache/tmp/n9a-r11/`. The pre-fix tree is the 11-patch replay; its two files were rebuilt by
  applying the patches to the base copies.
  - `export { cartesian }`: 137,776 → **137,813 B (+37 B)**, 187 B under the 138,000 B cap (cap unchanged).
  - `export * from stats`: **3,483 B** (unchanged).
  - Bare `import` of `cartesian.js` / `stats.js`, with and without `ignoreAnnotations`: **0 raw bytes**.
  - Root `index.ts` / `static.ts` esm bundles are byte-identical before and after (`cmp`). The only `cartesian/`
    input of index and static (IIFE included) is `repeats.ts`, which is untouched, so root/static/IIFE change by
    **0 B**.
- **Verification (observed):** `./tools/loupe fast packages/axylo/src/cartesian packages/axylo/src/stats
  packages/axylo/test/cartesian packages/axylo/test/stats` → `ok fast`. `./tools/loupe test packages/axylo/test/cartesian
  packages/axylo/test/stats` → `PASS: 345 tests` (338 before this round, plus 7 new).
- **Not run (left for Coordinator/Director):** Chrome/axe browser tests, `npm pack` / packed `tests/dist` suites, a
  real `npm run build` dist size check, and `verify:heavy`.
