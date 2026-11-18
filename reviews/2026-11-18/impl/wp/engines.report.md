<!-- Author: Claude Opus 5.5 (high), agent a61d95e46b3f0f3aa; observed model in transcript: claude-opus-5-5; the last reports and messages of the run, saved by the coordinator -->

## SubagentHandback

## Engine switch: report (nothing committed)

### Files changed (only my own files)
- `packages/axylo/test/browser/harness.ts`
  - `AXYLO_ENGINE=chromium|firefox|webkit`. The default is chromium, launched exactly as before (`channel: 'chrome'`, headless). Firefox and WebKit are Playwright's own builds, headless.
  - Every test writes `meta.engine` and `meta.engineVersion` into the Vitest JSON (`assertionResults[].meta`). Titles are unchanged, so Chrome citations still match.
  - `requireEngineFeature(engines, reason)` reports a test as skipped and sets `meta.notRun` to "<engine>: <reason>". It is used instead of `it.skip`, and a test that calls it never passes silently.
  - The contexts opened by a test that reports itself not run are closed after it. Without this, 46 leaked pages made `a1-names`' afterAll time out on Firefox.
  - Firefox only: `browser.zoom.siteSpecific=false`. I3's Ctrl+wheel test lets Firefox zoom the page to 110 %, and Firefox kept that zoom for 127.0.0.1 in every later context. That broke the 16 I3/I4/I6 tests that followed it (seen in my first run, now gone).
  - Chrome never reaches any of these branches.
- `acceptance/util.ts`
  - `backendOf` (used by `axOf`/`axWithin`) is guarded with `AX_TREE_REASON`.
  - Off Chromium, `readRange` and `readTable` fall back to the DOM, labelled as DOM evidence.
  - New `TOUCH_INPUT_REASON`.
- `acceptance/i1-pointer.browser.test.ts`
  - The pinch test is guarded.
  - The I4 touch test runs every tap on all engines and is guarded only before the CDP one-finger drag.
  - The hovered-tooltip "no buttons" check uses visible DOM buttons off Chromium, because a `.catch` would have swallowed the skip.
- `acceptance/a5-not-colour-alone.browser.test.ts`: on Firefox the contrast preference is set on the context instead of `emulateMedia`. Playwright's Firefox flips `matchMedia` but does not re-evaluate an already loaded sheet; I reproduced that with a plain `<style>` page. The chart is created after the preference either way.
- `a11y/util.ts`: `axNode` is guarded.
- `chart/util.ts`: unchanged.
- `tests/firefox`: deleted.
- `tsc -p packages/axylo` is clean for test/browser.

### How to run
`npm run build`, then:
`AXYLO_ENGINE=firefox AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser/acceptance`
Use `webkit` for WebKit; leave the variable unset (or `chromium`) for Chrome.

### Build used (please note)
- During my runs the working tree did not build: `cssScale` is no longer exported from `dom/tooltip.ts` (fix passes in progress). Other agents also deleted and rebuilt `dist` mid-run. One WebKit run mixed builds and showed A8 `label-title-only` on every type; that failure did not reproduce on a stable build, so it is not a finding.
- The final runs used an isolated copy in my scratchpad: `git archive` of HEAD 7208470, plus my test files as of about 12:55, built there. Its dist hashes are byte-identical to the 618429e build; the only src change in between is a comment in contracts.ts. I recorded the dist hash before and after each run, and it was unchanged.
- While the shared dist was missing, I copied that HEAD build into `packages/axylo/dist` once; another agent's build has since replaced it.
- After my copy was taken, another agent edited `acceptance/a6-a10.browser.test.ts` (`selectRange` → line/area/scatter, about 13:16, after commit bbd7564). I did not run that change.

### Tests not run, per engine
- **Chrome:** 0.
- **Firefox and WebKit:** 161 each.
- **151 need the browser's own accessibility tree** (roles, names, descriptions, states), read through CDP. Playwright's aria snapshot is its own computation and has no descriptions, so it is not the same evidence. By criterion:
  - A1 47 (including the negative control)
  - F12 26
  - L7 12
  - A10 11
  - A4 10
  - L8 10
  - C1 9
  - T-reference 9
  - I6 5
  - I2 4
  - C5 3
  - F2 3
  - F8 2
- **10 need multi-point or moving touch through CDP:** the I3 pinch (5) and the I4 one-finger drag (5). The I4 taps ran first and passed.

### Firefox 159.0 (Playwright build): 385 passed, 9 failed, 161 not run (555)
Chrome passes all 9 failing tests (555 of 555 in the same build, below).

By criterion (pass/fail/not run):

| Criterion | Result | Criterion | Result |
|---|---|---|---|
| A2 | 41/0/0 | L1 | 22/0/0 |
| A4 | 22/0/10 | L2 | 12/0/0 |
| A5 | 36/1/0 | L3 | 15/0/0 |
| A6 | 10/0/0 | L4 | 24/0/0 |
| A7 | 10/0/0 | L5 | 2/0/0 |
| A8 | 12/1/0 | L6 | 9/0/0 |
| A10 | 1/0/11 | F9 | 1/0/0 |
| C2 | 12/0/0 | F10 | 2/0/0 |
| C3 | 3/0/0 | T-dense | 9/0/0 |
| C4 | 3/0/0 | T-keyboard | 5/0/0 |
| I1 | 41/5/0 | T-limit | 5/0/0 |
| I3 | 20/0/5 | T-pointer | 7/0/0 |
| I4 | 4/1/5 | T-tooltip | 5/1/0 |
| I5 | 24/0/0 | T-zoom | 5/0/0 |

The fully not-run criteria are listed in the section above.

By type, taken from the titles (pass/fail/not run): line 79/1/32, area 69/3/27, bar 79/1/28, scatter 57/4/26, donut 58/0/26, compact 43/0/22.

**Cause 1: integer pointer coordinates (6 failures on Firefox, the same 6 on WebKit).** Both engines deliver `clientX`/`clientY` truncated to whole CSS px (I checked a move to 336.96, 82.2667: Chrome reports it exactly, Firefox and WebKit report 336, 82). The suspected cause in src is `lookup/geometry.ts` `contains()`, used by `lookup/scatter-grid.ts:189` and `lookup/aligned.ts:99`: a pointer even 0.27 px outside the fractional plot rectangle picks nothing.
- **A5 scatter, A8 scatter ("pointer tooltip: the state was not entered"), T-tooltip-scatter.**
  - Spec 3.6: "Nearest point within 24 px."
  - The point is drawn on the plot's top edge (y 82.267). The pointer lands at y 82, 1 px from the point and 0.27 px above the plot, and no tooltip appears.
- **I1 line and I1 area sweep.**
  - I1: "Pointing anywhere in the plot shows what is there."
  - The first datum sits on the left edge (x 65.6). The pointer lands at 65 and nothing is shown; at 66 the datum is shown.
- **I1 bar, rule 3b:** "step 2: rows changed to Plan50 t / Actual52 t".
  - Decision 0004: the datum "is held while the pointer stays inside the corridor … the convex hull of the point and the rectangle".
  - The truncated path (398,226) → (399,226) leaves the hull by about 0.01 px, picking resumes, and the next band is shown.
  - Suspected cause: `insideHull` in `dom/interaction.ts` has no tolerance for whole-pixel pointers. The rest point is also on a band boundary.

**Cause 2: measurement precision (3 failures, Firefox only).**
- **I1 area pinned rows, I1 scatter pinned rows, I4 area:** for example "North11 kWh: 113.3×24.0".
- I4: "Every control is at least 24×24 CSS px."
- Playwright's Firefox `boundingBox()` returns a height of 23.99999237. The element's own `getBoundingClientRect` height, `offsetHeight` and computed height are exactly 24 (`min-height: 24px` in `theme/css.ts:201`).
- So this is the measuring tool, not a product defect. I left the tests failing. If you want, the measurement could be changed (`getBoundingClientRect` in the page, or a 1/1000 px tolerance), but that is your decision.

### WebKit 27.2 (Playwright's WPE MiniBrowser): 384 passed, 10 failed, 161 not run (555)
This is the WebKit engine, not Safari; please label it so in any evidence.

By criterion, the same as Firefox except:
- I1 43/3/0
- I4 5/0/5
- L1 18/4/0

By type: line 78/2/32, area 70/2/27, bar 78/2/28, scatter 57/4/26, donut 58/0/26, compact 43/0/22.

Failures:
- The same 6 integer-pointer failures as Firefox. The precision artefact does not occur on WebKit.
- **L1 line, area, bar and scatter, late font.**
  - L1: "No visible text overlaps other text or is clipped", checked after fonts load.
  - WebKit shows overlaps such as "14,000" × "Sessions" and "1,300" × "Latency (ms)", plus clipped "1M" and "Cust…ing".
  - Cause, reproduced: WebKit's canvas 2D context keeps the font it resolved when `ctx.font` was assigned. Assigning the same string again does not re-resolve it (`measureText` stays 89.03 instead of 109.59). Chrome and Firefox re-resolve.
  - Suspected cause in src: `core/environment.ts` `createMeasurer` reuses one context per document and sets `c.font` only when the string differs, so measurements stay stale after a late font, even though the cache key includes the font epoch.

### Last lines of each acceptance run (all on the same build)
- **Firefox:** `Test Files 4 failed | 9 passed (13)` / `Tests 9 failed | 385 passed | 161 skipped (555)` / `Duration 618.99s`
- **WebKit:** `Test Files 5 failed | 8 passed (13)` / `Tests 10 failed | 384 passed | 161 skipped (555)` / `Duration 600.60s`
- **Chrome rerun, final harness:** `Test Files 13 passed (13)` / `Tests 555 passed (555)` / `Duration 458.45s`. The JSON says `engine chromium/157.0.8103.78`.

### chart, a11y and render suites (the other author's tests, not ported), 280 tests each
- **Firefox:** 266 passed, 11 failed, 3 skipped.
  - chart 158/10/0, a11y 22/1/2, render 86/0/1.
  - 7 failures are `newCDPSession` ("only available in Chromium"), in lifecycle ×4, interaction ×2 and review2 ×1.
  - The other 4 are lifecycle "height: auto … stable" (expected 2 to be 1), review2 "prefers-contrast swatch dash" (the same emulateMedia artefact), review2 "a slider named by plotLabel" (CDP), and a11y forced-colors focus indicator (`display: none`).
- **WebKit:** 267 passed, 10 failed, 3 skipped.
  - chart 160/8/0, a11y 23/0/2, render 84/2/1.
  - 8 failures are CDP.
  - The 2 render failures are a CSP "style-src-elem inline" finding and "a patterned bar differs from a plain bar" (expected 0 to be greater than 150).
- The skips: 2 are `axNode` (my guard); 1 is `render/timing` and is skipped in its own source.
- I did not triage these; counts and first-line messages only.

### What the matrix needs (I only read `acceptance/run.mjs` and `check.mjs`)
- `run.mjs` already passes the environment through, so `AXYLO_ENGINE=firefox node acceptance/run.mjs browser --output acceptance/results/browser-firefox.json` works. Its provenance sidecar should record `AXYLO_ENGINE` and the engine version, which it can take from the results' `meta`.
- `check.mjs` joins on file, title, ancestorTitles and status only. To cite an engine it must:
  - read `assertionResults[].meta.engine` and `meta.engineVersion`, and refuse a results file whose tests mix engines;
  - report a skipped test that has `meta.notRun` as "not run" with that reason;
  - give each evidence entry or cell an `engine` field (default chromium), so a cell names Chrome 157, Firefox 159 or WebKit 27.2 — the last labelled "WebKit (Playwright), not Safari";
  - never let one engine's pass stand for another's.

### Snap Firefox 160 note (the cancelled WebDriver package)
- geckodriver's POST /session needs `content-type: application/json`.
- It accepts one session at a time ("Session is already started").
- A snap-confined geckodriver cannot be killed from this shell (AppArmor label claude-desktop). `systemctl --user stop <snap.firefox.geckodriver-…scope>`, with the scope read from `/proc/<pid>/cgroup`, works.
- Before cancellation, render passed 8/8 and legibility 36/38; the 2 failures were second-session errors.
- The owner's own Firefox (pid 7845) was left alone.

### Housekeeping
- I stopped only processes I started, by PID, after checking each one's command line.
- The final results are in `/tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/` as `{ff,wk,cr}-acc.{json,txt,hash}` and `{ff,wk}-other.{json,txt,hash}`. That is tmpfs, so copy them if you want them kept.
- The isolated tree and probes are deleted.
- No contract change needed.

---

## SendMessage

Engine switch report: the Firefox and WebKit acceptance runs are done. Chrome passes all 555 on the same build. Nothing is committed.

FILES CHANGED (only my own files)
- packages/axylo/test/browser/harness.ts
  - AXYLO_ENGINE=chromium|firefox|webkit. The default is chromium, launched exactly as before (channel 'chrome', headless). Firefox and WebKit are Playwright's own builds, headless.
  - Every test writes meta.engine and meta.engineVersion into the Vitest JSON (assertionResults[].meta). Titles are unchanged, so Chrome citations still match.
  - requireEngineFeature(engines, reason) reports a test as skipped and sets meta.notRun to "<engine>: <reason>". It is used instead of it.skip, and a test that calls it never passes silently.
  - The contexts opened by a test that reports itself not run are closed after it. Without this, 46 leaked pages made a1-names' afterAll time out on Firefox.
  - Firefox only: browser.zoom.siteSpecific=false. I3's Ctrl+wheel test lets Firefox zoom the page to 110 %, and Firefox kept that zoom for 127.0.0.1 in every later context. That broke the 16 I3/I4/I6 tests that followed it (seen in my first run, now gone).
  - Chrome never reaches any of these branches.
- acceptance/util.ts
  - backendOf (used by axOf/axWithin) is guarded with AX_TREE_REASON.
  - Off Chromium, readRange and readTable fall back to the DOM, labelled as DOM evidence.
  - New TOUCH_INPUT_REASON.
- acceptance/i1-pointer.browser.test.ts
  - The pinch test is guarded.
  - The I4 touch test runs every tap on all engines and is guarded only before the CDP one-finger drag.
  - The hovered-tooltip "no buttons" check uses visible DOM buttons off Chromium, because a .catch would have swallowed the skip.
- acceptance/a5-not-colour-alone.browser.test.ts: on Firefox the contrast preference is set on the context instead of emulateMedia. Playwright's Firefox flips matchMedia but does not re-evaluate an already loaded sheet; I reproduced that with a plain <style> page. The chart is created after the preference either way.
- a11y/util.ts: axNode is guarded.
- chart/util.ts: unchanged.
- tests/firefox: deleted.
- tsc -p packages/axylo is clean for test/browser.

HOW TO RUN
npm run build, then:
AXYLO_ENGINE=firefox AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser/acceptance
Use webkit for WebKit; leave the variable unset (or chromium) for Chrome.

BUILD USED (please note)
- During my runs the working tree did not build: cssScale is no longer exported from dom/tooltip.ts (fix passes in progress). Other agents also deleted and rebuilt dist mid-run. One WebKit run mixed builds and showed A8 label-title-only on every type; that failure did not reproduce on a stable build, so it is not a finding.
- The final runs used an isolated copy in my scratchpad: git archive of HEAD 7208470, plus my test files as of about 12:55, built there. Its dist hashes are byte-identical to the 618429e build; the only src change in between is a comment in contracts.ts. I recorded the dist hash before and after each run, and it was unchanged.
- While the shared dist was missing, I copied that HEAD build into packages/axylo/dist once; another agent's build has since replaced it.
- After my copy was taken, another agent edited acceptance/a6-a10.browser.test.ts (selectRange -> line/area/scatter, about 13:16, after commit bbd7564). I did not run that change.

TESTS NOT RUN, PER ENGINE
- Chrome: 0.
- Firefox and WebKit: 161 each.
- 151 need the browser's own accessibility tree (roles, names, descriptions, states), read through CDP. Playwright's aria snapshot is its own computation and has no descriptions, so it is not the same evidence. By criterion: A1 47 (including the negative control), F12 26, L7 12, A10 11, A4 10, L8 10, C1 9, T-reference 9, I6 5, I2 4, C5 3, F2 3, F8 2.
- 10 need multi-point or moving touch through CDP: the I3 pinch (5) and the I4 one-finger drag (5). The I4 taps ran first and passed.

FIREFOX 159.0 (Playwright build): 385 passed, 9 failed, 161 not run (555)
Chrome passes all 9 failing tests (555 of 555 in the same build, below).
By criterion (pass/fail/not run):
- A2 41/0/0, A4 22/0/10, A5 36/1/0, A6 10/0/0, A7 10/0/0, A8 12/1/0, A10 1/0/11
- C2 12/0/0, C3 3/0/0, C4 3/0/0
- I1 41/5/0, I3 20/0/5, I4 4/1/5, I5 24/0/0
- L1 22/0/0, L2 12/0/0, L3 15/0/0, L4 24/0/0, L5 2/0/0, L6 9/0/0
- F9 1/0/0, F10 2/0/0
- T-dense 9/0/0, T-keyboard 5/0/0, T-limit 5/0/0, T-pointer 7/0/0, T-tooltip 5/1/0, T-zoom 5/0/0
- The fully not-run criteria are listed above.
By type, taken from the titles (pass/fail/not run): line 79/1/32, area 69/3/27, bar 79/1/28, scatter 57/4/26, donut 58/0/26, compact 43/0/22.

Cause 1: integer pointer coordinates (6 failures on Firefox, the same 6 on WebKit).
Both engines deliver clientX/clientY truncated to whole CSS px (I checked a move to 336.96, 82.2667: Chrome reports it exactly, Firefox and WebKit report 336, 82). The suspected cause in src is lookup/geometry.ts contains(), used by lookup/scatter-grid.ts:189 and lookup/aligned.ts:99: a pointer even 0.27 px outside the fractional plot rectangle picks nothing.
- A5 scatter, A8 scatter ("pointer tooltip: the state was not entered"), T-tooltip-scatter.
  - Spec 3.6: "Nearest point within 24 px."
  - The point is drawn on the plot's top edge (y 82.267). The pointer lands at y 82, 1 px from the point and 0.27 px above the plot, and no tooltip appears.
- I1 line and I1 area sweep.
  - I1: "Pointing anywhere in the plot shows what is there."
  - The first datum sits on the left edge (x 65.6). The pointer lands at 65 and nothing is shown; at 66 the datum is shown.
- I1 bar, rule 3b: "step 2: rows changed to Plan50 t / Actual52 t".
  - Decision 0004: the datum "is held while the pointer stays inside the corridor ... the convex hull of the point and the rectangle".
  - The truncated path (398,226) -> (399,226) leaves the hull by about 0.01 px, picking resumes, and the next band is shown.
  - Suspected cause: insideHull in dom/interaction.ts has no tolerance for whole-pixel pointers. The rest point is also on a band boundary.

Cause 2: measurement precision (3 failures, Firefox only).
- I1 area pinned rows, I1 scatter pinned rows, I4 area: for example "North11 kWh: 113.3x24.0".
- I4: "Every control is at least 24x24 CSS px."
- Playwright's Firefox boundingBox() returns a height of 23.99999237. The element's own getBoundingClientRect height, offsetHeight and computed height are exactly 24 (min-height: 24px in theme/css.ts:201).
- So this is the measuring tool, not a product defect. I left the tests failing. If you want, the measurement could be changed (getBoundingClientRect in the page, or a 1/1000 px tolerance), but that is your decision.

WEBKIT 27.2 (Playwright's WPE MiniBrowser): 384 passed, 10 failed, 161 not run (555)
This is the WebKit engine, not Safari; please label it so in any evidence.
By criterion, the same as Firefox except: I1 43/3/0, I4 5/0/5, L1 18/4/0.
By type: line 78/2/32, area 70/2/27, bar 78/2/28, scatter 57/4/26, donut 58/0/26, compact 43/0/22.
Failures:
- The same 6 integer-pointer failures as Firefox. The precision artefact does not occur on WebKit.
- L1 line, area, bar and scatter, late font.
  - L1: "No visible text overlaps other text or is clipped", checked after fonts load.
  - WebKit shows overlaps such as "14,000" x "Sessions" and "1,300" x "Latency (ms)", plus clipped "1M" and "Cust...ing".
  - Cause, reproduced: WebKit's canvas 2D context keeps the font it resolved when ctx.font was assigned. Assigning the same string again does not re-resolve it (measureText stays 89.03 instead of 109.59). Chrome and Firefox re-resolve.
  - Suspected cause in src: core/environment.ts createMeasurer reuses one context per document and sets c.font only when the string differs, so measurements stay stale after a late font, even though the cache key includes the font epoch.

LAST LINES OF EACH ACCEPTANCE RUN (all on the same build)
- Firefox: Test Files 4 failed | 9 passed (13) / Tests 9 failed | 385 passed | 161 skipped (555) / Duration 618.99s
- WebKit: Test Files 5 failed | 8 passed (13) / Tests 10 failed | 384 passed | 161 skipped (555) / Duration 600.60s
- Chrome rerun, final harness: Test Files 13 passed (13) / Tests 555 passed (555) / Duration 458.45s. The JSON says engine chromium/157.0.8103.78.

CHART, A11Y AND RENDER SUITES (the other author's tests, not ported), 280 tests each
- Firefox: 266 passed, 11 failed, 3 skipped.
  - chart 158/10/0, a11y 22/1/2, render 86/0/1.
  - 7 failures are newCDPSession ("only available in Chromium"), in lifecycle x4, interaction x2 and review2 x1.
  - The other 4 are lifecycle "height: auto ... stable" (expected 2 to be 1), review2 "prefers-contrast swatch dash" (the same emulateMedia artefact), review2 "a slider named by plotLabel" (CDP), and a11y forced-colors focus indicator (display: none).
- WebKit: 267 passed, 10 failed, 3 skipped.
  - chart 160/8/0, a11y 23/0/2, render 84/2/1.
  - 8 failures are CDP.
  - The 2 render failures are a CSP "style-src-elem inline" finding and "a patterned bar differs from a plain bar" (expected 0 to be greater than 150).
- The skips: 2 are axNode (my guard); 1 is render/timing and is skipped in its own source.
- I did not triage these; counts and first-line messages only.

WHAT THE MATRIX NEEDS (I only read acceptance/run.mjs and check.mjs)
- run.mjs already passes the environment through, so AXYLO_ENGINE=firefox node acceptance/run.mjs browser --output acceptance/results/browser-firefox.json works. Its provenance sidecar should record AXYLO_ENGINE and the engine version, which it can take from the results' meta.
- check.mjs joins on file, title, ancestorTitles and status only. To cite an engine it must:
  - read assertionResults[].meta.engine and meta.engineVersion, and refuse a results file whose tests mix engines;
  - report a skipped test that has meta.notRun as "not run" with that reason;
  - give each evidence entry or cell an engine field (default chromium), so a cell names Chrome 157, Firefox 159 or WebKit 27.2 — the last labelled "WebKit (Playwright), not Safari";
  - never let one engine's pass stand for another's.

SNAP FIREFOX 160 NOTE (the cancelled WebDriver package)
- geckodriver's POST /session needs content-type: application/json.
- It accepts one session at a time ("Session is already started").
- A snap-confined geckodriver cannot be killed from this shell (AppArmor label claude-desktop). systemctl --user stop <snap.firefox.geckodriver-...scope>, with the scope read from /proc/<pid>/cgroup, works.
- Before cancellation, render passed 8/8 and legibility 36/38; the 2 failures were second-session errors.
- The owner's own Firefox (pid 7845) was left alone.

HOUSEKEEPING
- I stopped only processes I started, by PID, after checking each one's command line.
- The final results are in /tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/ as {ff,wk,cr}-acc.{json,txt,hash} and {ff,wk}-other.{json,txt,hash}. That is tmpfs, so copy them if you want them kept.
- The isolated tree and probes are deleted.
- No contract change needed.

---

## SendMessage

Engine switch report: the Firefox and WebKit acceptance runs are done. Chrome passes all 555 on the same build. Nothing is committed.

FILES CHANGED (only my own files)
- packages/axylo/test/browser/harness.ts
  - AXYLO_ENGINE=chromium|firefox|webkit. The default is chromium, launched exactly as before (channel 'chrome', headless). Firefox and WebKit are Playwright's own builds, headless.
  - Every test writes meta.engine and meta.engineVersion into the Vitest JSON (assertionResults[].meta). Titles are unchanged, so Chrome citations still match.
  - requireEngineFeature(engines, reason) reports a test as skipped and sets meta.notRun to "<engine>: <reason>". It is used instead of it.skip, and a test that calls it never passes silently.
  - The contexts opened by a test that reports itself not run are closed after it. Without this, 46 leaked pages made a1-names' afterAll time out on Firefox.
  - Firefox only: browser.zoom.siteSpecific=false. I3's Ctrl+wheel test lets Firefox zoom the page to 110 %, and Firefox kept that zoom for 127.0.0.1 in every later context. That broke the 16 I3/I4/I6 tests that followed it (seen in my first run, now gone).
  - Chrome never reaches any of these branches.
- acceptance/util.ts
  - backendOf (used by axOf/axWithin) is guarded with AX_TREE_REASON.
  - Off Chromium, readRange and readTable fall back to the DOM, labelled as DOM evidence.
  - New TOUCH_INPUT_REASON.
- acceptance/i1-pointer.browser.test.ts
  - The pinch test is guarded.
  - The I4 touch test runs every tap on all engines and is guarded only before the CDP one-finger drag.
  - The hovered-tooltip "no buttons" check uses visible DOM buttons off Chromium, because a .catch would have swallowed the skip.
- acceptance/a5-not-colour-alone.browser.test.ts: on Firefox the contrast preference is set on the context instead of emulateMedia. Playwright's Firefox flips matchMedia but does not re-evaluate an already loaded sheet; I reproduced that with a plain <style> page. The chart is created after the preference either way.
- a11y/util.ts: axNode is guarded.
- chart/util.ts: unchanged.
- tests/firefox: deleted.
- tsc -p packages/axylo is clean for test/browser.

HOW TO RUN
npm run build, then:
AXYLO_ENGINE=firefox AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser/acceptance
Use webkit for WebKit; leave the variable unset (or chromium) for Chrome.

BUILD USED (please note)
- During my runs the working tree did not build: cssScale is no longer exported from dom/tooltip.ts (fix passes in progress). Other agents also deleted and rebuilt dist mid-run. One WebKit run mixed builds and showed A8 label-title-only on every type; that failure did not reproduce on a stable build, so it is not a finding.
- The final runs used an isolated copy in my scratchpad: git archive of HEAD 7208470, plus my test files as of about 12:55, built there. Its dist hashes are byte-identical to the 618429e build; the only src change in between is a comment in contracts.ts. I recorded the dist hash before and after each run, and it was unchanged.
- While the shared dist was missing, I copied that HEAD build into packages/axylo/dist once; another agent's build has since replaced it.
- After my copy was taken, another agent edited acceptance/a6-a10.browser.test.ts (selectRange -> line/area/scatter, about 13:16, after commit bbd7564). I did not run that change.

TESTS NOT RUN, PER ENGINE
- Chrome: 0.
- Firefox and WebKit: 161 each.
- 151 need the browser's own accessibility tree (roles, names, descriptions, states), read through CDP. Playwright's aria snapshot is its own computation and has no descriptions, so it is not the same evidence. By criterion: A1 47 (including the negative control), F12 26, L7 12, A10 11, A4 10, L8 10, C1 9, T-reference 9, I6 5, I2 4, C5 3, F2 3, F8 2.
- 10 need multi-point or moving touch through CDP: the I3 pinch (5) and the I4 one-finger drag (5). The I4 taps ran first and passed.

FIREFOX 159.0 (Playwright build): 385 passed, 9 failed, 161 not run (555)
Chrome passes all 9 failing tests (555 of 555 in the same build, below).
By criterion (pass/fail/not run):
- A2 41/0/0, A4 22/0/10, A5 36/1/0, A6 10/0/0, A7 10/0/0, A8 12/1/0, A10 1/0/11
- C2 12/0/0, C3 3/0/0, C4 3/0/0
- I1 41/5/0, I3 20/0/5, I4 4/1/5, I5 24/0/0
- L1 22/0/0, L2 12/0/0, L3 15/0/0, L4 24/0/0, L5 2/0/0, L6 9/0/0
- F9 1/0/0, F10 2/0/0
- T-dense 9/0/0, T-keyboard 5/0/0, T-limit 5/0/0, T-pointer 7/0/0, T-tooltip 5/1/0, T-zoom 5/0/0
- The fully not-run criteria are listed above.
By type, taken from the titles (pass/fail/not run): line 79/1/32, area 69/3/27, bar 79/1/28, scatter 57/4/26, donut 58/0/26, compact 43/0/22.

Cause 1: integer pointer coordinates (6 failures on Firefox, the same 6 on WebKit).
Both engines deliver clientX/clientY truncated to whole CSS px (I checked a move to 336.96, 82.2667: Chrome reports it exactly, Firefox and WebKit report 336, 82). The suspected cause in src is lookup/geometry.ts contains(), used by lookup/scatter-grid.ts:189 and lookup/aligned.ts:99: a pointer even 0.27 px outside the fractional plot rectangle picks nothing.
- A5 scatter, A8 scatter ("pointer tooltip: the state was not entered"), T-tooltip-scatter.
  - Spec 3.6: "Nearest point within 24 px."
  - The point is drawn on the plot's top edge (y 82.267). The pointer lands at y 82, 1 px from the point and 0.27 px above the plot, and no tooltip appears.
- I1 line and I1 area sweep.
  - I1: "Pointing anywhere in the plot shows what is there."
  - The first datum sits on the left edge (x 65.6). The pointer lands at 65 and nothing is shown; at 66 the datum is shown.
- I1 bar, rule 3b: "step 2: rows changed to Plan50 t / Actual52 t".
  - Decision 0004: the datum "is held while the pointer stays inside the corridor ... the convex hull of the point and the rectangle".
  - The truncated path (398,226) -> (399,226) leaves the hull by about 0.01 px, picking resumes, and the next band is shown.
  - Suspected cause: insideHull in dom/interaction.ts has no tolerance for whole-pixel pointers. The rest point is also on a band boundary.

Cause 2: measurement precision (3 failures, Firefox only).
- I1 area pinned rows, I1 scatter pinned rows, I4 area: for example "North11 kWh: 113.3x24.0".
- I4: "Every control is at least 24x24 CSS px."
- Playwright's Firefox boundingBox() returns a height of 23.99999237. The element's own getBoundingClientRect height, offsetHeight and computed height are exactly 24 (min-height: 24px in theme/css.ts:201).
- So this is the measuring tool, not a product defect. I left the tests failing. If you want, the measurement could be changed (getBoundingClientRect in the page, or a 1/1000 px tolerance), but that is your decision.

WEBKIT 27.2 (Playwright's WPE MiniBrowser): 384 passed, 10 failed, 161 not run (555)
This is the WebKit engine, not Safari; please label it so in any evidence.
By criterion, the same as Firefox except: I1 43/3/0, I4 5/0/5, L1 18/4/0.
By type: line 78/2/32, area 70/2/27, bar 78/2/28, scatter 57/4/26, donut 58/0/26, compact 43/0/22.
Failures:
- The same 6 integer-pointer failures as Firefox. The precision artefact does not occur on WebKit.
- L1 line, area, bar and scatter, late font.
  - L1: "No visible text overlaps other text or is clipped", checked after fonts load.
  - WebKit shows overlaps such as "14,000" x "Sessions" and "1,300" x "Latency (ms)", plus clipped "1M" and "Cust...ing".
  - Cause, reproduced: WebKit's canvas 2D context keeps the font it resolved when ctx.font was assigned. Assigning the same string again does not re-resolve it (measureText stays 89.03 instead of 109.59). Chrome and Firefox re-resolve.
  - Suspected cause in src: core/environment.ts createMeasurer reuses one context per document and sets c.font only when the string differs, so measurements stay stale after a late font, even though the cache key includes the font epoch.

LAST LINES OF EACH ACCEPTANCE RUN (all on the same build)
- Firefox: Test Files 4 failed | 9 passed (13) / Tests 9 failed | 385 passed | 161 skipped (555) / Duration 618.99s
- WebKit: Test Files 5 failed | 8 passed (13) / Tests 10 failed | 384 passed | 161 skipped (555) / Duration 600.60s
- Chrome rerun, final harness: Test Files 13 passed (13) / Tests 555 passed (555) / Duration 458.45s. The JSON says engine chromium/157.0.8103.78.

CHART, A11Y AND RENDER SUITES (the other author's tests, not ported), 280 tests each
- Firefox: 266 passed, 11 failed, 3 skipped.
  - chart 158/10/0, a11y 22/1/2, render 86/0/1.
  - 7 failures are newCDPSession ("only available in Chromium"), in lifecycle x4, interaction x2 and review2 x1.
  - The other 4 are lifecycle "height: auto ... stable" (expected 2 to be 1), review2 "prefers-contrast swatch dash" (the same emulateMedia artefact), review2 "a slider named by plotLabel" (CDP), and a11y forced-colors focus indicator (display: none).
- WebKit: 267 passed, 10 failed, 3 skipped.
  - chart 160/8/0, a11y 23/0/2, render 84/2/1.
  - 8 failures are CDP.
  - The 2 render failures are a CSP "style-src-elem inline" finding and "a patterned bar differs from a plain bar" (expected 0 to be greater than 150).
- The skips: 2 are axNode (my guard); 1 is render/timing and is skipped in its own source.
- I did not triage these; counts and first-line messages only.

WHAT THE MATRIX NEEDS (I only read acceptance/run.mjs and check.mjs)
- run.mjs already passes the environment through, so AXYLO_ENGINE=firefox node acceptance/run.mjs browser --output acceptance/results/browser-firefox.json works. Its provenance sidecar should record AXYLO_ENGINE and the engine version, which it can take from the results' meta.
- check.mjs joins on file, title, ancestorTitles and status only. To cite an engine it must:
  - read assertionResults[].meta.engine and meta.engineVersion, and refuse a results file whose tests mix engines;
  - report a skipped test that has meta.notRun as "not run" with that reason;
  - give each evidence entry or cell an engine field (default chromium), so a cell names Chrome 157, Firefox 159 or WebKit 27.2 — the last labelled "WebKit (Playwright), not Safari";
  - never let one engine's pass stand for another's.

SNAP FIREFOX 160 NOTE (the cancelled WebDriver package)
- geckodriver's POST /session needs content-type: application/json.
- It accepts one session at a time ("Session is already started").
- A snap-confined geckodriver cannot be killed from this shell (AppArmor label claude-desktop). systemctl --user stop <snap.firefox.geckodriver-...scope>, with the scope read from /proc/<pid>/cgroup, works.
- Before cancellation, render passed 8/8 and legibility 36/38; the 2 failures were second-session errors.
- The owner's own Firefox (pid 7845) was left alone.

HOUSEKEEPING
- I stopped only processes I started, by PID, after checking each one's command line.
- The final results are in /tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/ as {ff,wk,cr}-acc.{json,txt,hash} and {ff,wk}-other.{json,txt,hash}. That is tmpfs, so copy them if you want them kept.
- The isolated tree and probes are deleted.
- No contract change needed.
