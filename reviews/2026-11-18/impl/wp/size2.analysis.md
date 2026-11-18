<!-- Analyst: Claude Opus 5.5 (model id claude-opus-5-5, from the session's system prompt), Agent-tool subagent; requested and observed effort are not visible to the analyst. Measurement only: no file under packages/, apps/, scripts/, tests/, acceptance/, bench/ or docs/ was changed. Source anchor e90d8db (the rebuilt production file was byte-identical to packages/axylo/dist/axylo.js); main results re-checked on 91adfe7, which was committed while this ran. -->

# Download size, second analysis: what closes the gap to 96 / 80 KiB

## Summary

Targets (DX7): 98,304 B gzip for everything, 81,920 B for a page that imports only `line`. At e90d8db: **117,748 B (114.99 KiB) and 99,167 B (96.84 KiB)**, reproduced exactly. Every number below is gzip level 9 of an esbuild consumer bundle, built the way `scripts/size.mjs` builds one, from a scratch copy of the source built the way `scripts/build.mjs` builds `dist/axylo.js`. Unless a row says "estimate", it was built and measured.

| What is applied | Everything | Line only | Targets met |
|---|---:|---:|---|
| Today (e90d8db) | 117,748 B (114.99 KiB) | 99,167 B (96.84 KiB) | neither |
| **Class (a) only**, measured together: property mangling, dev/test-only members gated out, exact duplicates merged, esbuild CSS minifier | **113,977 B (111.31 KiB)** | **96,030 B (93.78 KiB)** | neither |
| … plus a module order chosen for gzip (also class (a), but fragile) | 113,034 B (110.38 KiB) | 94,974 B (92.75 KiB) | neither |
| **(a) + (b)**: line, measured upper bound (all inline kind branches folded away, other kinds' tables removed) | — | 91,832 B (89.68 KiB) | no |
| (a) + (b), realistic (*estimate*, calibrated by one real per-kind split) | ≈114,300–114,600 B (111.6–111.9 KiB) | ≈93,200–93,600 B (91.0–91.4 KiB) | no |

**Class (a) and (b) together cannot reach either target.** After them, roughly 16 KB is still missing for everything and 11–12 KB for line. Only one class (c) option is large enough to change that: **making streaming an opt-in**. Streaming storage costs 15.8 KB in everything and 12.9 KB in line. No combination without it reaches either target. With (a) and no streaming, the measured result is 100,060 / 84,669 B. Each of these measured combinations meets both targets:

| Combination (all on top of class (a); e90d8db; current module order) | Everything | Line |
|---|---:|---:|
| streaming opt-in + stylesheet shipped as a file only | 97,247 B (94.97 KiB) | 81,837 B (79.92 KiB), 83 B under |
| streaming opt-in + no canvas renderer in production + (b) for line | 97,699 B (95.41 KiB) | 79,084 B (77.23 KiB) with the (b) upper bound, ≈80,400–80,800 B (*estimate*) with realistic (b) |
| streaming opt-in + no canvas + stylesheet as a file | 94,934 B (92.71 KiB) | 80,402 B (78.52 KiB) |
| streaming opt-in + no canvas + table opt-in | 93,460 B (91.27 KiB) | 79,615 B (77.75 KiB) |

On 91adfe7 (HEAD after this ran), the baseline is 118,897 / 99,254 B. Class (a) measured 115,167 / 96,222 B. The first combination above misses both targets there by 120 B and 63 B. The third (streaming + no canvas + CSS file) measured 96,140 / 80,548 B, and the fourth measured 94,612 / 79,767 B. The margins in the first two combinations are smaller than the module-order effect (next paragraph), so treat them as "at the target", not as a pass.

**Measurement caveat found on the way.** Gzip of these bundles moves with module order alone. Reordering import statements in six hub modules, which changes no behaviour, gave everything 116,802–118,323 B and line 98,136–99,275 B over 20 orders. The current order is at the median for everything and about 550 B worse than the median for line. Every single-candidate saving below was therefore also measured as a *paired* delta under six orders, and the spread is given. Absolute totals are for the current order.

The class (c) options are for the owner. What each one costs the user is stated in its section. The dominant one, streaming opt-in, changes the public API: `append` on a chart created without the streaming import. If streaming moves to a sub-path entry, it also changes what the "everything" row means.

## Ranked table

Δ is the change in gzip bytes against e90d8db at the current module order. "Paired" is the range of the same delta under six module orders. Class (b) rows marked *line only* come from a variant that breaks the other kinds, so only their line row is meaningful.

| # | Candidate | Class | Δ everything | Δ line | Basis | Guarded by |
|---:|---|:-:|---:|---:|---|---|
| 1 | Property mangling of 431 type-checked internal names | a | **−2,458** | **−2,166** | measured; paired −2,469…−2,608 / −2,123…−2,252; 91adfe7 −2,446 / −2,123 | `tests/dist/tree-shaking.test.ts` markers (2 names reserved for it), `tests/dist/*.browser.test.ts`, `test/browser/acceptance` `prodPage` tests |
| 2 | Instrumentation- and test-only class members gated out of production | a | **−1,132** | **−890** | measured; paired −1,097…−1,171 / −871…−925; 91adfe7 −1,075 / −822 | `test/data/streaming-storage.test.ts`, `test/data/store.test.ts`, `test/data/transactions.test.ts`, `test/core/delivery.test.ts`, bench `memory()` |
| 3 | Module order chosen for gzip | a | ≈ −930 | ≈ −1,000 | measured as best of 20 orders: base −946 / −981; class (a) build −929 / −1,039. Fragile | `tests/dist/tree-shaking.test.ts` (no import-time work). Nothing guards the chosen order |
| 4 | Exact duplicate helpers merged (7) | a | −104 | −54 | measured; paired −100…−233 / −41…−202 | `test/data/review.test.ts` (data may not import lookup), unit tests of format, focus, lookup |
| 5 | Stylesheet through esbuild's CSS minifier | a | −64 | −60 | measured | `test/theme/minify.test.ts`, docs `checkSameRevision` |
| | **1 + 2 + 4 + 5 together** | a | **−3,771** | **−3,137** | measured: 113,977 / 96,030; paired (without 5) −3,710…−3,974 / −3,037…−3,329 | all of the above |
| 6 | Inline kind and shape branches moved behind each kind's composition | b | ≈ +300…+600 (*estimate*) | −3,948 upper bound; ≈ −2,100…−2,500 (*estimate*) | line upper bound measured (paired −3,948…−4,080); realistic share calibrated by #7 | `tests/dist/tree-shaking.test.ts`, `test/acceptance/type-matrix.test.ts`, `test/browser/acceptance/type-matrix.browser.test.ts`, controller and interaction suites |
| 7 | Calibration of #6: `core/axes.ts` split into aligned and scatter parts, done for real | b | +46 | −273 | measured; paired +25…+143 / −232…−378; donut −4,725, scatter −559; 91adfe7 +68 / −263 | `test/core/axes.test.ts`, `test/core/ticks.test.ts`, layout and acceptance F7 |
| 8 | Other kinds' tables out of line (option lists, AX120/121/132/133, unused default texts) | b | ≈ 0 (*estimate*) | −345 | measured *line only*; paired −318…−345 | `test/diagnostics/registry.test.ts`, `test/core/options.test.ts`, messages tests |
| 9 | Donut: the table's jump and page lookup without the x parser | b | +16 | +15 | measured, paired median; **donut −6,182** | `test/browser/acceptance/a4-table.browser.test.ts`, `test/browser/acceptance/f8-donut.browser.test.ts` |
| 10 | Streaming as an opt-in | c | **−15,834** | **−12,918** | measured; paired −15,834…−16,513 / −12,912…−13,236; on top of (a) −13,917 / −11,361 | `test/data/streaming-storage.test.ts`, `test/data/store.test.ts`, `test/data/transactions.test.ts`, streaming browser suites, P3/P7/I6 acceptance |
| 11 | Table as an opt-in | c | −4,287 | −3,660 | measured (scatter −7,015, donut −9,049) | `a4-table.browser.test.ts`, reader tests, F12 |
| 12 | Stylesheet only as `axylo.css` (not inside the JS) | c | −2,908 | −2,909 | measured | `tests/dist/csp.browser.test.ts`, first-chart snippets, `test/browser/render/theme.browser.test.ts` |
| 13 | No canvas renderer in production (`__renderer` only in dev and bench builds) | c | −2,424 | −1,455 | measured; paired −2,373…−2,633 / −1,414…−1,676 | `test/browser/render/render.browser.test.ts` (pixel agreement), `AXYLO_RENDERER=canvas` runs, `bench/test/*` |
| 13′ | No SVG renderer in production (canvas default) | c | −3,140 | −1,785 | measured; paired −3,140…−3,234 / −1,785…−1,861 | same, plus decision 0002 |
| 14 | Zoom as an opt-in | c | −1,862 | −1,794 | measured | interaction browser suites, `test/core/focus-range.test.ts`, I3 |
| 15 | Shorter diagnostic prose | c | ≈ −550 for one third shorter (*estimate*) | ≈ −540 (*estimate*) | measured bound: all prose costs 1,635 / 1,619 | `test/diagnostics/registry.test.ts`, the docs diagnostic pages |
| 16 | Shorter default messages | c | bound −680 | bound −649 | measured bound | messages tests, A10 |
| 17 | Internal fields renamed so they can be mangled too (contract rename) | c | ≈ −1,260 beyond #1 (*estimate*) | ≈ −990 beyond #1 (*estimate*) | built, but the output does not work | all |

## The candidates

### 1. Property mangling (class a)

**What.** Add `mangleProps` to the production builds in `scripts/build.mjs`, lines 52–60. The list of names is not a naming convention: each name was classified with the TypeScript type checker over the whole source. A name is mangled only if all four of these hold:

- Every occurrence resolves to a declaration in the library's own files, and `public.ts` does not count as one. This covers property accesses, object-literal keys through their contextual type, class members (checked against `implements` and `extends`), and destructuring.
- The name never appears as a whole one-identifier string literal. That catches key lists, compared keys and literal-typed arguments.
- It is not a key of a type with a string index signature (dictionaries such as `NAVIGATION`).
- It is not a property of a type reached by reflection: `obj[expr]`, `for … in`, `in`, `Object.keys`, `Object.entries`, `Object.values` or `JSON.stringify`.

Every name in TypeScript's DOM and ES lib files, and every name in `public.ts`, is reserved. That reserves every option, handle method, `Diagnostic` field, `Messages` key, `Point` field, event name and `__renderer`. The run marked 433 names as internal: `outcome`, `optionDiagnostics`, `visibleSlots`, `xDomain`, `drawSlots`, `stepInSeries`, `retainedRowCount` and the like. Contract names are mangled where they are internal (`contracts.ts` describes interfaces *inside* the bundle). Names that collide with DOM names (`kind`, `frame`, `width`, `start`, `end`, `values`) are kept.

`minX` and `adoptNormalized` are also reserved, because `tests/dist/tree-shaking.test.ts` uses them as markers in the minified file. Without that, the test would fail as designed. That leaves the 431 names measured here.

**Measured.** −2,458 / −2,166 B; area −2,188, bar −2,064, scatter −1,880, donut −1,639, validate −376.

**What must hold for it to be safe:**

- Only the production flavour is mangled. Dev builds and tests are untouched.
- The benchmark build (`__BENCH__` true) must **not** mangle, or must reserve the names in `core/instrument.ts`. The harness reads `describe()` fields such as `xDomain` and `oldestX`, which are in the list.
- New code that turns a property name into data (a string key, `Object.keys` on an internal object) must have the list recomputed. The list should be generated by a build-time check like the one used here, not maintained by hand.

**Verified.** Only this: in Node, `validate()` returned identical output from the mangled and unmangled builds on 11 dirty inputs across all five kinds (codes AX101 AX103 AX106 AX107 AX108 AX120 AX140 AX150 AX152). **The DOM path of a mangled build was not run.** Most browser suites load the development files (`test/browser/chart/util.ts`), so mangling widens the gap between what is tested and what ships. Before adopting it, run at least the production-page tests (`tests/dist/*.browser.test.ts`, `prodPage` in `test/browser/acceptance/util.ts`) and the acceptance runner against a mangled build.

**Method.** The classification ran on TypeScript 6.0.3's compiler API from a global bun install (`~/.bun/install/global/node_modules/typescript`), because the project's TypeScript 7 has no JavaScript API. It reported 0 type errors on the e90d8db source. The names were passed to esbuild as `mangleProps: /^(name|…)$/`.

### 2. Instrumentation- and test-only members out of production (class a)

**What.** esbuild keeps every member of a class it keeps, so methods that only `core/instrument.ts` or tests call still ship. Found with the TypeScript language service (references that are not in instrument.ts) and confirmed by grep:

- **The P7 byte counting:**
  - `count(bytes: ByteCount…)` in `data/store.ts:146`, `data/store-buffers.ts:208`, `data/store-window.ts:141`, `data/store-rows.ts:156,341,437,479` and `data/store-unaligned.ts:39,209,246`
  - `ownedBytes` in `data/store.ts:530` and `data/store-unaligned.ts:351`
  - the `CallerBuffers` field and its `add` calls in `data/store.ts:473,484` and `data/store-unaligned.ts:313,324,462`
  - the `lazyColumns.set` registry in `data/store-buffers.ts:257`

  With these gone, `data/store-bytes.ts` leaves the bundle. The `caller.add` bookkeeping also runs at run time in production today.
- **The stores' test conveniences:** `append`, `replace`, `prepareReplace` and `reencode`, and the `diagnostics` getter, in `data/store.ts:518,594,604,610,981` and `data/store-unaligned.ts:342,368,443,453,459`. The controller uses `prepareAppend`, `prepareReencode`, `resolveEncoding`, `retire`, `frame` and `retainedRowCount`; nothing in production calls the listed ones.
- **`Delivery.deliver`**, `core/delivery.ts:50`, which only `test/core/delivery.test.ts` calls.

**Measured.** All of these deleted in a scratch copy: −1,132 / −890 B (`store-bytes` 1,123 min B, store classes about 1,700 min B, delivery 163).

**How to ship it.** Do not delete these members. Gate them with `__DEV__ || __BENCH__`: define the methods on the prototype inside such a block, or move them into instrument.ts as functions that read the stores. The tests and the bench `memory()` probe keep working, and production folds the block away.

Smaller items of the same kind were not measured and amount to tens of bytes:

- `TableView.showRow` and `get page` (`dom/table.ts:203,220`)
- `TooltipView.where` (`dom/tooltip.ts:342`)
- scatter's `lastPick*` and `comparisons` getters (`lookup/scatter.ts:23,213`)

### 3. Module order (class a, fragile)

**What.** The order of modules inside `axylo.js` follows import order. Consumer bundlers keep the order of a prebundled file. Because no module does work at import time (`tests/dist/tree-shaking.test.ts` checks this), reordering imports changes bytes, not behaviour.

**Measured.** Over 20 seeded orders of the import blocks in `index.ts`, `core/chart.ts`, `core/controller.ts`, `dom/interaction.ts`, `kinds/line.ts` and `core/stages.ts`:

| Build | Everything | Line |
|---|---|---|
| Base | 116,802–118,323 B (median 117,618; current 117,748) | 98,136–99,275 B (median 98,614; current 99,167) |
| Class (a) | 113,034–114,338 B (current 113,963) | 94,974–96,014 B (current 96,013) |

The best order saved about −0.93 / −1.0 KB in both builds.

**Cost.** The best order changes after any code change, so the saving is not durable unless the release build searches for it each time, for example by trying N orders with an `onLoad` plugin that sorts hub imports by a recorded seed. Ranked last among the class (a) items for that reason.

### 4. Exact duplicates (class a)

Merged in a scratch copy:

- `once`: `format/time.ts:73` and `format/number.ts:140`
- `sameRemainder`: `data/store-rows.ts:5` and `data/store.ts:160`
- `pageDistance`: `core/focus.ts:42` and `lookup/search.ts:19`
- `setText`: `dom/figure.ts:81` and `dom/tooltip.ts:104`, moved to `dom/attributes.ts`
- `object`: `core/stages.ts:17` and `data/options.ts:112`
- `lowerBound`: `data/store-unaligned.ts:18` and `lookup/search.ts:1`. This one needs a neutral module, because `test/data/review.test.ts` forbids data importing lookup.
- `sameStyle` in `core/controller.ts:1973`, which is `sameTextStyle` in `core/environment.ts:144` without the null check

Measured −104 / −54 B. Gzip already finds most repeated code. Worth doing for maintenance, not for size.

### 5. CSS minifier (class a)

`theme/minify.ts` keeps the space after `:` and after selector commas. esbuild's CSS minifier removes them and merges the duplicate rules:

- `.axylo-legend-choice` at `theme/css.ts:206,209`
- `.axylo-jump` at `theme/css.ts:314,320`

14,280 → 13,774 B as text, 2,970 → 2,922 B gzip as a file. In the JavaScript: −64 / −60 B. `test/theme/minify.test.ts` compares rule trees, so merged rules would fail it, and the docs guard compares `axylo.css` to `minifyCss(AXYLO_CSS)`. Small. The duplicate rules could simply be removed from `css.ts` by hand.

### 6–8. Per-kind composition of the remaining inline branches (class b)

**Why line is still 84% of everything.** "Everything" adds 18.6 KB gzip of code that only other kinds use:

| Module | Minified bytes |
|---|---:|
| point and donut stores (`store-unaligned`) | 9.5 K |
| scatter grid, lookup and point order | 10.5 K |
| donut lookup, view, geometry and the slice list in `interaction` | 6.7 K |
| area and bar scenes | 5.0 K |
| other kinds' mark painters in `svg.ts` and `canvas.ts` | 6.7 K |
| point and donut normalization | 2.6 K |
| other table builders | 2.0 K |

The rest of line's 282 KB minified is code that a line chart can reach. By area: streaming storage 14.8%, controller 10.8%, interaction 10.7%, other DOM (tooltip, table, toolbar, placement, figure) 9.3%, data 8.3%, core helpers 6.9%, layout and axes 6.6%, scales and formatting 6.3%, stylesheet 5.1%.

What line carries but cannot reach at run time was measured by removing it:

- inline kind and shape branches: −3,948 to −4,080 B
- other kinds' tables: −345 B
- canvas, which only the private `__renderer` reaches: −1,414 to −1,676 B
- instrumentation and test-only members: −871 to −925 B

Together that is about 6.6–7.0 KB.

**#6, what and measured upper bound.** The previous restructuring left these as inline tests on `view.kind`, `frame.shape`, the datum and target kind (`'point'`, `'slice'`) and the projection (`'bands'`, `'ring'`). A codemod folded all 249 of them to what a line chart can be. In minified bytes, per module:

| Module | Minified B | What line cannot reach |
|---|---:|---|
| `core/controller.ts` | 3,209 | `positionValue`, `zoomable`, `isWall`, `latestX` (203–247), `freeze` (821), `followLatest` (860), `themeKeys` (1053), `formatSpec` and `pointDateUnit` (1112, 1945), `pointFor` (1705), `renamed` (1927), `pointIndex` (1983), `hasData` (2016) |
| `dom/interaction.ts` | 2,410 | `categoriesOf` and `xKindOf` (352–357), donut and scatter keys, swatches and steps (642–700, 925–1061), `horizontalBars` (1277–1301), table-jump columns (1606–1613) |
| `core/axes.ts` | 1,749 | |
| `core/focus.ts` | 1,391 | |
| `lookup/aligned.ts` | 973 | the bands projection |
| `view/stack.ts` | 703 | stacks |
| `stages`, `layout`, `view`, `reader`, `pointer`, `scene`, `options` | about 200–400 each | |

Measured on line: −3,948 B, from 99,167 to 95,219. This is an upper bound: it also folds the bar-only tests inside code that all aligned kinds share.

**#7, calibration, done for real.** `core/axes.ts` was split: the scatter axis parts, extent, titles and layout-key tail went into `SCATTER_AXES`, the rest into `ALIGNED_AXES`, and `AxisContext.axes` was filled from the composition.

- Line: −273 B, against −440 for an oracle that folds only `axes.ts`, so 62% of the oracle.
- Everything: +46 B (paired +25…+143), the cost of indirection.
- By-product: donut −4,725 B, because donut stops carrying the cartesian axis builder and tick generation that `layoutInput` statically reached. Confirmed per module: `scale/time` 5,080, `core/axes` 4,494, `scale/linear` 1,145, `format/number` 867 and `scale/nice` 703 min B leave the donut bundle. Scatter −559 B.

Scaled to the whole oracle, about 55–65% captured, the *estimate* for #6 is −2,100…−2,500 B on line. With six to ten such module splits, the *estimate* for everything is +300…+600 B.

**#8.** Other kinds' tables in line:

- the option lists of area, bar, scatter and donut (`data/options.ts:46–57`)
- the registry entries AX120, AX121, AX132 and AX133 (`diagnostics/registry.ts:106–123`)
- the default texts line never shows (`messages/index.ts`: `otherSlices`, `type*`, `donutSummary`, `incomplete*`, `totalMixed`, `percentage`, `category`)

Measured −345 B on line. The keys of `Messages` must stay, because `messages` options are validated against `Object.keys(defaultMessages)`.

**#9 (donut, not a target row).** The donut table's `pageForX` (`reader/table.ts:115`) and the interaction's `jumpTarget` (`dom/interaction.ts:1615`) call `readPosition` (`reader/x.ts:9`). It parses a typed value by normalizing a one-row *line* chart, so the donut bundle carries `normalizeAligned`, the x parser, steps and store diagnostics, though a donut only ever needs the category branch. Fix: a `categoryPosition` for the donut table, and `readPosition` passed through `InteractionParts` (null for donut). Measured donut −6,182 B, from 86,539 to 80,357. No effect on everything or line: +16 / +15 B paired median. The −419 / −494 B seen at the current order was module-order noise.

### 10–17. Class (c) options: what the user would lose

**#10, streaming opt-in (−15,834 / −12,918; on top of (a) −13,917 / −11,361).**

- **Where the bytes are:** `data/store.ts` 20.4 K min, `store-rows` 8.5 K, `store-buffers` 4.6 K, `store-calendar` 1.5 K, `store-bytes` 1.1 K, the controller's append path 1.6 K (`core/controller.ts:707–793`), and, in everything, `store-unaligned` 9.5 K.
- **What the user loses:** `append()` works on every handle today (spec I6, P3). As an opt-in, a page would import or register streaming first, for example from a sub-path entry. An `append` without it would have to report a diagnostic and do nothing.
- **What a streaming page pays:** these bytes back.
- **Loading the storage lazily on the first `append`** would break the synchronous contract: diagnostics up to date when `append` returns, and strict throwing from the call.
- **Definition:** if streaming moves to a sub-path, `export * from 'axylo'` no longer contains it, and "everything" then means "everything but streaming". The owner should decide whether the row keeps its meaning.

**#11, table opt-in (−4,287 / −3,660).**

- The "View as table" control is on by default (spec A4, `table` default true), and the F12 note sends readers to it.
- As an import, a chart without it loses the accessible data table.
- In the measurement the table builder, the table view and interaction's open, close, jump and render functions were removed. The toolbar control stayed.

**#12, stylesheet as a file only (−2,908 / −2,909 in every row).**

- Every page must load `axylo.css`. A chart without it renders unstyled.
- The first-chart snippet (DX1) gains a step.
- CSP is unaffected: the sheet is adopted, not inlined.
- The script-tag snippet already links the file, so it would stop downloading the stylesheet twice.

**#13 and #13′, renderers in every row.**

| What production leaves out | everything | line | area | bar | scatter | donut | validate |
|---|---:|---:|---:|---:|---:|---:|---:|
| canvas (SVG only), i.e. what canvas costs | −2,424 | −1,455 | −1,625 | −1,680 | −1,363 | −1,313 | +6 |
| SVG (canvas only), i.e. what SVG costs | −3,140 | −1,785 | −1,972 | −2,150 | −1,633 | −1,600 | +7 |

Gating only `core/chart.ts:66–69` saves about 1 KB. The rest needs the mark tables in `kinds/*.ts:24–25` gated as well, because the composition objects keep every painter alive.

- **Dropping canvas:** a production page's `__renderer: 'canvas'` silently draws SVG. Decision 0002 keeps canvas until the renderer rerun. The `AXYLO_RENDERER=canvas` production-page runs would test SVG. Bench builds keep canvas through `__BENCH__`.
- **Dropping SVG:** contradicts the current default of decision 0002.

**#14, zoom opt-in (−1,862 / −1,794).** Zoom is on by default on continuous x (spec I3: wheel, keys, buttons, Select range, pinch). The measurement removed the gestures, keys, buttons and `zoom()`. The view still takes a window.

**#15 and #16, text.**

| Text | As source | Gzip alone | Cost in the bundle |
|---|---:|---:|---:|
| Registry prose | 4,806 B in 185 literals | 1,904 B | 1,635 / 1,619 B |
| Default messages | 1,601 B | 734 B | 680 / 649 B |

The documentation quotes the registry messages. Shortening them changes the text that DX4 and DX5 deliver, and the docs. A third shorter would save roughly 550 B (*estimate*).

**#17, renaming internal fields that collide with DOM or string names** (`kind`, `frame`, `start`, `end`, `positions`, `slot`, `view`, …), so they can be mangled. This would be a contract-wide rename in `core/contracts.ts`. An upper bound was built with those names mangled. That output is not functional (it renames DOM accesses too), but its size bounds the gain: −3,718 / −3,159 B in total, about −1.26 KB / −0.99 KB beyond #1 (*estimate*).

## What I looked at and found not worth doing (measured)

- **Development-only code in the production file.** Nothing behind `__DEV__` or `__BENCH__` survives: no `__dev`, `__bench`, `__AXYLO_BENCH__`, `StageCounter` or bench strings in the built output. What does survive is the unguarded instrumentation in #2.
- **Minifier settings:**
  - `target: 'esnext'` makes no difference.
  - `es2020` adds 241 / 241 B.
  - `drop: ['console', 'debugger']` saves 0 B: there is no direct `console.*`, and the console is injected for diagnostics on purpose.
  - Only 14 `\u` escapes in the output, so `charset: 'utf8'` would gain nothing, and the consumer's bundler re-escapes anyway.
- **Option-name lists** as `/* @__PURE__ */ 'a b c'.split(' ')`: −3 / −6 B. The lists cost 173 B in total, because their repeats compress.
- **Registry entry keys** shortened to one letter (what a tuple encoding would save): −21 / −22 B. Mangling already shortens `text` and `outcome`.
- **Classes and closures.** The two giant closures (`controllerFor`, `createInteraction`) minify well: their inner names are renamed. The classes' cost is in their property names, which #1 addresses. Converting TypeScript `private` to `#private` would only duplicate #1.
- **Near-duplicates** in `dom/`, `core/`, `lookup/` and `data/` beyond #4 are different functions: `sameRect` with tolerance, `withUnit` in format against the reader one with scale handling, the two `rule` helpers.

## Method and reproduction

**The pipeline.**

1. Copy `packages/axylo/src` into the project. This used `.scratch-size/<variant>`, now removed.
2. Build `<variant>/index.ts` with esbuild 0.28.2 as `scripts/build.mjs` builds `dist/axylo.js`:
   - `bundle`, `esm`, `es2022`, `minify`, `legalComments: 'none'`
   - `define: { __DEV__: 'false', __BENCH__: 'false' }`
   - an `onLoad` plugin that replaces the variant's `theme/css.ts` with `minifyCss(AXYLO_CSS)` as a literal, both evaluated from the variant, as `stylesheetPlugin` does.
3. Build each consumer row from that file as `scripts/size.mjs` does: stdin `export * from 'axylo'`, the fixture's `example/npm.ts` for line, `export { <kind> } from 'axylo'` for the others. Settings: `bundle`, `minify`, `esm`, `es2022`, `conditions: ['production']`, with a resolve plugin that maps `axylo` to the built file.
4. Gzip with `zlib` at level 9.

The unmodified copy built byte-identical to `packages/axylo/dist/axylo.js` and gave exactly the brief's rows. `scripts/size.mjs` itself was not run, because it writes `bench/size-latest.json`. Per-module minified bytes come from a one-step metafile build of the consumer against the source.

**Edits per variant**, all asserted to match. Rebuild them in a copy to reproduce:

| Variant | Edits |
|---|---|
| mangling | `mangleProps` built from the classification in #1 |
| dead members | the members in #2 deleted |
| duplicates | the seven merges in #4 |
| CSS | `transformSync(css, { loader: 'css', minify: true })` |
| oracle | every `X.kind`, `kind` or `type` compared with `'donut'`, `'scatter'`, `'bar'` or `'area'`, and `X.shape` with `'points'` or `'donut'`, `X.kind` with `'point'`, `'slice'`, `'bands'` or `'ring'`, replaced by the constant a line chart gives. Positive tests on `'line'`, `'aligned'` and `'xy'` too, unless the receiver uses `?.` |
| no canvas | `core/chart.ts:66,69` guarded by `__DEV__ \|\| __BENCH__`, and each `kinds/*.ts` `canvas:` table replaced by `{}` outside those builds |
| no streaming | `append` body emptied, `openStore` removed from the compositions |
| no table | reader `table` parts null, table call short-circuited, interaction `jumpTarget`, `openTable`, `closeTable`, `renderTable` and `cellRuns` stubbed |
| no zoom | interaction's zoom functions stubbed, `d.zoom` and `d.zoomed` folded to false, controller `zoom()` emptied, `zoomOn` false |
| text | the literals inside `diagnosticRegistry` (levels kept) or `defaultMessages` blanked |

**Paired order deltas.** The import declarations of the six hub modules were sorted by an FNV hash of seed and specifier, the same way in both variants, for seeds 0–5. Seed 0 is the current order.

The measurement scripts are in `/tmp/claude-1000/-home-canarit-projects-axylo/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/size2-scripts/`. That directory is wiped at the next restart; everything needed to redo the work is described above.

**What I did not run or verify:**

- No browser test, no `npm run build`, no unit test. No source was changed, so none was needed.
- The mangled builds were checked only by `validate()` in Node.
- No variant was type-checked except base and the class (a) combination. Its one error is the expected one: instrument.ts still names the removed `ownedBytes`, which the real change would gate instead of deleting.
- The class (c) ablations remove code paths to price a feature. They are not designs, and an opt-in module needs some registration code of its own that was not measured.
- 91adfe7 and the uncommitted work in `packages/axylo/src` at the end of the run are newer than the anchor. Only the class (a) combination, streaming, canvas, table, the CSS file, the line oracle and the axes split were re-measured on 91adfe7. The uncommitted state measured 119,500 / 99,803 B and was not analysed.
