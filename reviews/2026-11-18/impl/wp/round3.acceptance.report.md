<!-- Author: Claude Opus 5.5 (high), agent a61d95e46b3f0f3aa; saved by the coordinator -->

## A2 toolbar tests and checker exports for the docs: report (nothing committed)

Both tasks are done. The three A2 toolbar tests now pass, and five new Select range tests pass on Chrome, Firefox and WebKit. On the shared build the full Chrome acceptance run has one failure, the I1 donut test you said is the interaction author's; I did not touch it. All 30 checker tests pass, and the Markdown report is unchanged.

All runs used the shared build read-only (`axylo.iife.js` edcaca9b1a2982b7, unchanged before and after). The scratch directory `.scratch-a2/` is removed. The `src` and `test/core` changes in `git status` are other agents' work, not mine.

### 1. A2 toolbar tests and the new Select range control

**What changed:**
- `acceptance/a2-keyboard.browser.test.ts`: the expected toolbar order now matches the spec and the toolbar list in `apps/docs/pages/accessibility.md`.
  - line and area: North, South, Zoom in, **Select range**, Zoom out, View as table.
  - scatter: the same with EU and US.
  - bar (category axis) and donut are unchanged: they have no zoom.
  - The titles are built from that list, so the three titles changed with it.
- `acceptance/i1-pointer.browser.test.ts`: a new describe, "I4 and A2 Select range: the two-click range". It has one test for each type where a drag selects a range: line, area, bar on a number axis, bar on a date axis, and scatter. Each test checks that:
  - the toggle comes right after Zoom in;
  - it is named by its text, "Select range", with no `aria-label` or `aria-labelledby` overriding it;
  - `aria-pressed` starts false, and the toggle is at least 24 × 24 px (measured with `cssSize`);
  - from the keyboard it is the second tab stop, the arrow keys reach it, Enter and Space toggle `aria-pressed`, and Escape releases it;
  - while it is pressed, two clicks with no movement set the x range from 25 % to 50 % of the plot, within a fortieth of the range (the same tolerance as the drag test), and the toggle is then released;
  - after the first click nothing has zoomed yet.
- **Negative control inside each test:** the same two clicks with the toggle not pressed leave the range alone.
- **Mutation check:** I removed the second press of the toggle in a temporary copy of the test. The line test then failed with `expected 'false' to be 'true'`. The copy is deleted.
- `EVIDENCE.json` went from 555 to 560 entries: 3 titles renamed and 5 added, in run order.
- `tsc -p packages/axylo` shows no errors in the acceptance files.

**What I ran:**
- The changed and new tests, on each engine: `Tests 10 passed | 146 skipped (156)` on Chrome, Firefox and WebKit.
- Full acceptance suite on Chrome, shared build:
  - `Test Files 1 failed | 12 passed (13)`
  - `Tests 1 failed | 559 passed (560)`
  - `Duration 473.48s`
- The one failure is "I1 donut: the tooltip can itself be hovered (rule 3b) … Escape closes it" (`expected false to be true`). That is the hover-then-Escape test you assigned to the interaction author. `git diff` shows that my only change to `i1-pointer.browser.test.ts` is the 74 added lines.

### 2. Exports for the docs' conformance page

**`acceptance/check.mjs`**
- `export const STATUSES`: a frozen list `['pass', 'fail', 'weak', 'no evidence', 'not run', 'cannot be verified here', 'not applicable']`. A test checks that it equals the status table in `acceptance/README.md`.
- `export const CHART_TYPES`: a frozen list `['line', 'area', 'bar', 'scatter', 'donut', 'compact']`, in column order.
- `check()` now also returns **`rows`**, one per criterion in table order:
  ```
  { id, statement, cells: { <chart type>: {
      status,                 // one of STATUSES
      reasons: string[],      // why the cell is not run, e.g. "Not run on webkit: …", "No Chrome result"
      reports: [{
        file,                 // repository-relative path
        label,                // the name the Markdown table uses
        source,               // 'run' | 'size'
        results,              // sorted, from 'pass' | 'fail' | 'skipped'
        engine,               // 'chromium' | 'firefox' | 'webkit' | null (Node runs, and results older than the engine record)
        engineVersion,        // string | null
        provenanceError,      // string | null; non-null means release mode does not count it
      }],
  } } }
  ```
- It still returns `runs`; each entry has `file` (absolute), `passed`, `skipped`, `failures`, `provenance`, `engine`, `engineVersion` and `provenanceError`.
- It still returns `table`, `report`, `summary`, `counts` and `exitCode`. On the fixtures, the report and table are byte-identical to HEAD's checker, in 8 of 8 option combinations.

**`acceptance/provenance.mjs`** (`run.mjs` now imports the configurations from here and keeps no list of its own)
- `export const CONFIGURATIONS`: a frozen map from configuration name to its Vitest arguments.
- `export const CONFIGS`: `['unit', 'browser', 'dist', 'dist-browser']`.
- `export function resultFiles()` returns every default result file, as `{ config, engine, file }` (engine `null` means Node):
  - `unit` → `acceptance/results/unit.json`
  - `browser` → `browser.json` (chromium), `browser-firefox.json`, `browser-webkit.json`
  - `dist` → `dist.json`
  - `dist-browser` → `dist-browser.json` (chromium; that suite launches Chrome itself)
- Already there and unchanged: `ENGINES`, `engineLabel(engine, version)` and `defaultResultFile(name, engine)`.

**For the docs author**, `apps/docs/lib/conformance.mjs` can then drop three local copies:
- `CONFIGS` and `STATUSES`: import them instead.
- `parseCell` and `parseTable`: read `result.rows` instead.
- The browser-file regular expression in `readChecker`: take the engine from `resultFiles()` or from `reports[].engine`.

Their point 4 (results at docs build time) is unchanged: `acceptance/results/` is gitignored, and the files in `engines-7208470/` keep their non-default names.

**`readSize`:** the `packed.react` requirement is removed. The current `bench/size-latest.json` has only `packed.axylo`, so the old check refused the real artifact. The size test now uses a packed record with only `axylo`, and it also checks that a measurement without `packed.axylo` is still refused.

**Tests and docs:**
- `acceptance/test/check.test.mjs` has three new tests:
  - the structured rows match the table cell for cell, including reports with their engine and provenance error;
  - the exported status list equals the README's table;
  - the configurations and default result files come from `provenance.mjs`, and `run.mjs` uses them.
- `node --test acceptance/test/*.test.mjs`: `ℹ tests 30`, `ℹ pass 30`, `ℹ fail 0`.
- The README has a short new section, "Reading the checker from code".

### Not done
- The stale matrix is not re-merged (the React rows and old titles), as you asked.
- The full suite ran on Chrome only; on Firefox and WebKit I ran just the 10 changed and new tests.
- The port of the chart, a11y and render suites still waits for their rewrite.
- The I1 donut failure is left for the interaction author.

**Files changed:**
- `acceptance/README.md`, `acceptance/check.mjs`, `acceptance/provenance.mjs`, `acceptance/run.mjs`, `acceptance/test/check.test.mjs`
- `packages/axylo/test/browser/acceptance/a2-keyboard.browser.test.ts`, `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts`, `packages/axylo/test/browser/acceptance/EVIDENCE.json`
