You wrote the `simplify` and `layout` modules of Axylo in this repository (brief: `reviews/2026-11-18/impl/wp/layout.prompt.md`). An independent reviewer from another provider tried to break them. Read `AGENTS.md` again, then the review at `reviews/2026-11-18/impl/wp/layout.review.md`.

You own, as before, only: `packages/axylo/src/simplify/**`, `packages/axylo/src/layout/**`, `packages/axylo/test/simplify/**`, `packages/axylo/test/layout/**`.

For each of the 14 findings: first reproduce it with a failing test, then fix it. Notes:

- **1 (blocker, label fitting cost).** Cache text widths per string for the whole `computeLayout` call; make truncation search by bisection on the kept length; skip labels early when even the shortest acceptable form cannot fit. Add a test that 1,000 categories lay out with a bounded number of measurer calls (count them through the test measurer) and that 100,000 categories finish in well under a second. For a plain category axis with far more labels than could ever be drawn, do not try remedies label by label: decide from the available length and the minimum label footprint that most must be hidden, and go straight to an evenly spread subset.
- **2 and 3 (labels that show nothing or cannot be told apart).** A truncated label must keep at least two characters on each side of the ellipsis, and is accepted only if no other label on the axis has both the same kept prefix and the same kept suffix; otherwise keep more, and if that cannot fit, hide the label and count it in `hidden`. A drawn label must always be attributable to exactly one source label.
- **4.** Cap the horizontal-bar label width so that a valid plot is produced whenever one is possible.
- **5.** Non-finite sizes are `unmeasured`.
- **6.** Solve a right margin for rotated labels, or keep the last anchor inside, so the last tick is not hidden needlessly.
- **7.** Message text stays inside the container: inset, limit the lines to what fits, end the last line with an ellipsis; a container too small for one line gets an empty text list rather than text outside it.
- **8.** Decide "isolated" from the series, not the draw range: look past each end of the range across SLOT_NO_ROW slots for a joinable value.
- **9 and 10.** Decide density without mapping every value, map only in the dense pass, and inline the affine map when the caller provides one (add an optional affine form of the x mapping to your input type; keep the function form working). Then make the timing test meaningful: warm up, take the median of several runs, and set the bound at 30 ms for one million points. Report the times you observe.
- **11 and 12.** Widen the property tests as the reviewer describes: every plot kind, ordered and plain axes, horizontal bars, sizes down to 100 × 60 and non-finite sizes; assert `plot` whenever a 120 × 80 plot is provably possible; assert every truncated label keeps characters on both sides and matches only its own source. For simplification, write the oracle independently of the implementation's density formula, and generate Float32Array y, x far outside the plot, device pixel ratios 1, 1.25, 1.5, 2 and 3, and ranges whose joined neighbour lies outside the range.
- **13.** Duplicate or empty labels: hide later duplicates (counted in `hidden`) instead of altering their text, and do not let them force remedies on the other labels.
- **14.** `computeLayout` must not add diagnostics to a sink on every call. Return what it found as data in a way that fits the contract: `Layout` already carries `fit.x.hidden`, `fit.y.hidden` and `kind: 'too-small'`, which is all the caller needs to raise AX142 and AX143 itself. Remove any sink parameter and say so in your report.

The reviewer also noted a wording conflict that is now resolved in the spec (F5): a break between two runs is always kept; SLOT_NO_ROW does not break a line. Your code already follows that.

Run `npm run typecheck` and `npm test` from the repository root. Other agents are mid-change elsewhere; failures in files you do not own are not yours.

Report per finding: reproduced (yes/no), fixed (yes/no), the test that covers it, and anything you disagree with and why. Paste the last lines of the test run and the measured simplification times.
