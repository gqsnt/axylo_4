## Review: packages/axylo/src/view, src/scene and their tests

Baseline: the 40/40 tests in `npx vitest run packages/axylo/test/view packages/axylo/test/scene` pass. `tsc -p packages/axylo --noEmit` reports no errors in the reviewed files. Every experiment ran from my scratchpad (`/tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/opusrev/*.test.ts`).

### Findings, most severe first

**1. B — view/index.ts:124-148, 276-277 (`alignedExtrema` over `visibleSlots` only). A zoom window with no value in it gets the "no data" domain while a segment is drawn through it.**
- Input (ran): a line of `[50,60,70,80]` at x=0..3 with zoom `[1.2,1.8]`.
- Observed: `visibleSlots {2,2}`, `drawSlots {1,3}`, `yDomain [0,1]`. The path is drawn at y ≈ -5880…-6880, so the plot is empty under a 0–1 axis.
- Same with monthly data `2026-01..04` (values 1200–1350) as an area zoomed to `['2026-02-05','2026-02-20']`: `yDomain [0,1]`, upper edge at y ≈ -125,000. The fill therefore covers the whole plot.
- Same class: a long-form series with only SLOT_NO_ROW in view is drawn from x=0 to x=6 at y=9 while `yDomain` is `[0.9,1.1]` (taken from the other series), so it is entirely off-plot.
- Spec: F7, and the view/scene contract that drawSlots exist so the line reaches the plot edge. Here the domain and the drawn geometry disagree.
- Fix: per visible series, when `drawSlots[i]` is wider than `visibleSlots`, add to the extrema the values interpolated at `xDomain[0]` and `xDomain[1]` along the joined segment. Do the same on stack totals. Add the cases above as tests.

**2. M — view/index.ts:189-191. A zoom outside the data, or of zero width, collapses `xDomain` to a point.**
- Input (ran): `[50,60,70,80]` with zoom `[10,20]` gives `xDomain [3,3]`; zoom `[2,2]` gives `[2,2]`.
- Observed: the degenerate linear scale maps every slot to the plot centre. The scene draws a vertical stroke `(80,120)→(80,70)→(80,20)` that is not in the data.
- Spec: F2 and F5 (fidelity); the brief's "clamped into xFull" was not meant to produce an empty-width window.
- Fix: keep the zoom width and shift the window inside `xFull` (use `xFull` if the zoom is wider). Reject or widen a zero-width zoom, reporting it.

**3. M — scene/bars.ts:69-86 together with render/geometry.ts `missingBox`. The "no data" mark is invisible when the baseline lies on the far plot edge.**
- Input (ran): category bars `A:-4, B:null`, auto domain `[-4,0]`.
- Observed: the scene emits `[80,20,70,0]`; `missingBox` grows it upward to y 14.75…19.25, entirely above `clip.y = 20`. Horizontal bars give `[150,53.3,0,50]`, grown to x 150.75…155.25, right of the clip.
- Consequence: in all-negative charts a missing bar looks exactly like a zero bar.
- Spec: F2 ("a 'no data' mark at the baseline, distinct from a zero bar").
- Fix: when the baseline sits at the top edge (or right edge when horizontal), emit an explicit `MISSING_MIN` extent pointing into the plot (`h = 6` downward, or `x = baseline - 6, w = 6`). Alternatively the renderer could grow the box toward the plot interior; agree this with the render owner.

**4. M — scene/index.ts:85 (`seriesPaint(k)` with k = slice index). Donut paints wrap modulo 8.**
- Input (ran): `[5,5,5,5,0,5,5,5,5]`, i.e. 8 positive slices and one zero.
- Observed: fills `[0,1,2,3,5,6,7,8]`. `theme/resolve.ts:30` maps index 8 to colour 0, so the first and last slices share colour 0 and meet at 12 o'clock.
- Same with a grouped ring such as `[9,0,0,8,7,6,5,4,3,1,1]`, where a kept slice lands on k=8 (by code reading).
- Spec: F9 and A5 (eight slices, no shared colour).
- Fix: assign paints by drawn ordinal, or by ordinal among non-"Other" positive entries, and have the legend use the same mapping. The brief's "slice k uses series paint k" causes this, so the owner needs to decide.

**5. M — view/index.ts:77 (`marker = SHAPES[i % 8]`, colour also i mod 8). Beyond eight series, series i and i+8 are identical in scatter, and every bar is.**
- Input (ran): 9-series scatter.
- Observed: series 0 and 8 are both palette 0, `circle`, size 6, and points have no dash. A 9-series bar chart gives series 0 and 8 the same fill and nothing else; RectMark has no dash or marker. AX130's message still says "uses dashes or markers".
- Spec: F9.
- Fix: for i ≥ 8 use `SHAPES[(i + Math.floor(i/8)) % 8]`, which leaves the first eight unchanged and makes (colour, marker) unique up to 64 series. Bars need a contract change (a pattern or hatch on RectMark); report it as such.

**6. M — scene/bars.ts:8-29 (band extents clamped to the plot) and view `xFull` for continuous-x bars. The first and last bars are half width and grouped bars sit off their x.**
- Input (ran): numeric x 0..3, two series, 140 px plot.
- Observed: slot 0 is `a [10, 9.33]`, `b [19.33, 9.33]` (total 18.67 px). Interior slots are 37.33 px. Both bars of slot 0 sit right of x=0.
- Under zoom (by code reading, bars.ts:33): bars whose centre is just outside `xDomain` are not drawn even though their body overlaps the plot, so edge bars pop in and out.
- Spec: the brief's "each band divided among the visible series"; F7 (bars fully inside the domain).
- Fix: widen `xFull` for continuous-x bars by half of the nearest slot spacing at each end. Draw slots whose band overlaps `xDomain`, and let the clip trim them instead of clamping the extents.

**7. M — view/index.ts:16 and view/references.ts:19-26. The zoom state accepts only values in the axis's written format, never axis positions.**
- Observed (ran):

| Axis | Numeric zoom | `Date` zoom |
|---|---|---|
| time, inferred | AX107, ignored | applied |
| date, inferred | ignored | ignored |
| wall, inferred | ignored | ignored |

- Consequence: an interactive zoom computed with `invert(pixel)` cannot be expressed on date or wall axes. On date axes it cannot be expressed below a day at all.
- Spec: 3.6 (zoom "Yes" on time and date axes).
- Fix: take zoom in axis positions in the view state and parse XValue at the public `zoom()` boundary. Alternatively, treat finite numbers as positions for every non-category kind.

**8. M — view/index.ts:186-188 and scene/index.ts:64. An x reference outside the data is dropped silently.**
- Input (ran): data x 0..5, reference `{x: 8}`.
- Observed: it resolves, but `xFull` stays `[0,5]`, no rule is drawn and no diagnostic is raised.
- Spec: F7 ("the automatic domain contains all data, reference lines…") and 3.6 ("included in the domain").
- Fix: widen the automatic `xFull` by x references, or report the omission.

**9. M — view/index.ts:184-188. An author x domain narrower than the data is ignored; spec and brief disagree here.**
- Input (ran): `x.domain [2,4]` with data 0..10.
- Observed: `xFull` and `xDomain` are `[0,10]`; a zoom to `[5,9]`, beyond the author's bounds, is accepted.
- Spec: F7 ("the zoomed view is inside the author's domain if given"). The brief, and the test at view.test.ts:9, say "widened by", meaning a union.
- Fix: the owner should decide. Per F7, use the author domain as `xFull` when one is given.

**10. M — view/stack.ts:22-27 and view/index.ts:272-274. The stack is rebuilt over the whole frame on every new frame revision.**
- Input (ran): 1,000,000 slots × 3 series, stacked area zoomed to 1%.
- Observed: zoom-only rebuilds take about 0.15 ms because the stack is reused. A new revision (an append) takes 50 ms and allocates 6 × 8 MB Float64Arrays.
- Brief item 3: work should be bounded by what is visible.
- Fix: accumulate only the union of draw slots (StackView would need an offset; note it as a contract change), or extend the previous stack incrementally when the buffers are shared.

**11. M — test/scene/scene.test.ts:347-361 and test/view/view.test.ts:193-212. The property tests cannot reach most of the brief's cases.**
- `stacked`, `horizontal` and dpr are all the same boolean `flag`, so stacked vertical bars, unstacked horizontal bars, and dpr 2 without stacking are never generated.
- There is no zoom (so the "except outside the zoomed domain" clause is never exercised), no author domain, no long-form data (no SLOT_NO_ROW or SLOT_GAP), no hidden series, never more than 18 rows (the simplified path never runs), and no x references.
- The stack property is wide-form with nulls only.
- No test covers continuous-x bars, horizontal stacked bars, the yDomain under zoom in a scene, donut palette wrap or scatter beyond eight series. Findings 1–6 all pass the current suite.
- Fix: draw those flags independently and add those generators, plus fixed tests for findings 1–6.

**12. m — view/index.ts:75. The contrast dashes are a 1 px ramp.**
- `[2+i,3]` gives `[3,3]`, `[4,3]`, … `[9,3]`; with 20 series it reaches `[21,3]`.
- Under forced colours every series is CanvasText (theme/css.ts:29), so neighbouring series differ only by a 1 px dash length, and series 0, 8 and 16 also share the circle marker (by code reading).
- Spec: A5 and F9 (the series must actually be distinguishable).
- Fix: use a small set of qualitatively different patterns (solid, long dash, dot, dash-dot, …) combined with the marker offset from finding 5.

**13. m — scene/lines.ts:35-36. The 12 px marker rule uses the average spacing.**
- Input (ran): x `[0, 0.01, 0.02, 0.03, 10]`.
- Observed: five markers, four of them within 0.42 px of each other.
- Spec: L5 ("adjacent points at least 12 px apart"); the brief says "on average".
- Fix: use the minimum adjacent spacing of the drawn values.

**14. m — scene/bars.ts:69-70. In stacks, the missing-component mark overlaps the next segment.**
- Input (ran): `A: a=4, b=null, c=2`.
- Observed: the mark for b is at y=50 and the renderer grows it to y 44–50; c's bar occupies y 40–49 and the mark is drawn over it.
- Fix: place the missing-component mark beyond the stack's outer end, or beside the stack.

**15. m — view/references.ts:54-58. Wrong diagnostic code for a band with equal bounds.**
- Input (ran): `{x:[1,1]}`.
- Observed: the reference is dropped and AX150 is raised. AX150 is "Unknown option key" (spec 3.5).
- Fix: use a fitting code, or draw it as a line.

**16. m — view/references.ts:3-4, 25-26. The view imports data internals and drops some diagnostics.**
- It imports `data/x` (`XParser`, `nameOf`) and `data/reports`, which `data/index.ts` does not export.
- The `Reports` object built there is never flushed, so AX112 and AX109 raised by option values are discarded silently (by code reading).
- Fix: ask the data owner to export a parser, and flush or deliberately drop these reports.

**17. m — view/index.ts:69-70 and 206. Diagnostics are re-raised on every rebuild, including rebuilds that return the previous view.**
- Observed (ran): with one sink kept across three zooms, AX130's count reaches 4. The contract's sink adds counts on merge.
- Fix: report only when there is no previous view or the condition changed, or document that callers pass a fresh sink per build.

### Areas I tried hard to break and could not
- **drawSlots and visibleSlots at the data edges:** NULL, GAP and NO_ROW runs at either edge, empty ranges, start 0 and end = length all match the join rule exactly.
- **Stacking:** mixed signs, hidden and non-drawable series, incomplete stacks, zeros and -0, a single series and overflow clamping all agree with hand sums.
- **Scatter ranges:** the binary search includes every duplicate at both edges.
- **Donut grouping:** exactly 8 versus 9 positive entries, ties at the cut-off (earlier wins), all-zero, a single full-circle slice (`[0, 2π]`, drawn as a full ring by the renderer), and ratios summing to 1 all behave as specified.
- **Wide property test (1,463 cases):** zoom, author domains, long form, dense data, dpr 1, 1.5 and 2, huge values, every kind and flag. Zero non-finite coordinates outside NaN pairs, zero negative or out-of-plot rectangles and bands, zero run overflows.
- **Line geometry:** vertices land exactly on projected points; NaN pen lifts appear only at non-joinable breaks and never at NO_ROW; isolated values become points; simplification starts exactly above 4 × plot columns; a 1M-point series zoomed to 1% builds its view in 0.6 ms and its scene in 2.9 ms.
- **Areas:** the unstacked baseline sits at projected zero; stacked bands share the identical boundary arrays; mixed-sign runs are correct.
- **Decorations:** axes, ticks, grid, references, horizontal swapping and z-order are all correct.
- **View reuse (400-case property):** a view reused through `previous` always equals a freshly built one; frames and previous views are never mutated.

Housekeeping note: before I moved to my own folder, I wrote `/tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/exp/vitest.config.mjs` at 02:38. That folder holds another agent's files, so I may have overwritten their config.
