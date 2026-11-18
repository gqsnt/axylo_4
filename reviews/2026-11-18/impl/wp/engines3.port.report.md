<!-- Author: Claude Opus 5.5 (high), agent a61d95e46b3f0f3aa; saved by the coordinator -->

## Port of the chart, a11y and render suites: report (nothing committed)

Every browser suite now passes on Firefox and WebKit, with no failures. Every test that is not run reports why. The Chrome counts are the same as before the port.

All runs used the shared build, read-only (`axylo.iife.js` ea61b79869f18f27, unchanged before and after). Results and logs are in `acceptance/results/engines-d33df71/`. Chrome has updated itself to 158.0.8127.36 since earlier runs.

### Changes per file
- **`chart/lifecycle.browser.test.ts`**: `requireEngineFeature` at the start of 4 tests:
  - "after destroy() no listener is registered…": `DOMDebugger.getEventListeners`;
  - "a destroyed handle … retains neither…": `HeapProfiler` heap snapshot;
  - "create–destroy cycles show no upward heap trend…" and "objects other than compiled code do not grow…": `HeapProfiler` and `Runtime.getHeapUsage`.
- **`chart/interaction.browser.test.ts`**:
  - "a tap pins the tooltip … one-finger vertical drag…": the taps run on every engine; the guard sits just before the CDP drag, as in acceptance I4.
  - The `zoom: 'touch'` pinch test: guarded at its start.
- **`chart/review2.browser.test.ts`**:
  - The `ax()` helper is guarded (it serves 2 tests).
  - "under prefers-contrast: more a line swatch uses the dash its line uses": on Firefox the preference is set on the context, before the page loads. Elsewhere it still uses `emulateMedia`, so Chrome is unchanged.
- **`chart/final-util.ts`**: `axButtons()` is guarded.
- **`render/review.browser.test.ts`**:
  - **DX8 CSP test:**
    - The violation listener is attached before navigation, with `addInitScript`.
    - The test page's own inline `<style>` is removed from the served page. The policy blocked it anyway, so the page renders the same, and the test checks that no `<style>` is left.
    - The violation check now comes before the screenshot. A new finding: in Playwright's WebKit, every screenshot inserts a `<style>`, which the policy blocks. I checked this on a page without the library: one violation per screenshot, with any screenshot options. Firefox and Chrome add none.
  - **"a patterned bar differs from a plain bar":**
    - Pixels now count when they differ from the plain bar's own colour by more than 64/255, instead of when they are within 80 of white. That is what F9 needs, and it no longer encodes Chrome's anti-aliasing.
    - A new check: the plain bar is painted (more than 64 from white).
    - The rest is unchanged: thresholds 800 / 1.4× / 150, patterns inside their bars, the renderers agreeing.
    - Measured on every engine and both renderers: diagonal 1232 pixels, cross 2464, dots 1200.
    - Largest distance from the plain colour:

      | Engine | Lines | Dots, canvas | Dots, SVG |
      |---|---|---|---|
      | Chrome | 212 | 160 | 159 |
      | Firefox | 212 | 176 | 174 |
      | WebKit | 212 | 106 | 106 |

**Guards the authors had already added**, and which match mine (consistent): `final-partials` (multi-point touch), `final-round3` (multi-point touch), `final-range` (pen via `Input.dispatchMouseEvent`), `final-pin` (accessibility tree) and `a11y/util.ts` `axNode`. `late-font`, `loadingdone`, `reattach` and `scale` use no Chrome-only tooling.

**Left unchanged on purpose:** the a11y forced-colors focus test (`page.focus()` then ArrowRight). It passes on all three engines now that the ring follows keyboard use, and it still tests keyboard use after a programmatic focus. Switching it to Tab would have tested less.

No assertion was weakened; the pattern metric is the change you asked for. `tsc -p packages/axylo` shows no errors in test/browser.

### Counts (passed / failed / not run)

| Suite | Chrome 158 | Firefox 159 | WebKit 27.2 (Playwright, not Safari) |
|---|---|---|---|
| acceptance | 560 / 0 / 0 | 399 / 0 / 161 | 399 / 0 / 161 |
| chart + a11y + render | 402 / 0 / 1 | 388 / 0 / 15 | 388 / 0 / 15 |
| all of test/browser, SVG | 962 / 0 / 1 | — | — |
| chart + a11y, canvas | 312 / 0 / 4 | — | — |

**Chrome is unchanged by the port:**
- Before: 402 passed, 1 skipped (SVG) and 312 passed, 4 skipped (canvas). These equal your d33df71 figures: 962 with acceptance.
- After: 962 passed, 1 skipped (all SVG) and 312 passed, 4 skipped (canvas).
- One caveat: my edits to the guard-only files landed while the "before" run was in progress. Those guards return at once on chromium, so they cannot change a Chrome count.

**Why tests are not run** (Firefox and WebKit identical):
- **acceptance, 161:**
  - 151 read the browser's own accessibility tree through CDP. By criterion: A1 47, F12 26, L7 12, A10 11, A4 10, L8 10, C1 9, T-reference 9, I6 5, I2 4, C5 3, F2 3, F8 2.
  - 10 need multi-point or moving touch through CDP: I3 pinch 5, I4 one-finger drag 5.
- **chart + a11y + render, 15:**
  - accessibility tree: 5 (a11y keyboard 2, review2 2, final-pin 1);
  - multi-point touch: 3 (final-partials, final-round3, interaction);
  - moving touch: 1 (interaction);
  - pen: 1 (final-range);
  - event listeners: 1, heap snapshot: 1, heap measurement: 2 (all lifecycle);
  - 1 `render/timing`, which is skipped in its own source and on Chrome too.
- **On Chrome**, the skips are the source-level ones only: timing 1 (SVG); final-pin 3 and final-round3 1 (canvas).

### Remaining failures
None on any engine. No product defect is left open by these runs.

### Earlier failures that are gone
- **Integer pointer positions** (Firefox and WebKit, 6 each): A5 scatter, A8 scatter, T-tooltip-scatter, the I1 line and area sweeps, and I1 bar rule 3b. Fixed by the 1 px plot-edge and corridor slack.
- **Firefox 24 px measurement** (3): fixed earlier, when the size checks moved to `getBoundingClientRect`.
- **WebKit L1 late font** (4): fixed by the late-font measurement fix.
- **Firefox lifecycle "height: auto … stable"**: no longer seen. The empty `loadingdone` fix applies.
- **Firefox forced-colors focus ring**: fixed by the focus ring following keyboard use.
- **Firefox review2 contrast swatch**: fixed by the context option.
- **WebKit CSP and pattern tests**: fixed by the port above.
- **CDP uses that failed on Firefox and WebKit** (8 and 8 at 7208470): now reported as not run with their reasons.

### Files in `acceptance/results/engines-d33df71/`
- Final runs, `.json` and `.txt` each: `firefox-acceptance`, `firefox-other`, `webkit-acceptance`, `webkit-other`, `chromium-all-svg`, `chromium-canvas`.
- Chrome baseline before the port: `before-chromium-svg`, `before-chromium-canvas`.
- `try1-{firefox,webkit}-other.*`: my first pass of the other suites.
- `run-all.sh`, plus the dist hashes in `final-dist.hash` and `dist.hash`.

The project scratch directory is removed.

**Changed files** (all in `packages/axylo/test/browser/`): `chart/final-util.ts`, `chart/interaction.browser.test.ts`, `chart/lifecycle.browser.test.ts`, `chart/review2.browser.test.ts`, `render/review.browser.test.ts`.
