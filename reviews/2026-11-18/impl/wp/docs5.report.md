<!-- Author: Claude Opus 5.5, agent a04bfe28413f07034; saved by the coordinator -->

## Docs pass from the matrix review: report

All four items are done in 10 files under `apps/docs/`. The default build's revision guard refuses (other authors have uncommitted source), so I built with `--unchecked-library`, and the docs browser suite waits for your rebuild. Nothing is committed, the library was not rebuilt, and my scratch probes are removed.

### What changed

**1. `data/wcag.mjs`**
- My parser already reads only each row's last column, which for the C rows is their "Verified by" column, so it picks up the corrected citations unchanged. It now finds 25 cited criteria and 30 uncited.
- Reasons for the four criteria you named, all "not assessed":
  - 1.3.4 Orientation: responsive sizing is tested, but no test exercises a restriction to one orientation.
  - 2.1.4 Character Key Shortcuts: the zoom keys (+, - and 0) act only while the plot has focus, but no test establishes that protection.
  - 3.3.2 Labels or Instructions: the "Jump to" field has a label, but no test asserts it.
  - 2.5.2 Pointer Cancellation: one test cancels a drag in progress and checks the view is unchanged after release; no test covers the other pointer actions.
- I removed the reasons from 1.3.2 and 3.3.1, which are cited now, so no stale text is left for them.
- I re-read my other classes against the reviewer's remarks. The not-applicable and page-responsibility ones stay as they were, and so does 3.3.3 (not assessed), as the reviewer advised.
- The build and the unit test both fail if an uncited criterion has no reason.

**2. Per-row evidence caveat** (`lib/site.mjs`)
- Above the conformance table: "Evidence is recorded per row of the specification, not per criterion: the results and the tests listed under a criterion are those of the specification rows that cite it, and not every one of them bears on that criterion."
- I did not build a test-to-criterion mapping.

**3. Pause for streaming compact tiles**
- `conformance.md` ("What you must supply") and `accessibility.md` (a new bullet "A pause for streaming compact tiles") now say it. A compact chart fed by `append` has no Pause control, since it has no toolbar. A page that streams into compact tiles must give the reader its own control that stops appending, and appends what arrived meanwhile on resume (WCAG 2.2.2).
- `compact.md` has a new "Streaming" row saying the same.

**4. Stacks, written to spec F2, F5 and F10**
- `data.md`:
  - Outside a stack, a slot a series simply has no row for is no gap: its line is joined across it, and a bar chart draws no bar and no "no data" mark there.
  - New "In a stack" paragraph: a series with no value at an x, for any reason, including no row, is a missing part. The part has zero height, the line follows its band, and the total is marked "incomplete".
- `area.md`:
  - Stacking row points to the incomplete rule.
  - The edge-case section adds that the line follows its band, gives the weekly-beside-daily case, and advises aggregating to one step before stacking.
  - New example `examples/area-uneven.ts`: daily Web orders stacked with weekly Call centre orders.
- `bar.md`:
  - Missing values: a slot with no row gets no bar and no mark.
  - Stacking: a part is missing also when its series has no row there.
- New check `area-uneven` in `test/example-checks.ts`:
  - On 2 March the value text has Web 120, Call centre 300, Total 420 and no "incomplete".
  - On 3 March it has Web 125 and "Total 125 (incomplete)".
  - Both are derived from the example's data and F10.

### What I ran and saw (20:35 CET, HEAD 6772563)

- **`node apps/docs/build.mjs`** refuses:
  ```
  the installed axylo.css differs from the minified packages/axylo/src/theme/css.ts
  the installed axylo.dev.js differs from what packages/axylo/src builds to now
  ```
- **`node apps/docs/build.mjs --unchecked-library`**:
  ```
  built 18 pages (19062 words), 29 diagnostic pages and 47 examples in 709 ms, into …/apps/docs/.cache/unchecked-site
  NOT FOR PUBLISHING: built against a packed library that is not the build of its source (2 differences).
  ```
  The link and anchor check passed. The page says "The specification cites 25 of the 55", and the caveat is above the table.
- **`npx vitest run --config apps/docs/vitest.config.ts`**: `Test Files 5 passed (5)`, `Tests 241 passed (241)`.
- **`tsc -p apps/docs/.cache/consumer/tsconfig.json`** (strict type-check of all examples against the installed package): exit 0, no errors.
- **Probe in Chrome against the unchecked site (the shared build), removed afterwards.** `area-uneven` value text:
  - Home: "Mar 2, 2026. Web 120; Call centre 300; Total 420. Point 1 of 14"
  - Home, then Right: "Mar 3, 2026. Web 125; Call centre No observation; Total 125 (incomplete). Point 2 of 14"
  - No console errors.

  This was not the test suite.

### What waits

- **The whole docs browser suite** (172 tests with the new example) waits on your rebuild: every file calls the default `buildSite()`, which refuses while `dist` is not the build of the source. Then run `AXYLO_BROWSER=1 npx vitest run --config apps/docs/vitest.config.ts`, and `node apps/docs/build.mjs` to replace `apps/docs/dist`.
- **What only the stack code change will show**, which no docs check asserts:
  - In `area-uneven`, the Call centre line following its band down on the days between its rows. Today, per `wp/stack-no-row.report.md`, the stroke is still joined across those days while the band pinches to zero, so the live example shows a joined line until the change lands.
  - On stacked bars, no "no data" mark on a slot with no row. Today there is one.

  The `area-uneven` check itself does not wait: it asserts only the "incomplete" readout, which today's code already gives, as the probe shows.

