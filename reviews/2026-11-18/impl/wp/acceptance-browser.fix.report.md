<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a61d95e46b3f0f3aa, resumed. Saved by the coordinator from the hand-back. -->

## Browser acceptance suite, strengthening pass: report

On a fresh build at 08:15, after the core's fourth pass (HEAD `ed230af`), 495 of 532 tests pass and 37 fail. I believe every one of the 37 is a real product defect, a pending piece of library work, or a strict reading I name below; none is a known test defect. That is less established for the newest checks, where my check of the check is limited to the control that breaks it. Before the run I checked that the bundle was not older than the source. Of the earlier failures, only those that repeated on this build are counted. Nothing is committed, and I edited nothing outside `packages/axylo/test/browser/acceptance/**`. `tsc -p packages/axylo` shows no errors in these files.

New files: `checks.ts` holds the checkers, and `negative-controls.browser.test.ts` holds 11 permanent controls. Each control breaks one behaviour from the test side, in a real chart, and requires the checker to say so:
- **Separator:** 1 px, 0.5 px, 0 px and diagonal gaps drawn in the page.
- **Painted colour:** marks made faint (opacity 0.15), and marks covered by an overlay.
- **Grayscale marker class:** identical markers swapped in.
- **Text overlap:** an injected overlapping label, a clipped label, and two lines overlapping by 1.1 px.
- **Table comparison:** two cells swapped, and two headers swapped.
- **Summary clauses:** the range sentence removed.
- **Value-text reading:** focus taken away with Tab, and the range turned into a text field.
- **Tooltip occlusion:** the tooltip moved over the active bar.
- **Motion:** a 1 s entry fade added, and a 600 ms transition added on update.
- **Reference marks:** the line made transparent, then removed.
- **Dense spike column:** the spike moved 5 columns.

All 11 pass. `util.ts` now says at the top that the suite is evidence for the SVG renderer only, and it throws if `AXYLO_RENDERER=canvas` is set.

### Per review finding

**1 · I5 motion**
- **Change:** screenshots now run with animations on. A new frame tracer, `traceMotion`, records on the page's own clock and per animation frame what the marks paint (markup plus computed opacity, transform, fill, stroke and `d`) and any running animations. First render is checked from the first painted frame for 2.5 s. An update must visibly change the drawing and settle within 200 ms by the page clock; under reduced motion it must reach the final picture in one step. A new 24-chart filter change, per type, must also settle within 200 ms.
- **Negative control:** a 1 s fade and a 600 ms transition are both flagged.

**4 · L2/A5 palette**
- **Change:** colours are now sampled from painted mark pixels: bar interiors, the core of flat strokes at device pixel ratio 2, scatter points at ratio 4, slice interiors. The backdrop is the painted background. An empty sample is a failure. Scoring covers the analytic simulation and the 8-bit image (`seenRaster`). L2 now samples axis lines and the focus ring as painted, with at least one sample required, and measures text against the pixels actually behind it.
- **Negative control:** faint marks and covered marks are both flagged.

**5 · A5 separators and grayscale**
- **Change:**
  - Every seam is measured across its normal: stacked, grouped and horizontal bars, stacked areas, and all four donut seams including the closing one at 12 o'clock. The measure is checked against a 1 px control drawn in the same page at the same angle, scanned the same way.
  - Bars also get a geometric check of at least 1 px, allowing 0.011 px for SVG's 0.01 px coordinate rounding.
  - The invented 85 % grayscale overlap is gone. In its place, each crossing trace's last-point marker must have the same shape class (judged on a grayscale image) as its legend marker, and the three must differ from each other. Whether a reader can follow the crossing lines is stated in the title as a human judgement.
- **Negative control:** separator and marker controls, as listed above.

**6 · L1/L8/A6 text**
- **Change:**
  - Text boxes are now the part actually painted, each marked whole, clipped or ellipsised; text cut by an ancestor's overflow counts as cut. Lines of the same element are now compared too.
  - Remedies are checked: at most three lines, rotation of at most 45°, middle truncation with the full text in the table, and the note plus AX143 for unordered categories. Bars must keep their orientation.
  - A late-font test (DejaVu loaded through `FontFace`) and a 12-label bar test at 240 px are new.
  - L8 now shrinks the container 1 px at a time. The last drawn plot must be between 120 and 122 px wide (between 80 and 82 px high), and the summary must stay on one uncut line.
  - A6 emulates 400 % zoom as 320 × 256 CSS px at device pixel ratio 4.
- **Negative control:** text controls, as listed above.

**7 · I1 tooltip**
- **Change:**
  - Every probe now has an active mark, and a probe without one fails; bars count as whole rects.
  - Time from move to readout is counted in animation frames (95th percentile no more than 1).
  - The hover test moves slowly, straight across the reading axis (decision 0004), and hit-tests the tooltip at the end.
  - Row identities are checked on both the tooltip and the readout.
  - The 24 px radius is bracketed (23 and 25 px), and the tie test runs with the rows in both orders.
  - Horizontal bars and hidden area and bar series are covered. A new test checks that neither the tooltip nor the readout ever covers a control.
- **Negative control:** occlusion control.

**8 · A1/A4**
- **Change:**
  - A1 now checks each named summary statement, each in a sentence of its own. The author-description case requires the ranges, the zone and the omission as well as the author's text.
  - A4 compares the ordered headers and every row exactly.
  - New: date and number zoomed bars, and a 24-tile layout test.
  - The fixture's `number()` now accepts integers only, so the 0.000123456 rounding problem cannot recur.
  - The donut fixture is now unsorted: 360, 1200, 240, 600.
- **Negative control:** table and summary controls.

**9 · A2/A7 focus**
- **Change:**
  - `valueText` now throws unless the range has focus and Chrome exposes it as an unignored slider. The value text is labelled as coming from a DOM attribute; the range's numeric value comes from Chrome's tree.
  - The focus indicator is now checked as painted pixels: the plot outline on all four sides, and the overlay ring around the datum. Tooltip clearance is measured against both.
  - A7 now uses a sliding window (decision 0004): the text is unchanged while the datum stays; the numeric position follows it; eviction rewrites the text once; the next key reads the current count. Donut is included.
- **Negative control:** value-text control.

**10 · L7/A7/I6**
- **Change:**
  - L7 state messages are now exact (set through `messages`), checked for their geometry and absent ticks. Each transition (loading to ready, ready to error, ready to internal failure) must produce exactly one polite announcement.
  - The A7 observer now also catches live regions inserted already populated.
  - While paused, I6 freezes the marks, the description, the value text and the open table. After Resume, each buffered row must appear once, with its values.

**11 · A8**
- **Change:**
  - Every state is now checked to hold before the scan.
  - The scan runs on a page with landmarks and a page heading, with all rules on.
  - `heading-order` must complete (pass or fail, not be left incomplete).
  - A 250-row table must actually scroll, and `scrollable-region-focusable` must complete.
  - Added: a paused chart, a hidden series on bar and scatter, and compact area and bar.

**12 · A10**
- **Change:**
  - The message map is now typed as a record over `keyof Messages`, so it stops compiling when a key is missing. It did exactly that for `totalMixed`, `incompleteAt` and `incompleteCount`, which are now added.
  - Each applicable key's own sentinel must reach a reader surface.
  - The lang check now follows the element the figure's `aria-describedby` points to, not a class name.
  - Keys no surface uses (`referenceSummary`, `showSeries`, `hideSeries`, `value`, `labelsHidden`) are recorded with the reason.

**13 · T-dense/C2**
- **Change:**
  - Fixed domains. At device pixel ratios 1 and 2, a spike and a dip must each be drawn in their own device-pixel column and nowhere else. A break inside one column must be kept.
  - A sample the drawing dropped must still be reachable through the table. A stacked case checks the cumulative spike.
  - Bars, scatter points and donut slices are identified by where they are drawn, not by counting elements.
- **Negative control:** spike control.

**14 · T-limit/F8**
- **Change:** eight series must raise no AX130 and nine must raise it, with one painted cue per series (colour, dash, marker or pattern) and nine distinct. Donut grouping is scrambled, so the seven largest are not the first seven. Arcs, legend, table and the empty and error messages are checked exactly.

**15 · T-reference**
- **Change:** a reference line and a band, each outside the data in turn, must widen the domain. Each must be painted: the line in the reference colour, the band as the composite at its computed opacity. Each label must sit next to its own mark. The donut must draw no reference mark at all.
- **Negative control:** reference control.

**16 · F2/F12**
- **Change:**
  - Each date chart is checked for its gap on its own, as well as for equal geometry.
  - `missing: 'zero'` is tested for line, area, bar and compact.
  - Scatter points are identified by position, and the null row must read "No data" in the table. Donut arcs are identified by angle and colour.
  - The F12 changed-value notes are worded through `messages` and asserted exactly: "CHANGED 1.", "CHANGED 3.", never "LOST", together with AX160 and AX121.

**17 · I2/I3/I4**
- **Change:**
  - I2: marks are checked after each of click, Enter and Space.
  - I3: Zoom out, Meta+wheel and the pinch without `zoom: 'touch'` are now covered. For the plain pinch, the chart must not cancel the touch events. Zoom also runs on date and number bar axes. Keys are checked one at a time.
  - I4: selectable tooltip rows are measured as controls; taps operate the legend, Zoom and the table; scroll is compared with the position before the drag.

**18 · L3/L4/L5**
- **Change:**
  - L3: a known datum must be at the same position, and hoverable, after each resize. A table opened in an auto-height chart must stay in the figure.
  - L4: scheme and text colour are put in conflict. Five root triggers are each checked in the first frame after the change, then on pixels. A media change is checked, and forced colours are checked when switched on at run time.
  - L5: the 12 px threshold is bracketed at 11 and 13 px.

**19 · Compact**
- **Change:** every check now runs for compact line, area and bar.
  - C1 requires the whole page to be unchanged after hovering and clicking.
  - C2 checks the zero baseline against heights derived from the data, plus motion and scheme.
  - C3 checks positions derived from the data at each size.
  - C4 measures bar texture from painted pixels, so the child-rect pattern now counts. The earlier residual failure is gone: compact bars pass.
  - C5 requires a painted corner marker inside the figure.

**Settled spec readings added:** F10 mixed-sign readouts (area, bar); F9 bar cues up to 32 series; F8 zero and null slices not counted toward the limit.

### Tests that now fail (on the 08:15 build)

**Pending, not a finding yet**
- **A10 area, A10 bar:** `incompleteAt` and `incompleteCount` never reach a surface. The library does not use them yet; another agent is implementing them. `totalMixed` already reaches a surface.

**A2, all five types: focus indicator covered or cut off**
- **Spec:** "The focus indicator is … not hidden by the tooltip". Reading: no part of either indicator is covered.
- **Observed:** on line, the tooltip covers the plot outline at the first datum. On line and area, the datum ring at the last point is drawn at x 739, outside the 736 px figure, so it is not painted. On bar, the tooltip covers the top line of the ring. On donut, the ring is clipped at 12 o'clock.
- **Suspected cause:** `src/core/focus.ts` (the ring is placed outside the plot) and `src/dom/tooltip.ts` (the avoid-box does not include the ring).

**A7 bar: value text rewritten on append**
- **Expected (decision 0004):** the text is not rewritten while the datum is unchanged.
- **Observed:** "Q3 … Point 3 of 4" becomes "Point 1 of 4" when the category window slides.
- **Suspected cause:** `src/dom/interaction.ts`, the category `remapper` path in `commit`.

**I1, all five types: tooltip not hoverable**
- **Expected:** the tooltip can be reached by a slow, straight approach and stays put.
- **Observed:** on line, area and bar it moves away (hit-test lands on the plot). On scatter and donut it closes on the way.
- **Suspected cause:** `src/dom/tooltip.ts` and `pointAt` in `src/dom/interaction.ts`.

**I1, all five types: tooltip or readout covers controls**
- **Observed:** controls such as Pan left at the plot's left edge, legend and toolbar buttons are covered, in the default size and in a 300 × 260 tile. This breaks decision 0004 ("never covers the controls").
- **Suspected cause:** `src/dom/tooltip.ts` placement and the readout's reserved space.

**I1 bar: active bars covered at the top edge**
- **Observed:** at the plot's top edge the tooltip goes below the pointer and covers the active bars.
- **Suspected cause:** placement in `src/dom/tooltip.ts`.

**I4, all five types: selectable tooltip rows too small**
- **Spec:** "Every control is at least 24×24 CSS px".
- **Observed:** the selectable tooltip rows are about 17 px tall.
- **Suspected cause:** `src/theme/css.ts`, `.axylo-tooltip-choice`.

**L1 line, area, scatter: late font**
- **Observed:** after a late font, the y tick labels overlap the y-axis title, and on scatter "1M" is clipped.
- **Suspected cause:** no relayout after the font loads (`src/core/controller.ts`, `src/layout/labels.ts`).

**L4, all six types: one frame too late**
- **Spec:** "repaint within one frame".
- **Observed:** after a class change on `<html>` the marks keep their light colours in the first frame. They become dark later.
- **Suspected cause:** `src/theme/watch.ts` (an asynchronous observer).

**L8 scatter, L8 donut: summary wraps**
- **Spec:** "the one-line summary".
- **Observed:** "Scatter chart with 2 series." and "Donut chart with 4 slices." wrap to two lines. The core now wraps by design, so you may want to settle this reading.
- **Suspected cause:** `src/theme/css.ts` and `src/dom/figure.ts`.

**T-pointer-scatter: tie does not go to the later row**
- **Spec:** "ties go to the later row".
- **Observed:** with the row order reversed, the same point ("second") still wins.
- **Suspected cause:** `consider`/`later` in `src/lookup/scatter-grid.ts`.

**T-dense-donut: thinnest slice not drawn**
- **Spec:** "No" simplified drawing for donuts.
- **Observed:** the 0.1 % slice gets an empty path `d=""`, so it is not drawn at all.
- **Suspected cause:** `src/scene/index.ts` arcs, where the 1 px gap swallows the slice.

### Still not established, and why
- **Not verifiable here:** screen readers (A3), Firefox and Safari (A6, L1), a physical phone or touch screen reader (I4), GPU rasterisation.
- **Canvas renderer:** nothing (the suite reads the SVG DOM).
- **L1 browser text zoom:** emulated as twice the inherited font size; real browser text zoom is not available headless.
- **Compact simplification** for dense data.
- **F5 at several zoom levels.**
- **Simulated colour vision:** scored on the sampled colours, not on a simulated screenshot.
- **Real speech:** what a focused range's text change actually makes a screen reader say.

### Last lines of the run (default SVG renderer)
```
 Test Files  5 failed | 8 passed (13)
      Tests  37 failed | 495 passed (532)
   Start at  08:15:02
   Duration  397.11s (tests 99%, import 1%)
```

`EVIDENCE.json` is rewritten from this run: 532 entries, negative controls included.
