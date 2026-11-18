<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a61d95e46b3f0f3aa, resumed. Saved by the coordinator from the hand-back. -->

## Alignment pass on the browser acceptance suite: report

The four readings now follow the documents, and the suite has one new negative control. On the final run, 519 of 551 tests pass and 32 fail. Most of the 32 are the new revision-2 checks failing because the library does not do that yet. The build changed under every run (the core author's sixth pass was rebuilding), so none of the 32 should be treated as a finding until it repeats on a settled build. Nothing is committed, and I touched only `packages/axylo/test/browser/acceptance/**`. TypeScript reports no errors in these files.

### What changed

**1. Tooltip hover (decision 0004 revision 2, amended I1), five types.** The hit-test on the tooltip element is gone. In its place:
- **The approach.** The pointer moves in 24 steps from the datum to the tooltip's nearest point, 2 px inside. On line, area and bar every step checks that the tooltip is still shown, its rows are identical, and its rectangle has not moved. On scatter and donut the datum is held only inside the rectangle (rule 3), so those checks start once the pointer is in it. The test ends inside the rectangle, then checks Escape and the move to another datum.
- **Hovered versus pinned.** A hovered tooltip must hold no buttons in Chrome's tree. A click pins it: each row becomes a button at least 24 × 24 CSS px, clicking a row fires `select` for that series, and Escape dismisses it.
- **No stalling (line, area, bar).** A fast sweep through the tooltip's rectangle, one move per x, must show every x label in order. A click inside the tooltip must select the datum nearest the pointer.
- **I4.** Hovered rows are no longer measured as controls. The rows of a pinned tooltip are, and so are the strip's entries for a pinned datum in readout mode; both must be at least 24 × 24 px.

**2. Readout mode.**
- **Thresholds bracketed.** A helper resizes the container by bisection until the plot is at a target size. One side of each limit is checked: a plot 240–241.5 px wide (or 140–141.5 px high) must get a floating tooltip. A plot under the limit must get the strip and no floating tooltip.
- **Exact 239 / 139 px is not reachable.** The reserved strip itself takes height, so a plot just under 140 px may not exist. Below the limit the test therefore accepts any size under it.
- **What the strip must do.** It shows the datum and sits under the plot, on at most two lines. Nothing intersects it and nothing covers it (hit-tested at its centre). Showing and hiding a datum must leave every position in the figure unchanged.
- **Outside readout mode.** At the default size and at 420 × 320, a tooltip shown for the pointer or the keyboard never overlaps a control.
- **Ten-series test.** In readout mode, the strip names the tooltip's series in the same order up to where it is cut, and "+N more" counts the rest.

**3. L8.** The visible summary is now allowed two lines. If it is cut, it must be cut with an ellipsis (`text-overflow` or line clamp), not by overflow. It must equal the first sentence of the figure's description, and the description must carry the full summary.

**4. A10.**
- **Map change.** `incompleteAt` and `incompleteCount` now apply only to the compact type; full area and bar charts are no longer required to show them. The comment in the map cites `src/reader/index.ts` and says full area and bar charts mark incomplete stacks through `incompleteStack` in the tooltip, table and value text.
- **Compact scenario.** It now builds stacked compact area and compact bar charts twice: with one incomplete stack, which should produce `incompleteAt`, and with twelve, which should produce `incompleteCount`, since the library counts above a fixed number of positions.
- **Room for the sentinel texts.** The chart is now 1100 × 900, so the long replacement texts still leave a readable plot.

**New negative control:** "I1 line: the layout comparison flags a strip that takes room in the flow only while a datum is shown". It inserts a 34 px strip into the figure's flow and requires `figureLayout` (new in `util.ts`) to report the change. It passes.

`EVIDENCE.json` is rewritten from the final run: 551 entries.

### Final run
Bundle rebuilt at 09:02 from HEAD `b915b20` with the sixth pass in progress. Default SVG renderer:
```
      Tests  32 failed | 519 passed (551)
   Start at  09:02:14
   Duration  422.80s (tests 99%, import 1%)
```

### What failed on that build

**New revision-2 checks**
- **I1, readout bracket tests (9):** a floating tooltip still appears below the limit.
- **I1, ten-series strip tests (4):** these depend on readout mode.
- **I1 hover, bar and donut:** the tooltip closed at the final step, inside its rectangle. On line, area and scatter the same test passes.
- **I4 line, area, bar, scatter:** a pinned datum gives the readout strip no buttons.

**Also failing**
- **L4, six types:** the first-frame colour change; these were already failing before this pass.
- **Appeared on this build, possibly from the moving build:**
  - **I5 line, area, scatter, donut:** the 24-chart filter change did not settle within 200 ms.
  - **L1 bar, 200 % text zoom.**
  - **L8 bar, scatter, by height:** the last plot drawn before the fallback was taller than 82 px. On the previous build this happened for every type, by up to about 46 px on the donut, which looks like the readout strip's reservation entering the minimum-size check.

**Passing on this build after failing before:** A2 focus indicators, A7 bar, L1 late font, T-pointer-scatter, T-dense-donut, the readout-mode check for donut by width, and the hover test on line, area and scatter. Whether these hold needs a settled build.
