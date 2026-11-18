# Work package: re-merge the acceptance matrix after both suites were rewritten

Read `AGENTS.md`. You own `acceptance/**` and nothing else; do not commit. You wrote the matrix, the checker and the first merge (`reviews/2026-11-18/impl/wp/acceptance-merge.report.md`).

Since your merge, both acceptance suites were strengthened after independent reviews, and their test titles changed:

- Browser suite: `packages/axylo/test/browser/acceptance/**`, now 532 tests with 11 negative controls; index in its `EVIDENCE.json`; what changed and why in `reviews/2026-11-18/impl/wp/acceptance-browser.fix.report.md`; the review that drove it in `reviews/2026-11-18/impl/wp/tests-opus.review.md`. Its author is making one more small alignment pass right now (tooltip hover, readout mode, L8 summary, A10 applicability), so a handful of titles in `i1-pointer`, `l-legibility` and `a6-a10` may still move: cite describe prefixes there where a prefix is the honest unit of evidence, and say which.
- Node suite: yours (commit 1bbdf6f and ed230af).
- Distribution tests: `tests/dist/**`, now 106 Node and 30 browser tests (`reviews/2026-11-18/impl/wp/dist.fix.report.md`).

The checker run on the coordinator's recorded results (all four configurations at commit d8b4150, in `acceptance/results/` with provenance sidecars; log in `acceptance/results/check.log`) exits 1 with many "invalid source registration" and "missing test title" errors and counts 132 cells as not run: the matrix still cites the old browser titles.

Do this:

1. Re-merge. For every cell, read the tests that now exist and decide again whether together they establish the criterion for that chart type. The strengthened suites were built to close the gaps your first merge listed as weak; where a gap is closed, the cell is no longer weak; where the strengthening itself narrowed a claim (for example the browser suite states it is evidence for the SVG renderer only; text zoom is emulated; colour vision is scored on sampled colours), record the limit in the cell. Negative controls are not evidence for a criterion; they are evidence that a helper works: record them once, in a section of the report, with the helpers they cover.
2. Spec changes since your merge, to reflect in statements and applicability (`docs/02-product-spec.md`): the type matrix's zoom row (no chart type zooms a category axis in 1.0); F8 (the eight-slice limit counts slices with an arc; shares to one fraction digit); F9 (bar cues distinct up to 32 series); F10 (mixed-sign stacks read both totals); I1 and L8 (decision 0004 revision 2: `docs/decisions/0004-tooltip-and-focused-text.md`); DX7's targets are under review (measured 99.5 KiB against 40; an analysis in `reviews/2026-11-18/impl/wp/size.analysis.md` proposes 96, 80 and 2 KiB; the owner has not decided: keep the cell failing against the spec's current numbers and say so).
3. Run the checker on the four recorded results and write the report (`--write`). The results were recorded at d8b4150 and the tree has moved (documents only, plus whatever agents are changing now): report the provenance verdict as the checker gives it; do not bypass it. Expected failing tests in those results: 37 browser acceptance tests, 2 distribution browser tests (the note's runs leaking into the page as JSON), 1 Node test (the memory bound after opening a store on a million points).
4. In the report, a section "What stands between this tree and a release", in order: failing cells grouped by cause (the tooltip and focus-indicator failures share one cause, being fixed under decision 0004 revision 2); weak cells; no evidence (A9 conformance table, DX9, DX12); not run (P1–P8: the benchmark harness exists in `bench/`, measurements await a quiet machine); cannot be verified here.

Run `node --test acceptance/test/*.test.mjs` and the checker. Report: counts per status before and after; the cells whose status you changed and why, grouped; the provenance verdict; the last lines of the runs.
