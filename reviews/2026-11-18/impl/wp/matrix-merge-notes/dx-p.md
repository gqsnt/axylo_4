# Family dx-p: DX1–DX12, P1–P8

Rows file: `.matrix-merge-scratch/rows/dx-p.json`. `node .matrix-merge-scratch/validate.mjs .matrix-merge-scratch/rows/dx-p.json` ends with `OK: 20 rows, no problems found by this helper` (the checker's one remaining problem is in T-reference-line, another family).

Titles from `tests/dist/**` and `apps/docs/test/**` have no EVIDENCE.json. I derived each one, and each runtime suite title used in `ancestors`, from the source by hand. I checked the suite-title pattern against the older `acceptance/results/dist.json` (08:34, before the React removal), which uses the same `describe.each` labels. All statuses below are static or come from a fabricated all-pass experiment (scratchpad `experiment.mjs`). No test was run.

## Changes by criterion

**DX1.** The statement now names npm and script tag only; React is gone. Compact is now **not applicable**: a compact chart needs `compact: true` by definition (spec 3.7), so "data and fields only" is a rule about the full chart.
- Removed: everything React (`packages/react/**`; the first-chart "React:" suite with StrictMode; the `react.tsx` snippet citations; the react fixture in `isolation.test.ts` and `types.test.ts`).
- Line evidence:
  - `snippets.test.ts`: four checks for each of the two snippets, with ancestors.
  - `isolation.test.ts` "was installed by npm from the packed tarballs…", for the npm and script fixtures.
  - `types.test.ts` "checked the first-chart snippet" and "type-checks with tsc --strict…", under Bundler and NodeNext.
  - `first-chart.browser.test.ts`: production and development renders (registration), the two "does not require the title" tests, and the script-tag "renders".
- Area, bar, scatter and donut (weak): "F3 <type>: AX140 generates a name and keeps the marks when no title is supplied" (Node, data and fields only), and two CSP variants (packed script tag and packed module). The gaps say that no first-chart snippet exists for these types.

**DX2.** Line evidence adds `packages/axylo/test/data/normalize.test.ts` "produces equal aligned values and slots from long, wide and typed inputs". It covers two series and caller row indexes that differ by form (wide 1, long 2, typed 1), which closes line's old gap. The same test is weak for area, bar and compact: it runs the line kind only. The gaps for area, bar, scatter and compact now say exactly what is missing. Donut's limits explain that rows and typed columns are its only forms.

**DX3.**
- Removed: `packages/react/test/dist.test.ts`; every react-fixture type check; and the blanket weak "type-checks…" citation on all six types.
- The packed type check is now **evidence** only where `tests/dist/fixtures/npm/consumer.ts` has a mistake for that type:
  - line: misspelled field, wide y with series, `validate('line', …)` with an area-only option;
  - bar: text field on the value axis;
  - scatter: `compact`;
  - donut: `zoom`.
- `docs/api/examples.ts` is weak (`document`) where it has mistakes for that type. It is compiled only by `npm run typecheck`, which no recorded test runs.
- Gaps name the missing mistakes per type. Wide y with series is not applicable to scatter (one y field) or donut (no series), as stated in the gaps.

**DX4.**
- Added, for all types: `diagnostics/registry.test.ts` "has every code and level in section 3.5"; the documentation-page tests (`apps/docs/test/diagnostics.test.ts`: three exact titles; `diagnostics.browser.test.ts`: "every code in the registry has a built page", "the diagnostics page links every code page").
- The flavours weak citations stay on line only, with ancestors and registration: the flavour page draws two line charts. They are removed from the other five types.
- Gap: field, rows and fix are asserted together for AX103 only on each type; there is no message snapshot.
- Limits: the site build refuses broken links (`checkSite`), so the link check is covered.

**DX5.**
- Removed: React browser test, React patch property test.
- Line adds seven `packages/axylo/test/browser/chart/lifecycle.browser.test.ts` tests (one-turn sequence, rejected strict update and append, destroy before the frame, no observer, listener or registration after destroy, kept handle retains nothing). The two heap tests are weak.
- All six cells are now `pending`: the 1,000-cycle heap trend is P7's measurement (spec "Verified by: … (P7)"), and P7 is not measured.
- Other types: a gap says the browser sequence and destroy checks run on line only.
- Limits: "switch together" is asserted on the committed frame in Node. Donut and compact skip the text and lookup comparison.

**DX6.** The 24-tile gap is kept for all types. Added for all types:
- the two docs theming name tests (evidence);
- the pending-css typography test (weak, now on every type instead of line only);
- `theme.browser.test.ts` "colors: { Direct: "var(--brand)" } stays live in SVG…" (weak).

The gap now also names color inheritance, the theme-object and positional-palette refusal, and the missing spacing property.

**DX7.**
- The statement now gives the 116 / 98 KiB targets.
- Removed: the "React adapter alone" size entry; `packages/react/test/dist.test.ts`; the renamed "ships JavaScript that imports nothing but its peers"; the stale limits text about 40 / 25 / 2 KiB.
- Size: line cites `everything (export * from axylo)` and `line only (examples/first-chart/npm.ts)`; the other types cite `everything` (DX7 sets no per-type target).
- Licence tests, with `ancestors: ["axylo"]`: "declares no runtime dependencies", "ships JavaScript that imports nothing", "is built from its own source only…".
- Limits say the size record does not name its commit, that the stylesheet is carried inside the JavaScript, and that `--check` is not yet a CI gate.

**DX8.** The statement follows the amended spec.
- Removed: all React, StrictMode and hydration citations (`node.test.ts` "@axylo/react server rendering"; first-chart StrictMode and hydrates; `packages/react/**`). Also removed: the built-in-strings text test (A10's concern; its fixture is changing), `render.browser.test.ts` "a selector that matches nothing…", and `node.test.ts` "a chart function called without a document…". The CSP test asserts the selector on the packed files instead.
- Evidence for each part:
  - Node import: `node.test.ts`, both conditions, with ancestors.
  - `validate()`: `node.test.ts` dirty fixture for line, plus "DX8 <type>" in Node for every type.
  - Create–destroy–create: `tests/dist/lifecycle.browser.test.ts`, both routes, plus the source-build "a destroyed handle … retains neither…", line only.
  - CSP: eight `csp.browser.test.ts` variants with ancestors, plus the late-report check.
  - Text, never HTML: `text.browser.test.ts` author-text test, two loaders. I cite it by its per-kind assertion structure, not its fixture values.
- Gap for area, bar, scatter, donut and compact: create–destroy–create and the missing-target error are line only.

**DX9.** Was empty (no evidence). Now weak (`document`) `apps/docs/pages/stability.md` (the policy), plus `cannotVerify` on all types: no release exists (0.0.0), so there is no previous release, no API report and no release history.

**DX10.**
- Removed: snippet, type and first-chart citations (they are DX1's; the docs suite renders the two first-chart snippets too); the `docs/api/examples.ts` document (compiled, never rendered).
- Now cites `apps/docs/test/examples.browser.test.ts`: two type-check tests, "every example has its own check…", and the describe prefix "examples render in Chrome from the packed packages". It also cites `apps/docs/test/node.browser.test.ts` (three Node-example tests). Same set for all six types; the examples cover every type.
- **The prefix cannot pass in this checker** (see defects). The cells stay "not run" even with all results passing.

**DX11.**
- Removed: "ships JavaScript that imports nothing but its peers" (renamed, and it belongs to DX7); "declares no runtime dependencies" (DX7); the old two-package titles "covers both published packages" and "lists exactly the files of each packed tarball…".
- Now cites: "is MIT…", "is built from its own source only…", "every licence or copyright header…" (with ancestors `["axylo"]`), and the three THIRD-PARTY-NOTICES tests under their current titles.

**DX12.** Was empty. Now `pending` on all types: the rehearsal has not been done (STATUS.md, next actions), and the repository holds no script, prompts or trap fixtures for it. It will be recorded as agent rehearsal, not as user evidence.

**P1, P2, P3, P5.** Line only, with specific NA reasons: the plan's W-first "create one line chart", W-page "24 × trend", and the line-only P3 endpoints in `bench/src/decision.js`.
- Removed: the `benchmark` weak citations of exploratory history files (`bench/src/page.js` with history). They establish no budget.
- `pending`: the owner's sentence, plus the harness endpoint that exists and "no test asserts the limit".

**P4.** Line, area, bar and scatter (unchanged; donut and compact NA, reasons reworded). Each cell has `pending` with the owner's sentence. For area, bar and scatter it adds that the harness's hover workload draws a line.

**P6.** Removed: the `scripts/size.mjs` document and the pending text. The evidence is now the same size entries as DX7: line gets `everything` and `line only`, the other types `everything`. The metric matches P6 (minified and gzipped, CSS inside the JavaScript). The limits match DX7's. Static status: **pass** from the record, which does not name its commit.

**P7.** The statement gives the 1.1× budget.
- Line weak:
  - `streaming-storage.test.ts` "bounds the retained typed-array backing after opening a million typed observations and appending": the line store's ArrayBuffer bytes only;
  - the two `lifecycle.browser.test.ts` heap tests: 2,500 cycles, means of 1,500–2,000 against 2,000–2,500, 1% allowance; and non-code heap, 300 → 1,000 cycles, less than 64 KiB.
- Removed: the benchmark weak citation, and the obsolete pending numbers (24,750,128 B against 16,000,000 B, the old 1× bound).
- All six types: `pending` with the owner's sentence.

**P8.** Compact only (NA reasons rewritten: scatter and donut have no compact variant). `pending`: the owner's sentence. The P8 endpoint draws compact line tiles; compact area and bar have no workload.

## Cells whose status went down or up

"Before" is what the old fields allowed; the old rows were refused by the checker (missing React files and titles, a missing size entry).

| Cell | Before | Now | Why |
|---|---|---|---|
| DX1/compact | weak | not applicable | Needs `compact: true` by definition; the first-chart rule is about the full chart. |
| DX2/line | weak (gap: one series, same indexes) | evidence only (pass when run) | normalize.test.ts compares two series across the three forms and checks each form's own row index. |
| DX5/line, area, bar, scatter, donut, compact | weak (gaps) | not run (pending) | The heap trend over 1,000 cycles is P7's measurement, not measured yet. Gaps remain for the non-line browser checks. |
| DX7/all | evidence only, but refused (React size entry, old title) | evidence only (pass when run) | Valid size entries and current titles; the size record meets 116 / 98 KiB. |
| DX8/line | evidence only, but refused (StrictMode, hydration, React) | evidence only (pass when run) | Current titles; every part cited. |
| DX9/all | no evidence | cannot be verified here | No release exists to run an upgrade test or diff an API report against. |
| DX10/line | weak | not run, permanently (checker) | Now cites the docs examples suite in full. Its per-example tests can only be cited by describe prefix, and the checker never passes that prefix (defect 1). |
| DX10/area, bar, scatter, donut, compact | weak | not run, permanently (checker) | Same as line. |
| DX11/all | evidence only, but refused (renamed titles) | evidence only (pass when run) | Current titles with ancestors. |
| DX12/all | no evidence | not run (pending) | The rehearsal is pending work. |
| P6/all | not run (pending) | pass (size record) | The size check measures P6's metric against the DX7 limit. |
| P1, P2, P3, P5/line; P4; P7; P8 | not run | not run | Unchanged status. The benchmark weak citations were removed and the pending text reworded. |

Every other cell keeps its status: DX1 area to donut weak; DX2 area, bar, scatter, compact weak and donut pass-capable; DX3, DX4 and DX6 weak; DX8 non-line weak.

## No evidence (gap list)

Most important first.

1. **DX10, all types.** The per-example render tests (`examples.browser.test.ts`, it.each over the example list) exist but cannot be counted: they can only be cited by describe prefix, and that prefix never passes (defect 1).
2. **DX5, all types.** Heap trend over 1,000 create–destroy cycles is P7, not measured. For area, bar, scatter, donut and compact, nothing in a browser checks the one-turn sequence, the rejected strict update, or what `destroy()` releases (the element, listeners, observers, kept data); Node only.
3. **DX8, area, bar, scatter, donut and compact.** Create, destroy and create again on one element, and "leaks nothing", are tested on line only. The missing-target error is checked through `line()` only.
4. **DX3, compile time.** The four typed mistakes per type:
   - area: none;
   - compact: none;
   - line: text field on a value axis missing;
   - bar: misspelled field, wide y with series, inapplicable option missing;
   - scatter: misspelled field, text field missing;
   - donut: misspelled field missing, text value only in docs/api.

   No recorded test compiles `docs/api/examples.ts`. At run time, wide y with series is checked on the full line chart only (missing for area, bar and compact).
5. **DX6, all types.**
   - No 24-tile page with differing series subsets: the pin is model-level, and the painted pin uses one hand-built scene.
   - Inheriting the page's `color` is not asserted.
   - Refusal of a theme object or positional palette is not tested.
   - No spacing property exists or is asserted (the stylesheet has only text spacing: `--axylo-letter-spacing`, `--axylo-line-height`).
6. **DX4, all types.** Field and rows are not checked for every code that has them (only some codes, in registry.test.ts and F3). No message snapshot.
7. **DX1, area, bar, scatter and donut.** No ten-line snippet is documented or rendered from the packed files for these types.
8. **DX2, area, bar, scatter and compact.** Two-series data and form-dependent row indexes are checked only with the line kind's normalizer.
9. **P1, P2, P3, P5 (line), P4 (line, area, bar, scatter), P7 (all), P8 (compact).** Not measured. No benchmark workload exists for P4 on area, bar or scatter, for P7 on any non-line type, or for P8 on compact area or bar.
10. **DX9 (no release) and DX12 (rehearsal not done), all types.**

## Not testable as written

- **DX7** "reconsidered only with a measured comparison": a process rule.
- **DX9** "at most one major version a year" and "keeps working for at least … six months": statements about release history. Not checkable until releases exist, and then only over time.
- **DX11** "verified at release": the tests check the tarball `npm pack` makes now; "at release" is a process step.
- **DX12** "passes the reader criteria": the agent's chart would have to be run through the whole reader suite (F, L, I, A). No script exists for that.
- **DX5** "releases everything" and **DX8** "leaks nothing": unbounded. The tests check what a page can observe (DOM, listeners, observers, animation frames, WeakRef-collected data and figure).
- **DX6** "spacing": the stylesheet has no layout-spacing custom property, so the word has no testable referent. "There is no theme object": an absence, checkable only through the types or AX150.
- **DX4** "Verified by: Message snapshots": none exist. Messages are checked by substrings.
- **DX10** "in CI": `.github/workflows/ci.yml` lists the suites, but it has never run (no remote).
- **DX1** "ten lines": `snippets.test.ts` counts non-blank lines (npm.ts is ten lines with blanks as well).
- **P1** "reference desktop" and the "named hardware profiles": no profile is defined in a form a test could check.

## Titles that promise more than their assertions

- `packages/axylo/test/acceptance/dx-controller.test.ts:21`, "DX2 <type>: supported row and column forms … preserve caller row indexes in diagnostics". The bad value is at row 1 in every form (one series), so the test cannot tell the caller's own index from a normalized one. `normalize.test.ts:209` does that, for the line kind only.
- `dx-controller.test.ts:81`, "DX5 <type>: replace then append then zoom in one turn switches marks, text and lookup together". For donut the text layer is not compared (`if (!donut && type !== 'compact')`). For compact neither text nor lookup is compared. For compact and donut the zoom has no effect.
- `packages/axylo/test/browser/render/pending-css.browser.test.ts:44`, "typography custom properties reach the text layer, and unset they inherit the page font". Only `--axylo-font-family` is asserted, against `sans-serif`; size, weight, letter spacing and line height are not.
- `packages/axylo/test/browser/chart/lifecycle.browser.test.ts:374`, "create–destroy cycles show no upward heap trend once the engine has warmed up". It asserts that the mean of cycles 2,000–2,500 is at most 1% above the mean of 1,500–2,000. That is two window means with an allowance, not a slope.
- `tests/dist/licence.test.ts:91`, "covers the published package". It asserts only that THIRD-PARTY-NOTICES.md contains the string `` `axylo` ``. The inventory and origin tests below it do the real work.
- `tests/dist/csp.browser.test.ts:106`, "draws every chart type, opens a tooltip and the tables…". Tooltips are opened on line and bar only, and tables on five types (compact has none). The title's singular "a tooltip" is accurate; read it as such.

Negative controls (not cited): `csp.browser.test.ts` "the instruments themselves" → "catch text inserted as HTML: the observer records the element, and each report names its directive and page" covers `tests/dist/pages/observe.js` and the report URLs. DX8's CSP and text citations rely on that helper.

## Checker or helper defects

1. **A describe prefix over tests with unexpandable `it.each` titles can never pass.** `titles.mjs` records `it.each(computed)('%s')` as a test with `title: null`. For a prefix citation, `resultFor` puts that null-title key in `expected`, and no result can match it. Confirmed with fabricated all-pass results: DX10 reads "not run" with the prefix and "pass" without it. Affected: `apps/docs/test/examples.browser.test.ts` (per-example renders), `diagnostics.test.ts`, `diagnostics.browser.test.ts` ("each input does what its page says"), `site.browser.test.ts`, `options.test.ts`. A `casePrefix` does not help either: it excludes the null key, but a passing result whose title is in neither `keys` nor a template is never added to `passed`. A fix could let a prefix citation declare `cases` for such suites, or exclude null-title registrations from `expected` when `cases` is given.
2. **A title-only citation of a test inside `describe.each` with computed rows never passes.** The scanner cannot name the suite, so it records the test with ancestors `[]`. `expected` uses those static ancestors; results carry the real suite title. Confirmed: DX11 without `ancestors` reads "not run" with all-pass results. Affected: `tests/dist/licence.test.ts`, `snippets.test.ts`, `node.test.ts` (`%j` is not expanded either), `lifecycle.browser.test.ts`, `csp.browser.test.ts`, `text.browser.test.ts`, `flavours.browser.test.ts`, `isolation.test.ts`, `types.test.ts`. Workaround here: `ancestors` with the runtime suite titles, even where the title is in only one suite (licence: `["axylo"]`). The brief says to give ancestors only when a title repeats; here the checker needs them.
3. **`describe.each` with literal rows puts a test in every row's suite at once.** Static ancestors become the union, for example `["stylesheet applied at run time","stylesheet linked by the page"]` or `["npm fixture","moduleResolution Bundler","moduleResolution NodeNext"]`. That path never occurs at run time.
4. **Size citations have no provenance.** `resultFor` judges `bench/size-latest.json` as it is: the record names no commit, and the checker does not compare its tarball integrity with the current pack. P6 already reads "pass" statically. Recorded in the DX7 and P6 limits.
5. **Helper:** `validate.mjs` prints no per-row statuses when another family's row makes the checker throw. I got the statuses by removing that one stale citation in a scratch copy (scratchpad `experiment.mjs`).
