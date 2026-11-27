# Cycle N3 — interaction, multi-engine and accessibility hardening (Wave 2, Track A): ledger

Status: **repaired candidate after Director turn 23, authored in the leaf. Turn 23 was the first run in which Chrome started for the owned suites (through the test-only short-`TMPDIR` helper): Chromium observed 36 passed, 7 failed, 6 skipped (`c3-journeys`, still blocked at Chrome startup by the runner `TMPDIR`). The seven failures were repaired in the test file only (see "Repairs after Director turn 23"). The repairs are not yet run in a browser; Firefox and WebKit have not been reached. `c3-journeys` still needs the runner fix.**
Nothing in this file says a browser test passed. The leaf workers were told not to launch browsers, and they did not.

Owned files changed (compared with the coordinator's `initial/` snapshot):

| File | Change |
|---|---|
| `packages/axylo/src/dom/interaction.ts` | F-RESP-2: touch-tap announcement in the layout's readout mode `none` with tooltips on. F-A11Y-6: the plot's name gets its own element with its own language, referenced by `aria-labelledby` under an id that skips ids already in its tree. |
| `packages/axylo/src/dom/table.ts` | F-A11Y-4 remainder: every valid jump the reader submits is announced once, including a jump to the page already shown. |
| `packages/axylo/src/theme/css.ts` | Wave 1 `forced · 320x4`: muted text uses `CanvasText` in forced colours. The `--axylo-grid` and `--axylo-muted` tokens stay `GrayText`. |
| `packages/axylo/test/browser/chart/n3-interaction-a11y.browser.test.ts` | New: 40 browser tests (listed below). |
| `packages/axylo/test/core/n3-table-jump.test.ts` | New: 5 Node tests, one of them a fast-check property. |
| `packages/axylo/test/core/n3-interaction.test.ts` | New: 14 Node tests. |
| `packages/axylo/test/core/n3-dom.ts` | New: a copy of the minimal DOM from `test/dom/lazy-dom-footprint.test.ts`, exported. That file registers its own tests, so it cannot be imported. |
| `docs/progress/n3-interaction-a11y-ledger.md` | This file. |

Untouched: `public.ts`, `core/contracts.ts`, `src/cartesian/**`, `src/finance/**`, `docs/02-product-spec.md`, `bench/**`, `acceptance/matrix.json`, runner and config files, and every existing test.

## Fixes

### F-RESP-2: touch tap when the readout is `none` (spec I1, I4, A7)

The layout chooses readout `none` when two things are true. The plot has no room for a floating tooltip (it is under 240×140). Reserving the strip would take it under L8's 80 px. In this mode a tap highlighted the datum, but nothing gave its value: a tap does not focus the proxy, so the `aria-valuetext` written to the proxy was never spoken.

`#activate` now handles an explicit touch tap (`!mouse`) on a datum when `d.tooltip` is on and the layout's `readoutMode` is `'none'`. After `#writeProxy(true)` it passes the proxy's own `aria-valuetext` and `lang` to `Figure.announce()`, the polite live region. The announcement therefore uses the same reading and the same language resolution as the keyboard reading. A7 allows it because the tap is the reader's own navigation.

**Repair (review finding 2).** The first candidate announced whenever `presentationFor(d) === 'none'`, which is also true for `tooltip: false`. A full-size chart with tooltips off then spoke on touch. The gate is now `d.tooltip && d.readoutMode === 'none'`.
- That implies the plot's own `none` case on this path. The callers require `plotReady`. A non-interactive chart resets the interaction. Entering the too-small fallback sets the readout kind to `'floating'` (`core/controller.ts`).
- The pin branch is back to its original `presentationFor(d) !== 'none'`.

What does not change:
- No overlay is added and the layout does not move.
- Mouse hover does not change.
- A mouse click in `none` still focuses the proxy, which is how the reading reaches assistive technology.
- Floating and strip taps still pin and do not announce.
- `tooltip: false` taps still select and never announce.
- A tap on no datum neither selects nor announces.
- The L8 threshold and compact behaviour do not change.

### F-A11Y-6: the plot name in its own language (spec A10, A3)

Previously the proxy was named only by `aria-label`, so the name took the proxy's `lang`. That `lang` follows the reading: `pointAll` for all series, `pointOf` for one.

`#build` now adds a hidden span to the plot, with `aria-hidden` so browsing does not hear the name twice. The proxy references it through `aria-labelledby`. `#placeProxy` writes `plotLabel` into the span with `lang = english('plotLabel') ?? pageLang`, which does not depend on the proxy's `lang`.

`aria-label` stays on the proxy, with the same text. `aria-labelledby` takes precedence, and an existing test (`final-partials`) reads `aria-label`.

**Repair (review finding 1).** The id was `<figure id>-l`, which the figure's allocator (`core/chart.ts` `ID_SUFFIXES`) does not reserve. A page element with that id could name the slider, and the id would then be duplicated.
- `#build` now starts from `<figure id>-l` and appends `0` while `getRootNode().getElementById(id)` finds an element: `-l`, `-l0`, `-l00`, … The id is allocated once per build and stays stable across commits.
- The tree is the proxy's own root, the document or its shadow root. That is the scope `aria-labelledby` resolves in. A document id does not collide with an id inside a shadow tree.
- The optional call keeps the minimal DOMs of existing Node tests working. Some of them have no `getElementById`.
- Appending `0` is the shortest loop measured. A numeric counter (`-l1`, `-l2`) put the root at exactly +200 B (see Bundle size).

**Repair (review `…053150Z`, finding 1): reattachment.** `detach()` keeps the proxy and the label, and the chart can reconnect in another shadow root or in the document, where the page may already use the label's id. The first id would then outrank the label for `aria-labelledby`.
- The naming moved into `#joinTree()` (formerly `#listenShadowScroll()`), which `#build` and every `attach()` already call. Sharing that call site, rather than adding a method and a guarded call in `attach()`, is what keeps the root within +200 B (+222 B as a separate method, +199 B shipped).
- It runs the same loop as the first allocation, in the label's current tree. The label's own id is cleared first, so a lookup can never resolve to the label itself and a page element after the chart in tree order is skipped too. With no collision the id is unchanged.
- Only `id` and `aria-labelledby` are written. The native range input is the same node, and the page's elements keep their ids and text.

The span's identity is stable. Moving between `pointAll` and `pointOf` (ArrowDown, Escape) changes only the proxy's `lang`, and focus stays on the proxy.

### F-A11Y-4 remainder: confirming a jump to the current page (spec A4, A7)

`render(true)` runs only for the reader's own paging, through `go()`: Previous or Next within bounds, or a valid jump. Before, it announced only when the visible page text changed. It now always calls `announceText` for `reader === true`. That helper already re-speaks repeated words by replacing the text node.

The page status is written with `setLanguageText(status, pageText, pageLang)`, the same `lang` and text as before in one call. It saves 23 B gzip.

Passive refreshes (`render()` from `update`) still never speak. Paging past either end never reaches `go()`. An x that is not in the data is an error, not an announcement.

### Forced colours: muted text (wave 1 `forced · 320x4`, spec L2, L4)

At the end of the stylesheet there is a new `@media (forced-colors: active)` block:

```
.axylo .axylo-subtitle, .axylo .axylo-message, .axylo .axylo-tooltip-more:not(button), .axylo .axylo-control[aria-disabled="true"] { color: CanvasText; }
```

The block has to come last. Its selectors have the same specificity as the rules that set the muted colour on disabled controls and on the "+N more" text, so it must follow them.

- **The defect.** `GrayText` on `Canvas` is 3.95:1, under L2's 4.5:1.
- **Scope.** These four rules are every text use of `--axylo-muted` (css.ts lines 142, 165, 214, 326 before the change).
- **Not changed.** `--axylo-muted` stays `GrayText` for non-text paints: the donut's "Other" slice and its swatch, and missing bars. `--axylo-grid` stays `GrayText`.
- **Disabled controls.** They keep their dashed `GrayText` border as the non-text cue (3:1 or more).

An `:is()` form of the selector saved 0 B gzip and raised specificity, so it was not used.

## Review repairs in the browser suite (`sol-6.2-medium__20261127T045934Z`)

| Finding | Repair in `n3-interaction-a11y.browser.test.ts` |
|---|---|
| 2: exact select and announcement counts | `tap()` returns only the `select` events and announcements that tap caused. The line test covers two valid taps: each gives exactly one select, with `{x: 2, y: 20}` and then `{x: 4, y: 40}`, and one announcement with the exact reading. A scatter miss gives zero selects and zero announcements: the top-left corner of a plot at least 120×80, more than 24 px (the pick radius) from all three points. Then a hit gives one of each. `tooltip: false` at full size and at the `none` size gives one exact select per tap and no announcement. |
| 3: disabled Next | The test asserts `aria-disabled="true"`, then clicks with `{ force: true }`. Playwright waits for an `aria-disabled` button otherwise. |
| 3: same-datum value change | `update({ data })` (a new epoch) is gone. A new histogram test uses fixed bins `[0,2,4,6,8]` and `append([{ v: 3 }])` into the focused bin 2–4. It asserts the same ordinal (1) and max (3), `aria-valuetext` equal to the old text with `Count 1` → `Count 2`, an `aria-valuetext` mutation, and no live-region mutation. Through fresh Enter selects: the same `x`, `index` and `series`, with `y` going 1 → 2. |
| 3: fresh Enter selects | `identity()` requires each Enter to add exactly one `select`. The line test keeps count-only append, ordinal shift, eviction (the focused datum is now in x 9–16) and repeated boundary arrows. |
| 4: compact capture | `Element.prototype.setPointerCapture` is wrapped before the chart exists, and each `pointerdown`'s real target is recorded. The test asserts the mouse and touch pointerdowns both landed in the chart, there were zero capture calls, and the mouse target had no capture while pressed. A touch pointer's implicit capture is the browser's own and is not counted. The no-select, no-tooltip, no-focus and AX142 assertions stay. |
| 4: reflow | Any element in the chart with `overflow-x: auto/scroll` that scrolls sideways is reported, the open table's overlay included. Only `.axylo-table-scroll` is exempt. Controls must be 24 CSS px less 1/50 px of coordinate rounding (was 23.5). The strip state asserts `.axylo-readout.axylo-readout-pinned` visible, no floating tooltip, and a visible `button.axylo-tooltip-more`. `legend: 'top'`: the three entries sit in `.axylo-controls-top`, above the plot. `legend: 'right'` at 320 px: the three entries sit in `.axylo-controls-side`, under the plot and within its width (F-RESP-1's narrow rule). |
| 5: opt-in shape and scanned states | `expectOptInShape` runs before the scans and before parity. It checks the SVG renderer. For cartesian: the three layer entries, numeric tick labels left of the plot, and right ticks whose powers of ten are evenly spaced per decade (log). For finance: `price` and `volume` pane clips, the volume pane below the price pane, and marks clipped to each. Each scan first asserts its state. Default: no tooltip, no table. Reading: proxy focused at ordinal 1, tooltip visible. Table: table visible with 12 or 8 rows, Hide table present. |
| 5: parity | Headers must equal the fixture's: `Day, Units, Share, Requests`, and `day, Opening, Highest, Lowest, Closing, Change, Direction, Shares`, from labels the finance fixture now authors. Every cell must be non-empty and every value cell must equal the fixture's number (formatting stripped). Every named value must be in that point's reading as `name value` or `name: value`: finance's volume, `Change <cell> (<direction>)`, and the direction computed from open and close. |
| 5: forced colours | `matchMedia('(forced-colors: active)')` must match on every engine. The Chromium-only `requireEngineFeature` skip is gone. Each axe scan asserts its `forced-colors` and `prefers-color-scheme` media state. |
| Note: unfocused wheel | The page starts at `scrollY = 100`. An upward wheel over the unfocused plot must lower `scrollY` and leave the domain at `[0, 10]`. Focused, the same wheel zooms in. |
| `…053150Z` 1: reattachment | One browser test: a chart moves from the document into a shadow root that already has `<figure>-l` (before the chart in tree order), then into a second shadow root with `-l` and `-l0`, back into the document after a `-l` decoy is added there, then out and back into the document once more. At each step: the same proxy node, the expected id (`-l`, `-l0`, `-l00`, `-l0`, `-l0`), unique in its tree, resolving to the chart's label with text `Chart plot`, and every decoy still connected with its id and text. Finally the slider's computed name (Playwright's role locator) is exactly `Chart plot`, never `Wrong name`. Two Node tests cover the same moves and a same-tree reattachment. |
| `…053150Z` 2: opt-in shape | `optInShape()` called `__bench.describe()`, which the public Cartesian and finance handles do not have, so the six axe cases and both parity cases would have thrown first. It now reads only the DOM, with selectors taken from the renderers: one `svg.axylo-svg` whose `g.axylo-scene` holds the marks and no `canvas` (`src/render/svg.ts`; `src/core/chart.ts` always builds the SVG renderer); `.axylo-label` ticks (`src/render/text.ts`); `.axylo-legend-entry` (`src/dom/interaction-controls.ts`); `clipPath#axylo-finance-<pane>-<n>` (`src/finance/render.ts`). New assertions: cartesian draws one bar group of 12 `rect`s, at least one filled area (`fill-opacity` below 1) and at least two stroked paths; one 12-vertex stroked path sits on 4 evenly spaced heights for requests `10^(1 + i % 4)`, rising with the value (log geometry of the drawn line, not only of the ticks). Finance draws 8 volume `rect`s and 4 falling bodies, each inside its pane's clip rectangle. A new `optInDrawn()` waits for the scene and tick labels, since the shared `settle()` only waits frames when there is no `__bench`. Every axe, keyboard and parity assertion is kept. |
| `…053150Z` note: `tooltip: false` geometry | At the `none` size, a tooltip-enabled control chart first finds the height with readout `none` (`toNone` now returns it). It is destroyed and the `tooltip: false` chart is made in the same container. The test asserts its plot box equals the control's (±0.5 px), is under 240 px wide and at least 80 px tall, with no AX142. |
| Audit: benchmark APIs | Opt-in paths use `make` → `settle` (from `acceptance/util`, which calls `__bench.ready()` only when the handle has it), `loadOptIn`, `structure`, `range`, `tabStops`, `focused`, `axe` (`a11y/util`, no chart handle) and `closePage`. No other opt-in path reads `__bench`, `__dev` or implementation state. The `__bench` uses that remain are on root-entry charts from the development bundle (`window.Axylo`), where `attachHooks` sets it under `__DEV__`. |
| 1: id collisions | Two browser tests, one in the document and one in a shadow root. `axylo-N-l` and `axylo-N-l0` decoys are placed in the chart's tree. Each asserts the label id is `<figure>-l00`, unique in its tree, inside the chart, with text `Chart plot`; the decoy keeps its text; the slider's name is exactly `Chart plot` and never `Wrong name`. |

## Repairs after Director turn 23

Director turn 23 (`turn-23-opus-5.5-medium__20261127T064401Z`, full log `/home/canarit/projects/prism/runs/coordinators/axylo_p2_n3_interaction_a11y/verify/turn-23-opus-5.5-medium__20261127T064401Z.log`) failed seven tests in `n3-interaction-a11y.browser.test.ts` on Chromium. All seven were fixtures or test actions that did not match the spec. No product code changed this round, and no existing expectation was edited.

| Failure (turn 23) | Cause | Repair |
|---|---|---|
| F-A11Y-6, both directions: `expected 'en' to be 'de'` / `'de' to be 'en'` after one Escape | Keyboard focus shows the tooltip. Under decisions 0001 and 0004 rule 7 ("one Escape does one thing"), the first Escape closes the tooltip and keeps single-series reading. The test expected the first Escape to leave single-series mode. | New `escapeInOrder()`: the tooltip is visible; the first Escape hides it while the proxy keeps focus and its reading (`value`, `max`, `aria-valuetext`, `lang`) equals the single-series reading; the label element is unchanged (same node, text, lang). The second Escape returns to the all-series reading and `lang` with focus and label stable. The third Escape is not consumed and reaches a `document` listener (`!defaultPrevented`; the first two reach it zero times). This is the pattern of `a11y/keyboard.browser.test.ts` and `final-hold.browser.test.ts`. |
| cartesian and finance keyboard: the reading after one Escape was still `Units, …` / `OHLC, …` | Same cause. | Same `escapeInOrder()`, then the reading equals the all-series reading at the same ordinal. |
| F-RESP-5 pinned floating tooltip: `.axylo-tooltip-pinned` not visible | The fixture clicked the proxy's centre with `height: auto` in a 256 px viewport, so the click could fall outside the viewport. It also depended on ten exactly coincident scatter points being under that centre. | Ten separate aligned line series (`legend: false`; decision 0001: a pointer over the plot picks the nearest x, so the click hits). `#chart` is 300 px tall at the viewport's width (`width: auto`, so a vertical scrollbar cannot cause sideways scrolling; floating mode is asserted: no `axylo-readout-mode`). `pinMiddle()` scrolls the plot's top into view, clicks the middle x of the visible part, checks that the click point is inside the 320×256 viewport, and scrolls on only as far as the content needs. The test asserts the pinned class, at least one row button, a visible `+N more` pager, the tooltip inside the viewport, and the pager inside the viewport, on top at its centre (`elementFromPoint`), and at least 24×24. Ten pinned rows of 24 px (decision 0004 rule 4) cannot fit in a plot inside a 256 px viewport, so the pager is required. |
| F-RESP-5 pinned strip: `.axylo-readout-pinned` not visible | Same fixture cause. | Same data, `#chart` 220×280 (readout mode is asserted: narrower than 240 px, decision 0004 rule 5). The test asserts the pinned strip, no floating tooltip, and a visible pager button inside the viewport, on top and at least 24×24. |
| F-RESP-6 24×16: the touch `pointerdown` was not in the chart (the mouse at the same point was) | Inferred, not observed: Chromium's touch adjustment moved the tap onto the `#before` / `#after` Tab sentinels, a few px above and below a 16 px chart. | The sentinels get `visibility: hidden` only during the mouse press and the tap. Layout does not change, and a hidden element is neither hit-tested nor a touch-adjustment candidate. They are restored before the remaining assertions. The Tab-stop assertion runs before (unchanged) and again after the restore. The `pointerdown` assertion now prints each target when it fails. The checks for pointer target, zero `setPointerCapture` calls, no capture, no select, no tooltip, no focus, dimensions and AX142 are unchanged. If the touch target is still outside the chart in the next run, the cause is not the sentinels and has to be looked at again. |

## Repairs after Director turn 25

Director turn 25 (`turn-25-opus-5.5-high__20261127T064831Z`, full log `/home/canarit/projects/prism/runs/coordinators/axylo_p2_n3_interaction_a11y/verify/turn-25-opus-5.5-high__20261127T064831Z.log`) failed one test on Chromium: F-RESP-5 "pinned strip readout with its pager", `readout mode: expected 0 to be greater than 0` (line 876). The turn-23 fixture's fixed 220×280 chart was not in strip mode. No product code changed, and no other test or expectation changed.

| Failure (turn 25) | Cause | Repair |
|---|---|---|
| F-RESP-5 pinned strip: no `.axylo-readout-mode` at 220×280 | Inferred from the controller, not measured: `#readoutDecide` (`src/core/controller.ts`, decision 0004 rule 5) chooses the strip only when the plot laid out without the strip is under 240×140, and then only when the plot keeps at least `MIN_PLOT_HEIGHT` 80 px above the measured strip (two lines, at least 48 px). Otherwise it chooses `none`. At 220 px wide the title, the toolbar rows and the x axis leave too little height, so the mode was `none`. | `#chart` is now 350 px tall. `toStrip()` tries the widths 290, 278, 266, 254, 242 and 230 CSS px in that order. After each width it waits for `document.fonts.ready` and two `settle()` calls (resize observer, layout). It accepts the first width where the root is in readout mode, the strip has a laid-out box at least 24 px tall, the plot (proxy) is at least 120×80, and there is no AX142. If no width qualifies, it fails and prints the measured geometry for every width tried. `pinStrip()` replaces `pinMiddle()` for this state. First it scrolls the strip's reserved box into the 320×256 viewport (the hidden strip is still laid out: `visibility: hidden`, css.ts:199). Then it clicks the middle x of the plot, at the middle of the part of the plot that is visible, with no scroll between the scroll and the click. It asserts that the strip box is in view, at least 8 px of plot is visible, and the root is still in readout mode after the click. The assertions that follow are unchanged: the pinned strip is visible, the floating tooltip is not, there is a visible `+N more` pager, the strip is in view, and the pager is in view, on top and at least 24×24. The reflow check is unchanged too: no horizontal scroll and no clipped text. The pager assertion also prints the geometry. The floating case still uses `pinMiddle()`, unchanged. |

## Evidence

### Ran in the leaf (Node), observed

| Command | Result |
|---|---|
| Round after turn 25: `npm run typecheck` (library and tests, `docs/api`, `tests/dist`) | exit 0. Node unit suite not rerun this round (test-only change to a browser file; turn 25 observed 2227 passed). No browser launched in the leaf. |
| Round after turn 23: `npm run typecheck` (library and tests, `docs/api`, `tests/dist`) | exit 0 |
| Round after turn 23: `npx vitest run --configLoader runner --no-cache --no-fsModuleCache` | Test Files 123 passed (123), Tests 2227 passed (2227) (exit 0). The browser file is type-checked only; no browser was launched in the leaf. |
| `npm run typecheck` (library and tests, `docs/api`, `tests/dist`) | exit 0 |
| `npx vitest run --configLoader runner --no-cache` (the whole unit suite, this round) | 123 files, 2227 tests passed (exit 0). Previous round 2225; the sealed candidate 2220; before N3, 121 files / 2208 tests. |
| `n3-interaction.test.ts` with the `attach()` call to `#joinTree()` removed (negative control, this round) | 1 of 14 failed: the reattachment test (`expected 'n3-l' to be 'n3-l0'`). Restored afterwards. |
| `npm run build` | previous round: built every dist file, each measured file byte-identical (`cmp`) to that round's scratch build. Not rerun in the workspace this round; this round's sizes come from the scratch builds below. |
| `n3-interaction.test.ts` against the sealed candidate's `interaction.ts` (negative control) | 3 of 12 failed: `tooltip: false` silence, document collision, shadow-root collision. The other 9 passed. |
| `n3-table-jump.test.ts` against the **baseline** `table.ts` (negative control, first round) | 2 of 5 failed: the same-page confirmation test and the property. |

Plain `npx vitest run` cannot start in this workspace. Its `node_modules` is a read-only symlink, and Vitest 5 writes `node_modules/.vite-temp` and `.vitest-cache` there. The flags above avoid those writes without changing what runs.

An earlier full run in this round, with a document-plus-shadow `getElementById` loop, failed 15 tests in one file, `test/dom/finition-interaction-lifecycle.test.ts` (`this[#doc].getElementById is not a function`). Its minimal DOM has no `getElementById`. The optional call on the tree fixed it, and no test was changed.

### Authored, not run in the leaf: `n3-interaction-a11y.browser.test.ts` (40 tests)

| Group | Tests |
|---|---|
| F-RESP-2 | 5: the `none` tap (exact selects, exact readings, polite, in the proxy's language, no overlay, identical figure box, the keyboard reading at End matches); a scatter miss, then a hit; `tooltip: false` at full size and at the `none` size; the floating control, which pins and stays silent. |
| F-A11Y-6 | 6: both override directions on a `lang="de"` page with live ArrowDown / Escape; the label is hidden from browsing, plus axe; id collisions in the document and in a shadow root; reattachment across the document and two shadow roots. |
| F-A11Y-4 | 1: two same-page jumps give two announcements; a cross-page jump; a disabled Next (state asserted, forced press); an invalid x; a passive append. |
| F-A11Y-5 | 2: line (count-only append, ordinal shift, eviction, repeated boundary arrows at End and at Home); histogram same-bin append (same datum, new value). |
| F-RESP-5 | 8: at 320×256 CSS px, device scale 4. Seven states: zoomed streaming eight-control toolbar; pinned floating tooltip with "+N more"; pinned strip with a visible pager button; open table with its pager; streaming; `legend: 'top'` (above the plot); `legend: 'right'` (under the plot at this width). Each asserts no page, figure or nested horizontal scroll outside the table's data scroller, no visible text cut by hidden overflow or by the viewport, and every visible control at least 24×24. One negative control: a 400 px chart, which the checker reports. |
| F-RESP-6 | 2 (24×16, 120×79): the compact chart fills its box and its marks stay inside. It has one `img`, no Tab stop and no focus. Mouse and touch both land on it, with zero `setPointerCapture` calls and no capture on the mouse target while pressed. No `select`, no tooltip, no AX142. A full chart of the same size raises AX142. |
| Forced colours | 1: outside forced colours, `--axylo-muted` reaches the subtitle and the disabled Zoom out. In forced colours (media state required), both are `CanvasText` at 4.5:1 or more against `Canvas`, and `--axylo-grid` / `--axylo-muted` are still `GrayText`. |
| Histogram | 5: a tap pins and a re-tap dismisses; zoom by buttons, by `+` `-` `0`, and by the wheel only while focused (unfocused, the page scrolls and the domain stays); focus survives `update()` / `append()`; Pause holds the table and Resume releases it; text at least 12 px and 4.5:1 in light and dark. |
| `axylo/cartesian` (dual-axis, log, mixed bar/area/line) and `axylo/finance` (candlestick with volume pane) | 5 each: axe in light, dark and forced (opt-in shape, then default, keyboard reading and table open, each state asserted); keyboard (two Tab stops, Home/End/Left/Right/PageUp/PageDown, Up/Down, Escape, table open and close with focus restored); table parity (fixture headers, one row per point, every value equal to the fixture and named in that point's reading). |

**Engine guards.** The file uses no Chrome DevTools protocol helper and no engine skip. All input goes through Playwright's engine-neutral `mouse`, `keyboard`, `touchscreen.tap`, `wheel` and `click({ force })`. Forced colours are required on all three engines. If an engine does not apply the emulation, the test fails and the Director records the limitation. It is never skipped silently.

### Three-engine results (Director)

**Turn 25 (latest, observed; before the repair above).** `turn-25-opus-5.5-high__20261127T064831Z`: `npm test` (Node) Test Files 123 passed (123), Tests 2227 passed (2227). Chromium browser suites: Test Files 2 failed | 1 passed (3), Tests 1 failed | 42 passed | 6 skipped (49).

| Suite | Chromium (turn 25) | Firefox | WebKit |
|---|---|---|---|
| `chart/n3-interaction-a11y.browser.test.ts` (40) | 39 passed, 1 failed (pinned strip; repaired since, see above) | unreached | unreached |
| `chart/histogram.browser.test.ts` (3) | 3 passed | unreached | unreached |
| `chart/c3-journeys.browser.test.ts` (6) | 0 run, 6 skipped at setup (`browserType.launch: Target page, context or browser has been closed`) | unreached | unreached |

These counts belong to the turn-25 candidate. The repaired file has not been run in a browser. **Final three-engine results: pending** the next Director run on Chromium, Firefox and WebKit.

**Turn 23 (earlier, observed).** `turn-23-opus-5.5-medium__20261127T064401Z`: `npm run typecheck` and `npm run build` passed; `npm test` (Node) Test Files 123 passed (123), Tests 2227 passed (2227). Chromium browser suites: Test Files 2 failed | 1 passed (3), Tests 7 failed | 36 passed | 6 skipped (49).

| Suite | Chromium (turn 23) | Firefox | WebKit |
|---|---|---|---|
| `chart/n3-interaction-a11y.browser.test.ts` (40) | 33 passed, 7 failed (repaired since, see above; pending the next Director run) | unreached | unreached |
| `chart/histogram.browser.test.ts` (3) | 3 passed | unreached | unreached |
| `chart/c3-journeys.browser.test.ts` (6) | 0 run, 6 skipped (Chrome startup: `Socket path too long`, runner `TMPDIR`) | unreached | unreached |

These counts belong to the turn-23 candidate. They do not carry over to the repaired file. The repaired file still needs a Director run on all three engines.

Earlier Director run: `turn-9-opus-5.5-medium__20261127T054101Z` (full log: `/home/canarit/projects/prism/runs/coordinators/axylo_p2_n3_interaction_a11y/verify/turn-9-opus-5.5-medium__20261127T054101Z.log`). Observed in that log:

| Step | Result |
|---|---|
| `npm run typecheck` | passed |
| `npm run build` | passed |
| `npm test` (Node) | Test Files 123 passed (123), Tests 2227 passed (2227) |
| Chromium browser suites | Test Files 3 failed (3), Tests 49 skipped (49): 0 test bodies ran |

| Suite | Chromium | Firefox | WebKit |
|---|---|---|---|
| `chart/n3-interaction-a11y.browser.test.ts` (40) | 0 run, 40 skipped in setup (browser launch failed) | unreached | unreached |
| `chart/c3-journeys.browser.test.ts` (6) | 0 run, 6 skipped in setup (browser launch failed) | unreached | unreached |
| `chart/histogram.browser.test.ts` (3) | 0 run, 3 skipped in setup (browser launch failed) | unreached | unreached |
| Total | 0 run, 49 skipped | unreached | unreached |

No engine has a pass on this candidate. A skipped test is not a pass.

**Cause.** `chromium.launch` in `packages/axylo/test/browser/harness.ts:77` fails before any test body. Chrome aborts (`SIGABRT`) at `process_singleton_posix.cc:315` with `Socket path too long`. The generated workspace `TMPDIR` puts its `SingletonSocket` at `/home/canarit/projects/prism/runs/coordinators/axylo_p2_n3_interaction_a11y/verify-6zqtw02t/tmp/tmpf0ft_7hj/com.google.Chrome.<6>/SingletonSocket`. That path is 148 bytes. A Unix socket path (`sun_path`) holds at most 107 bytes plus the terminator.

**Repeats.** The same startup failure happened in Director turns 8 (`turn-8-opus-5.5-medium__20261127T054101Z`, workspace `verify-nib0tpqv`) and 9 on this implementation (Node 2227 passed, browser 49 skipped both times). It also happened in `turn-2` on an earlier candidate (Node 2220 passed, browser 42 skipped). Each time Node passed and the browser suites stopped at launch. Firefox and WebKit were never reached. The failure comes from the runner environment, not from the candidate, and repeating the same Director command will fail the same way.

**Runner-side remediation (pending, outside the candidate file fence).**
- Export a short absolute `TMPDIR` that is backed by the verification workspace before the browser step. A short mount or alias that points to the workspace is fine, for example `ln -s <verify-workspace>/tmp /home/canarit/.pv/<id>` (or a bind mount) with `TMPDIR=/home/canarit/.pv/<id>`. Keep the whole `TMPDIR` under about 50 bytes, so that `TMPDIR/tmpXXXXXXXX/com.google.Chrome.XXXXXX/SingletonSocket` stays well below 107 bytes. Do not use the tmpfs `/tmp`.
- Set a workspace-local npm cache (`npm_config_cache=<verify-workspace>/npm-cache`).
- Then run the three engines in turn: `AXYLO_ENGINE=chromium|firefox|webkit` over `n3-interaction-a11y`, `c3-journeys` and `histogram`.

This change belongs to the Director/runner. The test-only startup helper below covers only the two owned suites. `c3-journeys` still needs the runner fix, and its Chrome step still blocks the Firefox and WebKit steps that follow it in the chained Director command.

Expected only: `c3-journeys` should not regress.
- Its live-region probe (F-A11Y-4 passive refresh) reads the first `[aria-live]` in the chart, and passive refresh stays silent.
- Its floating touch pin (F-RESP-3/4) and compact 24×16 (F-RESP-6) paths are unchanged.

This is reasoning, not a run.

### Test-harness change: short `TMPDIR` for Chrome startup (owned suites only)

**What.** New test-only helper `packages/axylo/test/browser/acceptance/short-tmp.ts`. `chart/n3-interaction-a11y.browser.test.ts` and `chart/histogram.browser.test.ts` now call `beforeAll(() => startWithShortTmp(start, { engine: ENGINE }))` and `afterAll(() => stopWithShortTmp(stop))`. Before, they called `beforeAll(start)` and `afterAll(stop)`. The harness's `start`/`stop` (`harness.ts`), `c3-journeys`, the runner, configuration, production source and every assertion are unchanged. No test is skipped and no error is caught.

**Why it can work.** In locked `playwright-core` 1.65.1, `_prepareToLaunch` creates the profile and artifacts directories with `os.tmpdir()`, and `_launchProcess` spawns the browser with `process.env` (`node_modules/playwright-core/lib/coreBundle.js:41573`, `:41581`, `:41611`). Both are read at launch. Chrome then creates its `SingletonSocket` under the inherited `TMPDIR`.

**How.** The helper is active only on Linux, for `AXYLO_ENGINE=chromium`, and only when `TMPDIR/.org.chromium.Chromium.XXXXXX/SingletonSocket` would exceed 107 bytes. Otherwise `start` runs exactly as before. When active, it does the following:
- It creates a unique directory `.axylo-XXXXXX`, spelled through `/proc/<test worker pid>/cwd/`. The directory goes inside the current `TMPDIR` when that is under the working directory and its short spelling fits. Otherwise it goes in the workspace root. In the Director's `verify-*/tree`, the `TMPDIR` is a sibling `verify-*/tmp`, so the directory lands in the tree root.
- It sets `TMPDIR` to that directory only while awaiting `start()`. It restores the previous value, or its absence, in a `finally`.
- After `stop()`, it removes the directory, even if `stop()` throws.
- If the short spelling would still be too long, it throws. A failed launch propagates unchanged.
- Firefox and WebKit are not affected.

**Observed in the leaf (Node probes, no browser launched).** A Node probe ran against the esbuild-compiled helper and passed (`ALL LIFECYCLE PROBES PASSED`). It checked these cases:
- Not needed (short `TMPDIR`, or a non-Chromium engine): `start` runs once and `TMPDIR` is untouched.
- Needed: inside `start`, `os.tmpdir()` is `/proc/<pid>/cwd/…` and resolves into the workspace. A deep `TMPDIR` inside the workspace falls back to the workspace root.
- A Unix socket bound and accepted a connection at `/proc/<pid>/cwd/.axylo-XXXXXX/.org.chromium.Chromium.XXXXXX/SingletonSocket` (76 bytes).
- `TMPDIR` is restored after success and after failure, and an unset `TMPDIR` stays unset.
- The directory is removed after `stop`, including when `stop` throws. A throwing `start` propagates the same error.

`npm run typecheck` passed with the change (it includes `packages/axylo/test`).

**Not observed.** Chrome startup through the alias, and every browser result for these suites. Those need a Director `verify()`. That run can give genuine Chromium evidence for `n3-interaction-a11y` and `histogram` only. It is not complete three-engine verification, because `c3-journeys` still fails at Chrome startup until the runner is fixed.

## Bundle size

**Method.** Three `src` trees, each built with the locked `scripts/build.mjs` (esbuild 0.28.2) in its own `.prism-cache/tmp/n3r/<tree>/` directory: production defines, that tree's own minified stylesheet as a literal, minified. Bytes are `gzip -9c < file | wc -c`. Remeasured in this round, all three trees rebuilt:
- base: the coordinator's `initial/`.
- sealed: the first candidate, `trees/opus-5.5-high__20261127T043437Z`.
- final: this workspace (after review `…053150Z`).

| Entry (prod file) | raw Δ B final | gzip -9 base | gzip -9 final | Δ B final | Δ B sealed |
|---|---:|---:|---:|---:|---:|
| `axylo.js` (root ESM) | +558 | 158340 | 158539 | **+199** | +140 |
| `axylo.iife.min.js` | +558 | 158607 | 158765 | +158 | +133 |
| `static.js` | +558 | 141219 | 141362 | +143 | +116 |
| `stream.js` | +558 | 158339 | 158537 | +198 | +138 |
| `cartesian.js` | +557 | 125609 | 125743 | +134 | +103 |
| `finance.js` | +564 | 124541 | 124680 | +139 | +115 |
| `stats.js`, `sync.js`, `export.js` | 0 | 1506 / 1580 / 3285 | same | **0** | 0 |
| `axylo.css` | +181 | 3380 | 3411 | +31 | +31 |

The sealed IIFE is **+133 B** by this recipe, as the review measured. The earlier ledger's +128 was wrong and is corrected here; the first ledger's +165 for the root came from a different gzip invocation and is superseded. The previous repair round measured +194 (root) and +152 (IIFE); this round's reattachment fix adds 5 B and 6 B.

Variants measured (root ESM gzip -9 Δ, the same recipe):

| Variant | Root ESM Δ |
|---|---:|
| First repair: document and shadow `getElementById` loop, numeric suffix, gate added to the old `none` term | +253 |
| Tree-only loop, numeric suffix, leaner gate, `setLanguageText` status | +213 |
| The same, with the original inline `presentationFor` and `none` dropped from the gate | +200 |
| The same, with the `-l0` / `-l00` suffix (previous round) | +194 |
| Reattachment: a separate `#nameLabel()` called from `#build` and, guarded, from `attach()` | +222 |
| Reattachment: the loop inside the existing `#joinTree()` call site, label id cleared first (**shipped**) | **+199** |

The N2 consumer recipe (`node docs/progress/n2-size-and-bundle.mjs compare <initial src> packages/axylo/src`, zlib level 9, tree-shaken consumer bundles), this round:

| Row | Δ B (gzip -9) |
|---|---:|
| root line only | +139 |
| root everything | +148 |
| static line only | +140 |
| static everything | +137 |
| cartesian | +137 |
| `axylo.css` | +31 |

**Core budget.** At most +200 B. The final root ESM is +199 B (`dist/axylo.js`), the IIFE +158 B, and the consumer root line +139 B. All are within budget. The margin on the root ESM is 1 B.

**Opt-in root tax: 0 B.**
- An esbuild metafile of each entry shows 0 `src/cartesian/**` or `src/finance/**` modules in the `index` (root), `static` and `stream` graphs, before and after. Cartesian has 15 and finance 6, both unchanged. Rechecked this round against base and final.
- No file under `src/cartesian/**`, `src/finance/**` or any other opt-in module changed.
- `stats`, `sync` and `export` are byte-for-byte unchanged.
- The cartesian and finance deltas are their own copy of the shared core change.

## Manual assistive technology and hardware

Each cell needs a person, real hardware or a real screen reader. Nothing here was rehearsed.

| Cell | Status |
|---|---|
| NVDA + Firefox, Windows | **OPEN (manual hardware/AT required)** |
| JAWS + Chrome, Windows | **OPEN (manual hardware/AT required)** |
| VoiceOver + Safari, macOS / iOS | **OPEN (manual hardware/AT required)** |
| TalkBack + Chrome, Android | **OPEN (manual hardware/AT required)** |
| Native Windows High Contrast | **OPEN (manual hardware/AT required)** |
| Real physical phone touch | **OPEN (manual hardware/AT required)** |

Specific checks are left for those rehearsals. Nothing in this cycle can answer them:
- whether screen readers speak the separately tagged plot name in its own language (most use one voice per accessible name);
- whether the `none`-mode tap announcement is spoken while the proxy is unfocused;
- whether the polite confirmation of a same-page jump is spoken after Enter in a text field.

## Assumptions and ambiguities

- **Fallback language of the label.** When `plotLabel` is translated, the label gets the page language. This mirrors `renderInstructions`, where text outside the proxy's language is tagged with the page's language. The DOM would give the same language by inheritance, because the span is not a descendant of the proxy.
- **Label id scope.** Collisions are checked in the label's own tree. `core/chart.ts`'s figure allocator checks the document and the innermost shadow root. For an IDREF only the own tree matters, and checking both cost about 10 B more.
- **Announcement scope.** Every explicit touch tap that resolves a datum in the layout's `none` mode, with tooltips on, is announced. That includes a second tap on the same datum: the reader asked again. A mouse click is not announced, because it focuses the proxy.
- **Same-datum value change (F-A11Y-5).** After a histogram append into the focused bin, the test expects the new count in `aria-valuetext` (A3: the reading describes the focused point) and no live-region mutation. The reading is `{x}. {values}. {position}` with `seriesValue` `{series} {value}`, so only `Count 1` → `Count 2` changes. The bins are fixed, so the position stays "Point 2 of 4".
- **Histogram `select` payload.** `y` is assumed to be the bin's count, the histogram's value (series label `Count`). Only equality across the append is assumed for `x`, `index` and `series`.
- **Count-only append (F-A11Y-5).** The test expects an unchanged `aria-valuetext`, so data arriving does not speak (A7), while `max` grows. The position words in the text can therefore lag the count until the reader moves. That is the documented trade-off in `core/focus.ts` `datumReading`.
- **Eviction (F-A11Y-5).** Only "focus stays on the proxy, on a retained datum (x 9–16), and nothing speaks" is asserted. The spec does not say which datum focus moves to.
- **"Eight-control toolbar".** Assumed to be a zoomed, streaming single-series line: Zoom in, Select range, Zoom out, Pan left, Pan right, Reset zoom, Pause, View as table. The test asserts those named controls and at least 8 buttons.
- **400 % at 320 px.** Taken as 320×256 CSS px at device scale 4, as N2's `320x4` case does. The body margin is 0, so the floating tooltip's 240×140 threshold can be reached at 320 px.
- **Log axis evidence.** The right axis is taken as logarithmic when at least three power-of-ten tick labels are evenly spaced per decade (±1.5 px). Compact tick text (`1K`, `10K`, spec F6) is parsed back to numbers.
- **Finance reading form.** Parity accepts a named value as `name value` (the aligned `seriesValue` form) or `name: value` (the OHLC summary form), whichever mode the reading uses.
