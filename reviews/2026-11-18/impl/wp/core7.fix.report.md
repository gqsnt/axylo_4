<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a1d73b9f46c46814f, resumed. Saved by the coordinator from the hand-back. -->

## Chart core, seventh pass: report

All five items are done. Browser acceptance on SVG now passes in full, 555 of 555, and both items you asked me to confirm (I5 and L1 bar at 200% text) pass in it. Nothing is committed; I did not swap the shared `dist` (old-code checks used private builds of 4504ca4 via `AXYLO_BUNDLE`).

### 1. Rule 3b: a rest holds the datum along the corridor (`src/dom/interaction.ts`)
- **Rest:** a pointer that stays within 2 CSS px for 250 ms, measured with the events' own timestamps, has rested.
- **Where it applies:** when the datum's floating tooltip is not across the reading axis (beside a bar or stack; always on scatter and donut).
- **Hold:** after a rest, the datum is held while the pointer is inside the convex hull of the resting point and the tooltip's rectangle. Leaving the hull resumes picking on that same move; a pointer that never rested is never held. The tooltip stays pointer-transparent and does not move.
- **One adjustment:** the corridor opens on the first move after the rest, even a move of 2 px or less. Without that, a datum resting exactly on a band edge (the acceptance bar probe) changed on the first 1 px step.
- **Tests:** five browser tests in `test/browser/chart/review6.browser.test.ts`:
  - bar after a rest;
  - bar without a rest, where the datum changes;
  - leaving the rectangle away from the corridor;
  - a fast sweep after a rest elsewhere;
  - donut with the tooltip in the hole.

  On 4504ca4 the three that need the hold fail; the no-rest and sweep tests also pass on old code, so they only guard.

### 2. L4 on a prefers-color-scheme change, fixed in CSS (`src/theme/`)
- **Stylesheet (`css.ts`):** the `.axylo` private defaults are now `light-dark(light, dark)`, so they switch in the frame the media query does. Fixed sets remain under `[data-axylo-scheme="light"]` and `[data-axylo-scheme="dark"]`. The comment says `light-dark()` is supported by the current and previous major versions of the four browsers in spec 2.3.
- **Resolution (`resolve.ts`):** when the chart's computed `color-scheme` is anything but `normal` and no `--axylo-background` decides, no `data-axylo-scheme` is written. The per-series properties were already references, not frozen colours.
  - With `color-scheme: normal` or `--axylo-background`, it works as before.
  - Forced colours and `prefers-contrast` are unchanged and still pass in the render suite.
- **Canvas:** it still repaints when the change event arrives, one frame behind; a comment in `controller.ts` says so, and AX141 is judged then.
- **Tests:**
  - `test/theme/review.test.ts` checks the generated stylesheet.
  - `test/browser/render/scheme.browser.test.ts` emulates the media change under `color-scheme: light dark` and reads the mark colour in the first rAF. It fails on 4504ca4.
- **Tests changed:** three render tests and two of my chart tests expected the attribute in "page sets color-scheme" cases. They now expect none, which is the design change, not a loosened check.

### 3. Two-tone focus ring (palette review B1)
- **Datum ring (`core/focus.ts`):** a 4 px background-colour surround with the 2 px focus colour on top, i.e. 1 px of background on each side. Corners are closed, the ring is kept inside the plot's box, and the tooltip's avoid-box grows by the surround (`RING_REACH` 10).
- **Plot outline (`css.ts`):** an inset `box-shadow` in the background colour under the 2 px outline. `forced-color-adjust: none` keeps it in forced colours, where both tokens are already system colours.
- **Tests:**
  - New browser test (`review6`): dark scheme, a bar of each of the 8 dark series colours, painted pixels at device pixel ratio 2. Crossing the ring finds background, then focus colour, then background, and the ring really crosses the neighbouring bar. It fails on 4504ca4 and passes on both renderers.
  - `test/core/focus.test.ts`: its expectation changed from 4 focus rules to 4 surround rules plus 4 focus rules.
- The acceptance A2 tests still pass.

### 4. Untitled chart named by its target's id (React review C6)
- `Host.targetId`, from `root.id` in `chart.ts`, is used for the diagnostic chart name and for the internal-error delivery. The allocated id stays for the DOM relationships.
- Node tests in `snapshot.test.ts`: "sessions" when the target has that id, the allocated id otherwise. `test/core/host.ts` has a new `targetId` option.

### Edits outside `src/core` and `src/dom`
- `src/theme/css.ts`: the token blocks and the ring surround.
- `src/theme/resolve.ts`: the scheme attribute rule only.
- `test/theme/review.test.ts`, `test/browser/render/scheme.browser.test.ts` (new), and the expectations in `test/browser/render/theme.browser.test.ts` and `review.browser.test.ts`.
- `test/browser/chart/util.ts`: `AXYLO_BUNDLE` now also reaches the render suites, without the renderer switch.
- `palette.ts` and `test/theme/palette.test.ts` show as modified in the tree, but those are the palette author's changes, not mine.

### Runs (last lines, final build)
- **Type check:** clean.
  - In the chained run it failed once with `packages/react/src/index.ts(114,50): error TS2554`, while the React author was editing that file.
  - Re-run afterwards: `tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p packages/react && tsc -p tests/dist`, no errors.
- **Node suite without acceptance:** `Test Files 2 failed | 44 passed (46)`, `Tests 2 failed | 791 passed (793)`. Neither failure is mine:
  - the kept memory test (`data/streaming-storage`);
  - `scene/scene.test.ts` "keeps generated geometry finite and clipped across independent chart states", which fails identically on a clean HEAD tree (2727a30).
- **My browser directories, SVG:** `Test Files 14 passed (14)`, `Tests 193 passed (193)`.
- **My browser directories, canvas:** `Test Files 14 passed (14)`, `Tests 193 passed (193)`.
- **Render (browser):** `Test Files 6 passed | 1 skipped (7)`, `Tests 86 passed | 1 skipped (87)`.
- **Theme (Node):** `Test Files 3 passed (3)`, `Tests 52 passed (52)`.
- **Browser acceptance, SVG:** `Test Files 13 passed (13)`, `Tests 555 passed (555)`.

Logs are `s3-*.txt` in `/tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/core-fix/`.

