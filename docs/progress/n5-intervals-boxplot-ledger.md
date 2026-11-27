# N5 — single-identity intervals, `scatter` layer, native `boxplot`, stats hardening, annotation diagnostics

## Current status — `Date` canonicalization & typed annotation signature repair (cross-review `sol-6.2-medium__20261127T101404Z`)

- **Latest cross-review:** `sol-6.2-medium__20261127T101404Z` (`/home/canarit/projects/prism/runs/coordinator_p2_n5/sol-6.2-medium__20261127T101404Z/report.md`)
- **Prior Director verify log (exact):** `/home/canarit/projects/prism/runs/coordinators/p2_n5/verify/turn-31-neon-4-medium__20261127T100713Z.log`
  - `npm run typecheck`: **PASS**
  - `npm run build`: **PASS**
  - Node suite: **PASS** (`137` test files / `2,362` tests)
  - Packed `tests/dist/subpaths.test.ts`: **3 passed, 1 failed, 13 skipped** (`axylo/cartesian` **129,681 B gz9** > `127,000 B` cap; bare imports **0 B** / **0 B** PASS).

### What changed in this repair (only owned options, annotation tests, and ledger)

| File | Change |
|---|---|
| `packages/axylo/src/cartesian/options.ts` | 1. **Canonicalize valid `Date` x coordinates:** `xValue` now returns `new Date(t)` from the validated timestamp `Date.prototype.getTime.call(v)` instead of retaining the caller's `Date` instance, so caller-defined serialization or value hooks (`toJSON`/`valueOf`/`toString`/`getTime`) are never invoked.<br>2. **Typed annotation signature (`__annSig`):** encodes each `Date` coordinate as `['date', Date.prototype.getTime.call(v)]` before `JSON.stringify` rather than passing `Date` instances directly to `JSON.stringify`. This avoids `Date.prototype.toJSON` and makes `Date` coordinates structurally distinct from identical ISO strings, so strict category-axis `update()` calls replacing an ISO string with a same-instant `Date` trigger revalidation and `AX107` rollback. |
| `packages/axylo/test/cartesian/n5-annotations.test.ts` | Added real public `cartesian()` wrapper update regressions (routing `createStaticChart` to `staticControllerFor` with the recording host) covering: (a) structural `__annSig` distinction between ISO strings and `Date`s across `point`/`threshold`/`range`; (b) a `Date` with throwing `toJSON`/`valueOf`/`toString`/`getTime` hooks canonicalized into a fresh `Date` with 0 hook calls across initial update and subsequent title update; (c) strict category-axis `update()` replacing an ISO string with the same-instant `Date` rejecting with `AX107`, rolling back, and preserving the accepted annotation across a follow-up `update()`. |
| `docs/progress/n5-intervals-boxplot-ledger.md` | Recorded this repair, exact prior review/Director numbers, new measurements, and remaining open gates. |

### Measured sizes & verification on this candidate

- `npx vitest run packages/axylo/test/cartesian packages/axylo/test/stats --configLoader native --no-cache`: **PASS** (`18` test files / `153` tests)
- `npm run typecheck`: **PASS** (exit 0)
- `npm run build`: **PASS** (exit 0)
- Consumer sizes (locked esbuild 0.28.2, production ESM minified, gzip-9):
  - `axylo/cartesian`: **357,502 B raw / 129,779 B gz9** (+98 B gz9 vs 129,681 B; +2,779 B above the 127,000 B cap)
  - `axylo/stats`: **3,896 B raw / 1,676 B gz9**
  - Bare imports (`ignoreAnnotations: true`): `axylo/cartesian` **0 B raw**, `axylo/stats` **0 B raw**
  - Legacy root/static/IIFE delta: **0 B** (zero edits outside `packages/axylo/src/cartesian/options.ts`, `packages/axylo/test/cartesian/n5-annotations.test.ts`, and this ledger).

### Open gates & out-of-fence handoff

1. **Packed size cap (`tests/dist/subpaths.test.ts`, 127,000 B vs 129,779 B gz9):** Requires out-of-fence integration/decision (N6 controller split + core/DOM static specialization or cap re-freeze).
2. **N6 (`packages/axylo/src/cartesian.ts`):** Add `scatter` (`point`) and `boxplot` variants to the public `CartesianLayerOptions` union.
3. **Shared Core / DOM / Data owners:** Lone compound legend toggle (`dom/interaction-controls.ts`), same-x hover cache winning mark (`dom/interaction.ts`), compound hover overlay anchor (`cartesian/overlay.ts`), >8-series keyboard readout (`core/focus.ts`), and duplicate-x scatter handling (`data/normalize.ts`).
4. **Coordinator:** Run full Director verification (Node + packed `tests/dist/subpaths.test.ts`), real Chrome + `axe-core` suite (`tests/dist/c5.browser.test.ts`), and final cross-provider review on the integrated seal.

---

## Prior status — in-fence repair (cross-review `sol-6.2-medium__20261127T100250Z`, superseded above)

- **Latest cross-review:** `/home/canarit/projects/prism/runs/coordinator_p2_n5/sol-6.2-medium__20261127T100250Z/report.md`
- **Prior Director verify log (exact):** `/home/canarit/projects/prism/runs/coordinators/p2_n5/verify/turn-28-neon-4-medium__20261127T095313Z.log`
  - `npm run typecheck`: **PASS**
  - `npm run build`: **PASS**
  - Node suite: **PASS** (`137` test files / `2,359` tests)
  - Packed `tests/dist/subpaths.test.ts`: **3 passed, 1 failed, 13 skipped** (`axylo/cartesian` **129,553 B gz9** > `127,000 B` cap; bare imports **0 B** / **0 B** PASS).

### What changed in this final in-fence repair (only owned files)

| File | Change |
|---|---|
| `packages/axylo/src/cartesian/options.ts` | 1. **Object-backed `ArrayLike` outlier columns (`isColumn`):** `readOutliers` now accepts any non-null object with integer `length` in `[0, 0x7fffffff]`, matching `data/options.ts` `resolveTable` and the public `Data<Row>` column contract. Preserves typed-array and ordinary-array per-row outlier cells (`isList`) and borrowed peer columns while retaining `AX106` for invalid column/cell shapes.<br>2. **Pre-signature `XValue` validation (`xValue`):** validates `point.x`, x-axis `threshold.value`, and x-axis `range.from`/`range.to` against `XValue` (`number \| string \| Date`) before adding to `meta.annotations` or `JSON.stringify([annotations, optionIssues])`. Rejects `bigint`, `symbol`, objects, cyclic objects, fake `Date` (`Object.create(Date.prototype)`), and other non-`XValue` types with indexed `AX150` warnings without invoking any object serialization hooks (`toJSON`/`valueOf`/`toString`). Reports non-finite numbers and invalid `Date`s consistently with indexed `AX103` warnings. Preserves valid numeric/string/`Date` values and `AX107` scale-mismatch diagnostics. |
| `packages/axylo/test/cartesian/n5-boxplot.test.ts` | Added regression verifying object-backed `ArrayLike` outlier column (`{ 0: Float64Array([12]), 1: [15], length: 2 }`) rendering, accessible table values, zero diagnostics, borrowed peer typed-array columns, and `AX106` on invalid column shapes. |
| `packages/axylo/test/cartesian/n5-annotations.test.ts` | Added Node regressions through `validateCartesian` (rejecting `bigint`, `symbol`, cyclic object, hooked object with 0 hook calls, fake `Date`, `NaN`, `Infinity`, invalid `Date`; preserving valid `Date`/ISO string and `AX107` on numeric-scale string mismatch) and through real `ChartController` strict `update()` rollback followed by a follow-up accepted `update()`. |

### Measured sizes & verification on this candidate

- `npm run typecheck`: **PASS** (exit 0)
- `vitest run packages/axylo/test/cartesian packages/axylo/test/stats --configLoader native --no-cache`: **PASS** (`18` test files / `152` tests)
- `npm run build`: **PASS** (exit 0)
- Consumer sizes (locked esbuild 0.28.2, production ESM minified, gzip-9):
  - `axylo/cartesian`: **357,198 B raw / 129,681 B gz9** (+128 B gz9 vs 129,553 B; still +2,681 B above the 127,000 B cap)
  - `axylo/stats`: **3,896 B raw / 1,676 B gz9**
  - Bare imports (`ignoreAnnotations: true`): `axylo/cartesian` **0 B raw**, `axylo/stats` **0 B raw**
  - Legacy root/static/IIFE delta: **0 B** (zero edits outside `packages/axylo/src/cartesian/options.ts`, owned tests, and ledger).

### Explicit out-of-fence owner integration & Chrome handoff

1. **N6 / Core / DOM / Build owners (packed size cap 127,000 B vs 129,681 B gz9):** Integrate N6's controller split, remeasure the combined Cartesian consumer, and either specialize the static aligned composition (`core/controller.ts`, `dom/interaction.ts`, `cartesian.ts`) to exclude non-aligned/streaming code or re-freeze the `axylo/cartesian` cap in `tests/dist/subpaths.test.ts`.
2. **N6 (`packages/axylo/src/cartesian.ts`):** Add `scatter` (`point`) and `boxplot` variants to the public `CartesianLayerOptions` union.
3. **Core / DOM / Data owners:** Lone compound legend toggle (`dom/interaction-controls.ts`), same-x hover cache winning mark (`dom/interaction.ts`), compound hover overlay anchor (`cartesian/overlay.ts`), >8-series keyboard readout (`core/focus.ts`), and duplicate-x scatter handling (`data/normalize.ts`).
4. **Coordinator:** Run full Director verification (including packed `tests/dist/subpaths.test.ts`), real Chrome + `axe-core` verification (`tests/dist/c5.browser.test.ts`), and final cross-provider review on the integrated candidate.

---

## Prior status — turn-25 seal + in-fence API/diagnostic repairs (superseded above)

**The Cartesian consumer is 129,553 B gzip-9 (+2,553 B above the 127,000 B cap; +112 B vs turn-25's 129,441 B after adding spec-required scatter position aliases, `point` alias, and malformed-outlier diagnostics).** The existing packed size gate still blocks release; no substantial safe in-fence size cut remains (see Structural Audit below).

### Turn-25 Director status (exact)

- **Turn-25 verify log:** `/home/canarit/projects/prism/runs/coordinators/p2_n5/verify/turn-25-astra-6.2-high__20261127T093810Z.log`
  - `npm run typecheck`: **PASS**
  - `npm run build`: **PASS**
  - `vitest run --configLoader native --no-cache`: **PASS** (`137` test files / `2,357` tests)
  - `tests/dist/subpaths.test.ts`: **3 passed, 1 failed, 13 skipped**:
    - Bare imports (`ignoreAnnotations: true`): `axylo/cartesian` **0 B**, `axylo/stats` **0 B** (**PASS**)
    - Tiny subpaths (`<= 3,500 B` gz9): `stats` **1,676 B**, `sync` **1,590 B**, `export` **3,295 B** (**PASS**)
    - Standalone cap (`<= 127,000 B` gz9): `cartesian` **129,441 B** (**FAIL** vs `127,000 B`), `finance` **124,599 B** (**PASS**).

### What changed in this repair pass (all inside N5 fence)

| File | Change |
|---|---|
| `packages/axylo/src/cartesian/options.ts` | 1. **Scatter `yAxis: 'left' \| 'right'` position aliases:** when a `scatter` (or `point`) layer supplies `yAxis: 'left'` or `yAxis: 'right'` and no axis has that literal ID, resolves to `leftAxes[0]` / `rightAxes[0]`. Explicit axis IDs in `axisById` always take priority (even if custom IDs are literally named `'left'`/`'right'`). An absent right axis still emits `AX174`.<br>2. **`type: 'point'` alias:** normalized `'point'` to `'scatter'` in `options.ts` (explicitly documented interpretation of the spec's "`scatter` / `point` Layer" wording; `scatter` remains canonical).<br>3. **`readOutliers` diagnostics:** no longer silently drops malformed or non-finite outlier cells. Preserves normal empty (`[]`, `Float64Array(0)`), absent-per-row (`undefined`, `null`), single finite numbers, and `axylo/stats` `Float64Array` outliers with 0 diagnostics. Emits `AX103` (non-finite `NaN`/`±Infinity` with `count`/`rows`) and `AX106` (non-numeric elements or malformed non-list cells/columns with `count`/`rows`) via `DiagnosticSink` (honoring `strict: true` rollback) while still drawing valid sibling outliers.<br>4. **Compact carrier signature:** replaced six per-carrier `__axis*`/`__mark`/`__stacked` keys and redundant `__capWidth` (already in `__layerSig`) with one `__s` string. |
| `packages/axylo/src/cartesian/boxplot.ts`, `annotations.ts` | Extended `OptionIssue` with `'AX106'` and optional `count`/`rows`; `validateCartesianAnnotations` forwards `count`/`rows` to `report(sink, ...)`. |
| `packages/axylo/src/cartesian/view.ts` | Merged the separate `AX171` log-outlier scan into the single `parts.forEach` boxplot pass and removed `sink` from `compoundFit`. |
| `packages/axylo/test/cartesian/n5-scatter.test.ts`, `n5-boxplot.test.ts` | Added regressions for scatter `left`/`right` position aliases on custom axis IDs, explicit ID priority, absent right axis `AX174`, `type: 'point'` alias through real `ChartController` + `validateCartesian`, and clean vs malformed/non-finite boxplot outlier diagnostics (`AX103`/`AX106`). |

### Structural bundle audit (new direction: pre-domain work, dead reachability, option/annotation metadata)

- **Post-treeshake `bytesInOutput` (`esbuild 0.28.2`, prod defines, minified ESM):**
  - Total `cartesian.js` consumer: **356,765 B raw / 129,553 B gz9** (`adoptNormalized`/`StreamSession` absent).
  - All 9 N5-owned files combined: **44,923 B raw** (`options.ts` 8,925, `lookup.ts` 7,889, `scene.ts` 6,675, `view.ts` 5,492, `annotations.ts` 4,367, `reader.ts` 4,053, `boxplot.ts` 3,052, `mark-swatch.ts` 2,537, `diagnostics.ts` 1,933).
  - **Dead shared reachability:** audited every runtime import across all 9 owned files. The only non-owned modules exclusively reachable through N5-owned files are `cartesian/dense.ts` (1,668 B raw, required for F5 decimation) and `cartesian/meta.ts` (219 B raw). `data/store-statistics.ts` (848 B) is already shared with `data/normalize.ts`; `view/index.ts` is 61 B. **Zero dead shared reachability remains inside the N5 fence.**
  - **Pre-domain & metadata compaction:** compacting carrier `__*` metadata and merging the `view.ts` outlier scan offset part of the API/diagnostic fix cost (+112 B gz9 net vs 129,441 B), confirming that closing the **2,553 B gz9** gap cannot be done safely inside N5 without feature removal or out-of-fence shared/controller/cap changes.

### Concrete owner handoff

1. **N6 / Core / DOM / Build owners (size cap 127,000 B vs 129,553 B gz9):** Integrate N6's controller split and remeasure the combined consumer; then either specialize the static aligned composition (`core/controller.ts` / `dom/interaction.ts` / `cartesian.ts`) so non-aligned/streaming paths are excluded, or re-freeze the `axylo/cartesian` cap in `tests/dist/subpaths.test.ts`.
2. **N6 (`packages/axylo/src/cartesian.ts`):** Add `scatter` (and optional `point` alias) and `boxplot` variants (with `yAxis?: AnyAxisId<Axes> | 'left' | 'right'` for scatter) to `CartesianLayerOptions`.
3. **Core / DOM / Data owners:** Lone compound legend toggle (`dom/interaction-controls.ts`), same-x hover cache winning mark (`dom/interaction.ts`), >8-series keyboard compound readout (`core/focus.ts`), compound hover overlay anchor (`cartesian/overlay.ts`), duplicate-x scatter in aligned frames (`data/normalize.ts`).
4. **Coordinator:** Run packed `tests/dist/subpaths.test.ts`, real Chrome/axe verification (`tests/dist/c5.browser.test.ts`), and cross-provider review on the integrated candidate.

### Prior status — delegated size repair after round 5 (superseded above)

**The Cartesian consumer was 129,441 B gzip-9, 577 B smaller than round 5 and 2,441 B above the 127,000 B cap.** The measurement below was from the turn-25 build.

### What changed

| Files under `packages/axylo/src/cartesian/` | Behavior retained by the consolidation |
|---|---|
| `options.ts`, `boxplot.ts`, `view.ts` | Intervals and boxes register their representative and secondary carriers in one typed role order. The reader-visible field stays first. The option parser retains field-specific formatters and units, duplicate-field diagnostics, and encoding signatures. The logical layout owns its representative map. |
| `boxplot.ts`, `scene.ts`, `lookup.ts` | A per-layer projector binds the borrowed columns and axis. It passes projected box bounds, median, whiskers, caps, and centre coordinates to scene or pick callbacks without allocating a shape per slot. Range drawing and picking use the same sorted bounds. The scene keeps its sparse runs and the picker keeps its local neighbour search and layer priorities. Both use the same stroke widths. |
| `boxplot.ts`, `reader.ts`, `lookup.ts`, `view.ts` | Raw values, missing states, and outliers use the physical carrier's formatter. Table and spoken log qualifiers retain their existing wording. Outlier scans visit source-row offsets in the typed columns directly. |

### Measured consumer sizes

Each row includes the changes above it. Both stages used locked esbuild 0.28.2. The first stage used the production defines, minified stylesheet plugin, ESM, ES2022, minification, and legal-comment settings from `scripts/build.mjs`. The consumer used the production condition, ES2022 and minified ESM from `tests/dist/subpaths.test.ts`. The local fixture used the actual package manifest. The consumer metafile contained only the fixture entry and the expected dist file. gzip sizes use Node zlib at level 9.

| Cumulative implementation | Consumer raw B | gzip-9 B | Change from round 5 |
|---|---:|---:|---:|
| Reproduced round 5 | 358,641 | 130,018 | 0 |
| Shared role metadata and carrier registration | 358,081 | 129,823 | −195 |
| Shared raw readout and outlier formatting | 357,836 | 129,719 | −299 |
| Shared projected geometry for scene and pick | 356,705 | 129,430 | −588 |
| Shared typed outlier traversal and distinct median/whisker callbacks | 356,580 | 129,422 | −596 |
| Final production build, including shared stroke widths, single scene partition pass, and the original centre ± half-width rectangle hit boundaries | **356,515** | **129,441** | **−577** |

The final variant retains the explicit centre drawing guard and computes both horizontal box hit boundaries directly from the centre to preserve rounding at the pick tolerance. These consolidations recovered 19% of the original 3,018 B shortfall. The local candidate contains neither streaming marker checked by the gate.

### Verification on this candidate

- `npm run typecheck` and `npm run build` exited 0. The second-stage consumer of the files produced by that build matched the source-based measurement. Both bare imports produced **0 raw bytes** with `ignoreAnnotations: true`. The consumer exporting all of `axylo/stats` measured 1,676 B gzip-9.
- Compared the actual built root and static ESM files in production and development, and both root IIFEs, against independently rebuilt pre-N5 `initial` files with `cmp`. All six were byte-identical. The incremental N5 legacy gzip tax is **0 B**.
- A seeded differential Node check against the round-5 source matched 780 option permutations, 128 pipelines, 4,480 datum and anchor pairs, and 38,578 pointer positions. It compared parsed options and issues, scene buffers, diagnostics, domains, summary, table rows, tooltip rows, pick targets, primary series, and anchors. Fixtures varied row and column inputs, missing values, reversed and collapsed bounds, caps, outliers, log axes, pinned domains, viewport size, hidden series, and zoom. The existing regression suite separately exercises sparse no-row bridges and final painted endpoints.
- The final Node run used `vitest run packages/axylo/test --configLoader native --no-cache` with browser selection disabled. The last lines were

```text
 Test Files  132 passed (132)
      Tests  2109 passed (2109)
   Start at  10:47:59
   Duration  20.11s (tests 53%, transform 38%, import 9%)
```

## Obstacles

- **Director and review status.** On round 5 the Director passed typecheck, build, and **137 files / 2,357 Node tests**. The packed consumer measured **130,018 B**, failing the 127,000 B assertion. Both bare imports passed. The cross-provider verdict on that seal required named fixes. The Coordinator still owns packed verification, Chrome including the C5 sync cases, and cross-provider review of the integrated candidate. [Director turn 21](/home/canarit/projects/prism/runs/coordinators/p2_n5/verify/turn-21-neon-4-medium__20261127T092336Z.log) · [Round-5 cross-provider report](/home/canarit/projects/prism/runs/coordinator_p2_n5/sol-6.2-medium__20261127T093126Z/report.md)
- **Size handoff to N6, core/DOM, and build owners.** Integrate N6's controller split, remeasure the combined consumer, then specialize the static aligned composition so streaming and non-aligned paths can be excluded while keeping the public entry and required marks. The reviewer measured **129,130 B** with an N6 source overlay on round 5 and **127,898 B** in a further branch-removal probe. Neither was a verified release build. The probe was already 898 B over cap before API repairs. Gzip deltas depend on the combined output, so the combined candidate needs a fresh measurement. [Round-5 cross-provider report](/home/canarit/projects/prism/runs/coordinator_p2_n5/sol-6.2-medium__20261127T093126Z/report.md)
- **Inherited legacy caps.** Local measurements for root line/all exports were 135,737 / 158,687 B and for static line/all exports were 121,251 / 141,547 B. The production IIFE was 159,027 B. Their byte-identical pre-N5 inputs already exceed the absolute C3 caps in `tests/dist/subpaths.test.ts`. The Director's round-5 test filter skipped these absolute assertions. The build owner should run the full packed subpath suite on integration.
- **Behavior and declarations across owners.** N6 owns adding `scatter` and `boxplot` to `CartesianLayerOptions`. DOM needs a toggle for a lone compound series and a same-x hover cache that accounts for the winning mark. Core focus and the Cartesian overlay need the compound readout and picked anchor, including beyond the eight-row tooltip. The hover payload still reads the representative field. The data owner needs to resolve duplicate-x scatter in the aligned frame. The Coordinator owns Chrome/axe verification in `tests/dist/c5.browser.test.ts`. This repair requires no change to `core/contracts.ts` or `public.ts`.

## Historical repair records

## Repair round 5 (cross-provider report `sol-6.2-medium__20261127T092044Z`)

| # | Finding | Change | Regression |
|---|---|---|---|
| 5a | Range picking missed the exact final endpoint of a painted band segment (`xPx >= px` selected `bandDist(i, next)` when `next < 0`) | `lookup.ts`: `compoundHit` for `range` falls back to the painted side at segment endpoints (`next < 0 \|\| (xPx < px && prev >= 0) ? bandDist(prev, i) : bandDist(i, next)`), keeping explicit `SLOT_GAP` unbridged. | `n5-repair2.test.ts`: mixed line + split-band range verifies scene runs `[0, 2, 0, 2, 2, 2, 2, 2]`, picks `'lo'` at exact final endpoint (`x = 5`) and pre-gap endpoint (`x = 2`), and falls back to `'l'` at gap (`x = 3`) and mid-gap (`x = 2.5`). |
| 5b | Packed Chrome strict rollback fixture repeated `'Peak'` in the rejected update, making the preserved DOM label non-discriminating | `tests/dist/c5.browser.test.ts`: strict update now attempts `{ type: 'point', x: 1, y: 1, label: 'Attempted' }` alongside invalid `{ y: 'nine', label: 'Bad' }`; asserts `#ann .axylo-text` still contains `'Peak'` and neither `'Attempted'` nor `'Bad'`. | Typechecked (`tsc -p tests/dist`); Chrome execution left for Coordinator. |
| 5c | Fresh structural bundle-reduction audit (in-fence only) | Profiled exact production esbuild metafile + per-file & dependency marginal gzip-9 ablation. Confirmed **no maintainable in-fence cut can close the 3,018 B gz9 gap** (see breakdown below). | No speculative terseness or feature removal applied. |

### Repair round 5 structural bundle ablation (exact production build + `stylesheetPlugin(minified)`, gzip-9)

- **Owned files (`46,959 B` raw total across 9 files) + exclusive reachability (`22,979 B` gz9 total over `107,227 B` non-owned floor):**
  - `options.ts`: `9,321 B` raw (`-3,866 B` gz9 marginal), `lookup.ts`: `8,926 B` (`-3,919 B`), `scene.ts`: `7,601 B` (`-3,922 B`), `view.ts`: `5,602 B` (`-4,583 B`), `reader.ts`: `4,446 B` (`-2,830 B`), `annotations.ts`: `4,367 B` (`-1,574 B`), `mark-swatch.ts`: `2,537 B` (`-945 B`), `boxplot.ts`: `2,226 B` (`-708 B`), `diagnostics.ts`: `1,933 B` (`-776 B`).
- **Non-owned exports pulled in exclusively by owned files (theoretical 0-byte stub upper bounds):**
  - `cartesian/axes.ts` `computeAxisDomain` + `scale/domain.ts` + `scale/log.ts` `niceLogDomain`: `-4,778 B` raw / **`-1,689 B` gz9** upper bound (still `+1,517 B` over cap even at 0 B replacement, and required for linear/log/stacked per-axis domains).
  - `cartesian/dense.ts`: `-1,451 B` raw / **`-634 B` gz9** upper bound (required for F5 decimation).
  - `view/references.ts` (`readSpan`/`resolveReferences`): `-1,638 B` raw / **`-588 B` gz9** upper bound (required for x-span and reference parsing).
  - `reader/table.ts` (`alignedTable`), `messages/index.ts`, `data/options.ts`: ~`650 B` / `620 B` / `548 B` raw each (all required).
- **Conclusion:** All dead shared branches reachable via N5 (`view/index.ts`, `alignedReader` / `store-statistics.ts`) were already severed in the prior `-5,050 B` gz9 pass. Pre-N5 `initial` (`127,120 B`) was already `+120 B` over cap. Closing the remaining `3,018 B` gap requires an owner decision outside the N5 fence (cap re-freeze, shared `#private` refactor in `dom/interaction.ts` / `core/controller.ts` / `dom/tooltip.ts`, or opt-in subpath split in `src/cartesian.ts` + `package.json`).

### Pending owner decisions & N6/shared follow-ups (unchanged, out of N5 fence)
- **Release owner / user decision:** Keep `axylo/cartesian` cap at `127,000 B` (requires out-of-fence shared/opt-in cuts) or re-freeze the cap for N5 (current exact measurement: `130,018 B` gz9).
- **N6 / shared owners (recorded only; sibling `p2_n6` snapshot does not yet contain these integrations):** Public `scatter`/`boxplot` variants in `CartesianLayerOptions` (`src/cartesian.ts`), F11 duplicate-x scatter (`src/data/normalize.ts`), same-x hover presentation cache (`src/dom/interaction.ts`), lone compound legend toggle (`src/dom/interaction-controls.ts`), >8-series keyboard compound text (`src/core/focus.ts`), and compound hover overlay anchor (`src/cartesian/overlay.ts`).

### Prior status (repair round 4, superseded above)

**Not complete. One known gate fails: the `axylo/cartesian` size cap (127,000 B gz9, kept unchanged).** Director `verify` passed typecheck/build/Node (`137` files / `2,356` tests) and failed at `tests/dist/subpaths.test.ts:53` (`130,015 B` gz9). Cross-provider review (`sol-6.2-medium__20261127T092044Z`) returned `Verdict: Merge after named fixes` (size cap + final band endpoint picking).

| Gate | State | Evidence |
|---|---|---|
| `axylo/cartesian` consumer ≤ 127,000 B gz9 (`tests/dist/subpaths.test.ts:53`) | **FAIL: 130,015 B (+3,015 B)** | Measured with locked esbuild two-stage production build + consumer gzip-9 (`358,629 B` raw, `adoptNormalized`/`StreamSession` absent). +519 B net over repair round 3 (`129,496 B`) after shared box-rect clipping/degeneracy, stroke-clipped/zero-length compound hit-testing, direct-hit-over-proximity ranking, and required annotation label validation. |
| `axylo/stats` consumer ≤ 3,500 B | pass: 1,558 B (`boxplot` export, `3,583 B` raw) | Measured |
| Bare `import 'axylo/cartesian'` / `'axylo/stats'` (`ignoreAnnotations: true`) | 0 / 0 raw bytes | Measured |
| Owned Node suites (`test/cartesian`, `test/stats`) | 18 files / 146 tests pass | Ran (`vitest run --configLoader native --no-cache`) |
| `npm run typecheck` (library, tests, docs/api, tests/dist) | exit 0 | Ran |
| Chrome (`tests/dist/c5.browser.test.ts`) | **not run** (worker rule); typechecked only | Left for Coordinator |
| Director `verify` / cross-provider review | not run | — |

## Repair round 4 (cross-provider report `sol-6.2-medium__20261127T091019Z`)

| # | Finding | Change | Regression |
|---|---|---|---|
| 4a | Clipped/degenerate compound geometry & proximity beating direct hits across slots; fake 1 px edge strip for wholly out-of-domain boxes | `boxplot.ts`: added shared `boxRectSpan(g, boxHalf, plot)` returning clipped `[y, h]` inside `plot` (1 px strip for genuine in-domain `q1 === q3` degeneracy) or `null` when wholly outside `plot`. `scene.ts`: skips box rect emission when `boxRectSpan` returns `null`. `lookup.ts`: `compoundHit` tests every compound mark against clipped painted geometry (`rectDist`, butt-capped zero-length strokes return `Infinity`), scans all slots within reach, and ranks direct visible painted hits (`dist === 0`) ahead of proximity hits (`0 < dist <= HIT_SLACK`) across both slots and compound layers (preserving tie-break by smaller `dx` then lower slot index). | `n5-repair2.test.ts` (4 new tests): wholly clipped cap at `plot.y - 2` rejected; zero-length `capWidth: 0` error bar without centre rejected; direct cap hit beats nearer-slot cap 2 px away; wholly out-of-domain box emits no rect and is not picked while in-domain degenerate `q1 === q3` box emits 1 rect and is picked. |
| 4b | Missing annotation `label` silently substituted `''` | `options.ts`: requires `typeof rawAnn.label === 'string'`, emitting `AX150` at `annotations[i].label` (warning, strict-failing and dropped from drawing/summary). | `n5-repair2.test.ts`: omitted `label` emits strict `AX150:annotations[0].label`, drops the annotation from `meta.annotations` and summary. |
| 4c | Packed Chrome fixture teardown called `.destroy()` on plain `hovers` object; strict rollback did not assert accepted annotation before next update | `tests/dist/c5.browser.test.ts`: teardown destroys only `[iv, bx, sc, ann]`; asserts `#ann .axylo-text` still renders `Peak` (and not `Bad`) immediately after strict rejection, before lenient/corrected updates. | Typechecked (`tsc -p tests/dist`); Chrome execution left for Coordinator. |

### Pending owner decisions & N6/shared follow-ups (unchanged, out of N5 fence)
- **Release owner / user decision:** Keep `axylo/cartesian` cap at `127,000 B` (requires out-of-fence shared/opt-in cuts) or re-freeze the cap for N5 (current exact measurement: `130,015 B` gz9).
- **N6 / shared owners:** Public `scatter`/`boxplot` variants in `CartesianLayerOptions` (`src/cartesian.ts`), F11 duplicate-x scatter (`src/data/normalize.ts`), same-x hover presentation cache (`src/dom/interaction.ts`), lone compound legend toggle (`src/dom/interaction-controls.ts`), >8-series keyboard compound text (`src/core/focus.ts`), and hover overlay anchor (`src/cartesian/overlay.ts`).

### Prior status (repair round 3, superseded above)

**Not complete. One known gate fails: the `axylo/cartesian` size cap.** No Director `verify` has run on this candidate, and no cross-provider review has run.

| Gate | State | Evidence |
|---|---|---|
| `axylo/cartesian` consumer ≤ 127,000 B gz9 (`tests/dist/subpaths.test.ts:53`) | **FAIL: 129,496 B (+2,496 B)** | Measured with locked esbuild two-stage production build + consumer gzip-9 (`357,367 B` raw, `adoptNormalized`/`StreamSession` absent). +75 B net over repair round 2 (`129,421 B`) after cap-crossing/clipping/annotation fixes, scene mask consolidation, and lookup/reader/options cleanups. |
| `axylo/stats` consumer ≤ 3,500 B | pass: 1,676 B (`3,896 B` raw) | Measured (vs `1,518 B` gz9 in `initial` due to N5 overflow hardening in `stats.ts`; unchanged in repair rounds 2–3). |
| Bare `import 'axylo/cartesian'` / `'axylo/stats'` (`ignoreAnnotations: true`) | 0 / 0 raw bytes | Measured |
| `axylo.js`, `static.js`, `stream.js`, `axylo.iife.js`, `axylo.iife.min.js`, `finance.js`, `sync.js`, `export.js` | byte-identical to `initial` (`Buffer.equals`, same `$TMPDIR` scratch build recipe) | Measured |
| `stats.js` | differs from `initial` (`3,561 B → 3,898 B` raw, `1,518 B → 1,676 B` gz9) due to N5 `stats.ts` hardening | Measured |
| Owned Node suites (`test/cartesian`, `test/stats`) | 18 files / 142 tests pass | Ran (`vitest run --configLoader native --no-cache`) |
| `npm run typecheck` (library, tests, docs/api, tests/dist) | exit 0 | Ran |
| Chrome (`tests/dist/c5.browser.test.ts`) | **not run** (worker rule); typechecked only | — |
| Director `verify` / cross-provider review | not run | — |

## Repair round 3 (cross-provider report `sol-6.2-medium__20261127T085619Z`)

| # | Finding | Change | Regression |
|---|---|---|---|
| 3a | Error-bar and boxplot caps extending past slot boundaries were missed by `compoundHit`; clipped error-bar centres won picks using full `size + HIT_SLACK` | `lookup.ts`: `compoundHit` scans neighbouring slots within effective horizontal reach (`max(boxHalf, cap) + HIT_SLACK` for boxplot, `max(cap, halfMarker) + HIT_SLACK` for errorBar), keeping winning `x`, `primary`, `datum`, `tooltip`, and `anchor` aligned. Error-bar centres are clipped by actual rendered half-extent (`(view.compact ? 3 : mark.size) / 2`) via shared `inPlot` and hit-tested within `halfMarker + HIT_SLACK`. `compoundBox` reuses `physical.rows` directly without per-call array allocation. | `n5-repair2.test.ts`: 100 px error-bar cap and 100 px boxplot cap crossing ~82.5 px slots (width 550); error-bar centre clipped at 4 px and 7 px above plot top rejected while 1 px above remains pickable. |
| 3b | Annotation summaries formatted raw ISO x strings instead of resolved coordinates; `axisId` on x-only annotations drew silently; unknown y-axis diagnostics used the raw axis name as `field` | `annotations.ts` / `reader.ts`: `annotationSummarySentences` resolves each x coordinate via `resolveX(view, raw)` and formats it with the chart's own `formatters.x`; `placeable` checks `meta.axisById.has(ann.axisId)` instead of fallback `axisOf`. `options.ts`: rejects `axisId` on x-only `threshold`/`range` annotations with `AX150` at `annotations[i].axisId` (dropped from drawing/summary, strict-failing), and reports unknown y-axis `AX174` with `field: 'annotations[i].axisId'`. `n5-pipeline.ts`: forwards `issue.field` via `reportCartesian` matching `createCartesianResolver`. | `n5-repair2.test.ts`: timezone-aware (`America/New_York`) ISO point & x-threshold summary matches `formatters.x(Date.parse(iso))`; x-only `axisId` emits strict `AX150:annotations[i].axisId`; unknown y-axis emits strict `AX174:annotations[i].axisId`. |
| 3c | C5 Chrome fixture asserted captured hover series and only one `ArrowDown` for scatter | `tests/dist/c5.browser.test.ts`: asserts `hoverOf('sc')` equals `'a'` directly; presses `ArrowDown` twice after `Home` (first selects `b` from all-series mode, second selects `Points`/`a`). Same-x hover transition is verified in Node lookup (`n5-repair2.test.ts`) rather than adding a knowingly failing Chrome case blocked by shared `dom/interaction.ts:455`. | `tests/dist/c5.browser.test.ts` (typechecked; Chrome left for Coordinator) + `n5-repair2.test.ts` same-x lookup transition regression. |
| 3d | Redundant `compoundRows` fallback in `scene.ts` | `scene.ts`: single guard `const state = physical.rows?.[index]; if (!state) continue;` removes both fallback `compoundRows` calls and the `compoundRows` import from `scene.ts`. | All 18 owned test files / 142 tests pass; reachability check confirms only `meta.ts` (219 B) and `dense.ts` (1,658 B) remain exclusively imported by owned files. |

### Prior status (repair round 2, superseded above)

| Gate | State | Evidence |
|---|---|---|
| `axylo/cartesian` consumer ≤ 127,000 B gz9 (`tests/dist/subpaths.test.ts:53`) | **FAIL: 129,421 B (+2,421 B)** | Measured (recipe below). The sealed bundle-cutter parent measures 128,836 B. Repair round 2 added **+585 B** net. |
| `axylo/stats` consumer ≤ 3,500 B | pass: 1,676 B | measured |
| Bare `import 'axylo/cartesian'` / `'axylo/stats'` | 0 / 0 raw bytes | measured |
| `axylo.js`, `static.js`, `stream.js`, `axylo.iife.js`, `axylo.iife.min.js`, `finance.js`, `sync.js`, `export.js` | byte-identical to `initial` (`cmp`, same scratch recipe); `stats.js` byte-identical to sealed parent (not `initial`) | measured |
| Owned Node suites (`test/cartesian`, `test/stats`) | 18 files / 136 tests pass | ran |
| Full Node suite | 137 files / 2,346 tests pass | ran |
| `npm run typecheck` (library, tests, docs/api, tests/dist) | exit 0 | ran |
| Chrome (`tests/dist/c5.browser.test.ts`) | **not run** (worker rule); typechecked only | — |
| Director `verify` / cross-provider review | not run | — |

**Size recipe** (it reproduces the reviewer's 128,836 B on the sealed tree). Copy `scripts/`, `package.json`, `tsconfig.base.json`, and `packages/axylo/{src,package.json,tsconfig.build.json}`, plus a `node_modules` symlink, into `.prism-cache/tmp/n5r/<tree>/`. Run `node scripts/build.mjs`. Then run esbuild 0.28.2 `bundle + minify` (esm, es2022) on `export { cartesian } from '<dist>/cartesian.js'` and gzip it at level 9. The same build in the workspace (`npm run build`) gives the same 129,421 B. The scratch build's IIFE lacks the leading `"use strict"` that the workspace build has, so legacy byte comparisons always use the same recipe on both sides.

**Cost of this round, by in-memory ablation** (one group at a time swapped back to the sealed version): lookup picking +181 B, view reuse +126 B (later trimmed by 25 B), compound summary +95 B, annotation field validation and summary filtering +223 B. A shared sorted-span helper was moved into `boxplot.ts`. It is used by the lookup only. Using it in the scene would allocate one array per data point, which the hot-path rule forbids, so the scene keeps its scalar code. I found no further behavior-preserving in-fence cut in the time available. Closing the gap needs an owner decision: see "Open", item 1.

## Repair round 2 (cross-provider report `sol-6.2-medium__20261127T083423Z`)

| # | Finding | Change | Regression (all in `test/cartesian/n5-repair2.test.ts` unless noted) |
|---|---|---|---|
| 2a | Range picking interpolated the raw fields | `lookup.ts` `compoundHit` tests the pointer against the painted, sorted bounds (`spanPixels`) of the two drawn rows on either side. It skips `SLOT_NO_ROW` exactly as `keep(bridge)` does in the scene. On a bridged no-row slot, it reports the nearer drawn row, so the tooltip gives a real interval. `compoundHit` now returns the hit slot. | Bounds 10–90 then 90–10, pointer 45 % across at y = 25, is picked as `Band`. A no-row mask, edited the way `n4-f10-reader.test.ts` edits slot states, gives one scene band run `[0, 2, 0, 2]`, and the lookup picks x = 3 with `40 – 60`. Below the bridged band the pick is not the range. Mutation check: with the sealed `lookup.ts`, both tests fail. |
| 2b | A fully clipped scatter point could win a pick | `pickPreferred.consider` rejects any glyph (scatter, outlier, line vertex) whose rendered half extent (`size / 2`; the renderer draws `size` as the diameter, `render/svg.ts` `pointData`) lies wholly outside the plot. | A size-4 point centred 4 px above a pinned top, with the pointer 1 px inside the plot: the line wins. Centred 1 px above the top, the point still shows and still wins. Fails with the sealed lookup. |
| 3a | Compound summary extrema and the latest reading came from undrawn rows | `reader.ts` reads a compound mark only at rows where `physical.rows` is `SLOT_VALUE` (every required bound present and plottable). On a log axis it skips nonpositive parts and outliers. Box outliers count only at drawn rows. The table is unchanged (raw values, marked). | Unpaired low 100: `Band: minimum 10, maximum 20.0, last 10 – 20.0.`, and the table keeps `100 – No data`. A log zero bound is left out of the summary, and the table keeps `0 (not plotted — log) – 100.0`. A box with no median at row 2 leaves out its outlier 50. The per-field formatter (`minimumFractionDigits: 1` on `hi`) is checked. |
| 3b | Annotation `label` / `axisId` / `description` of the wrong type was accepted | `options.ts` reports each one as AX150 at `annotations[i].<key>` and drops that annotation. | Numeric label, numeric axisId and object description each give a strict violation at the indexed path. One annotation is parsed, and the summary names only `Peak`. |
| 3c | An invalid x reported only `annotations` and was still summarized | Parsed annotations remember their option path (`diagnostics.ts` `annotationPath`, a lazy WeakMap). `validateCartesianAnnotations` reports `annotations[i].x`, `.value`, `.from` or `.to`. `annotationSummarySentences` (it now takes the view) leaves out annotations whose x does not resolve or whose y-axis does not exist. | `x: 'soon'` gives `annotations[0].x`, and `to: 'later'` gives `annotations[2].to`. Neither is summarized, and the bare field `annotations` is not reported. |
| — | Same-frame `drawSlots` / `xFull` reuse was lost | `view.ts` keeps `xFull`, `xDomain`, `visibleSlots` and `drawSlots` by identity when the previous view was built from the same accepted frame (`physicalOf(prior).frame === frame`). There is no reuse when an axis failed. | A legend toggle keeps all four by identity. A zoom keeps `xFull` and makes a new window `{1, 3}`. A new frame is never reused. Fails with the sealed `view.ts`. |
| 3d | Formatter and stack/percent behavior | No code change: plain and stacked series keep the old summary path. | A stacked percent bar beside a log range: `a: minimum 25%, maximum 50%, last 50%.`. The band reads row 1 only (`last 10 – 100`), with no `1,000`, and the table row is `0 (not plotted — log) – 1,000`. Fails with the sealed `reader.ts`, which gives `maximum 1,000, last 0 – 1,000`. |
| 4 | Chrome evidence | `tests/dist/c5.browser.test.ts`: (a) `hover` listeners on `bx` and `sc` record the winning series. The box hover point is the box's lower-left corner, and the test asserts it lies more than 24 px from A's mean marker. The box's winner is asserted different from the mean marker's winner. (b) `boxGeometry` finds medians, whiskers and caps separately per box rect: median at 0.5 of the box, whisker lengths relative to the IQR (A 1.25/4.5 and 2.25/4.5, B 0.5 and 0.5, C 0.5 and 0), two caps. (c) `scrollIntoViewIfNeeded` before reading `#bx` and `#sc` client coordinates. (d) Scatter: hover winner, keyboard Home → ArrowDown → `Points … 1`, ArrowRight ×2 → `-1 (not plotted)`, and the table headers and rows. | Typechecked only. **Not run.** |

Changed expectation: `n5-intervals.test.ts` "summarizes each interval from all its bounds" asserted `maximum 500.0 ms` and `from 10 ms to 500.0 ms`. Its fixture's 500 is the high of a row with no low, which is never drawn. That is the defect the review names. The expectation is now hand-derived from the drawn rows 0, 1 and 3 (10–30, 40–20, 25–45): `maximum 45.0 ms`, chart range `from 10 ms to 230 ms`.

## History (earlier rounds; their numbers are superseded by the status above)

### Files (all inside the N5 fence)

| File | Change |
|---|---|
| `packages/axylo/src/cartesian/boxplot.ts` (new) | Logical-mark registry (one entry per reader-visible series), carrier-frame map keyed by the published frame, shared box geometry (`boxHalfWidth`, `boxPixels`), per-row outlier storage (`Uint32Array` offsets + `Float64Array` values) |
| `packages/axylo/src/cartesian/options.ts` | `scatter` and `boxplot` layers; carriers ordered representatives-first; malformed annotations collected instead of dropped; annotation signature covers malformed ones |
| `packages/axylo/src/cartesian/view.ts` | Publishes one series per logical mark; carriers follow their logical visibility for domains; boxplot outliers widen the fit; AX130/AX131 counted on logical series; AX176 for unordered boxes |
| `packages/axylo/src/cartesian/scene.ts` | Intervals drawn per logical series from carrier columns; native box marks (rects + median rule + capped whiskers + outlier points, one typed batch each); scatter points |
| `packages/axylo/src/cartesian/lookup.ts` | One reading per interval/box; per-field formatters by carrier index; scatter pick within 24 px; box/whisker/band containment picking and anchors from the shared geometry |
| `packages/axylo/src/cartesian/reader.ts` | One table column per interval (raw bounds), six columns per box; summary sentences rebuilt from all bounds |
| `packages/axylo/src/cartesian/mark-swatch.ts` | Point swatch for scatter, box swatch for boxplot; intervals painted with their own series index |
| `packages/axylo/src/cartesian/annotations.ts` | Reports malformed annotations (AX150 / AX103) in the view stage |
| `packages/axylo/src/stats.ts` | Overflow-safe R-7 interpolation, k = 0 fences on overflowing IQR, overflow-safe mean, doc of native boxplot consumption |
| `packages/axylo/test/cartesian/n5-*.ts`, `test/stats/n5-stats-overflow.test.ts` (new) | Spec-derived unit and fast-check tests |
| `packages/axylo/test/cartesian/c5-ranges-annotations.test.ts`, `n4-swatch-parity.test.ts` | Expectations that encoded the carrier leak (see below) |
| `tests/dist/c5.browser.test.ts` | New N5 describe block on its own page and bundle; the existing C5 / sync case is unchanged |

`cartesian.ts`, `meta.ts`, `normalize.ts`, `axes.ts`, `layout.ts`, `overlay.ts`, `core/**`, `dom/**`, `public.ts`,
`sync*`, `export.ts`, `finance*` are untouched (checked by `diff -rq` against the pre-edit copy, see Verification).

### Repair round 1 (cross-provider report `sol-6.2-medium__20261127T075351Z`, seven findings)

Same author and model as above (Claude Opus 5.5, `claude-opus-5-5`, ts_builder worker; requested effort is in the
coordinator brief, not observed here). Started from the sealed tree `trees/opus-5.5-high__20261127T072309Z`
(byte-identical to this workspace at start, `diff -rq`). Only N5-fence files changed:
`cartesian/{options,view,scene,lookup,reader,annotations,boxplot}.ts`, `stats.ts`,
`test/cartesian/n5-intervals.test.ts`, `test/cartesian/n5-review-repair.test.ts` (new),
`test/stats/n5-stats-overflow.test.ts`, `tests/dist/c5.browser.test.ts` (N5 block and its two helpers only), this
ledger.

| # | Finding | What changed | Evidence (Node, ran) |
|---|---|---|---|
| 4 | Layer-only updates reused the old view | `options.ts`: the first carrier carries `__layerSig` (per logical mark: kind, cap width, size, outlier field). It is not a presentation part, so the real `core/stages.ts` `encodingChanged` returns true for line → scatter on the same field, a scatter `size`, a box `capWidth` and an `outliers` field change, and the controller renormalizes (new frame → new view, scene, lookup, reader). Labels stay out of it, so a rename still takes the names-only path. | `n5-review-repair.test.ts` "layer-only updates": real `encodingChanged` on translated options (same layers again → false), and create → update → render → readout through the real `ChartController` (`controllerFor` on the finance Node host, `test/finance/host.ts`) with the Cartesian stages wired as `src/cartesian.ts` wires them (its factory is not exported, so the test repeats that wiring): line → scatter size 9 → size 5, box cap 0 → 10 (whisker floats 24 → 48), outliers on (marker drawn, table `none` → `9`). Mutation check: with `__layerSig` disabled both tests fail (2 failed / 8 passed), restored after. |
| 2 | Domain fit read independent carrier extrema; outliers counted / drawn / fitted by different rules | `boxplot.ts` `compoundRows`: one per-slot rule (every needed field `SLOT_VALUE`, above zero on log) for ranges, error bars and boxes. `view.ts` `compoundFit` builds it once per frame (WeakMap) and hands `computeAxisDomain` the same carriers with those slots (shallow series objects, no column copy), so both the window fit and the full-data fallbacks (`allBound`, log `fullNice`) read only drawable rows; an error bar's centre is fitted where it is drawn. An all-hidden axis keeps the RFC C4.1 §4.4 full-data fallback, now from drawable rows. The mask is registered on `PhysicalView.rows`; the scene uses it for range state (no per-scene `Uint8Array`), error bars and boxes; outliers are fitted, counted, drawn and picked only where their box is drawn. Nonpositive outliers of a log box: AX171 once per outlier field (effect `omitted`), and `(not plotted)` / `(not plotted — log)` in tooltip / table. | "fits a hidden interval-only log axis from the rows its mark can draw" (`[100, 1000]` shown and hidden, 1e5 / 1e6 rows not drawable); "counts, fits, draws and picks the same outliers" (51 of the q1-less row: not fitted, not drawn); "reports nonpositive outliers of a log box" |
| 3 | Picks did not follow painted geometry | `lookup.ts` `#pickPreferred`: points first (line vertex at the nearest slot within 12 px; scatter points and box outliers at every slot within 24 px, so a point at the neighbouring x wins over a line here; ties to the later layer), then bars, then `#compoundHit`: range band interpolated between drawn neighbours (bridging no-row slots as the scene does) or the lone 4 px span; error-bar whisker, caps, centre marker; box rect, whiskers, caps; 3 px slack. The pick returns the hit's slot, and `anchor()` of the picked datum is the hit point (scatter point / outlier). | "picking follows the painted geometry" (3 cases: neighbour-slot scatter + anchor, band interior between slots, whisker vs. 20 px beside it, box rect / whisker / outlier + anchor) |
| 6 | Log-incompatible annotations silent; Tukey fences overflowed | `options.ts`: a y annotation value (`point.y`, `threshold.value`, `range.from/to` on axis y) at or below zero on a log axis is left out and reported as AX171 (warning, field `annotations[i].<key>`), so it is not drawn, not summarised, part of the options signature, and a strict create/update is rejected and rolled back by the existing wrapper path. `stats.ts`: when the IQR is not representable, fences are `2 * (q1/2 - k * iqr/2)` / `2 * (q3/2 + k * iqr/2)`. | "reports a y annotation at or below zero on a log axis"; `n5-stats-overflow` "scales an overflowed IQR" (hand-computed: Q1 = -1e308, Q3 = 1e308, k = 0.1 → fences ±1.2e308, outliers ±MAX, whiskers ±1e308; k = 1 → no outliers) |
| 7 | Browser paint probes used the wrong palette selector | `painted` and the box probe read `--axylo-series-color-N` (one-based, `theme/resolve.ts` `seriesProperty`) and map it to zero-based; markers are counted as closed subpaths of a point batch (`render/svg.ts` `pointData`); `markerCentres` gets each marker's client centre from its subpath's bbox and the path's screen CTM. New assertions: error-bar toggle hides whiskers and centres and restores 4 markers; hover on a centre marker reads `60 ms (55 ms – 65 ms)` and `10 ms – 30 ms`; keyboard Home reads `10 ms – 30 ms`; 2 outlier markers; box heights in IQR ratio 4.5 : 2 : 4; hover on the outlier 30 reads `outliers 30`; scatter 4 markers, equal log steps for 1→2 and 4→8, hover on x = 4 reads `Points 4`. | typechecked only (`tsc -p tests/dist`); **not run** |
| 1 | Cartesian cap 127,000 B | Savings tried in fence: `logicalOf` fallback no longer rebuilds interval groupings (only parser-made metas have intervals; the one hand-made meta, `c4-2-layout.test.ts`, has none); one `intervalText` wording shared by lookup, keyboard, table and summary; the range scene reuses the view's slot mask instead of allocating one. Reachability: only `boxplot.ts`, `meta.ts` and `dense.ts` are reached solely through fence files, all used. The cap is **not met** (numbers below). | measured |
| 5 | Public union, F11 duplicate x, lone legend | Out of fence; see Open items. | — |

**Changed expectation (finding 2), and why.** Two assertions in `n5-intervals.test.ts` encoded the shortcut that
finding 2 removes: they required the shown domain to reach a bound whose row cannot draw its interval (500 at
x = 3, whose low is missing; 1000 at a log row whose low is 0). They now require the opposite, derived from the
fixture and F13 (a log axis draws only values above zero; the band is drawn only where both bounds can be placed):
the band's drawable low (10) is fitted only while shown, the undrawable 500 never; on the log fixture the
undrawable row's high was moved to 5000 and a drawable 1000 added, so the test still proves the hidden band leaves
the fit. Readout texts in that test changed only with the fixture value (`– 5,000`).

## Design

**Carriers stay, the reader sees logical series.** A `range` (low, high), `errorBar` (y?, low, high) or `boxplot`
(median, min, q1, q3, max) still binds every field as a carrier series of the shared aligned frame, so the
borrowed columns, per-field formats, AX171 and AX176 (normalize.ts) work unchanged. The options stage orders the
carriers so that the first field of each layer (its representative: range → low, errorBar → y else low,
boxplot → median, scatter → y) sits at the layer's own index, and every other carrier follows after the last
representative. The view publishes only that prefix. Because the core builds its formatters per frame series
(`core/controller-helpers.ts` `buildFormatSpec`) and reads the hover payload as `frame.series[text.seriesIndex]`,
a published index is also the physical index of the representative: no remap, and the hover event's `y` is the
representative's value. The carrier frame is kept in a `WeakMap` keyed by the published frame (`physicalOf`); the
scene, lookup, table and summary read the other bounds from it with their own carrier formatter index.

**Visibility.** The legend toggles the representative's key. Carriers take the visibility of their logical series
before the domain fit (`computeAxisDomain`), so a hidden interval or box is out of the fit, the drawing, picking,
tooltip, keyboard reading and summary. A visible series on the same log axis keeps supplying the full-data
fallback, which never reads the hidden carriers. A stale hidden key that is now a non-representative carrier hides
nothing on its own.

**Readouts.** Interval: `low – high`, or `y (low – high)` for an error bar with a centre; bounds as given (a
reversed pair stays reversed, AX176). Missing bound: "No data" for that bound. Nonpositive on log: `(not plotted)`
in the tooltip, `(not plotted — log)` in the table, also for carriers after the prefix. Box:
`median M (min a, Q1 b, Q3 c, max d; outliers …)` / `no outliers`; table columns `<label> min | Q1 | median | Q3 |
max | outliers`.

**Scatter.** `{ type: 'scatter', y, yAxis?, label?, size? }`. `yAxis` may name any declared axis (left/right,
linear/log); omitted, it is the left axis (documented default). Values ≤ 0 on a log axis are not projected and
are counted by AX171 (the carrier is registered as a line field in meta.ts, whose closed mark union has no
`'scatter'`; the true mark is in boxplot.ts). Picking: nearest point within 24 px (spec 3.6) at any slot in that
reach, compared with line vertices (12 px, nearest slot) by distance; ties go to the later layer (repair round 1). **Aligned limitation:** a Cartesian scatter shares the
chart's x column, so it has one value per x per field; duplicate x is AX108 as for any aligned series
(tested). Coincident-point listing and "ties to the later row" of the root scatter chart (spec 3.6) do not apply.

**Boxplot.** `{ type: 'boxplot', min, q1, median, q3, max, outliers?, yAxis, label?, capWidth?, size? }`. The box is
a `RectMark` between Q1 and Q3 (clamped to the plot), the median a rule across it in the background colour, the
whiskers run from the box to `min` / `max` with caps (`capWidth` px; default: the box width), outliers are
`PointMark`s in the series colour. Box half width: 30% of the narrowest neighbour gap in view (or band), 3–24 px,
from `boxHalfWidth`, which the lookup uses too. Unordered five numbers → AX176 naming the layer, drawn sorted,
read raw. Outliers widen the domain while the box is visible (passed to the domain fit as y extents bound to the
box's axis), only those in the x window, and only where the box itself is drawn (repair round 1).

Consuming `axylo/stats` without changing its result:

```js
const result = boxplot(rows, { x: 'group', y: 'value' });
cartesian(el, {
  data: { columns: { ...result.data.columns, outliers: result.groups.map(g => g.summary.outliers) } },
  x: 'x', axes: { v: { position: 'left' } },
  layers: [{ type: 'boxplot', min: 'whiskerLow', q1: 'q1', median: 'median', q3: 'q3', max: 'whiskerHigh', outliers: 'outliers', yAxis: 'v' }],
});
```

`outliers` names a field whose per-row values are arrays / typed arrays of numbers (rows or columns form). They
are read once per options parse into two typed columns; the caller's arrays are not kept. The numeric columns stay
borrowed (tested: the frame's `q1` column is `result.data.columns.q1`).

**Layer fields not read.** A `y` on a `range` layer (which draws no centre) or an error-bar `y` that names no
field is reported as `AX150` on `layers[i].y` (warning; the option is ignored) instead of being dropped silently.

**Annotations.** Malformed annotations are left out and reported with existing codes, AX177 stays reserved
(spec 3.5): `AX150` naming the option path (`annotations[i]`, `annotations[i].type|axis|x|y|value|from|to`, or
`annotations` when it is not an array) and `AX103` for a non-finite number, as invalid references report it. Both
are warnings with effect `none` and outcome "The annotation is not drawn; the other annotations are." Valid siblings
are drawn. They are reported in the view stage (`validateCartesianAnnotations`), which both the chart and
`validateCartesian` run, because the composition's pending-issue type in `cartesian.ts` is closed to
AX170/AX173/AX174. A strict create/update that brings one is rejected (warnings are strict violations,
`core/delivery.ts`) and `cartesian.ts` restores the accepted options. The annotation signature on the first carrier
includes the malformed list, so valid → malformed → corrected → removed each changes the options and rebuilds
the view and its findings.

**Stats.** `between(a, b, t)` uses `a + t (b − a)` when the difference is finite (exact at t = 0; existing
results unchanged) and `(1 − t) a + t b` otherwise, clamped to `[a, b]`. `iqr` is reported as computed
(`Infinity` when not representable, never a made-up finite value). With k = 0 the fences are Q1 and Q3 (no
`0 × ∞ = NaN`). A mean whose sum overflows is the running mean stepped by halves, clamped to `[min, max]`.

### Verification, repair round 1 (history)

Repair round 1, final source:

- `npm run typecheck` (library + tests, docs/api, tests/dist): exit 0, no output.
- `npx vitest run --configLoader native --no-cache packages/axylo/test/cartesian packages/axylo/test/stats`:
  `Tests  126 passed (126)` (17 files).
- Full Node suite `npx vitest run --configLoader native --no-cache`: `Test Files  136 passed (136)`,
  `Tests  2336 passed (2336)` (rerun after the last test was added). It wrote `apps/docs/.cache/types/{tsconfig.json,probe.ts}`, removed by literal path.
- Sizes: `node scripts/build.mjs` in `.prism-cache/tmp/n5r/{initial,sealed,cand}` (copies of
  `runs/coordinators/p2_n5/initial`, the sealed tree, and this workspace), consumer bundle by the Director recipe
  (esbuild `bundle + minify` of `export { cartesian } from '<dist>/cartesian.js'`, gzip level 9):

  | measure | initial | sealed | candidate |
  |---|---:|---:|---:|
  | `axylo/cartesian` consumer gz9 (cap 127,000) | 127,120 | 132,904 | 133,886 |
  | `axylo/stats` consumer gz9 (cap 3,500) | 1,518 | 1,644 | 1,676 |
  | `dist/cartesian.js` gz9 | 127,233 | 133,043 | 134,025 |
  | bare `import 'axylo/cartesian'` / `'axylo/stats'` raw | 0 / 0 | 0 / 0 | 0 / 0 |
  | `axylo.js`, `static.js`, `stream.js`, `axylo.iife.js` | — | — | byte-identical to initial (`cmp`) |

  The initial and sealed numbers match the Director log (132,904) and the review (127,120). Incremental: the
  repairs before the trims measured 134,009; the two trims brought it to 133,859 (-150 B); labelling log outliers
  in the readouts added 27 B. A shared cap-width parser was tried and reverted: -70 B raw but +35 B gz9. The remaining gap to the cap is **6,886 B**, more than the whole N5 feature delta
  (+5,784 B), and the initial tree is itself 120 B over.

Sealed round (kept for the record): typecheck exit 0; 16 files / 115 tests in the owned suites; full suite 135 files /
2325 tests.

### Bundle reduction pass, sealed parent (`bundle_cutter`, behavior-preserving, in-fence only)

Started from the repair-round-1 candidate (`133,886 B` gz9 consumer vs `127,000 B` cap; gap `6,886 B`; initial pre-N5 tree `127,120 B`). All edits stayed strictly inside the N5 file fence (`packages/axylo/src/cartesian/{view,reader,options,annotations,lookup,scene,mark-swatch,diagnostics,boxplot}.ts` and this ledger).

### Measured reachability & reduction breakdown (esbuild two-stage production build + consumer, gzip-9)

| Step | Change (in-fence only) | Consumer raw | Consumer gz9 | Delta vs start | Gap to 127,000 | Bare import |
|---|---|---:|---:|---:|---:|---:|
| Baseline | Repair round 1 candidate | 373,309 B | 133,886 B | 0 B | +6,886 B | 0 B |
| 1 | Cut `src/view/index.ts` reachability (`cartesian/view.ts` builds `AlignedView` directly; `cartesian/scene.ts` inlines 6-line `stackAreaRange`) — drops unused single-axis `alignedExtrema`/`valueDomain`/`yExtent`/`widenedDomains` (`view/index.ts` 7,822 → 61 B raw) | 368,172 B | 131,967 B | -1,919 B | +4,967 B | 0 B |
| 2 | Cut `alignedReader` (`src/reader/index.ts`) reachability (`cartesian/reader.ts` writes unified aligned + compound summary in one pass, removing `summarizeCompound` rewrite) — drops `cartesianText`/`statsCache`/`seriesStats` (`reader/index.ts` 8,030 → 5,453 B) and block-summary path (`data/store-statistics.ts` 2,724 → 848 B) | 363,391 B | 130,002 B | -3,884 B | +3,002 B | 0 B |
| 3 | Deduplicate `cartesian/options.ts` (10,600 → 9,067 B) and `cartesian/annotations.ts` (5,133 → 4,214 B; shared `clampedSpan` + tuple candidates) | 360,955 B | 129,633 B | -4,253 B | +2,633 B | 0 B |
| 4 | Convert `cartesian/lookup.ts` from `#private` class to closure factory (9,747 → 7,469 B), deduplicate `cartesian/scene.ts` mark helpers/reference projection (9,601 → 7,745 B), tighten `cartesian/mark-swatch.ts` (2,796 → 2,537 B) | 356,917 B | 128,949 B | -4,937 B | +1,949 B | 0 B |
| 5 | Consolidate shared helpers (`BOX_ROLES`, `isCompoundKind`, `axisOf`, `isLogSeries`) in `cartesian/boxplot.ts`, factor `cartesian/diagnostics.ts` (2,002 → 1,836 B) and tighten `cartesian/view.ts` (5,752 → 5,380 B) | **356,003 B** | **128,836 B** | **-5,050 B** | **+1,836 B** | **0 B** |

- **Total in-fence reduction:** **-5,050 B gz9** (-17,306 B raw), closing **73.3%** of the 6,886 B gap with zero behavior removal and all tests intact.
- **Net N5 feature delta vs pre-N5 initial (`127,120 B`):** only **+1,716 B gz9** for single-identity intervals, first-class `scatter`, native `boxplot`, malformed/log annotation diagnostics, and all 7 review repairs.
- **`axylo/stats` consumer:** `1,676 B` gz9 (cap `3,500 B`), bare import `0 B`.

### Why the remaining 1,836 B gap cannot be closed cleanly inside the N5 fence

- **Zero remaining unused shared branches reachable via N5 files:** an in-memory ablation stubbing all 9 owned files to minimal exports yields a non-owned floor of `300,038 B` raw / `107,039 B` gz9. Every remaining non-owned file pulled in via owned files is actively required (`cartesian/axes.ts` 3,074 B, `cartesian/dense.ts` 1,658 B, `cartesian/bar-geom.ts` 1,558 B, `scale/domain.ts` 1,373 B, `view/references.ts` 858 B marginal, `scale/log.ts` 746 B marginal, `reader/table.ts` 650 B marginal, `messages/index.ts` 617 B marginal).
- **Diminishing returns on owned code:** the 9 owned files total `45,315 B` raw; further micro-compression would require sacrificing diagnostic clarity or readability for only ~200–400 B gz9, still leaving >1,400 B gap.

### Concrete minimal owner decisions / out-of-fence remedies (measured, not applied)

1. **Re-freeze the `axylo/cartesian` cap** in `tests/dist/subpaths.test.ts` (e.g., `127,000 B → 130,000 B` gz9) to reflect the N5 feature set (initial pre-N5 was already `127,120 B`, +120 B over the C4 cap; N5 adds only `+1,716 B` net after this reduction pass).
2. **Refactor `#private` class fields in shared DOM/core modules** (shared owners, separate track with legacy zero-tax verification): `cartesian.js` currently carries **3,108 occurrences (204 unique, 7,190 B)** of unmangled ES2022 `#private` identifiers (`dom/interaction.ts`: 1,346 occurrences / 12,626 source B; `core/controller.ts`: 627 / 6,802 B; `dom/tooltip.ts`: 352 / 3,338 B). Converting even `dom/interaction.ts` + `dom/tooltip.ts` to closure factories (matching `cartesian/lookup.ts`, which saved `-2,126 B` raw on one file) would shrink `axylo/cartesian`, `axylo/finance`, `axylo`, and `axylo/static` simultaneously by several KB gz9 with negative legacy delta.
3. **Optional subpath / opt-in module split** (`src/cartesian.ts` + `package.json`, N6 / owner): an in-memory ablation shows making `cartesian/annotations.ts` opt-in alone saves **-1,483 B gz9** (`127,353 B`), and splitting `boxplot` + `annotations` behind an opt-in composition helper would clear `127,000 B` with margin.

### Bundle-reduction verification (ran and saw)

- `npm run typecheck`: exit 0 (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist`).
- `npm run build`: exit 0 (`built axylo.css, ..., cartesian.js, ..., stats.js, ...`).
- Consumer check on built `packages/axylo/dist`:
  - `cartesian=128836 B` gz9 (down `-5,050 B` from `133,886 B`; gap `+1,836 B` to `127,000 B` cap), `adoptNormalized=false`, `StreamSession=false`, bare `import` = `0 B`.
  - `stats=1676 B` gz9 (cap `3,500 B`), bare `import` = `0 B`.
- Full Node suite (`npx vitest run --configLoader native --no-cache`):
  - `Test Files  136 passed (136)`
  - `Tests  2336 passed (2336)`
  - `Duration  20.03s`
- Browser suites (`test:browser`, `tests/dist/c5.browser.test.ts`): **not run** (left for Coordinator).

## Open: needs an owner decision or another track

1. **RFC §8 cap `axylo/cartesian` ≤ 127,000 B gz9** (`tests/dist/subpaths.test.ts:53`) still fails: **129,496 B** on this candidate, a gap of 2,496 B. History: initial 127,120 B, repair 1 133,886 B, bundle cutter 128,836 B, repair 2 129,421 B, repair 3 129,496 B. Owner options, none decided here: (a) re-freeze the cap for the N5 Cartesian family; (b) put `annotations` and `boxplot` behind an opt-in composition helper, which needs `src/cartesian.ts` and `package.json` (N6 or owner); an earlier ablation measured −1,483 B for annotations alone; (c) shrink shared code on its owners' tracks (`dom/interaction.ts`, `core/controller.ts`, `dom/tooltip.ts` `#private` fields), with a fresh legacy check.
2. **DOM, `packages/axylo/src/dom/interaction.ts:455` same-x hover presentation cache (blocker for live Chrome same-x transitions):** `#present` caches aligned hover state with `sameTarget(target, last[0])`, which compares `{ kind: 'x', x }` by `x` alone and returns early when the pointer moves between two different marks at the exact same `x` (suppressing the updated `primary` winner, hover event, and overlay). `cartesian/lookup.ts` switches `primary` and `anchor` cleanly at the same `x` (verified in `n5-repair2.test.ts`), but live DOM transitions require `#present` to include `lookup.primary(target)` (or an identity key) in the cache check on the DOM/N6 track.
3. **N6, `src/cartesian.ts` public types (remaining wrapper-type dependency):** the Chrome fixture and the tests still cast `as never` for `scatter` / `boxplot` layers. add `scatter` and `boxplot` to `CartesianLayerOptions` (the staged fixture
   still uses `as never`):
   ```ts
   | { readonly type: 'scatter'; readonly y: ValueField<Row> | readonly ValueField<Row>[]; readonly yAxis?: AnyAxisId<Axes>; readonly label?: string; readonly size?: number }
   | { readonly type: 'boxplot'; readonly min: ValueField<Row>; readonly q1: ValueField<Row>; readonly median: ValueField<Row>;
       readonly q3: ValueField<Row>; readonly max: ValueField<Row>; readonly outliers?: Extract<keyof Row, string>;
       readonly yAxis: AnyAxisId<Axes>; readonly label?: string; readonly capWidth?: number; readonly size?: number }
   ```
   plus the file header ("line + bar + area") and `docs/api` examples.
3. **F11 duplicate scatter x (scope decision or shared change):** a Cartesian scatter field is a carrier of the
   aligned frame, one value per x slot; `data/normalize.ts:241` disables a series with duplicate x (AX108,
   `series-disabled`). Investigated in fence: the existing `readOutliers` seam (per-row CSR typed columns parsed in
   `options.ts`) could hold extra same-x values, but their x must go through the frame's own x parser (dates,
   categories, AX107) and the slot index, which live in `data/normalize.ts` / `cartesian/normalize.ts`, outside the
   fence. Needed: either (a) `cartesian/normalize.ts` (Cartesian owner) normalizes scatter fields as row-ordered
   columns `{ slot: Uint32Array /* x slot per row */, y: Float64Array }` next to the aligned frame, which the
   scene / lookup / reader here would read, or (b) a contract field on `Series` in `core/contracts.ts` for
   multi-row slots. Until then the current behaviour (AX108, tested in `n5-scatter.test.ts`) stands and F11
   coincident-point semantics are not claimed for `axylo/cartesian`.
4. **DOM, `dom/interaction-controls.ts:52` lone legend** (the `view.frame.series.length > 1` gate): the legend is drawn only for more than one published
   series, so a chart whose only layer is one interval or box has no toggle. Needed: a composition opt-in (e.g.
   `Composition.legendForOne?: true`, set by `src/cartesian.ts`), checked next to the series-count gate, then a
   legacy-delta check (root/static must stay byte-identical).
5. **Core, `core/focus.ts:87` `alignedRows` (>8-series keyboard reading):** rows past the tooltip's eight are read
   from the published frame (`slotText(formatters, s, ser.y[i], state)`), i.e. a range's low only (`Band 20`
   instead of `20 – 80`). Needed: build those rows from `lookup.datum({ kind: 'aligned', seriesKey: ser.key, x })`
   (falling back to the current text when it returns null). The Cartesian lookup's `datum` already gives the
   compound reading; the eight-row tooltip limit stays in the lookup.
6. **`cartesian/overlay.ts:36-50` (not in the N5 fence):** the hover overlay still highlights the representative
   carrier at the slot (`s.y[slot]`), not the picked outlier or box. Related: the public `hover` payload's `y`
   comes from `core/controller-helpers.ts:419` `pointForDatum` (`series.y[i]`), which for a box is its `min`
   carrier. The picked hit is now available as `lookup.anchor(primary)` (point hits return the point); the
   overlay should draw from that anchor (or from `#compoundHit`'s mark) instead.
7. **DOM (`dom/mark-swatch.ts`):** the DOM copy has no scatter/boxplot swatch. The parity test compares the two on
   published views for line, bar, area, range and error bar only.
8. **Spec 3.5:** AX176 is also raised for a box whose five numbers are out of order; AX150/AX103 cover malformed
   annotations; AX171 now also covers nonpositive box outliers and y annotations on a log axis. The registry text is
   docs-owned.

## Changed expectations in existing tests (why)

- `c5-ranges-annotations.test.ts`: the table row of a range was `['2', '40 ms', '20 ms', '30 ms']` (one column per
  carrier, the leak this cycle removes); it is now `['2', '40 ms – 20 ms', '30 ms']` with headers
  `['step', '95% CI (ms)', 'mid (ms)']` — the same raw values, in the range's one column.
- `n4-swatch-parity.test.ts`: the fake view listed every carrier; the swatch is now only asked about published
  series (`['l', 'b', 'a', 'lo', 'mid']`), and "centre hidden" became "error bar hidden" because the centre can
  no longer be hidden on its own. Parity with the DOM copy still holds for every case.
- One N5 expectation was hand-derived wrongly and corrected from the fixture before it was committed to the
  file: the hidden-band summary range starts at 55 ms (the error bar's lowest bound), not 60 ms.

## Expected / not run

- Repair round 2: Chrome **not run**. Unverified assumptions in the new assertions: SVG stroke segments are written
  as absolute `M x y L x y` subpaths (the `render/svg.ts` `pathData` writer suggests this; the number format was
  not observed); the public `hover` event fires for pointer picks of a compound mark; the keyboard proxy reads the
  scatter's own value after ArrowDown (`dom/interaction.ts:703` maps ArrowDown to `series-next`); the table
  formats -1 as `-1` (as the box table's `-20` already does). The no-row range regression edits the published row
  mask in Node, because no single-table fixture produces `SLOT_NO_ROW` for one layer. Chart-level (controller)
  regression of the two picking fixes was not added: Node lookup + scene only.

- Repair round 1: no browser run. The N5 Chrome block was edited and typechecked only. Unverified points: the
  marker-centre probe assumes a point path has no `transform` of its own (the probe path is added to the same
  parent); tooltip text matching assumes the tooltip lists every shown series at the picked x (as the Node lookup
  does); the keyboard Home reading of `#iv` is assumed to include the first series' value.

- Chrome: the N5 block in `tests/dist/c5.browser.test.ts` was typechecked (`tsc -p tests/dist`) but **not run**
  (worker turns must not launch Chrome). Coordinator command:
  `HOME=$PWD/.prism-cache/tmp/<own>/home AXYLO_BROWSER=1 npx vitest run --config tests/dist/vitest.config.ts tests/dist/c5.browser.test.ts`
  (the packed dist setup strips `npm_*` variables, so a writable `HOME` is needed in prism workspaces).
- The browser block expects: 3 legend buttons `Band, Err, Trend` and the band's series-0 shapes gone after one
  click; table headers/rows of both charts; 3 box `rect`s; tooltip and keyboard text
  `median 5.5 (min 1, Q1 3.25, Q3 7.75, max 9; outliers 30)`; AX171 on the log scatter; strict annotation update
  throws and leaves diagnostics unchanged, lenient one reports `AX103:annotations[1].value`; axe-core clean;
  0 leftover nodes. Selectors (`.axylo-legend-entry`, `.axylo-proxy`, `.axylo-tooltip`, `.axylo-text`) were taken
  from the existing dist and finance browser tests; the text the legend button exposes was not observed.
- Path decision: the brief names `tests/dist/n5-intervals-boxplot.browser.test.ts`, but the fence lists only
  `tests/dist/c5.browser.test.ts`; the N5 cases are a second `describe` in the C5 file.
