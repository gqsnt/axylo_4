<!-- Author: Claude Opus 5.5 (high), agent a61d95e46b3f0f3aa; saved by the coordinator -->

## Follow-ups to e18c149: report (nothing committed)

All four items are done except for what is listed as not done at the end. Two of the failures you asked me to triage are tooling artefacts, two are engine differences the tests must allow for, and one is a small product defect.

**Your question about the refused hand-back.** It held the same facts as the SendMessage you received. The only difference was layout (a criterion table instead of a list).

**Where the runs happened.** Each run used an isolated copy in `.scratch-engines/` inside the project: HEAD e18c149, plus my test files, built there. Its dist (`axylo.iife.js` 3f81b87a95fe19aa) was unchanged before and after every run. The directory is now removed. A `.scratch-range2/` at the root is not mine; I left it alone.

### 1. The 24 × 24 measurement
- New helper `cssSize(locator)` in `acceptance/util.ts`. It reads the element's own `getBoundingClientRect()` in the page, on every engine.
- Its comment says why: Playwright's Firefox `boundingBox()` returns 23.99999237 for an element whose own rectangle is exactly 24.
- The limit is unchanged and no tolerance was added; 23.99 in the page still fails.
- Used by the two size checks in `i1-pointer.browser.test.ts`:
  - I1 "pinned rows … at least 24 × 24" (about line 235);
  - I4 `measure` (about line 729).
- Tests named "24 × 24" or "a hovered tooltip is text" (10 tests):

| Engine | Result |
|---|---|
| Firefox | `Tests 10 passed \| 101 skipped (111)` (were 3 failures) |
| WebKit | `Tests 10 passed \| 101 skipped (111)` |
| Chrome | `Tests 10 passed \| 101 skipped (111)` |

- Full Chrome acceptance run: `Test Files 13 passed (13)` / `Tests 555 passed (555)` / `Duration 453.78s`.
- `tsc -p packages/axylo` shows no errors in test/browser.

### 2. Triage of the non-CDP failures in the chart, a11y and render suites (read-only, test files not edited)

**Firefox, `chart/lifecycle` "height: auto … stable over 10 frames" (expected 2 to be 1): a small product defect.**
- It is intermittent: 1 failure in 6 runs of the whole file, and it passes alone.
- Instrumented in 25 runs: Firefox fires `document.fonts` `loadingdone` with `fontfaces.length === 0` about 80–100 ms after load.
- In 5 of the 25 runs that event came after `ready()`. The layout counter then went from 1 to 2 with identical sizes (probe 104.95×19.6, plot 405).
- Cause: `src/core/environment.ts:172-174` treats every `loadingdone` as a font change (`handlers.fonts()` → `invalidate.fonts()` → relayout), including an empty one.
- It breaks L3's test "`height: auto` container is stable over 10 frames". Nothing visible moves; a layout pass reruns.
- A fix would ignore a `loadingdone` with no font faces. That is for the controller's author.

**Firefox, `a11y/axe` "focus indicator … in forced colors" (`display: none`): an engine difference the test must allow for.**
- The ring is shown only when `.axylo-proxy:focus-visible` matches (`src/theme/css.ts:253`, `src/dom/interaction.ts:691`).
- The test clicks Zoom in with the mouse, then calls `page.focus(proxy)` and presses ArrowRight.
- After a mouse interaction, Firefox does not make `:focus-visible` match on a later arrow key; Chrome and WebKit do. Measured on a plain page and on the chart:
  - Firefox: ring `none` after "click, then focus()" and after "click the plot, then ArrowRight"; `block` after "click, then Shift+Tab to the plot".
  - Chrome: `block` in every case.
- Reaching the proxy by keyboard (Tab) would make the test engine-neutral.
- A question for the interaction author, not a spec breach: a Firefox user who clicks the plot and then uses the arrows sees no ring. A2 sets the ring's size and contrast, not when it shows.

**Firefox, `chart/review2` "under prefers-contrast: more a line swatch uses the dash" (`none`): confirmed as the emulateMedia artefact.**
- Same page, same chart:
  - `emulateMedia` after load gives `matchMedia` true and the swatch `none, none`.
  - The context option `{ contrast: 'more' }` gives `none, 6px 2.5px`.
- Chrome gives `6px, 2.5px` either way.
- The test would need the context option on Firefox, as I did in A5.

**WebKit, `render/review` DX8 CSP "style-src-elem inline": an engine difference (event timing).**
- The blocked element is `blank.html`'s own inline `<style>` (test page lines 6–9). Its violation reports source `:5:30` with target `#document`, not the library's script.
- Chrome and WebKit both block that style (body margin stays 8px).
- WebKit dispatches `securitypolicyviolation` late, after the test has attached its listener; Chrome dispatches it before, so Chrome passes without the event being seen.
- The library added no `<style>`. It adopted one constructed sheet (`adoptedStyleSheets` 1, `<style>` elements 1, the page's own).
- The test would need its listener attached before navigation (`addInitScript`) and the page's own `<style>` excluded, or a test page without inline style.

**WebKit, `render/review` "a patterned bar differs from a plain bar" (dots 0 > 150): patterns do draw on WebKit, in both renderers.**
- Diagonal (1232) and cross (2464) counts match Chrome exactly.
- Each dot draws as 2×2 pixels at exactly half coverage: distance from white 106, against Chrome's 52–57.
- The same holds on SVG and on canvas, so it is WebKit's anti-aliasing of a radius-1 dot centred on a pixel corner (`src/render/geometry.ts:91`: "dots of radius 1 on a 6 px grid at (3, 3)").
- The test counts pixels within 80 of white, which encodes Chrome's coverage. So this is an engine difference the test must allow for, not a missing cue.
- A5/F9 are not broken: dots stand 106 levels from the bar colour.
- Only a suggestion: a dot centred on a pixel centre, or a radius of 1.5, would make the cue independent of the engine.

**CDP uses that need `requireEngineFeature` once the rewrite lands (working tree):**
- `chart/lifecycle.browser.test.ts`, 4 uses:
  - line 314 `DOMDebugger.getEventListeners` ("after destroy() no listener is registered");
  - lines 343, 374 and 411 `HeapProfiler` / `Runtime.getHeapUsage` (the retained handle, the heap trend, and objects from cycle 300 to 1,000).
- `chart/interaction.browser.test.ts`, 2 uses: line 435 (tap, then a one-finger drag) and line 459 (pinch), both `Input.dispatchTouchEvent`.
- `chart/review2.browser.test.ts`, 1 use: the `ax()` helper at line 20 (accessibility tree), called by 3 tests.
- `chart/final-util.ts`, 1 use: `axButtons()` at line 85 (accessibility tree), used by `final-pin.browser.test.ts`.
- `chart/final-partials.browser.test.ts`, 1 use: line 147, pinch via `Input.dispatchTouchEvent`.
- `chart/final-range.browser.test.ts` (untracked), 1 use: line 203, "by pen" via `Input.dispatchMouseEvent` with `pointerType: pen`.
- `a11y/util.ts` `axNode`: already guarded.
- None of these has an engine-neutral Playwright equivalent that gives the same evidence.

### 3. Engine support in the acceptance runner and checker
- **`provenance.mjs`:**
  - New: `ENGINES`, `engineLabel()` (Chrome; Firefox (Playwright); WebKit (Playwright), not Safari), `declaredEngines()` (reads `meta.engine` / `meta.engineVersion`) and `defaultResultFile()`.
  - `snapshot` records `null` for a cited file that is missing, instead of crashing. The stale React citations made `run.mjs` throw ENOENT before Vitest started; the checker still reports those as matrix errors.
- **`run.mjs`:**
  - Validates `AXYLO_ENGINE` and accepts it only for the browser configuration.
  - Writes `browser.json`, `browser-firefox.json` or `browser-webkit.json`.
  - The sidecar records `engine` and `engineVersion`, taken from the results' meta.
  - Exits 1 if the results declare another engine or several versions.
- **`check.mjs`:**
  - Refuses a results file that mixes engines or versions, or whose sidecar disagrees.
  - Browser evidence takes an optional `engine` (default chromium; refused on Node evidence and for unknown engines). It is answered only by results of that engine, suite failures included.
  - A skipped test with `meta.notRun` is "not run" with its reason in the report; a missing engine shows "No <engine> result".
  - The runs list names each engine and version.
  - Results with no engine records predate the switch and count as Chrome. In a run on another engine, a test with no record counts for no engine and says so; the docs and dist suites launch Chrome themselves.
- **README:** new section "Browser engines".
- **Tests:** 7 new tests in `acceptance/test/check.test.mjs`; `node --test acceptance/test/*.test.mjs`: `ℹ tests 27`, `ℹ pass 27`, `ℹ fail 0`.
- **Mutation checks:** turning the engine filter off fails 2 tests; removing the mixed-engine refusal fails 1.
- **Shown on a small fixture** (F1/line cited for chromium, firefox and webkit; WebKit reports the touch reason):
  - The runs list showed "Chrome 157.0.8103.78", "Firefox (Playwright) 159.0" and "WebKit (Playwright), not Safari 27.2".
  - The cell showed `not run (browser.json pass, browser-firefox.json pass, browser-webkit.json skipped)`, with "Not run on webkit: multi-point and moving touch input …".
- **Runner smoke test:** `AXYLO_ENGINE=webkit node acceptance/run.mjs browser --output … f8-donut` gave 6 passed, 2 pending, 8 total, with the sidecar recording `engine: webkit, engineVersion: 27.2`. It also showed `changedDuringRun: true`, because other agents were editing the tree and my output sat in an untracked directory.
- **Invalid engines:** `AXYLO_ENGINE=webkit … dist` and `AXYLO_ENGINE=safari … browser` are both refused.
- I did not touch `matrix.json`. Run against the real per-engine results, the checker still stops at the matrix's stale citations (the removed React files, a dist title). That is the pending re-merge, not the engine code.

### 4. a6-a10 `selectRange`
Left alone.

### Not done
- No full Firefox or WebKit acceptance rerun on the new HEAD. Only the 10 size tests ran on those engines; the full suite ran on Chrome.
- The tests named in item 2 are not changed (not my files), and there are no product fixes (not mine).
- `matrix.json` is not re-merged and cites no engines yet.

**Files changed:** `acceptance/{README.md, check.mjs, provenance.mjs, run.mjs, test/check.test.mjs}`, `packages/axylo/test/browser/acceptance/{util.ts, i1-pointer.browser.test.ts}`.
