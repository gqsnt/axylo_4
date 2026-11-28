# N10a hardening ledger (pre-seal release hygiene)

Cycle N10a, on the Wave 4 seal `2b3868f`. Six closures. In this ledger, figures marked **supplied** come from
the cycle brief and earlier ledgers (the Director's runs, the `p2_ext_gap_audit`). They were not measured
again in this lane. **Observed** marks what the implementing lane ran itself. Everything under "Director-only
checks" still has to run on the candidate.

## 1. W4 packed Chrome page: hosts no longer overlap when a table opens

- Failure (**supplied**: Director Chrome run, 44/45): `tests/dist/w4-spatial-hierarchy.browser.test.ts`. The
  treemap's opened 100-row table overflowed `#tm`'s fixed height and ran under `#sb`. The sunburst's
  `.axylo-h-header` then intercepted the real `Next page` click.
- Fix: each of the five hosts (`#hm`, `#bb`, `#vio`, `#tm`, `#sb`) now sits in its own `<section>`. Its bottom
  padding (`TABLE_CLEARANCE`, 6000 px) gives the overflowing table room before the next chart starts. The
  padding is set through the CSSOM, which the page's CSP allows; the page has no style attributes. Every
  host keeps its width and height (640×900, 640×400, 900×360, 640×420, 520×520), so each plot box is
  unchanged. The real Playwright clicks and the page-2 checks are kept. Before each `Next page` click, a new
  assertion checks that the opened table ends above the next section.

## 2. `THIRD-PARTY-NOTICES.md` release inventory: 37 files

- The inventory listed the 10 files shipped before Axylo 4. It now also lists the 27 opt-in subpath files
  (`static`, `stream`, `cartesian`, `stats`, `sync`, `export`, `finance`, `spatial`, `hierarchy` × `.js`,
  `.dev.js`, `.d.ts`). That makes 37, the count `packages/axylo/package.json` `files` gives (34) plus
  `package.json`, `README.md` and `LICENSE`.
- Origins use the formats `tests/dist/licence.test.ts` checks: `built from packages/axylo/src` for `.js`, and
  `emitted from packages/axylo/src/<name>.ts` for `.d.ts`. Each `<name>.ts` source file exists.
- The dev-tools note now names Rollup and webpack, with their plugins and loaders. The package manifest is
  untouched: 0 runtime and 0 peer dependencies.

## 3. `tests/dist/tree-shaking.test.ts`: `view/stack.ts` belongs to `area` and `bar`

- Supplied measurement: `line` and `histogram` bundle 0 B of `view/stack.ts`, while `area` and `bar` include
  it (786/787 B). The ownership entry is now `['area', 'bar']`.
- The test already runs both directions for every kind. Each kind must include the modules it owns, so
  `area` and `bar` must include `view/stack.ts`. No kind may include a module owned only by others, so
  `line`, `histogram`, `scatter` and `donut` must not.

## 4. `tests/dist/bundlers.test.ts`: real multi-bundler consumers of the installed tarball

- Rollup 4.68.8 with `@rollup/plugin-node-resolve` 16.0.3 (`exportConditions: ['production']`, so Vitest's
  `NODE_ENV=test` does not cause node-resolve to infer `'development'`):
  - the root and all nine opt-in entry points are bundled through a used export, each from its packed
    `default` file;
  - bare `import 'axylo'`, `'axylo/spatial'` and `'axylo/hierarchy'` resolve to the packed file and leave
    0 code bytes.
- webpack 5.113.0 with css-loader and mini-css-extract-plugin:
  - production mode resolves the same ten from their `default` files (the exports map has no `production`
    key, so `default` applies);
  - a bare `import 'axylo'` keeps no packed JavaScript;
  - `import 'axylo/axylo.css'` is kept through the published `sideEffects: ["*.css"]` glob, and the
    extracted stylesheet holds the packed one;
  - development mode resolves the `.dev.js` files, distinct from the `default` files.
- Vite 8.3.8 in production mode (with `NODE_ENV=production` scoped around `viteBuild` and restored in
  `finally`—deleted if originally absent—because Vite 8 preserves Vitest's `NODE_ENV=test` and derives
  `isProduction` and its `development|production` export condition from `NODE_ENV`), from the npm fixture
  root with `resolve.preserveSymlinks`: `axylo`, `axylo/spatial`, `axylo/hierarchy` and `axylo/axylo.css`
  come from the installed package, and the CSS asset is emitted.
- Every `axylo` resolution is recorded and asserted positively, to the exact packed file. A resolution that is
  missing, external, or outside the installed package fails. Webpack searches only the fixture's
  `node_modules`. Output goes to `tests/dist/.out/bundlers/`, which is removed afterwards.
- `tests/dist/README.md` drops the obsolete "webpack and Rollup are not installed" note and describes this
  coverage.

## 5. `L9/area`: matrix cell closed

- Unit test: `packages/axylo/test/cartesian/n4-stacks-layout.test.ts`, "area on the right axis, line on the
  left: collapses at 320 px and restores at 960 px, with AX175, the right ticks, spine and title, and the
  summary sentence following".
- Packed Chrome test: `tests/dist/cartesian.browser.test.ts`, folded into the existing signed-stack browser
  test ("stacks signed bars and areas on their own sides of zero and reads totals and incomplete stacks alike
  by pointer, keyboard and table") after its existing real pointer, keyboard, and table checks (closing the
  table before resizing), keeping the packed browser suite at 45 cases total. It reuses the same N4
  signed-stack fixture (`#stacks`, areas `c` + `d` on right axis `w`, bars `a` + `b` on left axis `v`) and
  runs the `960 → 320 → 960 px` resize, area-mark, `AX175` diagnostic, accessible summary, and right-axis
  collapse/restore assertions.
- `acceptance/matrix.json`: both tests are cited under `L9.evidence.area` (preserving existing `F13/area` and
  `F13/bar` citations to the same browser test title), and `pending.area` is removed.

## 6. `P6` size targets and legacy caps: owner decision 2026-11-27

The owner decided on 2026-11-27, after the three-provider `p2_ext_gap_audit`, to align the targets with the
post-R2 and post-Wave 4 measurements. Deep architectural size cuts are deferred to a later campaign.

| Where | Entry | Before | After |
|---|---|---:|---:|
| `scripts/size.mjs` `SIZE_TARGETS` | line only (`examples/first-chart/npm.ts`) | 108 KiB | 135 KiB |
| `scripts/size.mjs` `SIZE_TARGETS` | everything (`export * from axylo`) | 128 KiB | 158 KiB |
| `tests/dist/subpaths.test.ts` `LEGACY_CAPS` | `line` | 135,293 B | 136,500 B |
| `tests/dist/subpaths.test.ts` `LEGACY_CAPS` | `everything` | 158,096 B | 159,500 B |
| `tests/dist/subpaths.test.ts` `LEGACY_CAPS` | `staticLine` | 120,729 B | 120,729 B (unchanged) |
| `tests/dist/subpaths.test.ts` `LEGACY_CAPS` | `staticEverything` | 140,988 B | 140,988 B (unchanged) |
| `tests/dist/subpaths.test.ts` `LEGACY_CAPS` | `iife` | 158,425 B | 159,600 B |

The `cartesian`, `finance`, `stats`, `sync`, `export`, `spatial` and `hierarchy` caps are unchanged.

Allowed documentation and acceptance changes retained in Cycle N10a:

- `scripts/size.mjs`: `SIZE_TARGETS` updated to `135` / `158 KiB` and header comments aligned to `158 / 135 KiB`.
- `acceptance/matrix.json`: `DX7` and `P6` statements aligned to `158 KiB` everything / `135 KiB` line only (in addition to closing `L9.evidence.area`).
- `tests/dist/README.md`: aligned to `158 / 135 KiB` and updated for the new multi-bundler coverage.
- `tests/dist/subpaths.test.ts` and `acceptance/journeys.json`: `LEGACY_CAPS` updated (`line`, `everything`, `iife`), IIFE cap test renamed to `"IIFE bundle stays within its 2026-11-27 owner-approved cap (<= 159,600 B)"` (matching the new cap rather than claiming a 0 B delta vs `b097f1a`), stale `subpaths.test.ts` citations/registrations refreshed from live tests, and `axylo/spatial` + `axylo/hierarchy` manifest exports registered under `static-stream` with their live bare-import and standalone cap citations.

### Scope limitation (post-Loupe `verify_scope_violation` repair)

- `docs/02-product-spec.md` and `acceptance/test/check.test.mjs` are outside the permitted Cycle N10a file scope and were restored verbatim to the Wave 4 baseline (`2b3868f`) so neither appears in the cumulative diff.
- Consequently, `docs/02-product-spec.md` retains the Wave 4 `DX7` row (`128 KiB` everything / `108 KiB` line only), and the unchanged baseline assertion in `acceptance/test/check.test.mjs:635` (`defect 5: the size targets are written once, in scripts/size.mjs, and are the spec DX7 row's`) conflicts with the owner-approved `SIZE_TARGETS` (`[135, 158]` vs baseline `[108, 128]`).
- That baseline assertion was neither weakened nor worked around. Updating `docs/02-product-spec.md` (DX7 row) and `acceptance/test/check.test.mjs:635-640` to `[135, 158]` requires an explicit follow-up whose write scope includes those two files.

### Byte attribution of the root `line` entry (**supplied**)

| Commit | Date | `line` (root), gzip | Note |
|---|---|---:|---|
| `86c9d18` | 2026-11-22 | 94.73 KiB | |
| `60d01f8` | 2026-11-24 | 107.05 KiB | basis of the 108 / 128 KiB targets |
| `9275499` | 2026-11-26 | 131.71 KiB | after the 2026-11-25 R2 speed/memory campaign |
| `2b3868f` | Wave 4 seal | 132.91 KiB | `everything` 155.28 KiB; `axylo/static` `line` 117.67 KiB |

Attribution (**supplied**, `p2_ext_gap_audit`): the root grew by about +24.7 KiB, and that growth came from
the 2026-11-25 R2 speed/memory campaign. Phase 2 Waves 1–4 together added under 1.2 KiB to the root, and they
shrank `axylo/static` `line` by 752 B. Wave 4 measurements (**supplied**, `w4-integration-ledger.md` and the
brief):

- root `line` 136,096 B;
- root `everything` 159,006 B;
- static `line` 120,499 B;
- static `everything` 140,812 B;
- IIFE 159,345 B.

All are within the new caps.

## Verification

### Observed in this worker lane (after scope repair)

- Baseline restoration verified byte-for-byte against Wave 4 `2b3868f`: `acceptance/test/check.test.mjs` and
  `docs/02-product-spec.md` match `2b3868f` identically and no longer appear in the cumulative diff.
- `npm_config_cache="$TMPDIR/npm-cache" node --test acceptance/test/*.test.mjs`: `tests 71, pass 69, fail 1, skipped 1` (exit 1; `npm_config_cache` pointed inside workspace-local `$TMPDIR` because the sandboxed home directory's `.npm/_logs` is read-only when `npm pack --dry-run` runs):
  - **Failing (1):** `defect 5: the size targets are written once, in scripts/size.mjs, and are the spec DX7 row's` (`acceptance/test/check.test.mjs:635`) — `AssertionError [ERR_ASSERTION]`: `actual: [135, 158]` vs unchanged Wave 4 baseline `expected: [108, 128]`. Recorded above as an explicit scope limitation; the baseline test was not weakened or worked around.
  - **Skipped (1):** `the pointer browser tests have the ancestors recorded by Vitest` (`acceptance/test/titles.test.mjs`, reason: `acceptance/results/browser.json is missing`).
  - **Matrix / schema / journey checks confirmed passing separately in the full output:**
    - `acceptance/test/check.test.mjs`: 41/42 passing (all matrix schema, spec ID reader, provenance, engine, waiver, and citation checks pass; only the `defect 5` size-target equality assertion fails);
    - `acceptance/test/journeys.test.mjs`: 27/27 passing (including `the real journeys index names all 16 journeys, covers all 7 opt-in manifest exports, and every citation resolves`, `check({ pers: true }) on the real repository evaluates all 16 journeys without blocking in diagnostic mode`, `strict graduation (--pers --release and --pers-strict) blocks on the real repo when no results or open gaps remain`, `readJourneys rejects unknown test titles, .skip citations, missing testFiles backing, and missing manifest export coverage`, and `CLI check.mjs prints accurate exit codes and summaries for --pers, --pers-strict, --pers --release, and --help`);
    - `acceptance/test/titles.test.mjs`: 1 pass, 0 fail, 1 skipped.
- `npm_config_cache="$TMPDIR/npm-cache" node acceptance/check.mjs --pers`: `PERS (diagnostic): PASS (exit 0) — 0/16 pass, 0 blocker(s)` (confirms live `acceptance/matrix.json` and `acceptance/journeys.json` validate cleanly against `docs/02-product-spec.md` IDs and resolve every cited test title, including the new `L9.evidence.area` citations and updated `subpaths.test.ts` citations).
- Unscoped `./tools/loupe fast` (all 3 tsconfigs + `oxlint`): `ok fast all 2s`.
- `./tools/loupe test packages/axylo/test/cartesian/n4-stacks-layout.test.ts`: `PASS: 13 tests`, including
  the new L9 area unit test.

### Pending Director-only checks (not run in this worker lane)

- Packed `npm run test:dist`, including `bundlers.test.ts` (runtime and `< 15 s` budget unverified here),
  `licence.test.ts` (37-file `THIRD-PARTY-NOTICES.md` inventory), `tree-shaking.test.ts` (`view/stack.ts`
  ownership), and `subpaths.test.ts` (renamed IIFE cap test and legacy/subpath caps);
- Packed `npm run test:dist:browser` (45/45 expected in Chrome, including the W4 spatial/hierarchy page
  clearance fix and the folded L9 area resize checks inside `tests/dist/cartesian.browser.test.ts`);
- `node scripts/size.mjs --check` against the updated 135 / 158 KiB `SIZE_TARGETS`.
