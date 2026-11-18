<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a6f0d7846bf125638, resumed. Saved by the coordinator from the hand-back. -->

## Fix pass on the distribution tests (review findings 2, 3, 20–24)

All seven findings are addressed and every distribution test passes. Finding 2 is a real product defect, now fixed with a two-specifier edit in `packages/axylo/src/index.ts`. Nothing is committed.

### Final runs
Against HEAD `ba11e6f` plus the other agents' uncommitted core changes, with dist rebuilt by `node scripts/pack.mjs` at about 07:25 CET. Final runs were at 07:42–07:47 CET.

- **Node**, `npx vitest run --config tests/dist/vitest.config.ts`: `Test Files 9 passed (9)` / `Tests 106 passed (106)`.
- **Browser**, `AXYLO_BROWSER=1 npx vitest run --config tests/dist/vitest.config.ts`: `Test Files 4 passed (4)` / `Tests 30 passed (30)` / `Duration 36.27s`.
- **`npm run typecheck`**: all four projects pass (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p packages/react && tsc -p tests/dist`), exit 0.
- **`npm test`**: 11 files fail (77 tests), all in other agents' work: modified `acceptance/f-domains`, `f-donut` and `f-stacks`, plus `acceptance/.scratch/*`, which look like deliberately broken variants. Every failure is a behaviour assertion such as `expected [] to deeply equal ['AX121']`, never an import or resolution error. The three unit test files that import the changed entry, plus `packages/react/test`, pass: 5 files, 139 tests.

### Per finding

**2. NodeNext consumers lose the public types (blocking).**
- Test first: added `fixtures/npm/tsconfig.nodenext.json` and `fixtures/react/tsconfig.nodenext.json`, and `types.test.ts` now runs both fixtures under Bundler and NodeNext.
- Before the fix, both NodeNext runs failed with TS2834 at `node_modules/axylo/dist/index.d.ts` lines 5 and 6, TS2459 (types not exported), and unused `@ts-expect-error`. The React fixture also failed in the adapter's own `index.d.ts`.
- The fix (re-read the file right before editing; nothing else touched):
  - `packages/axylo/src/index.ts` line 7: `} from './public';` → `} from './public.js';`
  - line 12: `export type * from './public';` → `export type * from './public.js';`
- **Not changed:** `packages/react/src/index.ts`, because its emitted `index.d.ts` has no relative specifiers; the React NodeNext run passes once the core's declarations are fixed. The `./core/*` runtime imports in `index.ts` are also unchanged, since they never reach the declarations. No build configs were changed.
- After the rebuild, `dist/index.d.ts` carries `./public.js`, and all 12 type tests pass. The new specifier still resolves in the workspace type check, in Vitest (the tests above) and in esbuild (`npm run build`).

**3. Size check compared rounded KiB.**
- `scripts/size.mjs` now exports `exceeds(bytes, targetKiB)`, which compares integer bytes against `targetKiB * 1024`.
- The measuring code only runs when the script is called directly, so the function can be imported.
- The header says `--check` is correct but not a CI gate while the targets are under review. I did not change CI.
- New `tests/dist/size.test.ts` covers the boundary, e.g. 40,961 B against 40 KiB is over.
- Current sizes:

| Bundle | gzip | Target | `--check` |
|---|---|---|---|
| line only | 99.38 KiB | 25 KiB | over |
| everything | 99.47 KiB | 40 KiB | over |
| script tag (JS + CSS) | 103.53 KiB | none | — |
| React adapter | 1.17 KiB | 2 KiB | passes |

`--check` exits 1.

**20. Text insertion.** New `text.browser.test.ts`, served under the strict policy. It runs from the minified script-tag file and from a bundled module under the development condition.
- **Sentinels:** `pages/sentinels.ts` gives every text source on each of the five chart types its own inert sentinel, `<u data-axs="id">…</u>`:
  - title, subtitle, description, series name and category;
  - x and y field labels, unit;
  - x and y value formatters, and tick formatters;
  - a compact chart.
- **Exact assertions:** heading text and accessible name are compared exactly; ticks must match exactly their formatter's output for a number; legend entries are compared exactly.
- **Containment assertions:** the description, axis titles, tooltip/readout parts and `aria-valuetext` must each contain the right sentinels.
- **Table:** the caption must equal the title sentinel exactly. Headers and every cell are compared against the fixture row they came from.
- **Page-wide checks:** every `data-axs` anywhere in the page text or attributes must belong to a whole sentinel, no `[data-axs]` or `u` element may exist, and the observer must have recorded nothing.
- **Messages:**
  - A second page overrides every `Messages` key and drives 13 chart states (dirty data, zoomed, untitled, time zone, references, loading, empty, error, ten series, eleven slices, a sparse stack, and the dirty-input note).
  - It requires 36 named keys, listed by the surface the spec gives each.
  - The dirty-input note must read exactly ``Values not shown: 3. ${S('m-seeTable')}``, and author error text must appear as text.
  - Keys that no triggered state shows are listed in `tests/dist/README.md`.

**21. StrictMode and DX1 scope.**
- **StrictMode:** `pages/spy-axylo.ts` is put between the packed adapter and the packed core through an esbuild plugin. It logs each chart's create and destroy, and which chart's listeners received events.
- **What the test asserts:**
  - The log reads exactly create#1, destroy#1, create#2.
  - The destroyed chart #1 ignores `update`, `append` and `zoom`: still one figure, title unchanged.
  - Hover events reach chart #2 only.
  - Unmount adds destroy#2 and leaves `#root` empty. After that, nothing reacts to `update`, resize or the pointer.
- **Untitled variants:** the npm, script-tag and React snippets each draw without their title and print only AX140.
- **DX1 scope:** I did not add first-chart examples for the other four chart types. `tests/dist/README.md` and the test header now state that DX1 is established for the documented line chart by all three routes, with only the package-level parts carrying over to the other types.

**22. Fixture isolation and extraction.**
- **Install by npm:** the hand-written tar extractor and the symlinks are gone. `pack.mjs` now runs `npm install --offline --ignore-scripts --no-audit --no-fund --no-package-lock` in each fixture, from the fixture's own `package.json`. The React fixture now declares `@types/react` and `@types/react-dom`. All of this works offline here.
- **Environment:** `npm_*` variables are stripped from the install's environment. When the tests were started through npx, one of them (allow-scripts) made the install refuse to run with `EALLOWSCRIPTS`.
- **Cache fallback:** if the npm cache lacks registry metadata for the third-party packages (a cache filled only by `npm ci`), the install falls back to `--prefer-offline`. That fallback has not happened here.
- **Guards:** the fixtures still sit under the repository, so isolation is enforced by guards instead:
  - Node: `tests/dist/guard/node-guard.mjs`, a resolve hook loaded with `--import`; `nodeJson` always uses it.
  - esbuild: `fixtureGuard` in `pack.mjs`, now on every test build and in `size.mjs`. It immediately caught the CSP module entry's import of the pages directory, which is now explicitly allowed.
  - TypeScript: the `--listFiles` output, since no option stops TypeScript walking up to the root `node_modules`. I checked: a `paths` mapping does not stop it.
- **What `isolation.test.ts` asserts:**
  - npm's lockfile names the packed tarball and its integrity for each of our packages.
  - There are no links in any fixture `node_modules`.
  - Without a guard, the undeclared package does resolve into the workspace, so the guards have something to stop.
  - Declared imports resolve inside each fixture, with and without `--conditions=development`, including the adapter's own `import 'axylo'`.
  - An undeclared import (`@axylo/react` from the npm and script fixtures, `fast-check` from the React fixture) is stopped by all three guards.

**23. CSP observation.**
- **Reports:** each page's policy now names its own `report-uri /csp-report/<page>`, and the server keeps reports per page. A last test waits, then requires all 8 pages to have zero reports and no report under an unknown page id.
- **Negative control:** it waits for exactly 2 reports, requires their directives to be exactly `script-src-attr` and `style-src-attr` with `document-uri` equal to the control page, and the events to name the same two directives.
- **Stylesheet effect,** on every page:
  - computed `display: flex` on the figure and `font-weight: 600` on the title;
  - `--axylo-default-series-1` equal to the light value the packed `axylo.css` declares (#4a94eb), and the first series mark's computed colour equal to it;
  - a screenshot, decoded by the new dependency-free `tests/dist/png.ts`, with more than 50 pixels of that colour (176 observed);
  - with the sheet disabled or un-adopted, `display` is no longer `flex`.

**24. Oracles.**
- **Development-only behaviour:** new `flavours.browser.test.ts`, with a list written by hand from spec 3.5, plan 1.6 and 1.7, and the diagnostics docs. It runs on all four core files and both adapter files:
  - the AX104 hint prints once in development and never in production;
  - it reaches `onDiagnostic` and `chart.diagnostics` in both;
  - the AX140 warning prints once in both;
  - the adapter's memoize hint appears once in development and never in production.
- **Token check:** the source-derived check in `conditions.test.ts` is kept but labelled supplementary, with the reviewer's objection stated in its header.
- **Licence:** `THIRD-PARTY-NOTICES.md` now has a release inventory of all 16 shipped files, each with origin and licence, plus a Notices section. `licence.test.ts` now asserts:
  - the inventory equals the tarballs' file lists exactly;
  - each claimed origin holds: bundle inputs come only from the package's `src`, and the shipped CSS equals the string `theme/css.ts` exports;
  - any licence or copyright header found in source or shipped files must be quoted in Notices, instead of counting as a failure;
  - the existing checks (MIT, no dependencies, imports) are kept.

  The notices file now says that third-party code copied into `src` without a header cannot be detected.

### Files I changed or added
- **Changed:**
  - `packages/axylo/src/index.ts` (the two specifiers above)
  - `scripts/pack.mjs`, `scripts/size.mjs`
  - `THIRD-PARTY-NOTICES.md`
  - `tests/dist/{README.md, browser.ts, paths.ts, types.test.ts, isolation.test.ts, conditions.test.ts, csp.browser.test.ts, first-chart.browser.test.ts, licence.test.ts, side-effects.test.ts}`
  - `tests/dist/pages/{observe.js, page.css}`
  - the three fixture `package.json` files, and `fixtures/react/tsconfig.json`
- **New:**
  - `tests/dist/{guard/node-guard.mjs, png.ts, size.test.ts, text.browser.test.ts, flavours.browser.test.ts}`
  - `tests/dist/pages/{sentinels.ts, spy-axylo.ts, flavour.ts}`
  - `fixtures/{npm,react}/tsconfig.nodenext.json`, `fixtures/react/{main-strict.tsx, memo.tsx}`

The package READMEs and LICENSE files are untouched. No new `.gitignore` lines are needed: the scratch output goes under the already-ignored `fixtures/*/.out/` and `tests/dist/.out/`.

### Not verified
- The `--prefer-offline` fallback, and fixture installs on a CI runner whose cache was filled by `npm ci`.
- Windows and macOS.
- Browsers other than Chrome, and bundlers other than esbuild.
- The webpack effect of `sideEffects: ["*.css"]`.
- The headless Chrome still running at the end belongs to the other agent's `vitest run packages/axylo/test/browser/acceptance`; mine closed.

