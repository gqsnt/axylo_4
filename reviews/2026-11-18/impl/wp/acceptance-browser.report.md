<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a61d95e46b3f0f3aa. Saved by the coordinator from the hand-back. -->

## Browser acceptance suite: report

I wrote 457 browser tests under `packages/axylo/test/browser/acceptance/`. On the default SVG renderer, 443 pass and 14 fail. Each failure is either a spec point the build does not meet or a reading of an ambiguous sentence that I marked "(reading: …)" in the title. Nothing outside my directory was edited and nothing was committed. `tsc -p packages/axylo --noEmit` reports no errors in my files.

**The build changed under me.** Other agents rebuilt `dist` at 06:14 and 06:20 and kept editing `src` (`dom/tooltip.ts`, `dom/interaction.ts`, `dom/figure.ts`, `theme/css.ts`, `dom/table.ts`). Before the final run I ran `npm run build` myself. The final run started at 06:21:31.

Some results moved between builds:
- **Started passing:** single-click Pan buttons (I3), a visible "Jump to" error (A4), the note staying in the figure (F12 bar), the A7 position-text test, the dark-scheme palette.
- **Changed how it fails:** the I1 bar test. It first failed because pointing at the plot's bottom row showed nothing; now it fails because the tooltip leaves the viewport at the top edge.
- **Gaps you listed that now pass:** pan buttons and the jump error.
- **One gap not tested:** category-axis zoom being off is the spec's own rule ("on time, date and numeric x only"); the T-zoom-bar test checks exactly that and passes.

### Files
- Tests: `a1-names`, `a2-keyboard`, `a4-table`, `a5-not-colour-alone`, `a6-a10`, `f12-note`, `f8-donut`, `f2-gaps`, `l-legibility`, `i1-pointer` (I1–I6), `type-matrix`, `compact` (each `.browser.test.ts`).
- Helpers:
  - `util.ts`: pages, the accessibility tree via CDP, tab stops, shape and colour readers.
  - `fixtures.ts`: hand-written data and expected text, plus copies of `dirty`, `bars` and `parts`.
  - `text.ts`: rotated text boxes and a 1 px overlap test.
  - `vision.ts`: OKLab and Machado 2009 colour-vision simulation.
  - `prod.html`: the minified production bundle.
- `EVIDENCE.json`: 457 entries, one per test, built from the Vitest JSON report.
- Scratch files are removed.

### Test counts (ran and saw, final run)
| Criterion | Tests per type (failing in brackets) |
|---|---|
| A1 | line 8, area 8, bar 8, scatter 8, donut 7, compact 7 |
| A2 | line 9, area 9, bar 8, scatter 8, donut 6 |
| A4 | line 6, area 5, bar 4, scatter 5, donut 4 |
| A5 | line 7, area 7, bar 5 (1), scatter 4, donut 4, compact 6 |
| A6 (Chrome only) | 2 each for line, area, bar, scatter, donut |
| A7 | 3 each for line, area, bar, scatter; donut 2 |
| A8 | 1 per type, including compact; each test covers every state |
| A10 | 2 per type (1 failing in each) |
| F12 | line, area, bar, scatter 5 each; donut 6 |
| F8 | donut 6 |
| F2 | line 3, area 3, compact 2, bar 2, scatter 1, donut 1 |
| L1 | 3 per type (line, area, scatter and donut each 1 failing) |
| L2, L4, L7 | 2, 3 and 2 per type, compact included |
| L3, L8 | 3 and 2 per full type |
| L5 | line 1, area 1 |
| L6 | 2 each for line, area, bar, scatter; donut 1 |
| I1 | line 4, area 4, bar 4 (1), scatter 3 (1), donut 2 |
| I2 | 1 each for line, area, bar, scatter |
| I3 | 5 each for line, area, bar, scatter |
| I4 | 2 per full type |
| I5 | 3 per type, compact included |
| I6 | 1 per full type |
| T-pointer, T-tooltip, T-keyboard, T-zoom, T-dense, T-limit, T-reference | 1 per applicable type each |
| C1 / C2 / C3 / C4 / C5 | 12 / 5 / 3 / 3 (1) / 3 |

### Failing tests (ran and saw)
1. **A10, all 6 types: the summary is not marked `lang="en"` on a `lang="de"` page.**
   - Spec: "Built-in English text is marked lang="en" when the document language is not English."
   - Expected (reading): the generated summary sentences are built-in English and should be marked.
   - Page: `.axylo-summary` has no English `lang` ancestor. The note, toolbar, plot and pager are marked correctly.
   - Likely cause: `src/dom/figure.ts` `update()` sets `lang` only on the note and the message, and `FigureModel` has no summary language field.
2. **A5 bar: grouped bars touch.**
   - Spec: "Adjacent filled marks … are separated by at least 1 px of background."
   - Page: the two bars of a group touch; background coverage between them is 0.22 px.
   - Likely cause: `src/scene/bars.ts` lines 71–75, where `width = part`, so there is no gap inside a group.
   - Reading: grouped bars count as adjacent filled marks, although the spec only names slices and stacked segments.
3. **C4 compact bar: two compact bar series differ by colour only.**
   - Page: both series draw with dash `none`, no fill pattern and no other cue.
   - Reading: C4 names lines; I applied "never by colour alone" (A5) to bars.
   - Likely cause: `src/scene/bars.ts` and the compact cue logic in `src/view` give compact bars no cue.
4. **L1, line, area, scatter and donut, 200 % text only.**
   - Spec: zero text outside the figure.
   - Page: at 240 and 320 px wide (360 px tall), the chart falls back to the too-small state (L8). It shows the whole multi-sentence summary, which overflows the figure, and "View as table" ends up outside it. On the donut, the legend list overflows too. With plain text and with the WCAG text-spacing overrides, all widths pass.
   - Likely cause: `src/dom/figure.ts` (`summaryVisible`) shows the full summary, while L8 asks for a one-line summary.
5. **I1 scatter: one point cannot be picked.**
   - Setup: a full-viewport chart (body margin 0, chart 100vw × 100vh). The point EU (20 kB, 140 ms) sits on the plot's top edge and shares x with US (20, 100).
   - Page: pointing exactly at it, or 10–12 px away, shows neither a tooltip nor the readout. The same point is pickable in the default 720 × 400 layout.
   - Likely cause: `src/lookup/scatter-grid.ts` (`pick`, its row/column edge handling). Not confirmed.
6. **I1 bar: the tooltip leaves the viewport.**
   - Spec: the tooltip "stays inside the viewport".
   - Page: pointing at the top edge of the plot in a full-viewport chart puts the tooltip partly outside the viewport, at all 7 columns.
   - Likely cause: `src/dom/tooltip.ts` placement, which was being edited during the run.

### Not covered, and why
- **Cannot be verified here:** A3 with a real screen reader, A6 in Firefox and Safari, phone behaviour for I4, GPU rasterisation. A6 and I4 were run in Chrome only, with emulated touch.
- **L1 with a late-loading font:** no font file is available offline.
- **I5 "24-chart filter change settles within 200 ms":** a timing budget, so it is left out.
- **A9:** a document, not a browser test.
- **Node side:** F1, F3–F7, F9–F11, DX and P are left to the Node suite. F5 has only its rendered half here (T-dense-line and T-dense-area).
- **Canvas renderer:** not run; the known canvas separator gap is therefore not exercised.
- **Note text and placement:** these tests rely on a `waitForFunction` wait. It gives the note time to appear and then asserts on it.

### Spec ambiguities and the reading chosen
| Topic | Reading |
|---|---|
| Value format | Number, a space, then the unit ("12 kWh"). Dates use the en-US medium form. |
| Summary "y range" | The data's minimum to maximum, not the axis. |
| Scatter "last" | The point with the largest x. |
| Donut summary | Each slice's value and share. |
| Table jump field | WCAG 3.3.1 applies: an unmatched value needs visible error text. |
| Separators | Anti-aliased background coverage summed between the two marks is at least 0.75 px. A rect geometry check is added for stacked bars. |
| Grayscale A5 | Binarised last-point markers overlap by at most 85 % of their union, at DPR 2. |
| A7 | A focused range whose value text changes is spoken, so its position must not count arriving rows. This now passes. |
| F12 "changed" | An AX160 formatter fallback counts as a changed value; AX121 grouping does too. |
| L1 200 % text-only zoom | Twice the inherited font size. |
| Tooltip hover (WCAG 1.4.13) | The pointer moves onto the tooltip in one step. With a slow sweep the content follows the pointer on nearest-x charts. |
| Scatter zoom "x only" | The y domain is unchanged after an x zoom. |
| I5 slack | Settled 300 ms after an update (200 ms plus 100 ms of slack). |

### Last lines of the final run (default renderer, ran and saw)
```
 Test Files  5 failed | 7 passed (12)
      Tests  14 failed | 443 passed (457)
   Start at  06:21:31
   Duration  221.13s (tests 99%, import 1%)
```
Run with `npm run build` then `AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser/acceptance`.
