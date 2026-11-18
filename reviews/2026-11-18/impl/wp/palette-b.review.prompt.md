# Check: the adopted default palette (candidate B)

You are an independent reviewer from a different provider than the author. Read-only: do not create, edit or delete files. Put everything in your final message. Node is available (no network); throwaway scripts to stdout only. Say for each finding whether you ran something or reasoned it out.

The owner adopted a new default palette on 2026-11-18 (commit 9861f54): `packages/axylo/src/theme/palette.ts`, tested by `packages/axylo/test/theme/palette.test.ts`, recorded in `docs/decisions/0003-default-palette.md` and `research/palette/**` (`palette.json`, `raster.json`, `strokes.json`, `configs/fit-final.json`, `README.md`). Author's reports: `reviews/2026-11-18/impl/wp/palette.candidate-b.report.md` and `palette.adopt-b.report.md`. Earlier reviews of the previous palettes, for the method: `palette.review.md` and part B of `misc-opus.review.md` in the same folder.

```
light  #2b97ee #cf8020 #0b6c49 #812cc4 #be1506 #0380a8 #8c1382 #8e948f   on #ffffff
dark   #5d9afd #dc772f #ade4ba #9443a9 #ba4f1f #38c7fe #d991b8 #6d736e   on #16181d
```
Tokens are unchanged (read them from `palette.ts`).

1. **Recompute independently**, with your own implementation (sRGB transfer, WCAG luminance and contrast, OKLab and OKLCH, the Machado 2009 simulations at severity 1.0 applied in linear RGB), every row of the measured table in the adoption report and in the decision: lowest contrast per scheme; all-eight pairwise minima for normal, protan, deutan and tritan, analytic and after rounding simulated colours to bytes; first-three, first-four, first-five and first-six minima; the largest hue shift between schemes per slot; distances to the focus, reference and muted tokens; neighbour differences for 25% and 80% fills over each background (ideal and 8-bit). Report every disagreement larger than rounding and which side is wrong. Give a table of all 16 colours with OKLCH, contrast and nearest neighbour.
2. **Criterion A5** in `docs/02-product-spec.md`: does each of the 16 colours meet it as specified (3:1 on its background; minimum pairwise OKLab difference 0.10 under the four visions)? Yes or no per colour, with your numbers.
3. **The costs the record states** (louder light red and purple; dark purple at 3.07:1; dark margins of 0.104 to focus and 0.102 to muted; dark first blue at 6.35:1): are they stated accurately, and is anything worse than the record says (a pair or margin tighter than reported; a slot whose hue family differs between schemes by more than the record says; a light and a dark colour of one slot that a reader would not call the same family)?
4. **The focus token under the two-tone ring**: the ring is the focus colour with a surround in the background colour on both sides (`packages/axylo/src/core/focus.ts`, `packages/axylo/src/theme/css.ts`). Check 3:1 for the focus colour against each background and for the surround (the background colour) against each of the 16 series colours.
5. **Tests**: for each test in `palette.test.ts`, would it fail if one colour of B were changed so that the stated rule breaks? Try two mutations in memory and say what failed. Does the default `score.mjs` run reproduce `palette.json` (run it if it only writes to stdout or can be pointed at a scratch output; otherwise reason from the code)?

At most 10 findings, most severe first (B the accessibility claim is false; M major; m minor), with numbers. No praise. End with the per-colour A5 verdict table.
