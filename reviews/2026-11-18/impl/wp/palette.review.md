<!-- Reviewer: Codex gpt-6.2-astra, effort xhigh (observed in the session rollout, thread 01a1ecda-c27e-7eb2-ac8e-cf8cea9b67d2), read-only, cross-provider. Reviewed commit 51e1be5. -->

**All 16 shipped colours pass the numerical A5 palette requirement on their respective default backgrounds.** The lowest contrast is **3.041417:1**. The smallest full-precision OKLab distance is **0.100387**. I found no error larger than rounding in the author’s opaque-colour arithmetic or in the measured tables.

**The chart does not meet A5 as a whole at `51e1be5`.** Area markers disappear from the legend and tooltip. I also reproduced a rendered fill below the decision’s 0.06 threshold and found a two-scheme counterexample to the claimed necessity of the lightness spread.

## Findings

1. **B · Eight area markers become one shape in the legend and tooltip. Ran.** I passed eight distinct marker cues through the committed `seriesSwatch` and `createSwatch` functions. All eight area swatches emitted the identical square path `M5 1H15V11H5Z`. Both the legend and tooltip use this path. A5 explicitly requires the area’s shape marker to be repeated in both places. The palette tests still pass. Draw the series marker on the area chip and verify its identity against the plotted marker in an eight-series chart. The same integration check should exercise contrast-mode dashes, applicable bar patterns, 1 px background separators, and the grayscale crossing-line fixture A5 names. [Area swatch selection](/home/canarit/projects/axylo/packages/axylo/src/dom/interaction.ts:111) · [Square path](/home/canarit/projects/axylo/packages/axylo/src/dom/swatch.ts:93) · [A5](/home/canarit/projects/axylo/docs/02-product-spec.md:141)

2. **M · The 25% fill guarantee fails on an 8-bit raster. Ran.** For light slots 4–5, ideal source-over on white gives **0.060916**. Drawing the same fills in an in-memory Skia canvas produced `#d7c8e0` and `#eed7d4`, **0.059002** apart. The test uses the correct encoded-sRGB blend for an ideal isolated fill. Its precision exceeds that of the raster it describes. The background also matters when one translucent area covers another. For scale, all eight isolated light fills at 25% have only **1.275–1.596:1** contrast against white. An outline can carry the graphical information there. Keep the analytic test, add pixel checks for the renderer and backing colours the decision promises, and allow enough margin for those checks. The 0.06 limit belongs to decision 0003. [Fill test](/home/canarit/projects/axylo/packages/axylo/test/theme/palette.test.ts:136) · [Decision table](/home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:47)

3. **M · Three pairs fall below 0.10 in the committed simulated preview pixels. Ran.** I sampled the interiors of the eight donut slices in both PNGs. The normal rows reproduce all 16 shipped hex values exactly. After the preview’s simulation and 8-bit output, light protan slots 6–8 measure **0.098343**, dark tritan slots 2–5 measure **0.099183**, and dark tritan slots 1–8 measure **0.099631**. All sampled channels agree with independently simulating and then rounding to the nearest byte. The author’s full-precision simulation of the original mark colours is correct. A5 asks for rendered marks to be scored and leaves the simulation’s output precision unspecified. Define the acceptance pipeline explicitly. A claim that the simulated screenshots themselves clear 0.10 needs more margin. [Decision’s preview claim](/home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:28) · [Scoring pipeline](/home/canarit/projects/axylo/research/palette/color.mjs:65)

4. **M · Neither the three deep light colours nor the medium-dark first blue is forced by the six constraints. Ran.** The counterexample below raises the lowest light-scheme OKLab L from **0.39111 to 0.48158**, narrows its range from **0.28951 to 0.20679**, and raises dark slot 1 from **L 0.54972, 3.64:1** to **L 0.81504, 10.28:1**. It keeps all three tokens, both backgrounds, full-severity simulation, and all six thresholds. Its magenta is more saturated, which is a genuine design trade-off. Correct the necessity claim at line 146. The explanation that the simulations simply flatten OKLab `a` or `b` also overstates the model. For the shipped light blue, simulated L ranges from **0.6430 to 0.6913** around its original **0.6590**. The projections act in linear RGB. [Geometric argument](/home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:107) · [Claim about relaxing both limits](/home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:146)

5. **M · The family-order explorer can discard a feasible order after a timeout. Reasoned from code; ran the final and what-if grid checks.** The first-four precheck caches `!!search(..., 2, four).best`. A two-second timeout with no incumbent becomes `false` and skips every later permutation with that same first-four set. The order loop also prints only successes. Preserve three outcomes, and prune only after a completed infeasibility proof. The underlying branch-and-bound lower bound and forward checking are sound for its sorted candidate domains. I reproduced both shipped solutions to completion, in **64 light and 35,088 dark search nodes**. That proves each fixed search. The final light boxes were centred on an earlier answer, the dark search fixes that one light solution, and the fitter imposes **3.02:1** and **28°** where the tests allow **3:1** and **30°**. [Explorer precheck](/home/canarit/projects/axylo/research/palette/explore.mjs:59) · [Search bounds](/home/canarit/projects/axylo/research/palette/fit.mjs:71) · [Final config provenance](/home/canarit/projects/axylo/research/palette/configs/fit-final.json:2)

6. **M · The stroke statistic is reproducible, but “always fully covered” and “what the eye averages” exceed the evidence. Ran and reasoned.** My independent CPU rasterization reproduced the reported Canvas stroke rows. At DPR 1, **one of 576 sampled columns** lacked a fully covered pixel for each colour. Light orange’s least-covered core reached **96.62%**, giving **2.924:1**. Its core p10 and median both round to **3.04:1**, just as published. The weighted statistic uses `Σcoverage² / Σcoverage`, drops coverage at or below 0.02, and omits untouched background. It describes this path and sampling rule. WCAG 1.4.11 evaluates the contrast of the graphical information needed to understand the content against adjacent colours and permits assessing the specified stroke colour despite antialiasing. Neither WCAG nor A5 defines a coverage-weighted average as the 3:1 test. A5 still calls for rendered-mark checks, and L2 calls for computed-style and rendered-pixel checks. Report the percentile, qualify the perceptual interpretation, and retain the thin-line result as a legibility measurement. [Stroke calculation](/home/canarit/projects/axylo/research/palette/strokes.mjs:59) · [Decision conclusion](/home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:100) · [WCAG guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

7. **m · The record cross-check permits materially false entries. Ran.** In memory I changed the recorded light protan closest pair to **1–1**, dark blue’s OKLCH to **[0, 0, 0]**, its recorded weighted stroke median to **99**, and light blue’s contrast from **3.12 to 3.16**. All **23 palette-file tests passed**. Pair identities, OKLCH and stroke records go unchecked, and the contrast assertion allows nearly 0.05 error for a two-decimal record. `score.mjs` also imports an existing stroke record without checking its colours or backgrounds. Compare fields at their published precision, validate the stroke inputs before copying them, and narrow the README’s cross-check claim to the fields actually verified. [Record assertions](/home/canarit/projects/axylo/packages/axylo/test/theme/palette.test.ts:145) · [Stroke record import](/home/canarit/projects/axylo/research/palette/score.mjs:35)

8. **m · A binding minimum does not imply that almost any hand edit breaks a constraint. Ran.** I changed one channel by one byte in every valid direction, **95 edits** in total. **36/48 light** and **32/47 dark** edits still met all six numerical constraints, including the muted token. A stale record catches a changed hex independently of those constraints. Report the tight pairs and their margins. The measurements support those statements directly. [Decision’s maintenance claim](/home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:79)

9. **m · The palette-history section mixes measured defaults, authored examples and recollection. Ran and checked the landscape.** In the installed `d3-scale-chromatic` 3.1.1 Tableau 10, **5/10** colours fall below 3:1 on white. Red is slot **3**, green is slot **5**, and teal separates them. The red–green deutan distance really is **0.006640**. Observable 10’s yellow, pastel blue and pink measure **1.91, 1.95 and 2.19:1**. R7 has eight displayed six-slice rows. Recharts’ colours are authored example colours, D3’s chart is authored, uPlot has no default palette, and ECharts was read from options. The seven displayed library palette rows have respectively **5, 4, 4, 0, 1, 6 and 4** colours below 3:1 for Chart.js, ECharts, Highcharts, ApexCharts, Plotly, Nivo and MUI X. ApexCharts repeats slot 1 at slot 6. Cite the versioned arrays for Tableau and Observable. Identify a specific Carbon, Okabe–Ito or Tol array before claiming its measured extrema or failures. [Decision’s comparisons](/home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:155) · [Landscape R7](/home/canarit/projects/axylo/docs/01-landscape.md:220)

## Independent arithmetic

I implemented the reference calculation in Node using **linear sRGB → D65 XYZ → LMS → cube roots → OKLab**. This gives an independent route around the author’s combined linear-sRGB-to-LMS matrix. I derived the last transform by inverting the OKLab-to-cube-root-LMS matrix. OKLCH uses `hypot(a,b)` and `atan2(b,a)`. The difference is the ordinary Euclidean norm in OKLab, with white at **L = 1** and **no factor of 100**.

For a normalized sRGB channel \(u\), I used \(u/12.92\) through 0.04045 and \(((u+0.055)/1.055)^{2.4}\) above it. Encoding uses \(12.92x\) through 0.0031308 and \(1.055x^{1/2.4}-0.055\) above it. WCAG luminance uses linear-channel weights **0.2126, 0.7152, 0.0722**. Contrast is \((Y_\mathrm{lighter}+0.05)/(Y_\mathrm{darker}+0.05)\).

I am confident of those transfer, luminance, contrast, polar-coordinate and distance constants from memory. I know the OKLab transform structure and Machado model, but cannot vouch from memory for every decimal in their matrices. I independently checked **all 27 Machado endpoint coefficients** against the three 11-level tables in the locally installed Plotly 4.3.0 bundle. Every coefficient matched. The rows I applied to **linear** RGB at severity **1.0**, with the result clipped to `[0,1]` before OKLab, were:

```text
protan   .152286  1.052583 −.204868    .114503  .786281  .099216   −.003882 −.048116 1.051998
deutan   .367322   .860646 −.227968    .280085  .672501  .047413   −.011820  .042940  .968881
tritan  1.255528  −.076749 −.178779   −.078411  .930809  .147602    .004733  .691367  .303900
```

I compared all **120 unordered pairs of the 16 colours under all four visions**, including the **224 within-scheme comparisons** that determine A5. Maximum absolute discrepancy against `color.mjs` was **7.92×10⁻⁹** in distance, **3.38×10⁻⁸** in an OKLab coordinate, **0.000019°** in hue, and **zero** in contrast. The inverse transform recovered each shipped linear channel within **2.75×10⁻¹⁰**. Neither implementation has a material numerical error here.

A5 names normal vision and the three **-opias**. Severity 1.0 is an appropriate interpretation, consistent with R7. A5 specifies no particular model and no sweep of anomalous-trichromacy severities. Reducing severity would change the question and can even reduce separation. At tritan severity **0.9**, dark slots 3–6 measure **0.099563**, versus **0.100668** at 1.0.

## The six constraints and their mutation tests

I executed the committed test bodies with Vitest’s `expect`, changing inputs only in memory. Each mutation below failed the named test.

| Test | Requirement and independent result, light / dark | Mutation caught |
|---|---|---|
| 1 | A5 opaque contrast on `#ffffff` / `#16181d`, minimum **3.041417 / 3.643024** against 3 | Set light slot 1 to white. Contrast **1:1**. |
| 2 | A5 minimum **0.10** over all 28 pairs in each scheme, including repeats, under each of four visions | Set light slot 6 to `#027cad`. Normal still gives **0.115811**. Tritan slots 1–6 give **0.099947**, which would print as 0.100. |
| 3 | Decision-only **0.14** for the first four, measured **0.140598 / 0.145611**. The 0.10 checks for prefixes 3, 5 and 6 follow from test 2. | Swap light slots 3 and 5. The full set is identical. The new first four contain the orange–red tritan pair at **0.102505**. |
| 4 | Decision-only maximum **30°** shortest hue arc, measured **18.4915°** for slate and **7.8359°** for the chromatic slots | Swap dark slots 1 and 2. Slot 1 shifts **160.15°**. A separate **358.859° / 1.256°** case correctly passed at **2.397°**. |
| 5 | Decision-only normal-vision **0.10** from focus, reference and muted. Minima **0.108078 / 0.100768**, **0.148372 / 0.105580**, **0.105871 / 0.100945** | In three runs, set light slot 6 equal to each token. Each failed at **zero**. |
| 6 | Decision-only **0.06** for seven consecutive normal-vision pairs over the scheme background. Ideal minima at 25% **0.060916 / 0.060399**, at 80% **0.193912 / 0.173528** | Reorder both schemes to **4,2,3,1,6,5,7,8**. Light slots originally numbered 1 and 6 become neighbours at **0.033**. Among the six numerical constraints, only test 6 fails. |

The test thresholds for **1 and 2** come from A5. The extra limits are explicit fitter inputs in decision 0003. The commit establishes that the palettes were fitted to those inputs. It does not establish when the extra limits were chosen. Ring closure and deficiency-simulated fills are recorded separately. I reproduced the three sub-0.06 normal-vision 25% closures and the documented **0.023–0.046** range for 25% consecutive neighbours under deficiencies.

Every prefix row in the decision record reproduced at its printed precision, including the closest pair identities. Values below are in **normal / protan / deutan / tritan** order.

| Slots | Light | Dark |
|---|---|---|
| First 3 | .316 / .169 / .281 / .254 | .258 / .236 / .187 / .283 |
| First 4 | .299 / .169 / .201 / .141 | .230 / .146 / .187 / .152 |
| First 5 | .116 / .102 / .119 / .103 | .114 / .122 / .107 / .101 |
| First 6 | .116 / .102 / .118 / .103 | .114 / .122 / .102 / .101 |
| All 8 | .116 / .100 / .101 / .103 | .114 / .101 / .101 / .101 |

I also triggered the distinct-count test with a duplicate, the OKLab reference test with a changed matrix coefficient, the record test with a one-byte hex edit, and the L2 token test by setting the axis to the background. The four stylesheet tests each failed when I respectively removed a series declaration, set `color-scheme` on the root, removed the structure marker, or inserted an unmatched brace. The previous palette failed **six numerical test cases**, plus the two expected stale-record checks.

## Feasibility counterexample

These two palettes work **together**, with the shipped backgrounds and tokens.

```text
Light  #3791ff #d28204 #2b6d48 #881bbd #c70f09 #1f7fae #fe1ce0 #959396
Dark   #63d2fc #f9c309 #78aa6f #bf37be #e42129 #4574fa #ee5ec3 #7e7c80
```

| Independently measured | Light | Dark |
|---|---:|---:|
| Lowest contrast | 3.028060 | 3.809938 |
| Minimum Δ across all pairs and visions | 0.102001 | 0.100212 |
| First-four minimum across visions | 0.148624 | 0.142296 |
| Largest cross-scheme hue shift | 29.965134° | 29.965134° |
| Nearest focus / reference / muted | .107341 / .119952 / .100781 | .113824 / .107331 / .113049 |
| Ideal neighbour Δ at 25% / 80% | .062831 / .207713 | .067636 / .172076 |
| OKLab L range | .48158–.68837 | .58920–.84182 |

The counterexample also cleared the two raster checks discussed above. Its rendered 25% fill minima were **0.061675 / 0.066833**, and its smallest distances after rounding the simulated colours to bytes were **0.101856 / 0.100043**.

I independently enumerated the published `whatif-no-deep-light.json` domains with a bitset search. Their sizes were **430, 907, 467, 1,130, 1,668, 498, 1,331 and 454**. I found no solution on that grid at **0.10/0.14**, **0.09/0.14**, **0.09/0.12**, or even **0.08/0.12**. The counterexample uses colours outside those hand-selected boxes. This reconciles the author’s unsuccessful runs with the existence of a palette meeting the original limits. The fitter’s usual steps are **0.01 L, 0.01 C, 2° hue**. The family explorer uses **3°** hue and considers **99** eligible family sets. I did not reproduce the historical timed **34/12/53** split.

## Verification and colour verdicts

No files were created, edited or deleted. No contract change is needed. I ran the theme test bodies and raster calculations in memory. I did not run a fresh browser session, the browser suite, or the TypeScript build. The stroke check used an independent CPU Skia rasterization of the seeded geometry. The preview-pixel check read the committed Chrome PNGs. The last lines of the in-memory test run were:

```text
palette.test.ts 23 passed, 0 failed
color.test.ts 10 passed
review.test.ts 4 passed
Theme test bodies: 37 passed, 0 failed
```

**Sound — colour arithmetic.** The sRGB transfer, WCAG luminance and ratio, OKLab/OKLCH, Euclidean scale, and full-severity Machado matrices reproduce the published figures.  
**Sound — opaque palette measurements.** Both backgrounds, all 16 series rows, four visions, all prefix minima, closest pairs, token distances and hue shifts check out.  
**Sound — analytic fill measurements.** The published tables correctly describe unquantized encoded-sRGB source-over at both opacities.  
**Sound — fixed-grid search.** Both final searches complete and reproduce the shipped arrays within their stated domains.  
**Sound — stroke table.** The reported Canvas percentiles reproduce at their printed precision. The interpretation limits are in finding 6.

Each **yes** below answers the A5 **colour** question for the opaque mark on its scheme background, with full-precision simulation applied to that mark. “Nearest” is the worst distance to any other slot over all four visions. The last two numeric columns give the **weighted stroke p10 / median** and reproduce every colour behind the decision’s grouped stroke rows.

| Scheme · slot | Colour | OKLCH | Contrast | Nearest Δ · other slot, vision | DPR 1 | DPR 2 | A5 colour |
|---|---|---|---:|---|---|---|---|
| Light 1 | `#4395ea` | .659 .150 251.8° | 3.1223 | .104942 · 6 tritan | 2.48 / 2.57 | 2.75 / 2.84 | Yes |
| Light 2 | `#e77412` | .681 .170 52.1° | 3.0414 | .102505 · 5 tritan | 2.47 / 2.55 | 2.73 / 2.79 | Yes |
| Light 3 | `#085e01` | .419 .140 142.0° | 8.0403 | .101807 · 5 protan | 5.14 / 5.54 | 6.34 / 6.64 | Yes |
| Light 4 | `#5f2083` | .391 .159 310.0° | 10.3913 | .102990 · 7 protan | 6.33 / 6.89 | 8.08 / 8.47 | Yes |
| Light 5 | `#ba5f50` | .590 .120 30.7° | 4.3384 | .100643 · 8 deutan | 3.18 / 3.35 | 3.67 / 3.80 | Yes |
| Light 6 | `#087ca6` | .551 .110 231.4° | 4.7255 | .100387 · 8 protan | 3.42 / 3.60 | 3.99 / 4.15 | Yes |
| Light 7 | `#a12c63` | .490 .160 356.1° | 6.8721 | .102990 · 4 protan | 4.67 / 5.00 | 5.66 / 5.90 | Yes |
| Light 8 | `#8f9299` | .660 .011 267.3° | 3.1160 | .100387 · 6 protan | 2.43 / 2.52 | 2.72 / 2.79 | Yes |
| Dark 1 | `#1c73c5` | .550 .150 251.9° | 3.6430 | .100572 · 8 tritan | 2.82 / 2.95 | 3.19 / 3.29 | Yes |
| Dark 2 | `#d77939` | .669 .140 52.0° | 5.6519 | .100873 · 5 tritan | 4.13 / 4.36 | 4.80 / 4.97 | Yes |
| Dark 3 | `#b0e391` | .861 .121 134.3° | 12.0443 | .100668 · 6 tritan | 8.29 / 8.84 | 9.96 / 10.36 | Yes |
| Dark 4 | `#bf93f1` | .740 .139 304.8° | 7.3225 | .101483 · 7 protan | 5.24 / 5.51 | 6.17 / 6.36 | Yes |
| Dark 5 | `#bc5145` | .570 .141 28.7° | 3.7219 | .100713 · 8 deutan | 2.84 / 2.99 | 3.23 / 3.33 | Yes |
| Dark 6 | `#71daff` | .839 .110 223.6° | 11.1413 | .100668 · 3 tritan | 7.66 / 8.17 | 9.24 / 9.62 | Yes |
| Dark 7 | `#fa93b5` | .780 .129 359.3° | 8.3767 | .101483 · 4 protan | 5.91 / 6.29 | 7.00 / 7.26 | Yes |
| Dark 8 | `#82828f` | .611 .019 285.8° | 4.6840 | .100572 · 1 tritan | 3.52 / 3.69 | 4.02 / 4.18 | Yes |