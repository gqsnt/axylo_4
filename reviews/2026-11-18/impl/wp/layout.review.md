Review of packages/axylo/src/simplify/**, src/layout/** and their tests, against reviews/2026-11-18/impl/wp/layout.prompt.md. Reviewer: Claude (same provider as any Claude author, so this is not a cross-provider review).

Baseline (ran): `npm run typecheck` is clean, and `npx vitest run packages/axylo/test/simplify packages/axylo/test/layout` passes 24/24. I ran every experiment below on esbuild bundles of the modules in my scratch directory. I used the tests' 7 px/char, 16 px line-height measurer and the tests' scales.

## Findings

**1. B — Label fitting slows down very fast as the number of categories grows, and no measurement is cached.**
- Where: layout/labels.ts:106-126 (`middleText`), labels.ts:244-256 (the truncation pass), layout/index.ts:97-99 (no cache) and index.ts:124-182 (every margin pass re-measures everything).
- Input: a plain band axis with labels like `Customer Success International Services N`, container width×400.
- Observed (ran, Node, trivial measurer):

  | Categories | Width | Measure calls | Time |
  |---|---|---|---|
  | 40 | 720 | 99,915 | 61 ms |
  | 200 | 720 | 246,643 | 185 ms |
  | 1,000 | 720 | 993,321 | 426 ms |
  | 10,000 | 1200 | 11.5 M | 6.9 s |
  | 100,000 | 1200 | 118 M | 86 s |

- Cause: one `fitBottom` call with 20,000 ticks makes 7.7 M calls, and 95% of them are measurements of truncation candidates.
  - A skipped label does not move `edge`. So many neighbouring labels land in the window where `…` fits but no distinct form does.
  - Each of those labels then measures every split at every length, about L²/2 ≈ 1,000 calls, before it gives up.
  - The layout makes 3 margin passes and repeats all of this each time.
  - In a browser, canvas `measureText` is slower than this measurer, so these times are lower bounds.
- Spec: §3.6 expects "more bars than pixels" to work, with a hint. Layout runs on every resize.
- Fix:
  - Cache widths per string for the whole `computeLayout` call.
  - Make the distinctness check cheap, then search the kept length by bisection (width grows with the number of kept graphemes).
  - Stop early: when `pixel − edge` is below the width of the shortest distinct form, skip the label without measuring.

**2. M — Truncation draws labels that show nothing, such as `…`, `C…` or `…5`, and counts them as shown.**
- Where: labels.ts:115-124 (`minimum = kept >= 2 ? 1 : 0` lets `kept` fall to 1 and 0) and labels.ts:257-258.
- Input: 200 categories `Category number N` at 240×320.
- Observed (ran): 9 labels are drawn: `Cate…er 1`, `…`, `C…`, `…5`, `…8`, `…1`, … `…5` fits category 5, 15, 25, 105 and others. `hidden` counts only the 191 skipped labels.
- Observed in the property's own domain (ran; 2,000 cases, widths 240–1,920): of 30,352 drawn x labels, 865 are just `…` and 5,104 are one character plus `…`.
- Spec: L1 says "no label disappears without the reader being told" and "truncate in the middle". A lone `…` is a label that has disappeared, and `X…` is end truncation, not middle truncation.
- Fix: a truncated label must keep at least one grapheme on each side of the ellipsis (or a chosen minimum share of the text). Otherwise hide it and count it in `hidden`.

**3. M — Truncated labels are distinct strings but cannot be told apart.**
- Where: labels.ts:122. Distinctness is tested only by string equality against `originals` and `used`.
- Observed (ran):
  - `Region North Total` / `Region South Total` at 340 px are drawn as `Region… Total` and `Re…l`. Both fit either original, so the reader cannot tell which bar is North.
  - At 260 px, four `Region X Total` labels become `Region…Total`, `R…`, `…l`, `…`.
  - A linear axis `Week 1 total` … `Week 13 total` at 420 px draws `Week 1…tal` for week 11, right beside `Week 1 total`.
  - 13 ticks `2026-MM-01 00:00` at 600 px become `2026…0:00`, `202…00`, `20…:00`, `2026…0`, … None of them shows the month.
- Spec: L1 asks for every label to be kept distinct, and the brief's test says the labels "stay distinguishable".
- Fix: accept a truncation only if no other label on the axis has the same prefix and suffix. Otherwise keep more of the label, and if it cannot fit, hide it and count it.

**4. M — Horizontal bars with an axis title return `too-small` at 240 px, although a valid plot was possible.**
- Where: labels.ts:271 (`width * 0.4`), with index.ts:140 and 146.
- Input: `kind:'bands', horizontal:true`, labels `Customer Success & Onboarding`, `Engineering Platform Services`, `Sales`, `Marketing Operations`, 240×300, x title `Team`.
- Observed (ran): `too-small`. The left margin is 4 + 4 + 96 + 20, which leaves a plot 112 px wide. Without the title, the same input gives a plot 137 px wide.
- Spec: L8 applies only when the figure cannot hold a 120×80 plot. Here, truncating the labels to 88 px gives exactly 120.
- Fix: cap the label width at `min(0.4·width, width − MIN_WIDTH − the other margins)` before giving up.

**5. M — NaN and Infinity sizes give `plot`, `compact`, `ring` and `message` results with NaN or Infinity geometry.**
- Where: index.ts:188. `NaN <= 0` is false, so the guard lets NaN through.
- Observed (ran):
  - width NaN: a `plot` result whose plot width is NaN, and a ring with `cx`, `r0` and `r1` all NaN.
  - height NaN: plot height is NaN.
  - width Infinity: plot width is Infinity.
  - The message and compact results show the same problem.
- Spec: L3 and the contract say a container without a usable size is `unmeasured`.
- Fix: `if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return unmeasured`.

**6. m — With rotated labels, a tick at the plot's right edge is always hidden, which triggers a needless "labels hidden" note.**
- Where: labels.ts:247-248 and index.ts:125. The right margin is fixed at INSET = 4, but a rotated box reaches sin45·lineHeight ≈ 11.3 px to the right of its anchor.
- Observed (ran): a linear axis 0–12 with 13 `Week N total` ticks at 600 px gives `hidden: 1`, and the missing tick is 12 (at x = 596). AX143 is emitted.
- Fix: when rotation is used, solve a right margin in the margin loop. Alternatively, shift the last anchor inward, as the unrotated path already does.

**7. m — Message text can extend outside the container.**
- Where: index.ts:190-193. There is no inset and no limit on the number of lines.
- Observed (ran): a 65-character error message gives:
  - at 60×20: 9 lines, box `{y:-62, height:144}`;
  - at 10×10: 53 lines, box `{y:-419}`.
- Spec: L1 requires zero text outside the figure. A compact tile (C3, 32 px tall) in its error state is the likely case.
- Fix: inset the text, limit the lines to `floor(height / lineHeight)`, and end the last line with an ellipsis.

**8. m — Whether a value is isolated is decided within the draw range, not the series.**
- Where: simplify/index.ts:94-111.
- Observed (ran): `joinRuns([V,V,NULL,V,V], {start:1,end:5})` reports `isolated:[1]`, although slot 1 is joined to slot 0. In the same way, `[V,V,NULL,V,NO_ROW,V]` with `{0,4}` reports `isolated:[3]`.
- Spec: the contract's join rule defines "isolated" as having no joined neighbour, which is a property of the series. A view that widens `drawSlots` to a value at the range edge would get a marker for a point that is really part of a line (L5, F2). Whether a real view does this is inferred, not observed.
- Fix: at each end of the range, look past the edge across NO_ROW slots for a joinable value before calling a value isolated.

**9. m — The simplification pass takes about 21 ms per million points, not "a few milliseconds".**
- Where: simplify/index.ts:151-161 and 119-121.
- Observed (ran, warm): 20.7–22.7 ms per call in Node at widths 97, 320, 877 and 1920, and DPR 1, 2 and 3. Under vitest the printed times are 23–49 ms. A single fused loop with the same per-column rule runs in about 4.5 ms on this machine.
- Cause: both scans call `mapX` and `Math.floor` for every value. The first scan always maps pixels, even when the result will not be dense.
- Fix: decide density from a count that needs no mapping, map only in the dense pass, and inline the affine map for continuous scales.

**10. m — The million-point timing test cannot fail for any realistic slowdown.**
- Where: test/simplify/simplify.test.ts:113-117.
- The bound is 200 ms, 4–9 times the observed 23–49 ms, and it times a single cold call.
- The brief's target is "a few ms, not hundreds", and a 200 ms limit is already "hundreds".
- Fix: warm up, take the median of several runs, and set the bound near the target (for example 30 ms in CI), or relative to a baseline loop.

**11. m — The layout property test cannot reach findings 2–6.**
- Where: test/layout/layout.test.ts:254-289.
- Coverage: it only generates plain, vertical band axes with a fixed value axis and fixed titles. It never generates horizontal bars, ordered or continuous axes, rings, sizes below 240×160, or NaN.
- Line 275 accepts `too-small` for any input. That result never occurs in its domain (0 of 2,000 runs), so an implementation that always returned `too-small` would pass.
- It asserts nothing about what a drawn label still shows, so the 20% of labels that are `…`-only or one character pass.
- Fix:
  - Generate every kind, ordered axes and horizontal bars.
  - Assert `plot` whenever a 120×80 plot is provably possible.
  - Assert that every truncated label keeps graphemes on both sides and matches only its own source.

**12. m — The simplify property test's oracle copies the implementation's choices instead of checking them.**
- Where: test/simplify/simplify.test.ts:156 copies the density formula `4*(ceil((left+width)*ratio) - floor(left*ratio))`. Lines 146-155 compute runs within the range, which repeats finding 8.
- The generator (130-143) never produces:
  - Float32Array y;
  - x positions more than a fraction of a pixel outside the plot;
  - DPR 3;
  - a range edge whose joined neighbour lies outside the range.
- My own oracle covers Float32 y, DPR 1.25 and 3, offset plot edges, negative pixels and partial ranges. It found 0 mismatches in 3,000 random cases, so the code is right in those cases, but this test would not catch a regression.

**13. m — Duplicate or empty input labels force every label to rotate and invent a different-looking name.**
- Where: labels.ts:180-186 (duplicates count as conflicts at every stage) and `middleText`.
- Observed (ran) at 400×200:
  - `['Same','Same','Other']`: every label is rotated, and the second is drawn as `Sa…e`, which reads as a different category.
  - `['','','A']`: every label is rotated and one is hidden.
- This matters for time or number ticks whose formatter produces the same text twice.
- Fix: hide later duplicates (counted in `hidden`) instead of changing their text, and do not let them force remedies on the other labels.

**14. m — Diagnostics: AX143 can suggest the wrong remedy, and counts can grow with every layout.**
- Where: index.ts:171-176 and 89-95.
- Observed (ran): `fitValue` hiding value-axis labels emits AX143 with "Try horizontal bars", which is irrelevant for a value axis.
- Inferred: AX142 and AX143 are added on every layout call (every resize). The collector adds counts when it merges (diagnostics/collector.ts:23), so counts grow unless the caller uses a fresh sink for each layout.
- Fix: suggest horizontal bars only when the category axis of a vertical chart is the one hiding labels, and make the per-layout emission idempotent (or return the diagnostics with the result).

## Areas I tried hard to break and could not

- **Simplify fidelity (F5, F2):** no failures found. I checked per-column first/min/max/last with ties, extremes at run ends, several runs in one column, value/null alternating within a pixel, NO_ROW joined versus NULL/INVALID/GAP/ABSENT_FIELD breaking, ranges starting or ending mid-run, negative pixels, an offset plot edge, DPR 1/1.5/2/3, NaN `mapX`, Float32 y, and the density threshold at 8 versus 9 values over 2 columns. My oracle found 0 mismatches in 3,000 cases.
- **Float32 packing:** a kept vertex can cross into the next device column (1000.99999 rounds to 1001 at DPR 1, 2 and 3), but only by less than 1e-5 px, which is not visible.
- **Spec wording (not a code defect):** F5's "a gap is drawn whenever a whole column contains no valid sample" conflicts with the contract's NO_ROW join rule. The code follows the contract.
- **Areas:** no failures found. Both boundaries start and end at the same x in every run, bands split exactly where the join rule forbids joining, and a shared edge is the identical array when the sources match. Crossing and zero-height bands cause no index errors.
- **Layout geometry:** no failures found. 4,000 random layouts (3,458 plots; vertical and horizontal, thinnable and plain, line heights 12–28, long and huge value labels, titles on and off) gave zero box intersections, zero boxes outside the container (apart from finding 7), zero identical drawn labels, `hidden` always matching the number of labels not drawn, no `thinned` on a plain axis, remedies always in order, margins always settling within 3 passes, and no `plot` result with a rectangle under 120×80 for finite sizes.
- **Sizes and rings:** 121×81 and 119×79 give the right kinds, a 0 or negative size gives `unmeasured`, and rings in wide and tall containers are centred with `r0 = 0.6·r1`.
- **Isolation:** only core/contracts.ts is imported, there is no DOM access, and no input array is mutated.
