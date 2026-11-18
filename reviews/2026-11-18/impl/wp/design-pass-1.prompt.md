You wrote the `layout`, `simplify`, `view` and `scene` modules of Axylo in this repository. The chart now renders end to end, and a look at real output found presentation defects in your modules. Read `AGENTS.md` again. The rendered pages are produced by `node scripts/gallery.mjs light canvas` (it needs `npm run build` first and system Chrome, which you cannot launch in this sandbox; work from the descriptions below and from unit tests).

You own only: `packages/axylo/src/layout/**`, `packages/axylo/src/view/**`, `packages/axylo/src/scene/**` and their test directories. Other agents are changing `core/` and `dom/` right now and call your exported functions: do not rename or remove any export, parameter or result field; additions must be optional.

Spec changes to follow (`docs/02-product-spec.md`): L1 now allows wrapping category labels to at most three lines; L6 now says a reference line or band shows its label next to it.

Fix, each with a test written first:

1. **Category labels wrap before they rotate, up to three lines.** With seven bars in a 700 px wide plot, the label "Customer Success & Onboarding" was rotated and truncated to "Custom...arding". It must come out as three lines ("Customer", "Success &", "Onboarding") or two when two fit, unrotated, with the other labels on one line. Only when a three-line wrap cannot fit does rotation apply.
2. **Rotated labels are not truncated while there is room below.** A rotated label may extend down until the bottom margin reaches 40% of the container height; truncate only beyond that.
3. **Tick labels keep their distance.** Value-axis tick labels must end at least 6 CSS px from the axis line (they currently touch the tick marks), and x tick labels start at least 6 px below it.
4. **Reference labels.** For every reference in the view, layout places a `PlacedText` with role 'reference': for a horizontal line or band, at the right end just above the line (below it if it would leave the plot); for a vertical one, at the top just right of the line (left if it would leave the plot). It takes part in the overlap test like any other text and is truncated in the middle if it cannot fit. The layout input needs the references and their pixel positions come from the projection: add an optional `references` field to the layout input carrying each reference's axis, positions and label (the contract's `ResolvedReference`).
5. **Horizontal bars read top to bottom.** The first category is at the top, the last at the bottom. Make the band scale's pixel range run top to bottom for horizontal bars, and check the scene and the layout's category labels agree.
6. **Scatter x is a measure.** For a scatter view whose x kind is number, the full x domain is rounded outward to nice bounds the same way the value domain is (through the same `valueDomain` rule with `includeZero: false`), so the axis reads 0 to 1,000 for data from 10 to 998 instead of starting at an arbitrary value.
7. **A horizontal reference on a bar chart must be visible over the bars.** The 'reference' rule is drawn above bars and areas (it already is in z-order): confirm with a scene test, and give reference rules a stroke width of 1.5 and the contract's dash style `{ normal: [4, 3], contrast: [6, 3] }` so they are not mistaken for a grid line.

Run `npm run typecheck` and `npm test` from the repository root. Failures in files you do not own are not yours.

Report per item: done (yes/no), the test that covers it, and anything you could not do without a contract change.
