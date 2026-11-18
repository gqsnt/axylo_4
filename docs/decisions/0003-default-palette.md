# Decision 0003: the default categorical palette

Status: **adopted by the owner on 2026-11-18.** The palette below is the one the owner chose, candidate B (commit 987988b), and it is the 1.0 default.

How it got here:
1. **First version.** Commit 51e1be5 was reviewed by Codex gpt-6.2-astra (`reviews/2026-11-18/impl/wp/palette.review.md`). The review confirmed the arithmetic and showed four things wrong:
   - the uneven lightness was claimed to be forced, and it is not;
   - simulated screenshots and 8-bit fills fell below the limits the record promised;
   - the order explorer could prune a feasible order after a timeout;
   - the record overclaimed in several places.
2. **Refit.** The refit (52bbdf0) added byte-level checks and corrected the text. It was reviewed again (`reviews/2026-11-18/impl/wp/misc-opus.review.md`, part B; reported to me as Codex gpt-6.2-sol). That review found a more even light scheme.
3. **Candidate B.** I refitted around that scheme by eye. The owner chose candidate B over the refit, which is kept below as "Superseded".

The hard constraints are measured and tested. Candidate B has been reviewed independently (`reviews/2026-11-18/impl/wp/palette-b.review.md`, of commit 9861f54; its header records Codex gpt-6.2-astra at effort xhigh, observed in the session rollout, read-only). The review confirmed that all 16 colors meet A5 and that every row of the measured tables reproduces. Its six findings were corrections to this record, and they are applied here; none changes a color.

Spec: A5 (palette thresholds, provisional), L2 (3:1 for marks), F9 (eight series). Finding R7, docs/01-landscape.md.

## The palette

The slot order is blue, orange, green, purple, red, cyan, magenta, slate. That is the first version's order, and hue families are kept per slot within constraint 4's 30°.

The family names describe the light scheme. Two dark slots read differently by eye, as the palette-B review noted (finding 6):
- **Dark slot 5 reads as rust or burnt orange.** At hue 41.9° it is 10.1° from the dark orange (52.0°) and 11.8° from the light red (30.1°). It is also the dark scheme's closest normal-vision pair, 2–5, at 0.115.
- **Dark slot 7 reads as a dusty pink.** The light magenta is plum (chroma 0.190); the dark one has chroma 0.100.

The hue shifts per slot are 11.5°, 12.7°, 10.0°, 14.1°, 11.8°, 0.1°, 13.9° and 0.1°.

| Slot | Family | Light | OKLCH | Contrast on #ffffff | Dark | OKLCH | Contrast on #16181d | Hue shift |
|---|---|---|---|---|---|---|---|---|
| 1 | blue | `#2b97ee` | 0.66 0.160 248 | 3.10 | `#5d9afd` | 0.69 0.160 260 | 6.35 | 12° |
| 2 | orange | `#cf8020` | 0.67 0.140 65 | 3.11 | `#dc772f` | 0.67 0.150 52 | 5.69 | 13° |
| 3 | green | `#0b6c49` | 0.47 0.100 162 | 6.45 | `#ade4ba` | 0.87 0.081 152 | 12.33 | 10° |
| 4 | purple | `#812cc4` | 0.50 0.220 305 | 6.79 | `#9443a9` | 0.53 0.171 319 | 3.07 | 14° |
| 5 | red | `#be1506` | 0.51 0.200 30 | 6.36 | `#ba4f1f` | 0.56 0.150 42 | 3.57 | 12° |
| 6 | cyan | `#0380a8` | 0.56 0.110 229 | 4.51 | `#38c7fe` | 0.78 0.140 229 | 9.11 | 0° |
| 7 | magenta | `#8c1382` | 0.45 0.190 332 | 8.30 | `#d991b8` | 0.74 0.100 346 | 7.35 | 14° |
| 8 | slate | `#8e948f` | 0.66 0.010 151 | 3.10 | `#6d736e` | 0.55 0.011 151 | 3.66 | 0° |

`configs/fit-final.json` reproduces these arrays. Both exact searches complete with cost 0, so the run is deterministic: `node research/palette/fit.mjs --config=research/palette/configs/fit-final.json --seconds=300`. `palette.ts` holds the arrays it writes.

**One token differs from the first version.** The dark focus token is a near-white `#e3e8f0` (14.4:1 on #16181d), not `#79a8ff`. The refit made that change, and candidate B changes no token.
- **Why the change.** The old focus blue sits at OKLab L 0.735, exactly where a dark-mode series blue belongs. With it kept, no dark set I found had a first blue above L 0.55. The exact search with the blue asked for at 0.62 ended at `#3970c2`, L 0.55 (`configs/dark-n2.json`, best within 300 s).
- **Against today's palette.** `#79a8ff` is 0.050 from today's dark blue `#5d9afd`, under constraint 5's 0.10.
- **Light focus.** `#1f5fcc` is unchanged; `keyboard.browser.test.ts` hardcodes it.

**Before and after.**

| | 51e1be5 | Refit 52bbdf0 (superseded) | Now (candidate B) |
|---|---|---|---|
| Light OKLab L, lowest to highest | 0.39 to 0.68 | 0.43 to 0.68 | 0.45 to 0.67 |
| Light, spread across the first three | 0.26 | 0.25 | 0.20 |
| Light, largest chroma | 0.17 | 0.205 (purple) | 0.220 (purple) |
| Eighth's chroma, light / dark | not recorded here | 0.026 / 0.031 | 0.010 / 0.011 |
| Dark first blue | `#1c73c5`, L 0.55, 3.64:1 | `#64acfa`, L 0.73, 7.46:1 | `#5d9afd`, L 0.69, 6.35:1 |
| Dark, largest chroma | 0.15 | 0.177 (purple) | 0.171 (purple) |
| Largest light/dark hue shift | 18.5° (slate), 8° chromatic | 13.6° (red) | 14.1° (purple) |
| Byte-rounded simulation, worst pair | 0.098 (light protan 6–8) | 0.102 | 0.102 |
| 25% fills on an 8-bit raster, worst neighbours | 0.0590 (review's raster) | 0.063 (Chrome) | 0.064 light, 0.063 dark (Chrome) |

**What B buys:**
- a light set with less spread;
- an ochre instead of a hot orange in slot 2;
- a lighter slot-3 green;
- a grey eighth in both schemes.

**What B costs:**
- a louder light red and purple;
- a dimmer dark purple;
- tighter dark margins to the focus and muted tokens;
- a deeper dark first blue.

"How B was made and why it was chosen" gives the measurements of both lists.

![Light scheme preview](../../research/palette/preview-light.png)

![Dark scheme preview](../../research/palette/preview-dark.png)

Each preview shows:
- the swatches, with hex, contrast and nearest neighbour;
- lines with 3, 5 and 8 series at 2 px, with Axylo's end markers;
- three overlapping areas at 25%;
- eight stacked areas at 80%;
- an eight-slice donut;
- grouped bars.

The same charts are repeated under the three simulations (the Machado matrices as SVG color matrices in linear RGB) and in grayscale. Source: `research/palette/preview.html`.

## What is measured, and on what

There are three forms of measurement:

- **Analytic.** The 8-bit hex is decoded, then simulated or composited in floating point, then converted to OKLab.
- **Bytes.** Values are rounded where an 8-bit image would round them. A simulated color is encoded and rounded to the nearest byte before the OKLab conversion. A translucent fill is quantised as a raster would quantise it: alpha at round(α×255), each channel rounded. That reproduces Chrome 157's canvas and SVG fills on white exactly and is within one byte on #16181d. A second variant puts alpha at floor(α×255), which is what the review's CPU Skia raster did.
  - **The rounding model is not the preview image.** Chrome's SVG filter can differ from the model by a byte. For the shipped palette, every sampled donut pixel of the preview equals the model. For the superseded palette one did not: in light tritanopia, slot 7 was `#b30f41` in the PNG and `#b20f41` in the model, which took the light tritan 5–7 distance from 0.102 in the model to 0.1005 in the image.
- **Chrome.** Two records come from Chrome itself:
  - the fill pixels Chrome actually drew, canvas and SVG (`research/palette/raster.mjs`);
  - the preview PNG itself: `preview.mjs` reads back the middle of every donut slice in every row of the image it just wrote (`preview-pixels.json`).

The unit test requires the analytic and the byte forms. It also checks:
- the recorded Chrome fill pixels against the 0.06 limit;
- the recorded preview pixels against 0.10;
- that each recorded pixel is within one byte of its model;
- that the browser records on disk are the ones folded into `palette.json`. These are `raster.json`, `strokes.json` and `preview-pixels.json`. The test also decodes `preview-light.png` and `preview-dark.png` itself and reads each donut sample at the coordinates `preview.mjs` recorded.

Before the palette-B review, the test read only the copies folded into `palette.json`. It therefore still passed with those files unreadable, or with false summary fields (review finding 4). It now also recomputes the record's check list, its pass flags, its tight list and the raster minima.

A stricter margin is the worst case over every byte color within one byte per channel of both fills. It is recorded but not required. The shipped light scheme meets it (0.060); the dark scheme does not (0.057).

## Constraints, measured

These values come from `research/palette/palette.json`, which `score.mjs` writes. The unit test recomputes each value with its own code and compares it at the written precision, including which pair is closest. The fields it checks are listed in `research/palette/README.md`. Limits are applied to unrounded values, and the record keeps three decimals.

| Constraint | Check | Limit | Light | Dark |
|---|---|---|---|---|
| 1 | lowest contrast on background | ≥ 3 | 3.10 (slate) | 3.07 (purple) |
| 2 | min pairwise ΔE, all 8, normal / protan / deutan / tritan | ≥ 0.10 | 0.113 / 0.102 / 0.102 / 0.102 | 0.115 / 0.105 / 0.102 / 0.103 |
| 2, bytes | the same after the simulation is rounded to bytes | ≥ 0.10 | 0.113 / 0.103 / 0.102 / 0.102 | 0.115 / 0.105 / 0.102 / 0.103 |
| 2, image | the same on the donut slices read back from the preview PNG | ≥ 0.10 | 0.113 / 0.103 / 0.102 / 0.102 | 0.115 / 0.105 / 0.102 / 0.103 |
| 3 | first 4, worst vision (analytic; bytes) | ≥ 0.14 | 0.144 tritan; 0.143 | 0.162 deutan; 0.164 |
| 3 | first 3, 5, 6, worst vision (analytic) | ≥ 0.10 | 0.149 / 0.102 / 0.102 | 0.188 / 0.113 / 0.105 |
| 4 | largest light/dark OKLCH hue shift | ≤ 30° | 14.1° (purple) | same pairs |
| 5 | nearest series color to focus / reference / muted | ≥ 0.10 | 0.116 (cyan) / 0.121 (green) / 0.111 (cyan) | 0.104 (green) / 0.107 (green) / 0.102 (pink) |
| 6 | neighbour fills at 25%: ideal / byte models / Chrome canvas / Chrome SVG | ≥ 0.06 | 0.065 / 0.064 / 0.064 / 0.064 | 0.064 / 0.064 / 0.063 / 0.063 |
| 6 | neighbour fills at 80%: ideal / byte models / Chrome | ≥ 0.06 | 0.223 / 0.224 / 0.224 | 0.175 / 0.174 / 0.175 |
| 6, recorded only | 25% fills, worst case within one byte | (0.06) | 0.060 | 0.057 |

"Muted" is my addition to constraint 5: the donut draws its "Other" slice in the muted token, next to series slices.

### Prefix minima (constraint 3)

Each cell is analytic / bytes, with the closest slots.

| Prefix | Vision | Light | Dark |
|---|---|---|---|
| first 3 | normal | 0.263 / 0.263 (1–3) | 0.268 / 0.268 (1–3) |
| first 3 | protan | 0.149 / 0.149 (2–3) | 0.259 / 0.257 (1–3) |
| first 3 | deutan | 0.235 / 0.235 (2–3) | 0.208 / 0.208 (2–3) |
| first 3 | tritan | 0.206 / 0.205 (1–3) | 0.188 / 0.186 (1–3) |
| first 4 | normal | 0.247 / 0.247 | 0.229 / 0.229 |
| first 4 | protan | 0.149 / 0.149 | 0.224 / 0.226 |
| first 4 | deutan | 0.154 / 0.153 | 0.162 / 0.164 |
| first 4 | tritan | 0.144 / 0.143 | 0.182 / 0.182 |
| first 5 | normal / protan / deutan / tritan | 0.197 / 0.106 / 0.102 / 0.144 | 0.115 / 0.122 / 0.113 / 0.113 |
| first 6 | normal / protan / deutan / tritan | 0.119 / 0.106 / 0.102 / 0.102 | 0.115 / 0.120 / 0.107 / 0.105 |

`node research/palette/score.mjs --md` prints the full tables, with pair identities for every row.

### Tight pairs and margins

These are every measured value within 5% of its limit (`palette.json`, `tight`), the browser measurements included:

- **Light:**
  - contrast 3.096 (slate; the solver keeps 3.02);
  - all-eight pairwise 0.102–0.103 under the three deficiencies, analytic and in bytes;
  - the same in the preview PNG (0.102–0.103);
  - first four 0.144 under tritanopia (0.143 in bytes);
  - first five and six 0.102–0.103.
- **Dark:**
  - contrast 3.074 (purple);
  - all-eight pairwise 0.102–0.105;
  - the preview PNG's deuteranopia and tritanopia rows (0.102, 0.103);
  - first six 0.104 in bytes;
  - focus distance 0.104 (green against `#e3e8f0`);
  - muted distance 0.102 (pink against `#9da2ad`);
  - the 25% fills Chrome drew, 0.0628 in both canvas and SVG.
- **Fills, both schemes:** the 25% neighbours have about 0.003–0.005 of room; the 80% fills have a lot.

Before the palette-B review, the scorer built this list before it appended the browser checks. The record therefore left out seven qualifying values: three light and two dark preview rows, and the two dark Chrome fills (review finding 5). `score.mjs` now builds the list from every check, and the unit test recomputes it.

How fragile is that to a hand edit? I tried every one-byte change of one channel of one color. 44 of 48 light edits and 48 of 48 dark edits still meet every required check (`palette.json`, `oneByteEdits`). A changed hex still fails the record test until `score.mjs` is rerun.

The solver kept margins above the tested limits: pairwise 0.102, fills 0.063, contrast 3.02, and a hue shift of 15° (`configs/fit-final.json`, `solverLimits`). B is not at the edge of its boxes: with fills at 0.065 and pairwise at 0.103, the same boxes still hold solutions that differ by a few bytes in several colors. I kept B as chosen and did not search for the largest margins.

## Focus token under a two-tone ring

The second review (part B, finding 1) showed that a single-ink focus indicator cannot work with these colors:
- **Dark.** `#e3e8f0` is under 3:1 against five dark series colors: blue 2.27, orange 2.54, green 1.17, cyan 1.58 and pink 1.96. Purple (4.70), red (4.04) and slate (3.94) pass.
- **Light.** The same holds: `#1f5fcc` is between 1.08 and 1.90:1 against every light series color.
- **In dark, no single ink can clear the background, the purple and the green together.** An ink 3:1 from both the background and the purple `#9443a9` has to reach at least 9.22:1 on the background. An ink 3:1 from the green `#ade4ba` has to be at most 4.11:1 or at least 37.0:1 on the background. White reaches only 17.76:1.
- **Against the green and the background alone, one ink is possible.** `#707070` is 3.59:1 on `#16181d` and 3.44:1 against the green (palette-B review, finding 3); it fails against the purple at 1.17:1. The first version of this paragraph said no ink could clear the green and the background, which was wrong.

A datum outline crossing a mark therefore fails WCAG 1.4.11 wherever it is drawn in one ink. The chart core now draws the indicator in two tones: a ring in the focus token, with a surround in the background color between the ring and the marks (`core/focus.ts`, `theme/css.ts`; not my files).

**What the token must satisfy under the two-tone ring:**

1. **The focus color must reach 3:1 against the background.** The ring is seen against its surround, which is the background color. Light `#1f5fcc` on `#ffffff` is 5.89:1; dark `#e3e8f0` on `#16181d` is 14.43:1. Both pass, and the L2 token test asserts it.
2. **Against opaque marks, the surround reaches 3:1.** That is constraint 1 read the other way: every opaque series color reaches 3:1 on its background (lowest 3.10 light, 3.07 dark), and so do the axis and reference tokens.
   - **Translucent fills fall below it.** Measured on the fill pixels Chrome drew (`raster.json`), all 16 fills at 25% are under 3:1 against the background: the lowest is 1.27:1 (light slate) and 1.24:1 (dark purple). At 80%, 6 of 16 are under it: light blue, orange and slate (2.38–2.45:1), and dark purple, red and slate (2.38–2.77:1). The palette-B review found this (finding 1). The first version of this item said "every mark it touches", which was wrong for fills.
   - **The ring keeps its contrast over a fill.** Both rings put a 2 px focus band between 1 px bands of the background color. The datum ring draws a 4 px background outline under a 2 px focus outline (`core/focus.ts`). The plot ring uses a 2 px outline over a 4 px inset background shadow (`theme/css.ts`). The focus color therefore always touches the background color, at 5.89:1 (light) or 14.43:1 (dark), whatever fill lies under the ring. The outer edge between a background band and a translucent fill has less than 3:1, and nothing here claims more.
3. **The focus color needs no contrast against series colors.** The surround keeps them from touching.

**Constraint 5 is no longer needed for contrast.** That constraint is the 0.10 OKLab distance between every series color and the focus token, and it never could provide contrast: an OKLab distance is not a contrast ratio. What it buys is identity. The ring's color never coincides with a series color, so a focused datum's outline is not read as a mark of its own or another series. That matters most for slot 1, the most-used series. The old dark focus `#79a8ff` is 0.050 from today's dark blue `#5d9afd`, so a ring around a series-1 point would be drawn in nearly that series' own color. I recommend keeping constraint 5. Dropping it would allow `#79a8ff` to return (7.49:1 on the background, so it would pass under two tones) at the cost of that confusion. This is the owner's call.

## How B was made and why it was chosen

**Where it started.** It started from the second review's pair (part B, "More even light scheme"):

```text
light  #1e97fa #c7872b #0f6f48 #8636c1 #c61405 #4f81b7 #921184 #8c9695
dark   #64acfa #fbab2d #96e8c6 #9f46ae #fe573f #387bf0 #d571aa #5f6866
```

That pair meets every limit, and I confirmed it with the same code. By eye, it has two faults:
- **Its sixth slot is a second blue.** Light `#4f81b7` is 2° of hue from `#1e97fa`, and dark `#387bf0` is 9° from `#64acfa`.
- **Its dark red shouts.** `#fe573f` (chroma 0.207 at L 0.68) is the loudest mark in the dark scheme.

So I did three things:
- moved slot 6 to cyan and teal hues (`configs/b-cyan.json`, `b-cyan-45.json`);
- held both eighths at chroma 0.015 or less;
- asked for calmer dark red and orange. In the wide searches, the orange was capped at chroma 0.15 and the red at 0.16. The final dark search asked for 0.14, in boxes up to 0.18. Both ended at 0.150 to two decimals (0.1503 orange, 0.1505 red).

**How the sets were found.**
- **Light.** It came from annealing, then an exact local search (`configs/b-polish-light.json`).
- **Dark.** It came from an exact search against the light set (`b-polish-dark.json`).
- **Reproduction.** `configs/candidate-b.json` puts small boxes around both with the solver margins. Its slots are the same as today's `fit-final.json`, and it is kept as the record of the candidate.

**Against the superseded palette and the review's pair:**

| | Superseded | Review's pair | B (shipped) |
|---|---|---|---|
| Light L, lowest to highest | 0.43–0.68 | 0.46–0.67 | 0.45–0.67 |
| Light L spread, first three | 0.25 | 0.19 | 0.20 |
| Light largest chroma | 0.205 (purple) | 0.207 (purple, red) | 0.220 (purple) |
| Hue gap, slot 1 to slot 6, light / dark | 20° / 27° | 2° / 9° | 19° / 30° |
| Eighth's chroma, light / dark | 0.026 / 0.031 (hue 283 / 274) | 0.012 / 0.011 | 0.010 / 0.011 |
| Dark largest chroma | 0.177 (purple) | 0.207 (red) | 0.171 (purple) |
| Dark first blue | `#64acfa`, L 0.73, 7.46:1 | `#64acfa` | `#5d9afd`, L 0.69, 6.35:1 |
| Lowest contrast, light / dark | 3.03 / 3.26 | 3.03 / 3.09 | 3.10 / 3.07 |

**What B costs, as measured:**
- **A louder light red and purple.**
  - `#be1506` is a full red (chroma 0.20), like the review's `#c61405`. It is the loudest line in the light "8 lines" panel, and the superseded coral was not.
  - The light purple is at chroma 0.220, above both other sets. In B's neighbourhood, a cap of 0.207 is proved infeasible: the exact search in `configs/b-purple-207.json` completes with no solution.
  - A calmer red does not need a more chromatic purple. My searches with red at 0.18 or 0.17 returned purple at 0.23 (`b-red-18.json`, `b-red-17.json`), because they minimise the distance to their targets, not purple's chroma. The first version of this item read that as "feasible only with purple at 0.23", which was wrong.
  - On the `b-red-17` grid with purple capped at 0.22, the palette-B review (finding 2) found red at chroma 0.170 with purple at 0.2195, slightly below B's own 0.2196:

    ```text
    light  #3697f9 #cf8020 #056850 #8734cb #ab2a09 #297ea6 #8b0b8b #8e948f
    dark   #5c97fe #dc772f #aae4bd #9443a9 #ba4f1f #2fc3ff #d791bb #6d736e
    ```

    `color.mjs` confirms that it meets every required check, analytic, in bytes and on both raster models. Its lowest contrast is 3.02:1 (light) and its largest hue shift 14.8°. It has not been rendered in Chrome.
  - My own exact search on that grid (`configs/b-red-17-p22.json`) completes with the same red and purple, differing only in slots 6 and 8. Its dark search timed out in that config's boxes.
  - Red at 0.16 is proved infeasible in its boxes (`b-red-16.json`).
- **A dark purple at 3.07:1,** against 3.26 in the superseded set.
- **Tighter dark margins to the tokens:** focus 0.104 and muted 0.102. The superseded set had 0.138 and 0.113.
- **A dark first blue at 6.35:1** (`#5d9afd`, L 0.69) instead of `#64acfa` (7.46:1). Keeping `#64acfa` against this light set was not found (`b-dark-blue.json`): the exact search timed out and annealing found nothing.
- **A light floor at 0.45, not the review's 0.46.** With every light color at 0.46 or above, my searches found only a steel-blue sixth (`b-walk3.json`, hue 242) or nothing (`b-cyan.json`, `b-indigo.json`). That is a search result, not a proof.
- **A more saturated dark cyan.** `#38c7fe` has chroma 0.14, against 0.11 in the superseded set. I asked for 0.115; the exact search went to 0.14.

**Why it was chosen.** The owner chose B over the superseded palette for its more even light scheme, a calmer first three and a neutral eighth. The comparison images the owner chose from are kept as they were: `research/palette/compare-light.png` and `compare-dark.png`, superseded above and B below, with the same seven panels in normal vision. What can be checked in them:
- **"3 lines", light.** In the superseded set, the deep green line is clearly the heaviest and the orange the hottest. In B, the ochre and the lighter green sit closer to the blue.
- **Swatch 8, both images.** The superseded slate reads as a lavender grey; B's reads as grey in both schemes.
- **Swatches 1 and 6, and the donut.** Both sets show sky blue against teal in light and blue against cyan in dark.
- **"8 lines" and the donut, dark.** B's pink is dusty rather than candy-bright, and its red is a brick.

**The candidate's own records.** These are `palette-b.json`, `raster-b.json`, `strokes-b.json`, `strokes-b-raw.json.gz`, `preview-b-*.png` and `preview-b-pixels.json`, all written before adoption. I regenerated the shipped records from `palette.ts` in Chrome 157. The result is identical to the candidate's records byte for byte: the raster, stroke and raw stroke records, the preview pixels and the light PNG. `palette.json` equals `palette-b.json` except for the latter's `candidate` field.

## Thin lines

`strokes.mjs` draws each color as a 2 px random-walk polyline in headless Chrome 157 and reads the pixels back. It draws through canvas and SVG, at device pixel ratios 1 and 2. For each pixel column it records two values:

- **Core:** the most covered pixel.
- **Weighted:** the coverage-weighted mean of the touched pixels, bg + (Σc²/Σc)(ink − bg), with coverage at or below 0.02 dropped.

This is a legibility measurement of this rendering path, not the WCAG test. WCAG 1.4.11 allows the specified stroke color to be assessed despite antialiasing, and A5 is met on the swatch.

Weighted p10 / median contrast, by renderer and device pixel ratio (`strokes.json`):

| Scheme, slot | Color | Swatch | Canvas DPR 1 | SVG DPR 1 | Canvas DPR 2 | SVG DPR 2 |
|---|---|---|---|---|---|---|
| light 1 | `#2b97ee` | 3.10 | 2.50 / 2.59 | 2.48 / 2.59 | 2.77 / 2.84 | 2.77 / 2.84 |
| light 2 | `#cf8020` | 3.11 | 2.47 / 2.56 | 2.47 / 2.56 | 2.74 / 2.82 | 2.74 / 2.82 |
| light 3 | `#0b6c49` | 6.45 | 4.33 / 4.60 | 4.28 / 4.60 | 5.18 / 5.41 | 5.18 / 5.41 |
| light 4 | `#812cc4` | 6.79 | 4.64 / 4.98 | 4.64 / 4.98 | 5.59 / 5.82 | 5.59 / 5.82 |
| light 5 | `#be1506` | 6.36 | 4.86 / 5.12 | 4.86 / 5.12 | 5.63 / 5.77 | 5.59 / 5.77 |
| light 6 | `#0380a8` | 4.51 | 3.32 / 3.49 | 3.32 / 3.49 | 3.82 / 3.97 | 3.82 / 3.97 |
| light 7 | `#8c1382` | 8.30 | 5.70 / 6.07 | 5.62 / 6.07 | 6.88 / 7.16 | 6.82 / 7.16 |
| light 8 | `#8e948f` | 3.10 | 2.42 / 2.50 | 2.42 / 2.50 | 2.70 / 2.79 | 2.70 / 2.79 |
| dark 1 | `#5d9afd` | 6.35 | 4.59 / 4.84 | 4.57 / 4.83 | 5.38 / 5.58 | 5.37 / 5.58 |
| dark 2 | `#dc772f` | 5.69 | 4.13 / 4.38 | 4.13 / 4.38 | 4.80 / 4.97 | 4.80 / 4.97 |
| dark 3 | `#ade4ba` | 12.33 | 8.50 / 9.04 | 8.41 / 9.04 | 10.20 / 10.60 | 10.20 / 10.60 |
| dark 4 | `#9443a9` | 3.07 | 2.43 / 2.52 | 2.43 / 2.52 | 2.72 / 2.80 | 2.72 / 2.80 |
| dark 5 | `#ba4f1f` | 3.57 | 2.76 / 2.87 | 2.74 / 2.87 | 3.11 / 3.22 | 3.09 / 3.22 |
| dark 6 | `#38c7fe` | 9.11 | 6.37 / 6.75 | 6.37 / 6.75 | 7.54 / 7.87 | 7.54 / 7.87 |
| dark 7 | `#d991b8` | 7.35 | 5.24 / 5.56 | 5.24 / 5.56 | 6.17 / 6.38 | 6.17 / 6.38 |
| dark 8 | `#6d736e` | 3.66 | 2.85 / 2.94 | 2.81 / 2.94 | 3.21 / 3.31 | 3.21 / 3.31 |

What else the record shows:
- **Core.** The core p10 equals the swatch to two decimals in every row and renderer.
- **Coverage.** Counted from the raw pixel record (`strokes-raw.json.gz`), every color has a fully covered pixel in 575 of 576 columns at DPR 1 (one column without, in both renderers). At DPR 2 it has one in all 1,152.
- **Renderers.** Canvas and SVG differ by up to 0.09 (dark green, DPR 1 p10: 8.50 canvas, 8.41 SVG), and most often by 0.00–0.05.
- **Tested.** The unit test recomputes every statistic in this table, and both column counts, from the raw record.

Every series also has a full-color marker at its last point and at sparse intervals (spec A5).

## Superseded: the refit of 52bbdf0

This palette shipped from the refit until the owner adopted B on 2026-11-18:

```text
light  #4a94eb #e97200 #136102 #7314a2 #bd585e #007baa #a52265 #9293a5
dark   #64acfa #de7b2e #b2e390 #9149b9 #c3513d #71d8ff #f898b5 #7a7f93
```

**Why it was replaced: uneven lightness in the light scheme.**
- **Spread.** Light L ran from 0.43 to 0.68. Three colors (green, purple and magenta, at L 0.43–0.49) were much darker than the three near 3:1.
- **Weight.** In the 3-series chart, the green line was clearly the heaviest of the first three (L 0.43 against 0.66 and 0.68).
- **What B gives instead.** B has a calmer first three (ochre for a hot orange, a lighter green) and a neutral eighth. The superseded slate `#9293a5` was a lavender grey at chroma 0.026, hue 283.

**Its measurements, from commit 987988b's `research/palette/palette.json`.** Pairwise cells are normal / protan / deutan / tritan.
- **Lowest contrast:** 3.03 light (slate), 3.26 dark (purple).
- **All-eight minimum:** 0.124 / 0.103 / 0.103 / 0.102 light; 0.116 / 0.104 / 0.103 / 0.102 dark.
- **Fills:** the 25% neighbours were 0.063 in Chrome, and 0.056 at the worst case within one byte.
- **One-byte edits:** 41 of 46 light and 46 of 47 dark passed.
- **Strokes:** the lowest weighted p10 at DPR 1 was 2.38 light and 2.55 dark.

**Its record.** That commit holds its Chrome records and preview PNGs. `configs/fit-superseded.json` reproduces its arrays; I ran it again here and both searches completed. It came out of a four-step refit, and an explorer fix shipped alongside:

1. **Wider boxes, exact search.** I ran `fit.mjs` with light floors at L 0.44–0.48 and chroma up to 0.18–0.22 (`configs/even-a.json`, `even-c.json`). No palette was found within 300 s. That is a timeout, not a proof.
2. **Annealing.** `anneal.mjs` searches the same grids by minimising the total shortfall. I checked it first on a known-feasible neighbourhood, where it recovered the first review's palette.
   - From random starts it found feasible light sets only once the boxes were split into tiers: blue, orange and slate near 3:1, red and cyan in the middle, green, purple and magenta lower (`configs/tier-44-free.json`).
   - It found nothing with every color at L 0.46 or above (`configs/tier-46-cr.json`).
3. **Dark against that light set.** The searches with the old focus token failed: `dark-a2.json` (annealing) and `dark-n2.json` (exact; best blue L 0.55). Moving the dark focus to near-white let annealing find a set with a light dark-mode blue and a deeper purple (`configs/dark-c.json`).
4. **Polish.** I put small boxes around both results, with the solver margins (`configs/fit-superseded.json`, formerly `fit-final.json`). In those boxes, 0.065/0.103 and 0.066/0.102 were proved infeasible.

Explorer fix: `explore.mjs orders` keeps three outcomes per order: feasible, proved infeasible, timed out. It prunes only on a completed proof and prints all three. The first version's family and order statistics came from the faulty explorer. I did not rerun them in full, so they are withdrawn.

## Why lightness spreads on white (corrected)

The first version said that each simulation "removes one chromatic axis", and that three deep colors were therefore forced. Both statements were wrong.

The Machado matrices act in linear RGB, not in OKLab. In OKLab they mostly compress the red–green direction (protanopia, deuteranopia) or the blue–yellow direction (tritanopia), but they also move lightness. For example, the first version's light blue has L 0.659 unsimulated and between 0.643 and 0.691 across the simulations. The compression is a design heuristic, not a proof.

The first review then exhibited a two-scheme palette meeting all six constraints with light L from 0.48 to 0.69:

```text
light  #3791ff #d28204 #2b6d48 #881bbd #c70f09 #1f7fae #fe1ce0 #959396
dark   #63d2fc #f9c309 #78aa6f #bf37be #e42129 #4574fa #ee5ec3 #7e7c80
```

It lay outside the boxes my what-if runs had searched. That pair pays in chroma: its magenta has chroma 0.30, its red 0.21 and its purple 0.23, and one hue shift sits at 29.97°. The second review then found a pair with light L 0.460–0.673 and chroma at most 0.207. So the uneven lightness of the superseded set was not the price of restrained chroma either. B starts from that pair.

## Tried and failed

Each line below means "not found" in the searches for the superseded refit; B's own searches are listed in its section above. Only searches that complete prove anything, and those are marked.

- **A lighter, calmer slot-3 green** (L 0.46 or above, chroma 0.11 or below), with restrained chroma elsewhere (`configs/green-a.json`; `green-b.json`, which also allowed a saturated red): nothing at the time.
  - The shortfalls were green against red under protanopia, and magenta against cyan and slate.
  - B later found one (`#0b6c49`, L 0.47, chroma 0.10), with wider hue boxes and a purple at chroma 0.22.
- **Walking from the first review's palette toward lower chroma** while staying feasible (`configs/walk-b.json`): the green and red calmed down, but the magenta stayed at chroma 0.28 or more (`#fd26e0`).
- **The first review's tier structure with chroma held at 0.22 or less** (`configs/cx-a.json`): nothing; magenta was always the shortfall.
- **Red third**, as in Tableau 10 (`configs/red3-a.json`): nothing; red was short against green under protanopia.
- **Magenta fourth instead of purple**, to relieve the dark blue (`configs/mag4-a.json`): feasible on white. Its dark set was proved infeasible with the old focus token (exact search, `configs/dark-n2-m4.json`), and annealing found none with the new one (`configs/dark-b2-m4.json`).
- **Fills at the worst case within one byte per channel, in both schemes**: never met together with the other goals. B meets it in light (0.060) but not in dark (0.057).
- **A palette with every light color at L 0.48 or above that also keeps chroma at 0.22 or less**: none found. My conclusion at the time was that the lightness-for-chroma trade was real. That was wrong: the second review found an L 0.46 floor at chroma 0.207 by searching a wider range of hues. My searches were limited in time, boxes and hue ranges.

## Additions beyond the six constraints

- **Muted token** in constraint 5 (tested). The donut's "Other" slice.
- **Byte-level checks** (tested): byte-rounded simulation; fills on both 8-bit raster models; Chrome's drawn pixels within one byte of the model and 0.06 apart; the preview PNG's donut pixels 0.10 apart.
- **Ring closure and deficiency-simulated fills** (recorded only).
  - At 25% the donut's closing pairs go down to 0.029 (light 6–1) and 0.037 (dark 6–1) in normal vision. Under the simulations they go lower: 0.024 (light 6–1, tritanopia) and 0.029 (dark 6–1, deuteranopia). The first version of this item gave only the normal-vision figures as the minimum (palette-B review, finding 5).
  - Neighbours under simulation go down to 0.028 (light, deuteranopia, 6–7).
  - Slices are opaque in Axylo, so constraint 2 covers them.
- **Solver margins** as listed above. The tests use the decision's limits.

## For the owner

- **The light red and purple are the loudest light colors** (chroma 0.20 and 0.22). Purple at 0.207 is proved infeasible near B. A red at 0.17 exists without a more chromatic purple, which the palette-B review found; it is unrendered and not adopted ("What B costs").
- **The dark focus ring is near-white `#e3e8f0`** (light stays blue).
  - This is a visible UI change, made to free the dark blue.
  - With the two-tone ring it meets its contrast need (14.4:1 on the background).
  - Reverting to `#79a8ff` is possible under two tones only if constraint 5 is dropped: it is 0.050 from the dark blue (see "Focus token under a two-tone ring").
- **The dark set mixes three very light colors with two dimmer ones.** The light ones are the green (L 0.87), cyan (0.78) and pink (0.74). The dimmer ones are a deep purple (0.53) and a brick red (0.56), the dimmest at 3.07 and 3.57:1.
- **Slot hues move within each family between schemes.** The largest shift is 14.1° (purple), under constraint 4's 30°. By eye, dark slot 5 reads as rust and dark slot 7 as dusty pink (see "The palette").

## Reference palettes (measured)

These are read from the installed d3-scale-chromatic 3.1.1 (`research/harness/node_modules`) by `research/palette/references.mjs` and scored with the same code (`research/palette/references.json`). Minima are over the first eight colors.

| Scheme | Below 3:1 on white | Min ΔE normal / protan / deutan / tritan (closest slots) |
|---|---|---|
| schemeTableau10 | 5 of 10 | 0.129 / 0.016 / 0.007 (3–5, red–green) / 0.064 |
| schemeObservable10 | 6 of 10 | 0.113 / 0.059 / 0.020 / 0.046 |
| schemeCategory10 (D3's default, Plotly's) | 4 of 10 | 0.113 / 0.007 (2–3) / 0.039 / 0.042 |
| schemeDark2 | 2 of 8 | 0.099 / 0.018 / 0.017 / 0.049 |
| schemeSet1 | 5 of 9 | 0.130 / 0.031 / 0.035 / 0.066 |

Library defaults as rendered are in R7 (docs/01-landscape.md). That table has eight displayed six-slice rows. Four rows need a note:
- Recharts' row uses its documentation's authored colors.
- The D3 chart is authored.
- uPlot has no default palette.
- ECharts was read from its options.

What I took from these:
- the blue-then-orange opening (Tableau 10, Category 10);
- a quiet neutral last;
- the evidence that the familiar sets put adjacent hues that deuteranopia merges (Tableau 10's red and green at 0.007).

The first version also drew on palettes recalled from memory (IBM Carbon, Okabe–Ito, Paul Tol). No arrays for them are installed here, so they are not cited.

## Not verified

- **Browser suites.** The suites that sample palette colors were not run, because they need `npm run build`.
  - `render.browser.test.ts` and `theme.browser.test.ts` read the colors from `palette.ts`, so they should follow; that is inferred.
  - `keyboard.browser.test.ts` checks the light focus only, and that token is unchanged.
  - `tests/dist/csp.browser.test.ts` reads the light first series color from the packed stylesheet, so it should need no change; that is inferred, not run.
- **The built bundle.** `packages/axylo/dist` (untracked) still declares the superseded colors until the next build, for example `--axylo-default-series-1: light-dark(#4a94eb, #64acfa)`.
- **The focus ring.** The two-tone ring is in the chart core. Its rendered pixels have not been measured here; the contrasts above are computed from the token colors.
- **Overlapping fills.** Raster checks cover isolated fills over the background. A 25% area over another 25% area is not scored.
- **Simulation and platform.** The simulation is Machado at severity 1.0 only. Strokes and fills were measured in headless Chrome 157 on Linux only.
- **People.** Nobody with a color-vision deficiency has looked at the previews.
- **Review.** B has been reviewed independently (`palette-b.review.md`), without a fresh browser render. The review's red-at-0.17 counterexample has not been rendered in Chrome. The owner chose B from the comparison images.

## Files

- `packages/axylo/src/theme/palette.ts`: both series sets, written from `candidates/fit-final.json`, and the tokens. Exported names and shapes are unchanged.
- `packages/axylo/test/theme/palette.test.ts`: what it checks:
  - constraints 1–6, analytic and in bytes;
  - Chrome fill pixels;
  - the record at its written precision;
  - stroke-record validation;
  - the preview PNG's pixels;
  - the browser records on disk against the record, with both preview PNGs decoded;
  - the check list, pass flags and tight list;
  - the one-byte-edit count.
- `research/palette/`: the scripts and records.
  - Scripts: `color.mjs`, `fit.mjs`, `anneal.mjs`, `explore.mjs`, `score.mjs`, `raster.mjs`, `strokes.mjs`, `preview.mjs`, `references.mjs`.
  - Configs: `configs/` (`fit-final.json` is the shipped palette, `fit-superseded.json` the previous one).
  - Records: `palette.json`, `raster.json`, `strokes.json`, `strokes-raw.json.gz`, `preview-pixels.json`, `references.json`.
  - Previews: `preview.html` and the two PNGs.
- Record of the choice, in `research/palette/`:
  - the comparison: `compare.html`, `compare-light.png`, `compare-dark.png`;
  - the candidate as written before adoption: `configs/candidate-b.json`, `configs/b-*.json`, `candidates/candidate-b.json`, and the `*-b*` records.

  The README lists what each file is and how to reproduce it.
