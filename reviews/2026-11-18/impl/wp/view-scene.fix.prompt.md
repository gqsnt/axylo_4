You wrote the `view` and `scene` modules of Axylo in this repository (brief: `reviews/2026-11-18/impl/wp/view-scene.prompt.md`). An independent reviewer from another provider tried to break them and found 17 defects. Read `AGENTS.md` again, then the review at `reviews/2026-11-18/impl/wp/view-scene.review.md`.

The contracts changed in response. Re-read in `packages/axylo/src/core/contracts.ts`: `DonutSlice.colorIndex` (new, required) and `RectMark.pattern` (new, optional).

You own, as before, only: `packages/axylo/src/view/**`, `packages/axylo/src/scene/**`, `packages/axylo/test/view/**`, `packages/axylo/test/scene/**`.

**Compatibility while you work:** other agents are calling `buildView` and `buildScene` and reading their results right now. Do not rename or remove any exported function, parameter, state field or result field; additions must be optional.

For each finding: reproduce it with a failing test first, then fix it. Decisions already taken:

- **1.** When a series' draw range is wider than its visible slots, the value domain also takes the values interpolated at both ends of the x domain along the joined segments (and the same for stack totals), so what is drawn inside the plot is inside the domain.
- **2.** A zoom window is moved inside the full x domain keeping its width (the full domain when it is wider); a zero-width or reversed zoom is treated as no zoom.
- **3.** Keep emitting the 'missing' rectangle at the baseline: the renderer is being changed to grow the mark toward the inside of the plot.
- **4.** Donut slices get `colorIndex` as the contract now states; the ArcMark's fills use it.
- **5.** Markers: for series i ≥ 8 use `SHAPES[(i + floor(i / 8)) % 8]`. Bars and stacked areas of series i ≥ 8 get `pattern` on their RectMark, cycling 'diagonal', 'cross', 'dots' by `floor(i / 8)`, so no two series share both color index and pattern up to 32 series.
- **6.** Bars on a continuous x axis: the full x domain is widened by half the nearest slot spacing at each end so every bar is whole; every bar whose band overlaps the x domain is drawn, and the clip trims it.
- **7.** In the view state, a finite number given as zoom or author x domain is an axis position for every x kind except category; other values (strings, `Date`) are parsed as before.
- **8.** x references widen the automatic full x domain.
- **9.** An author x domain, when given, is the full x domain (spec F7): data outside it is not shown and zoom is confined to it. Change the test that says otherwise.
- **10.** Not in this pass (it needs a contract change that would break another module mid-flight). Leave the stack as it is and do not mention it further.
- **11.** Rewrite the property tests as the reviewer describes: independent flags, zoom, author domains, long-form data with SLOT_NO_ROW and SLOT_GAP, hidden series, enough rows to reach the simplified path, x references; plus fixed tests for findings 1 to 9 and 12 to 17.
- **12.** Contrast dashes are qualitatively different patterns (solid, long dash, short dash, dot, dash-dot, dash-dot-dot, long-short, dense dot), cycling, combined with the marker rule of finding 5.
- **13.** A marker on every point only when the smallest spacing between adjacent drawn values is at least 12 CSS px.
- **14.** In a stack, the mark for a missing component is placed at the outer end of that stack on its side of zero, not inside it.
- **15.** A band reference with equal bounds is drawn as a line; no diagnostic.
- **16.** Keep using the data module's x parsing, through one adapter function in your module; pass on to the sink whatever it reports for option values (references, domains, zoom).
- **17.** Report AX130, AX131 and AX110 only when there is no previous view or the condition newly applies, so a kept sink does not accumulate counts.

Run `npm run typecheck` and `npm test` from the repository root. Other agents are mid-change elsewhere; failures in files you do not own are not yours.

Report per finding: reproduced (yes/no), fixed (yes/no), the test that covers it, and anything you disagree with and why. Paste the last lines of the test run.
