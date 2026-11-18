<!-- Author: Claude Opus 5.5, agent a04bfe28413f07034; saved by the coordinator -->

## Conformance follow-up: report

The conformance page now reads the checker's structured `rows` instead of its Markdown table. Today's page is unchanged except for the spec's new A5 wording. Nothing is committed, and I did not touch the library or `acceptance/**`. The default docs build refuses as you expected, so the docs browser suite waits on your rebuild.

### What changed (6 files under `apps/docs/`, on top of 47c22d7)

- **`lib/conformance.mjs`**
  - The three local copies are gone: the `CONFIGS` array, the `STATUSES` array, and `parseCell`/`parseTable` with the browser-file regex.
  - It now imports `check`, `CHART_TYPES` and `STATUSES` from `acceptance/check.mjs`, and `ENGINES`, `engineLabel` and `resultFiles` from `acceptance/provenance.mjs`. I used `resultFiles()`, which is built from `CONFIGS`, so `CONFIGS` itself is not imported.
  - A new `readRows()` reads `result.rows`. For each report:
    - The engine is `reports[].engine`. When that is null, it falls back to the engine `resultFiles()` gives for that file, so a pre-switch `browser.json` still counts as Chrome.
    - It counts for this revision when `provenanceError` is null.
    - The commit comes from the file's sidecar.
  - The guard stays. The build stops when:
    - `rows` is not a list;
    - a row's chart types are not exactly `CHART_TYPES`;
    - a status is outside `STATUSES`;
    - a report has an unknown `source` or result, or an engine outside `ENGINES` or null.
  - What is more exact now: a `source: 'size'` report counts in the checker's verdict but in no engine's column. Before, it would have been matched by label. No cited WCAG row has one today.
- **`test/conformance.test.ts`**
  - The table-parsing tests are replaced by: reading the checker's own fixture rows, the engine fallback, and five guard cases.
  - The fixture tests for the refused matrix and for results without provenance stay unchanged.
- **Pages**
  - `accessibility.md`: the Escape row follows decision 0004's rewritten clarification. The datum on show stays closed until the pointer reaches a different datum, and nothing else opens at once. After Escape from a hold, the datum under the pointer also stays closed. The colour-vision row follows spec A5: bars are told apart by position and order and named by the legend and tooltip; fill patterns apply past the eighth series and between neighbours in a compact chart.
  - `theming.md` and `getting-started.md`: the same A5 change.
  - `options.md`: removed the sentence about keys that are not shown, since those three keys are gone.

**Your edits.** `data/messages.mjs` and the options test still agree: the test passes, and the build's key check passes. The AX199 condition you aligned reads well on the page.

### What I ran and saw (18:17 CET, HEAD 7f9965e, `dist` from 22a0b52, other authors' uncommitted source in the tree)

- **`node apps/docs/build.mjs`** refuses, as expected:
  ```
  Error: The packed library and its source differ (run `npm run build`, then build the site again):
    the installed axylo.css differs from the minified packages/axylo/src/theme/css.ts
    the installed axylo.dev.js differs from what packages/axylo/src builds to now
  ```
  So `apps/docs/dist` was not replaced; it is still my 18:00 build.
- **`node apps/docs/build.mjs --unchecked-library`** prints:
  ```
  built 18 pages (18051 words), 29 diagnostic pages and 46 examples in 528 ms, into …/apps/docs/.cache/unchecked-site
  NOT FOR PUBLISHING: built against a packed library that is not the build of its source (2 differences).
  ```
  The link and anchor check passed.
- **Conformance page, before against after.** I compared the article of `dist/conformance.html` with `.cache/unchecked-site/conformance.html`. The only difference is the spec's A5 criterion text, which appears twice.
  - The checker still refuses the matrix: now 99 problems. The first is a missing test title in `packages/axylo/test/reader/index.test.ts` (T-reference-line).
  - Every cell reads "not recorded". The result files listed are unit, browser, dist and dist-browser, all from d8b4150.
- **`npx vitest run --config apps/docs/vitest.config.ts`**: `Test Files 5 passed (5)`, `Tests 239 passed (239)`. These run against the source, not `dist`.
- I left `apps/docs/.cache/unchecked-site` in place for you to look at. It is gitignored and goes away with the cache.

### What waits on your rebuild

All six docs browser test files (170 tests at my last run): examples and their checks including Select range, diagnostics outcomes and printed lines, site axe and overflow, defaults, theme, and Node examples. Each calls the default `buildSite()`, so they refuse until `dist` is the build of the source. After the rebuild, run `AXYLO_BROWSER=1 npx vitest run --config apps/docs/vitest.config.ts`, then `node apps/docs/build.mjs` to replace `apps/docs/dist`.

### One thing to look at

The spec's AX199 row now names "a formatter" among the author code it covers. AX160 also covers "a custom formatter that threw", and there the default format is used. The docs repeat the spec as written. Please say which code a throwing formatter raises, and when.

