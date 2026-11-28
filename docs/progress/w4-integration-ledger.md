# W4 integration ledger

## Seal fix: `TableModel.row(-1)` returns `null`

- **Finding** (review `sol-6.2-medium__20261128T015736Z`): the bubble reader (`src/spatial/bubble/composition.ts`,
  `readerWith`) used a negative ordinal on `table.row(...)` to offer a deferred AX160 size-format failure again,
  so an author's `table.row(-1)` returned `undefined`/`false` instead of `null` (`TableModel.row`: "null outside
  the range", spec A4).
- **Fix:** the deferred offer (`sizeMissed(meta)`) now runs inside the `row` getter itself, under the same
  table-ownership guard (`state.reading` set to this table and restored on every exit). `row(i)` only calls the
  bubble table, which returns `null` for `i < 0` and `i >= rowCount`. The setter and the controller's per-table
  row cache are unchanged. Follow-up (review `sol-6.2-medium__20261128T020445Z`): the guard is written inline
  around `built.row(i)` and around `sizeMissed(meta)` (no shared callback helper), so an uncached row read during
  CSV export allocates no closure.
- **Regression:** `test/spatial/bubble/ax160-review7.test.ts` (pending-CSV / onDiagnostic-only update case) checks
  `row(-1)`, `row(-2)`, `row(rowCount)`, `row(rowCount + 1)` are `null` before the pending export, while pending
  after it, and after publication (placed after the first owned CSV read, since looking `row` up is the retry
  hook). The existing assertions (reused table, cached fallback, no formatter rerun, report once to the new
  handler, note) are kept. Confirmed the new checks fail on the previous code (`expected undefined to be null`).
- Contracts and `public.ts` unchanged. Size gate: Director-measured.

## Wave 4 heavy-gate closeout (`p2_w4_heavy_fix`, 2026-11-28)

- **Coordinator seal:** `p2_w4_heavy_fix` (`sol-6.2-medium` Coordinator, `opus-5.5-medium__20261128T031542Z`, cross-provider unconditional **`Verdict: Merge`** from `sol-6.2-medium__20261128T031914Z`, `verify_cmd_source = "loupe"`, isolated `bwrap` **`PASS: 3082 tests`**, `dist closure ok: packages/axylo: 33 manifest files, 11 declarations, 22 scripts (21.1 ms)`).
- **Protected contracts:** `git diff b217e58 -- packages/axylo/src/core/contracts.ts packages/axylo/src/public.ts` is strictly empty.
- **Merged Wave 4 + Wave 3b lineage on `phase2/wave4-integration`:**
  - `phase2/n9b-hierarchy` (`d48e50b`) — `axylo/hierarchy` squarified `treemap` + radial `sunburst`
  - `phase2/n8a-heatmap` (`6ced14a`) — `axylo/spatial` `heatmap` + OKLab/Viridis & diverging color scales
  - `phase2/n8b-bubble` (`af1b178`) — `axylo/spatial` `bubble` + nested-circle size legend
  - `phase2/n9a-violin` (`fb5530b`) — `violin` / KDE in `axylo/stats` + `axylo/cartesian`
  - `phase2/n7b-export` (`a07300e`) — whole-figure `exportSvg`/`exportPng`, closed-table CSV, `Symbol.for('axylo.export')`, `axylo/finance` `0 B` bare import
  - `chore/loupe-dist-closure` (`0b25637`) — `<25 ms` pure-Node manifest & `.d.ts` closure check in `./tools/loupe verify`
- **Director verification results (quiet CPU):**
  - `./tools/loupe verify`: **`PASS: 3082 tests`** (`199/199` files + `scripts/check-dist-closure.mjs` `21.1 ms`)
  - Full Chrome browser suite (`verify:heavy` + targeted re-run of all 3 fixed suites):
    - `verify:heavy` initial run passed `58/61` files (`1,345/1,353` tests); after `p2_w4_heavy_fix`, all 3 previously failing Chrome suites passed **100%** (`axe.browser.test.ts`, `n2-visual-responsive.browser.test.ts` `82/82`, `n9b-hierarchy.browser.test.ts`).
  - Packed `tests/dist` (`node`):
    - `instrumentation.test.ts`: **7/7 PASS** (`/\breencode\b/` eliminated from production builds)
    - `package-contents.test.ts`: **10/10 PASS** (37 tarball files, full `.d.ts` closure)
    - `subpaths.test.ts` (filtered `spatial|hierarchy|cartesian|stats|sync|export|finance|bare|declarations|Node`): **PASS** (all 4 `spatial`/`hierarchy` prod+dev bare imports `0` raw bytes, all Node SSR + Bundler/NodeNext `.d.ts` checks passing)
    - Known pre-existing `N10a`-owned `test:dist` items (distinct from Wave 4): `licence.test.ts` (`THIRD-PARTY-NOTICES.md` inventory), `tree-shaking.test.ts` (`view/stack.ts`), and 3 historical absolute legacy caps (`line`, `everything`, `IIFE`).
  - Packed Chrome (`npm run test:dist:browser`): **`44/45` PASS (`11/12` files)** — `w4-spatial-hierarchy.browser.test.ts` passed `expectWholeFigure` (SVG + 1x/2x PNG + painted marks including `oklab(...)`) and `expectClosedOpenCsv` across all 5 families, with **1 remaining test-page layout overlap** at `w4-spatial-hierarchy.browser.test.ts:303` (`#tm` fixed `360px` host height overflows into `#sb`'s `.axylo-h-header` when clicking `Next page` on the opened 100-row table — queued as first tiny fix in `N10a`).
- **Packed gzip-9 sizes (`npm run size`, `bench/size-latest.json` vs `b217e58` Wave 3 baseline):**

| Entry | Wave 4 gzip-9 | KiB | Delta vs Wave 3 (`b217e58`) | Notes |
|---|---:|---:|---:|---|
| `line` (root) | `136,096 B` | `132.91` | `+286 B` | Historical `P6` `108 KiB` target (`N10a` owner-approved revision) |
| `everything` (root) | `159,006 B` | `155.28` | `+319 B` | Historical `P6` `128 KiB` target (`N10a` owner-approved revision) |
| `line` (`axylo/static`) | `120,499 B` | `117.67` | **`−752 B`** | Smaller than Wave 3 |
| `everything` (`axylo/static`) | `140,812 B` | `137.51` | **`−735 B`** | Smaller than Wave 3 |
| `cartesian` | `137,792 B` | `134.56` | `+10,672 B` | Includes N5 `boxplot`/`scatter` + N9a `violin` (`<= 138,000 B`) |
| `stats` | `3,483 B` | `3.40` | `+1,965 B` | Includes N9a `kde`/`violinData` (`<= 3,500 B`) |
| `sync` | `3,494 B` | `3.41` | `+1,904 B` | Includes N6 visual peer sync + `createDashboard` (`<= 3,500 B`) |
| `export` | `3,498 B` | `3.42` | `+203 B` | Includes N7b whole-figure + closed-table CSV (`<= 3,500 B`) |
| `finance` | `123,865 B` | `120.96` | **`−734 B`** | `0` raw bytes bare import (`<= 127,000 B`) |
| `spatial` *(NEW)* | `142,492 B` | `139.15` | `NEW` | `heatmap` + `bubble`, `0 B` bare import (`<= 143,000 B`) |
| `hierarchy` *(NEW)* | `21,588 B` | `21.08` | `NEW` | `treemap` + `sunburst`, `0 B` bare import (`<= 21,600 B`) |
| `script tag` (`iife.min` + css) | `162,763 B` | `158.95` | `+318 B` | `axylo.iife.min.js` `159,345 B` |

