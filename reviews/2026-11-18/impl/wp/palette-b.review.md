<!-- Reviewer: Codex gpt-6.2-astra, effort xhigh (observed in the session rollout, thread 01a1ee2a-b522-7b60-b7ff-e8a3480c3701), read-only, cross-provider. Reviewed commit 9861f54. -->

**All 16 colours pass the colour requirements of A5 on their own scheme background.** The lowest opaque contrast is **3.0961:1** in light and **3.0739:1** in dark. The closest analytic pairs are light green–red at **0.102187** and dark cyan–magenta at **0.102224**, both under deuteranopia. Every row of the adopted palette’s measured table agrees with my independent calculation at its published precision. I found no B-level failure in the requested A5 claim. [A5](</home/canarit/projects/axylo/docs/02-product-spec.md:141>) · [Adoption table](</home/canarit/projects/axylo/reviews/2026-11-18/impl/wp/palette.adopt-b.report.md:40>)

## Findings

1. **M · The decision extends the surround’s 3:1 result to marks for which it is false. Ran contrast on the opaque colours and the recorded Chrome fill pixels, and inspected both ring implementations.** The focus ink against its background surround is **5.8872:1** in light and **14.4329:1** in dark. The surround passes against all 16 opaque series colours. But all **16 of 16** isolated 25% fills and **6 of 16** isolated 80% fills fall below 3:1 against the surround. At 25%, light slate gives **1.2748:1** and dark purple **1.2377:1**. At 80% the minima are **2.3814:1** and **2.3775:1**. The datum and plot rings both put a 2 px focus band between 1 px background bands, so the focus band retains its stated contrast against those bands. The decision’s assertion that the surround reaches 3:1 against *every mark it touches* needs an opaque-mark qualification. [Decision](</home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:170>) · [Datum ring](</home/canarit/projects/axylo/packages/axylo/src/core/focus.ts:283>) · [Plot ring](</home/canarit/projects/axylo/packages/axylo/src/theme/css.ts:239>)

2. **M · A light red at chroma 0.17 does not require purple at 0.23. Ran a constrained search and independently scored the result.** I kept the `b-red-17` light grid and tightened its purple cap to 0.22. It produced red `#ab2a09` at **0.169957** and purple `#8734cb` at **0.219487**, slightly below B’s own purple at **0.219553**. A matching dark fit kept the largest hue shift to **14.8055°**. Across the two schemes, the minima were **3.02097:1** contrast, **0.102612** analytic and **0.102477** byte-rounded separation, **0.141386** across first-four checks, **0.101290** to tokens and **0.063140** across ideal and byte-model fills. This disproves the decision’s “feasible only with purple at 0.23” claim on its own grid. The measured increase in B’s red and purple chroma is real. The counterexample was scored in memory without a fresh browser render. [Cost claim](</home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:213>) · [Search grid](</home/canarit/projects/axylo/research/palette/configs/b-red-17.json>)

   ```text
   light  #3697f9 #cf8020 #056850 #8734cb #ab2a09 #297ea6 #8b0b8b #8e948f
   dark   #5c97fe #dc772f #aae4bd #9443a9 #ba4f1f #2fc3ff #d791bb #6d736e
   ```

3. **m · The decision’s single-ink impossibility example names the wrong set of surfaces. Ran a counterexample and checked the luminance bounds.** `#707070` gives **3.5861:1** against `#16181d` and **3.4390:1** against dark-scheme green `#ade4ba`. The decision says no such ink exists. Its broader conclusion holds when purple is included. To clear both the background and purple, an ink needs at least **9.2218:1** against the background. To clear green, it needs at most **4.1108:1** or at least **36.9972:1**. White reaches only **17.7588:1** against that background. [Single-ink argument](</home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:161>)

4. **m · The browser-record tests can pass with unavailable images and false summary fields. Ran an in-memory isolation check.** All **36** tests passed when reads of the preview PNGs, `raster.json`, `strokes.json` and `preview-pixels.json` were made to throw, and the in-memory `palette.json` had false `checks`, empty `tight` lists and a zero 25% `minModel`. The tests verify the folded pixel arrays and recompute stroke statistics from the raw gzip. They do not establish that the separate browser artifacts still agree with those arrays, or that every summary field is correct. For this review I decoded the actual PNGs and read the separate records. The shipped artifacts agree. [Chrome fill test](</home/canarit/projects/axylo/packages/axylo/test/theme/palette.test.ts:270>) · [Record test](</home/canarit/projects/axylo/packages/axylo/test/theme/palette.test.ts:290>) · [Preview test](</home/canarit/projects/axylo/packages/axylo/test/theme/palette.test.ts:377>)

5. **m · Two margin summaries omit tighter measurements. Ran the comparisons and traced the scorer.** The `tight` list, described as covering every measurement within 5% of its limit, omits **seven** qualifying browser measurements. These are three light and two dark preview rows, plus the dark 25% Canvas and SVG fills at **0.062846** against **0.060**. The scorer builds `tight` from the checks available before the browser rows are appended to the scheme record. Also, the reported 25% closing-pair minima of **0.029276** light and **0.036923** dark describe normal vision. Across all four visions, slots 6–1 reach **0.024025** in light tritanopia and **0.028518** in dark deuteranopia. These translucent closing pairs are recorded separately from the opaque A5 test. [Tight-list construction](</home/canarit/projects/axylo/research/palette/score.mjs:116>) · [Closing-pair claim](</home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:334>)

6. **m · Two slot names change appreciably by eye despite meeting the hue rule. Ran OKLCH measurements and inspected both previews.** I would call slot 5 **red** in light and **burnt orange or rust** in dark. At **41.91°**, dark slot 5 is closer in hue to its own orange at **52.00°** than to light slot 5 at **30.07°**. Slot 7 goes from **plum-magenta** to **dusty pink**, with chroma falling from **0.18972** to **0.09986**. Those names are visual judgments. The measured shifts for slots 1–8 are **11.503°, 12.716°, 9.980°, 14.110°, 11.842°, 0.125°, 13.923°, 0.055°**. No slot exceeds the reported maximum. The description of dark orange and red as capped at 0.15 is accurate to two decimals only. Their shipped chromas are **0.150279** and **0.150480**. [Palette and family names](</home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:19>) · [Light preview](</home/canarit/projects/axylo/research/palette/preview-light.png>) · [Dark preview](</home/canarit/projects/axylo/research/palette/preview-dark.png>)

## Independent measurements

I ran a separate Node implementation using the sRGB transfer function, WCAG luminance weights `0.2126, 0.7152, 0.0722`, and linear sRGB → D65 XYZ → LMS → OKLab. I applied the severity-1.0 Machado matrices in linear RGB and clipped each simulated channel to `[0,1]`. The byte calculation re-encoded, rounded and decoded each simulated channel before measuring Euclidean OKLab distance. I took the colours, backgrounds and tokens from the shipped source. [Palette inputs](</home/canarit/projects/axylo/packages/axylo/src/theme/palette.ts:32>)

### Pairwise and prefix minima

Each cell gives **analytic / byte-rounded** minimum distance. I checked the closest slot identities as well as the values.

| Scheme and slots | Normal | Protan | Deutan | Tritan |
|---|---:|---:|---:|---:|
| Light 1–3 | .26285 / .26285 | .14863 / .14865 | .23540 / .23496 | .20606 / .20522 |
| Light 1–4 | .24674 / .24674 | .14863 / .14865 | .15386 / .15299 | .14375 / .14323 |
| Light 1–5 | .19701 / .19701 | .10630 / .10606 | .10219 / .10267 | .14375 / .14323 |
| Light 1–6 | .11851 / .11851 | .10630 / .10606 | .10219 / .10267 | .10237 / .10231 |
| **Light 1–8** | **.11251 / .11251** | **.10240 / .10256** | **.10219 / .10237** | **.10237 / .10231** |
| Dark 1–3 | .26824 / .26824 | .25859 / .25736 | .20774 / .20778 | .18769 / .18609 |
| Dark 1–4 | .22928 / .22928 | .22425 / .22559 | .16193 / .16371 | .18232 / .18211 |
| Dark 1–5 | .11514 / .11514 | .12202 / .12231 | .11317 / .11290 | .11275 / .11148 |
| Dark 1–6 | .11514 / .11514 | .12028 / .11889 | .10729 / .10508 | .10533 / .10357 |
| **Dark 1–8** | **.11514 / .11514** | **.10478 / .10544** | **.10222 / .10243** | **.10261 / .10281** |

For all eight light colours, the analytic closest pairs in vision order are **4–7, 6–8, 3–5, 1–6**. Byte rounding changes the last two to **3–7** and **3–6**. The dark pairs are **2–5, 5–8, 6–7, 4–8** in both calculations. All **64** donut interiors sampled directly from the two PNGs across the four requested visions matched the byte model exactly.

The stated dark costs reproduce. Purple is **3.07393:1** and the first blue is **6.3476:1**, down from **3.2621:1** and **7.4615:1** in the superseded palette. The nearest dark series to focus, reference and muted are **green 0.104214**, **green 0.107272** and **pink 0.102348**. In light they are **cyan 0.115745**, **green 0.121400** and **cyan 0.111079**. The old dark focus `#79a8ff` is **0.050095** from B’s blue. The earlier report’s **0.024** applies to the superseded blue. Light red and purple rose from chromas **0.13026 / 0.20512** to **0.19998 / 0.21955**. [Decision costs](</home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:211>)

### Neighbouring fills

I composited in encoded sRGB over each scheme background. Each cell gives **ideal / rounded-alpha bytes / floored-alpha bytes**. At 80%, both byte models use alpha 204 and give identical results, so those rows show **ideal / bytes**.

| Scheme and opacity | 1–2 | 2–3 | 3–4 | 4–5 | 5–6 | 6–7 | 7–8 |
|---|---|---|---|---|---|---|---|
| Light 25% | .0798/.0802/.0790 | .0687/.0687/.0674 | .0800/.0799/.0788 | .0645/.0641/.0636 | .0881/.0885/.0880 | .0771/.0765/.0762 | .0827/.0822/.0821 |
| Dark 25% | .0947/.0940/.0936 | .0854/.0843/.0850 | .1304/.1296/.1267 | .0684/.0673/.0694 | .1159/.1150/.1146 | .0671/.0675/.0664 | .0639/.0638/.0641 |
| Light 80% | .2518/.2514 | .2229/.2237 | .2604/.2606 | .2340/.2344 | .2807/.2801 | .2415/.2413 | .2578/.2573 |
| Dark 80% | .2519/.2515 | .2247/.2244 | .3512/.3512 | .1811/.1810 | .3044/.3043 | .1747/.1744 | .1820/.1812 |

| Minimum | Light 25% | Dark 25% | Light 80% | Dark 80% |
|---|---:|---:|---:|---:|
| Ideal | .064504 | .063870 | .222858 | .174658 |
| Worse of the two byte models | .063601 | .063849 | .223685 | .174449 |
| Recorded Chrome Canvas and SVG, each | .064079 | .062846 | .223685 | .175111 |
| Worst within ±1 byte per channel of both rounded fills | .060359 | .057440 | .218990 | .170238 |

I also recomputed **256 stroke statistics** from the raw column bytes and checked the decision’s 16 stroke rows. The lowest DPR-1 weighted p10 was **2.41534:1** for light slate and **2.42975:1** for dark purple, reproducing **2.42 / 2.43**. Each renderer had full ink in **575/576** columns at DPR 1 and **1,152/1,152** at DPR 2 for every colour. These are thin-stroke measurements. The A5 verdicts below use opaque swatches. [Stroke table](</home/canarit/projects/axylo/docs/decisions/0003-default-palette.md:240>)

## Tests and reproduction

I ran all 36 committed test bodies in memory with Vitest’s `expect`. CSS was generated from each mutated palette as it would be on import. I reasoned from the assertions about the rule each test can detect. [Palette test file](</home/canarit/projects/axylo/packages/axylo/test/theme/palette.test.ts:172>)

| Test or tests | Would a one-colour change that breaks the stated rule fail? |
|---|---|
| Known OKLab values and grey simulations | Independent of B. Fixed reference inputs exercise the colour math. |
| 8-bit fill model against two rasterizers | Independent of B. Uses historical sample colours. |
| Eight distinct series | Yes for a duplicate, wrong count or invalid hex spelling. |
| 1 · Opaque contrast | Yes, below 3:1 in the affected scheme. |
| 2 · Analytic separation | Yes, for any of 28 pairs under any of four visions below 0.10. |
| 2 · Byte separation | Yes, including a failure that displays as `0.100` after rounding. |
| 3 · Prefixes | Yes, for either calculation below its prefix threshold. |
| 4 · Hue family | Yes for an arc over 30°, in both scheme tests. Ordinary colour names are outside the assertion. |
| 5 · Token distance | Yes, below 0.10 to any of the three tokens under normal vision. |
| 6 · Ideal fills | Yes for any of seven consecutive pairs below 0.06 at either opacity. |
| 6 · Byte-model fills | Yes for either alpha model. |
| 6 · Chrome fills | Yes for a failing **recorded** neighbour or a model discrepancy over one channel byte. A small source edit can leave the saved pixels within tolerance. |
| Research record | Every changed series hex fails against a stale record. The recomputation covers the detailed fields identified above. Finding 4 gives the summary-field exceptions. |
| Stroke record | Every changed series hex fails against stale row identities. The test also recomputes statistics from raw columns. It sets no minimum weighted stroke contrast. |
| Preview PNG | Every changed hex fails against the stale recorded normal row. The test reads the folded samples. |
| One-byte edits | Yes if the base palette breaks a modelled rule or the edit counts disagree. It does not render each mutation. My independent count was **44/48** light and **48/48** dark. |
| L2 token contrast | Independent of a series-only edit. Tests axis, focus, muted and reference against the background. |
| Stylesheet declarations | Detects disagreement with the explicit light/dark series declarations. A palette edit propagated into generated CSS passes this test. The automatic `light-dark()` pairings are not asserted here. |
| Stylesheet scheme detection, structure marker, balanced braces | Three separate structural tests. A valid series hex substitution leaves each assertion intact. |

**Mutation 1, ran.** Light slot 6 changed one byte from `#0380a8` to `#037fa8`. Analytic separation still passed. Byte-rounded tritan slots **3–6 fell to 0.09994346**. Seven tests failed: light byte separation, prefixes, research record, stroke record, preview and edit count, plus the dark record’s cross-scheme hue field. The saved Chrome-fill test passed.

**Mutation 2, ran.** Dark slot 4 changed from `#9443a9` to its background `#16181d`. Contrast became **1:1** and the slot’s hue shift became **36.5952°**. Ten tests failed: dark contrast, dark recorded Chrome fills, dark stroke and preview, and both schemes’ hue, research-record and edit-count tests.

**Reproduction, ran.** `score.mjs --out=/dev/stdout` used the default palette and all default inputs. Its **69,417 JSON bytes** matched `palette.json` byte for byte, with SHA-256 `52b64c31a26dbdfe3be2859533f1d92a1e6bd3ceb2a873c93c0c3ef735fa77f7`. It printed `all hard constraints met`. The final fitter also reproduced both adopted arrays, completing in **9 search nodes per scheme**. [Scorer output path](</home/canarit/projects/axylo/research/palette/score.mjs:139>) · [Final configuration](</home/canarit/projects/axylo/research/palette/configs/fit-final.json>)

I created, edited and deleted no files. No contract change is needed. I checked the committed images and raw measurements without running a fresh browser, build or typecheck. The final lines from the in-memory palette runs were:

```text
baseline: 36 passed, 0 failed
byte: 29 passed, 7 failed
contrast: 26 passed, 10 failed
```

## Per-colour A5 verdicts

The contrast column also gives the **background-coloured surround against each opaque mark**. Neighbours are other slot numbers in the same scheme. The worst distance is the analytic minimum over all four visions. P, D and T denote protanopia, deuteranopia and tritanopia. Token distances are in focus / reference / muted order.

| Scheme · slot | Colour | OKLCH L C h | Contrast | Normal Δ · slot | Worst Δ · slot, vision | Token distances | A5 colour |
|---|---|---|---:|---|---|---|---|
| Light 1 | `#2b97ee` | .6593 .1600 248.1° | 3.1047 | .11851 · 6 | .102372 · 6 T | .1537 / .2852 / .2087 | Yes |
| Light 2 | `#cf8020` | .6692 .1403 64.7° | 3.1058 | .14022 · 8 | .127999 · 8 P | .3554 / .3003 / .2218 | Yes |
| Light 3 | `#0b6c49` | .4710 .1003 161.7° | 6.4507 | .14768 · 6 | .102187 · 5 D | .2240 / .1214 / .1121 | Yes |
| Light 4 | `#812cc4` | .4990 .2196 304.8° | 6.7944 | .11251 · 7 | .106750 · 6 D | .1555 / .2230 / .2082 | Yes |
| Light 5 | `#be1506` | .5101 .2000 30.1° | 6.3649 | .19701 · 2 | .102187 · 3 D | .3450 / .2312 / .2087 | Yes |
| Light 6 | `#0380a8` | .5611 .1101 229.1° | 4.5094 | .11851 · 1 | .102372 · 1 T | .1157 / .1772 / .1111 | Yes |
| Light 7 | `#8c1382` | .4500 .1897 332.2° | 8.2985 | .11251 · 4 | .103049 · 3 D | .2259 / .1864 / .1935 | Yes |
| Light 8 | `#8e948f` | .6601 .0101 150.6° | 3.0961 | .14022 · 2 | .102398 · 6 P | .2372 / .2483 / .1517 | Yes |
| Dark 1 | `#5d9afd` | .6908 .1596 259.6° | 6.3476 | .11981 · 6 | .105693 · 6 T | .2806 / .1871 / .1443 | Yes |
| Dark 2 | `#dc772f` | .6718 .1503 52.0° | 5.6853 | .11514 · 5 | .103262 · 7 T | .3039 / .2108 / .1693 | Yes |
| Dark 3 | `#ade4ba` | .8697 .0808 151.7° | 12.3324 | .17130 · 6 | .105331 · 6 T | .1042 / .1073 / .1815 | Yes |
| Dark 4 | `#9443a9` | .5300 .1706 318.9° | 3.0739 | .18186 · 8 | .102612 · 8 T | .4321 / .3215 / .2426 | Yes |
| Dark 5 | `#ba4f1f` | .5597 .1505 41.9° | 3.5738 | .11514 · 2 | .104780 · 8 P | .4030 / .2950 / .2229 | Yes |
| Dark 6 | `#38c7fe` | .7792 .1397 229.2° | 9.1066 | .11981 · 1 | .102224 · 7 D | .1983 / .1323 / .1434 | Yes |
| Dark 7 | `#d991b8` | .7401 .0999 346.1° | 7.3510 | .15796 · 2 | .102224 · 6 D | .2141 / .1191 / .1023 | Yes |
| Dark 8 | `#6d736e` | .5488 .0105 150.6° | 3.6598 | .15456 · 5 | .102612 · 4 T | .3812 / .2594 / .1646 | Yes |