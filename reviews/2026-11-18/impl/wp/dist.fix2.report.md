<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a6f0d7846bf125638, resumed. Saved by the coordinator from the hand-back. -->

## Maintenance pass on the distribution tests

Both distribution configurations and the type check pass. Neither of the two failures was a product defect; both were test-side, as the restructuring agent said, and both are fixed. Nothing is committed.

**Final run:** HEAD `5dc837e` plus other agents' uncommitted work; I rebuilt dist with `node scripts/pack.mjs` at about 10:34 CET and ran everything at 11:35 CET.

- **`npm run typecheck`** (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p packages/react && tsc -p tests/dist`): exit 0.
- **Node:** `Test Files 10 passed (10)` / `Tests 121 passed (121)`.
- **Browser:** `Test Files 4 passed (4)` / `Tests 30 passed (30)` / `Duration 38.40s`.

### 1. The two failures
**`csp.browser.test.ts` (8 failures).**
- **First cause:** the regex for the stylesheet's light series colour predated the `light-dark()` tokens and the minified form.
  - It now reads a `[data-axylo-scheme="light"]` block, or the `.axylo` block (taking a plain colour or the first argument of `light-dark()`), in readable or minified text.
  - It requires every form the sheet gives to agree. Today that is #2b97ee.
  - The computed custom property may now be either the fixed value or a `light-dark()` pair that starts with it.
- **Second cause, found once the regex was fixed:** 0 pixels of the series colour were painted.
  - The screenshot showed the line chart's table in the plot's place, because the earlier "View as table" click leaves the table open.
  - That fits spec A4 (a table no taller than the plot that does not move other charts), so it is not a defect.
  - The style and paint check now runs before any table opens: 480 pixels of #2b97ee on every page. The "rules disappear without the sheet" check still runs at the end.

**`conditions.test.ts > @axylo/react` (development-only text).**
- I retired the source-derived token check and its scanner instead of patching it. It was finding identifiers like `value`, `series` and `label`, which the minifier keeps anywhere.
- The hand-pinned `flavours.browser.test.ts` stays as the evidence, and the file header says why the check was removed.
- I added a check that no shipped core file (ESM dev, ESM prod, both IIFE files) and neither adapter file refers to `__DEV__` or `__BENCH__`.

### 2. `scripts/size.mjs`
- **Targets:** 96 KiB everything, 80 KiB line only, 2 KiB React adapter, compared as integer bytes. The header says `--check` is not a CI gate yet; I did not touch CI.
- **New rows, no target:** area, bar, scatter and donut each imported alone (`export { x } from 'axylo'`), and `validate` alone.
- **Breakdown:** it now rebuilds with `PRODUCTION`, `stylesheets()` and `stylesheetPlugin()` imported from `scripts/build.mjs`. It reports "303903 B minified; the packed axylo.js is 303903 B, identical in size".

Size table from the packed files (esbuild minify, production condition, gzip level 9):

| entry | min B | js gzip B | css file gzip B | total KiB | target | status |
|---|---|---|---|---|---|---|
| line only (`npm.ts`) | 255,120 | 89,605 | — | 87.50 | 80 | OVER |
| everything | 303,856 | 106,738 | — | 104.24 | 96 | OVER |
| area only | 260,476 | 91,514 | — | 89.37 | — | — |
| bar only | 256,092 | 89,997 | — | 87.89 | — | — |
| scatter only | 238,968 | 83,830 | — | 81.87 | — | — |
| donut only | 221,734 | 77,125 | — | 75.32 | — | — |
| validate only | 58,215 | 20,887 | — | 20.40 | — | — |
| script tag (IIFE min + css) | 304,394 | 106,833 | 2,886 | 107.15 | — | — |
| React adapter alone | 3,499 | 1,671 | — | 1.63 | 2 | ok |

`--check` exits 1.

### 3. `tree-shaking.test.ts`, reviewed as its owner
- **The existing markers are honest.** Each must first appear in its own kind's bundle, so a renamed marker fails rather than passing everything.
  - `kind:"<k>",normalize:`, `axylo-pattern-`, `__other__` and `adoptNormalized` are distinctive.
  - `.upper` (area) and `.minX` (scatter) are generic property names: if shared code ever uses one, the test fails falsely rather than passing falsely. Acceptable, but worth knowing.
- **What it lacked:** a check one level up, for shared code that starts importing another kind's module whose text has no marker. Literal kind names cannot serve as that check: every single-kind bundle already names all five kinds many times, through diagnostics and option tables.
- **What I added** (6 tests): the library source, bundled one kind at a time with the release settings from `build.mjs`.
  - For each kind, every source module that contributes bytes is checked against a hand-written list of which modules belong to which kinds, taken from the map in `tree-shake.report.md`. Examples: `kinds/*`, `scene/areas` and `scene/bars`, the scatter and donut lookups and views, the aligned stores, `view/stack`, `data/store-unaligned`.
  - Each kind must include its own modules and none that belong only to other kinds.
  - `validate` alone must include `data/normalize` and no module under `kinds/`, `render/`, `dom/`, `scene/`, `lookup/`, `reader/` or `theme/`, since it runs only the synchronous stages (plan 1.6).
- This check runs on the source, not the packed file: the packed-file markers stay the distribution evidence.

### The restructured package
Nothing looks wrong:
- `exports` and `files` are unchanged and still match the tarball; the 10 and 6 files pass the content tests.
- The shipped `index.d.ts` imports only `./public.js`, and NodeNext and Bundler consumers type-check.
- `sideEffects: ["*.css"]` still holds: importing for effects with hints ignored bundles to 0 bytes.
- No shipped file contains `__DEV__` or `__BENCH__`.
- `dist/` now also holds `kinds/*.d.ts` and the other internal declarations from `tsc`, but `files` keeps them out of the tarball.
- The restructuring agent had also edited my `licence.test.ts` and `THIRD-PARTY-NOTICES.md` (the "generated from X through Y" origin wording); I kept that, and the licence tests pass.

### Files changed
- `tests/dist/csp.browser.test.ts`
- `tests/dist/conditions.test.ts`
- `tests/dist/tree-shaking.test.ts`
- `tests/dist/README.md`: rows for conditions, tree-shaking and size.mjs, plus the new targets
- `scripts/size.mjs`

### Not verified
- Browsers other than Chrome, bundlers other than esbuild.
- Windows and macOS.
- The CI behaviour of the fixture installs, including the `--prefer-offline` fallback.

