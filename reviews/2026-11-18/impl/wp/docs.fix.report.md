<!-- Author: Claude Opus 5.5 (requested effort xhigh), Agent-tool subagent a04bfe28413f07034, resumed. Saved by the coordinator from the hand-back. -->

## Docs fix pass: all 30 review findings addressed (`apps/docs/**` only, nothing committed)

**State:** at a consistent library revision the docs tests are green: unit 222/222 and browser 167/167. The browser suite can't be green right now: another agent is editing `packages/axylo/src` (the tree-shaking work). Each browser test file rebuilds the site, and that build refuses to run when the packed `axylo.dev.js` no longer matches what the current source builds to.

### Build, counts and last test lines (ran and saw)
- **Build:** 19 pages (16,833 words), 29 diagnostic pages, 51 runnable examples (48 of mine plus the 3 `examples/first-chart` snippets, now running live) and 2 Node examples. Every repository file a page links to is published as a source page with line anchors (64 of them).
- **Unit** (`npx vitest run --config apps/docs/vitest.config.ts`, 10:43):
  ```
  Test Files  4 passed (4)
       Tests  222 passed (222)
  ```
- **Browser** (`AXYLO_BROWSER=1 …`), last fully green run at 10:40 against a consistent revision:
  ```
  Test Files  6 passed (6)
       Tests  167 passed (167)
  ```
- **Later browser runs (10:44):** after `npm run build`, the first one or two files pass, then the rest stop with "the installed axylo.dev.js differs from what packages/axylo/src builds to now". The build reports this and stops; finding 29 asked for exactly that check.

### Findings
Every finding is fixed. Each fix was checked with a browser probe of the built library, or a Node or TypeScript probe, and nearly all are now covered by a test.

| Finding | What changed and how it was checked |
|---|---|
| 1 | Stylesheet reader handles both the `light-dark()` pairs and the per-scheme blocks, and refuses non-hex or mismatched values. The site builds into a temporary directory and replaces `dist` only after its checks pass. |
| 2 | Getting started rebuilt around the snippets running live, plus a daily example (`daily-sessions.ts`: UTC-midnight ISO strings, string counts, unsorted rows, a `null` day). The five sentences are there, and the `validate()` snippet uses the first chart's own options. Checked in America/Los_Angeles: no diagnostics, and 24 Feb stays 24 Feb. |
| 3 | The gap rule is stated as `data/steps.ts` has it: at least three rows, intervals that are multiples of the smallest, at least half of them the smallest, never at the ends, sparse series suppressed, other series irrelevant. An explicit `null` is given as the reliable instruction. Both of the reviewer's cases reproduced. |
| 4 | Conversion to JavaScript numbers, the 2⁵³ limit, exponent notation and the field-wide rejection are now stated. `'9007199254740993'` reading 9,007,199,254,740,992, `'1e999'` raising AX103 and booleans raising AX106 all reproduced. |
| 5 | Event value forms as in `public.ts`, the zoom event's exact triggers, and a new `zoom-linked` example. Following-latest sends no event (reproduced). |
| 6 | `compact-tiles` headlines now come from its rows (50,781 / $184,909 / 30), asserted by the test. |
| 7 | `update.html` uses the current week in both handlers; the test asserts "Week of 9 March". |
| 8 | Mixed-sign stacks: the title is now "Revenue gains and losses by quarter", and pages say "includes zero" and quote the two totals the readout names (`Total 165 k USD and -60 k USD`). New `area-mixed` example. |
| 9 | Donut limit counts positive arcs only. 8 positives plus zero and null are not grouped; 9 are, with "Other (2)" (both reproduced). |
| 10 | Series keys versus labels: wide-row keys are field names, a new `wide-keys` example uses them in `colors` and an event, and `row: null` / `index: -1` is documented. |
| 11 | Compact page written to the new behaviour. The current build already has it: AX150 "Compact charts draw no references". The description no longer lists the reference. |
| 12 | Borrowing is described as conditional, and the `append` fast path as conditional (AX151 makes a strict chart reject the call); React's "same data" hint is described as a heuristic. |
| 13 | The x-kind vote is described correctly; 3 categories, 2 dates and 2 numbers giving a date axis plus AX107 reproduced. |
| 14 | Level and effect are separated. Scatter with a `y` list gives AX150 plus the error state; AX199 is never thrown. |
| 15 | Limits rows rewritten: bars use fill patterns (32 combinations), AX132 counts x positions, AX133 counts plottable points, scatter missing-y rows appear in the table (new example). |
| 16 | Tooltip per decision 0004 rev 2 (anchoring, click to pin, readout strip below 240 × 140 px); "being finished" removed; no chart type zooms a category axis (AX150 reproduced). |
| 17 | Every page now says what the chart exposes and what was verified in spec 3.8's terms; nothing says what a screen reader speaks. |
| 18 | "Up to two tab stops", none for compact charts, donut legend buttons fire `select`, pager only above 100 rows, Page Up/Down step of floor(n/10) (reproduced: 35 points move 3). |
| 19, 30 | Link destinations limited to relative paths, `#`, `https:` and `mailto:`. Balanced parentheses in destinations, ids unique across the page (block quotes included), each directive its own block, duplicate ids fail the build. Unit-tested. |
| 20 | Every link resolves inside `dist`, checked from the site root. Repository files are published as source pages. `[table:]` targets and `[source:]` roots are validated, and a missing quoted file fails the build. |
| 21 | `strictNullChecks` now on for HTML scripts; the five examples fixed with an explicit `byId` helper; the DOM `lib` requirement for Node code is documented. |
| 22 | Each example shows its host markup and mounting code, and links the shared Phase 1 fixture. |
| 23 | DX10 now runs from packed tarballs: `lib/consumer.mjs` packs both packages and installs them offline into `apps/docs/.cache/consumer`, the way `tests/dist` does it (I did not edit their files). Examples are type-checked there with library checking on and a guard on files read from outside the consumer, and bundled from there by esbuild under the `development` condition. Each example now asserts its chart count, a value from its own data, and the interaction it teaches (`test/example-checks.ts`). |
| 24 | Options test checks each documented type both ways against the declared type, and "required" against the type. New `defaults.browser.test.ts` checks each default: option left out must equal the documented value given explicitly, and differ from another value. Theming test checks each public token's fallback binding in `css.ts` and `resolve.ts`; `theme.browser.test.ts` checks painted colours in both schemes. Diagnostics: each condition must start with spec 3.5's text, and every minimal input is run normal and strict to check field, rows, strict-throws and what the reader sees. |
| 25 | All the reviewer's scope corrections applied; each one was reproduced first. |
| 26 | Style installation path, the CSP tests, browser targets kept separate from what was verified, decision 0002 marked provisional, the toolbar-print claim removed, palette measurements as in decision 0003. |
| 27 | "The configuration used in this comparison" throughout; each claim tagged with where it was checked. Both libraries reading `'40'` as 40 was confirmed by running them; "Recharts has no palette" corrected (it has opt-in themes); the annotation plugin is marked "not checked here". |
| 28 | Tick default corrected (50,000 below a million, compact from a million), `XValue` and `columns` defined, first y field sets the shared axis, translated `{seeTable}` example added. |
| 29 | The vendor wrapper is gone: React is bundled from the consumer under the same condition. The revision check rebuilds `axylo.dev.js` in memory and compares it byte for byte, plus the CSS and the version. |

### Mutations: each one fails the strengthened tests (ran)
1. **Options reference, `tooltip` type `string` and default `false`:** `options.test` fails "CommonOptions: each documented type is the declared type", and `defaults.browser` fails "CommonOptions.tooltip: left out equals false".
2. **`--axylo-axis` and `--axylo-grid` defaults swapped:** two binding tests fail in `theming.test`, and `theme.browser` fails in both schemes (painted rgb values swapped).
3. **AX107's cause replaced with "Duplicate x within a series":** `diagnostics.test` fails "AX107: the condition starts with the specification's". Changing only the `because` sentence is not machine-checked; it sits beside the input for a human reviewer.
4. **Direct base `31000 → 3100` in `examples/_phase1-data.ts`** (`first-chart.ts` no longer exists): `migrate-trend` and `recharts-trend` fail ("Direct 1,147" vs "Direct 29,047"). The expected value comes from `research/harness/src/data.js`, not from my copy of the fixture.

All four files were restored afterwards.

### Library behaviour that looked wrong (not changed)
- **Wide-row summary:** reads "a from 1 visits to 3": it uses the first field's key instead of its label, and puts the unit on the minimum only (`reader/index.ts`).
- **Incomplete stacks:** not named in the summary for stacked areas or stacked bars, although the `incompleteAt` and `incompleteCount` messages exist (`reader/index.ts:189`). The pages keep to F10 (tooltip, table, announcements).
- **AX143 message:** always suggests horizontal bars, including on date axes (`registry.ts:130–133`).
- **Too-small fallback:** the plot input's value text reads "No data" when the plot is replaced by its summary (AX142).
- **AX199 message:** says "not your data", yet a row getter that throws raises it (`stages.ts:171–172`, `registry.ts:147`).
- **Resolved since the last report:** the spurious AX143 on date axes (`dates.ts` now passes), and AX108 on the only series (it now shows "… could not be drawn. See table.").
- **Not re-checked this pass:** the typing problem with wide `y` objects under `strictNullChecks: false`.

### What DX10 still does not prove
- Only esbuild bundles the examples, and only the `development` condition and React's development build are rendered.
- Only Chrome.
- Tarballs are installed from local files, not a registry.
- The script-tag snippet's CDN URLs are answered with the packed files.
- HTML module scripts are bundled, not loaded through an import map.

### Lines for you to add
- **`vitest.config.ts`:**
  ```ts
  include: process.env.AXYLO_BROWSER
    ? ['packages/*/test/**/*.browser.test.ts', 'apps/docs/test/**/*.browser.test.ts']
    : ['packages/*/test/**/*.test.ts', 'apps/docs/test/**/*.test.ts'],
  ```
  The Node examples now run from `node.browser.test.ts`, so they need no pattern of their own.
- **`package.json` scripts:**
  ```json
  "docs:build": "node apps/docs/build.mjs",
  "docs:screenshots": "node apps/docs/screenshots.mjs"
  ```
- **`.gitignore`:** `apps/docs/.cache/` and `apps/docs/.scratch/`. `apps/docs/dist` is already covered by `dist/`.
- **CI:** no new step is needed once the include is in, because each browser test file builds the site itself (pack plus an `npm install --offline` into the consumer, falling back to `--prefer-offline` like `tests/dist`). This needs `npm run build` to have run on the same revision. Windows has not been run.

The four screenshots in `apps/docs/screenshots/` are from the 10:44 build. I deleted my own scratch folder.

