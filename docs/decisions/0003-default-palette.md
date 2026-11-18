# Decision 0003: the default categorical palette

Status: **proposed, refitted after review.** The first version (commit 51e1be5) was reviewed by Codex gpt-6.2-astra (`reviews/2026-11-18/impl/wp/palette.review.md`). The review confirmed the arithmetic and showed four things wrong: the uneven lightness was claimed to be forced and is not; simulated screenshots and 8-bit fills fell below the limits the record promised; the order explorer could prune a feasible order after a timeout; and the record overclaimed in several places. This version is a refit with byte-level checks and corrected text. The hard constraints are measured and tested. Whether the result is good to look at is the owner's call (see "For the owner"). The refit itself has not been reviewed.

Spec: A5 (palette thresholds, provisional), L2 (3:1 for marks), F9 (eight series). Finding R7, docs/01-landscape.md.

## The palette

Slot order: blue, orange, green, purple, red, cyan, magenta, slate. That is the first version's order. Hue families are kept per slot.

| Slot | Family | Light | OKLCH | Contrast on #ffffff | Dark | OKLCH | Contrast on #16181d | Hue shift |
|---|---|---|---|---|---|---|---|---|
| 1 | blue | `#4a94eb` | 0.66 0.150 254 | 3.12 | `#64acfa` | 0.73 0.135 252 | 7.46 | 2° |
| 2 | orange | `#e97200` | 0.68 0.175 52 | 3.06 | `#de7b2e` | 0.68 0.150 54 | 5.90 | 2° |
| 3 | green | `#136102` | 0.43 0.140 141 | 7.67 | `#b2e390` | 0.86 0.121 133 | 12.08 | 8° |
| 4 | purple | `#7314a2` | 0.43 0.205 310 | 8.93 | `#9149b9` | 0.54 0.177 312 | 3.26 | 2° |
| 5 | red | `#bd585e` | 0.59 0.130 18 | 4.45 | `#c3513d` | 0.58 0.151 32 | 3.86 | 14° |
| 6 | cyan | `#007baa` | 0.55 0.115 234 | 4.76 | `#71d8ff` | 0.83 0.110 225 | 10.97 | 9° |
| 7 | magenta | `#a52265` | 0.49 0.175 355 | 6.96 | `#f898b5` | 0.79 0.119 1 | 8.58 | 6° |
| 8 | slate | `#9293a5` | 0.67 0.026 283 | 3.03 | `#7a7f93` | 0.60 0.031 274 | 4.47 | 9° |

**One token changes.** The dark focus token goes from `#79a8ff` to a near-white `#e3e8f0`, which is 14.4:1 on #16181d. The old focus blue sat at OKLab L 0.735, exactly where a dark-mode series blue belongs. With it kept, no dark set I found had a first blue above L 0.55. The exact search with the blue asked for at 0.62 ended at `#3970c2`, L 0.55 (`configs/dark-n2.json`, best within 300 s). The light focus `#1f5fcc` is unchanged; `keyboard.browser.test.ts` hardcodes it. Every other token is unchanged.

**Before and after.**

| | 51e1be5 | Now |
|---|---|---|
| Light OKLab L, lowest to highest | 0.39 to 0.68 | 0.43 to 0.68 |
| Light, spread across the first three | 0.26 | 0.25 |
| Light, largest chroma | 0.17 | 0.205 (purple) |
| Dark first blue | `#1c73c5`, L 0.55, 3.64:1 | `#64acfa`, L 0.73, 7.46:1 |
| Dark, largest chroma | 0.15 | 0.177 (purple) |
| Largest light/dark hue shift | 18.5° (slate), 8° chromatic | 13.6° (red) |
| Byte-rounded simulation, worst pair | 0.098 (light protan 6–8) | 0.102 |
| 25% fills on an 8-bit raster, worst neighbours | 0.0590 (review's raster) | 0.063 (Chrome, canvas and SVG) |

The dark blue now has ordinary dark-mode lightness. The light set did not get much more even. Slot 3's green is still the heaviest of the first three lines on white (L 0.43 against 0.66 and 0.68). "Tried and failed" below says what I searched for that and why I stopped.

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
- **Bytes.** Values are rounded where an 8-bit image would round them. A simulated color is encoded and rounded to the nearest byte before the OKLab conversion; that is what the simulated rows of the preview PNGs hold. A translucent fill is quantised as a raster would quantise it: alpha at round(α×255), each channel rounded. That reproduces Chrome 157's canvas and SVG fills on white exactly and is within one byte on #16181d. The second variant, alpha at floor(α×255), is what the review's CPU Skia raster did.
- **Chrome.** The fill pixels Chrome actually drew, canvas and SVG (`research/palette/raster.mjs`).

The unit test requires the analytic and the byte forms. It checks the recorded Chrome pixels against the 0.06 limit, and checks that each recorded pixel is within one byte of the model. A stricter margin is the worst case over every byte color within one byte per channel of both fills. It is recorded but not required, because I found no palette that meets it together with the rest (0.054–0.056 is the best I saw; see below).

## Constraints, measured

These come from `research/palette/palette.json`, which `score.mjs` writes. The unit test recomputes each value with its own code and compares it at the written precision, including which pair is closest.

| Constraint | Check | Limit | Light | Dark |
|---|---|---|---|---|
| 1 | lowest contrast on background | ≥ 3 | 3.03 (slate) | 3.26 (purple) |
| 2 | min pairwise ΔE, all 8, normal / protan / deutan / tritan | ≥ 0.10 | 0.124 / 0.103 / 0.103 / 0.102 | 0.116 / 0.104 / 0.103 / 0.102 |
| 2, bytes | the same after the simulation is rounded to bytes | ≥ 0.10 | 0.124 / 0.103 / 0.103 / 0.102 | 0.116 / 0.103 / 0.102 / 0.102 |
| 3 | first 4, worst vision (analytic; bytes) | ≥ 0.14 | 0.156 protan; 0.155 | 0.158 tritan; 0.159 |
| 3 | first 3, 5, 6, worst vision (analytic) | ≥ 0.10 | 0.156 / 0.102 / 0.102 | 0.158 / 0.103 / 0.103 |
| 4 | largest light/dark OKLCH hue shift | ≤ 30° | 13.6° (red) | same pairs |
| 5 | nearest series color to focus / reference / muted | ≥ 0.10 | 0.101 (cyan) / 0.152 (green) / 0.110 (cyan) | 0.138 (cyan) / 0.104 (cyan) / 0.113 (slate) |
| 6 | neighbour fills at 25%: ideal / byte models / Chrome canvas / Chrome SVG | ≥ 0.06 | 0.064 / 0.063 / 0.063 / 0.063 | 0.064 / 0.064 / 0.063 / 0.063 |
| 6 | neighbour fills at 80%: ideal / byte models / Chrome | ≥ 0.06 | 0.201 / 0.202 / 0.202 | 0.179 / 0.179 / 0.179 |
| 6, recorded only | 25% fills, worst case within one byte | (0.06) | 0.056 | 0.056 |

"Muted" is my addition to constraint 5: the donut draws its "Other" slice in the muted token, next to series slices.

### Prefix minima (constraint 3)

Each cell is analytic / bytes, with the closest slots.

| Prefix | Vision | Light | Dark |
|---|---|---|---|
| first 3 | normal | 0.319 / 0.319 (1–2) | 0.251 / 0.251 (1–3) |
| first 3 | protan | 0.156 / 0.155 (2–3) | 0.247 / 0.246 (1–3) |
| first 3 | deutan | 0.270 / 0.271 (2–3) | 0.178 / 0.177 (2–3) |
| first 3 | tritan | 0.243 / 0.241 (1–3) | 0.158 / 0.159 (1–3) |
| first 4 | normal | 0.284 / 0.284 | 0.246 / 0.246 |
| first 4 | protan | 0.156 / 0.155 | 0.247 / 0.246 |
| first 4 | deutan | 0.217 / 0.217 | 0.178 / 0.177 |
| first 4 | tritan | 0.157 / 0.157 | 0.158 / 0.159 |
| first 5 | normal / protan / deutan / tritan | 0.135 / 0.103 / 0.136 / 0.102 | 0.116 / 0.126 / 0.109 / 0.103 |
| first 6 | normal / protan / deutan / tritan | 0.124 / 0.103 / 0.117 / 0.102 | 0.116 / 0.124 / 0.109 / 0.103 |

The full tables with pair identities for every row are printed by `node research/palette/score.mjs --md`.

### Tight pairs and margins

These are every measured value within 5% of its limit (`palette.json`, `tight`):

- **Light:**
  - contrast 3.026 (slate; the solver keeps 3.02);
  - all-eight pairwise 0.102–0.103 under the three deficiencies, analytic and in bytes;
  - first five and six 0.102–0.103;
  - focus distance 0.101 (cyan against `#1f5fcc`).
- **Dark:**
  - all-eight pairwise 0.102–0.104;
  - first five and six 0.102–0.103;
  - reference distance 0.104 (cyan against `#bcc0c9`).
- **Fills, both schemes:** the 25% neighbours have about 0.003–0.004 of room; the 80% fills have a lot.

How fragile is that to a hand edit? I tried every one-byte change of one channel of one color: 41 of 46 light edits and 46 of 47 dark edits still meet every required check (`palette.json`, `oneByteEdits`). The first version of this record said that "almost any hand edit fails". That was wrong; the review measured 36/48 and 32/47 for 51e1be5. A changed hex still fails the record test until `score.mjs` is rerun.

The solver kept margins above the tested limits: pairwise 0.102, fills 0.063, contrast 3.02, hue shift 15° for chromatic slots (`configs/fit-final.json`, `solverLimits`). In the final boxes it proved 0.065/0.103 and 0.066/0.102 infeasible, so the margins cannot be much larger near this palette.

## Thin lines

`strokes.mjs` draws each color as a 2 px random-walk polyline in headless Chrome 157 (canvas and SVG, device pixel ratio 1 and 2) and reads the pixels back. For each pixel column it records two values:

- **Core:** the most covered pixel.
- **Weighted:** the coverage-weighted mean of the touched pixels, bg + (Σc²/Σc)(ink − bg), with coverage at or below 0.02 dropped.

This is a legibility measurement of this rendering path, not the WCAG test. WCAG 1.4.11 allows the specified stroke color to be assessed despite antialiasing, and A5 is met on the swatch.

| | Swatch | Core p10 | Weighted p10 / median, DPR 1 | Weighted p10 / median, DPR 2 |
|---|---|---|---|---|
| light blue `#4a94eb` | 3.12 | 3.12 | 2.47 / 2.57 | 2.75 / 2.84 |
| light orange `#e97200` | 3.06 | 3.06 | 2.50 / 2.59 | 2.75 / 2.81 |
| light slate `#9293a5` | 3.03 | 3.03 | 2.38 / 2.47 | 2.65 / 2.71 |
| light red, cyan | 4.45, 4.76 | same | 3.27 / 3.44, 3.46 / 3.64 | 3.75 / 3.91, 4.03 / 4.18 |
| light green, purple, magenta | 6.96–8.93 | same | 4.86 and up | 5.80 and up |
| dark purple `#9149b9` | 3.26 | 3.26 | 2.57 / 2.65 | 2.87 / 2.95 |
| dark red `#c3513d` | 3.86 | 3.86 | 2.93 / 3.09 | 3.35 / 3.43 |
| dark slate `#7a7f93` | 4.47 | 4.47 | 3.36 / 3.55 | 3.88 / 3.99 |
| dark blue, orange, green, cyan, pink | 5.90–12.08 | same | 4.27 and up | 5.00 and up |

The core column is the 10th percentile. In at least 90% of pixel columns the most covered pixel has the swatch's contrast. The review found that a few columns, about one in 576 at DPR 1, have no fully covered pixel (for the first version's orange, the least-covered core was 96.6%). Canvas and SVG agree within 0.05. Every series also has a full-color marker at its last point and at sparse intervals (spec A5).

## Why lightness spreads on white (corrected)

The first version said that each simulation "removes one chromatic axis", and that three deep colors were therefore forced. Both statements were wrong.

The Machado matrices act in linear RGB, not in OKLab. In OKLab they mostly compress the red–green direction (protanopia, deuteranopia) or the blue–yellow direction (tritanopia), but they also move lightness. For example, the first version's light blue has L 0.659 unsimulated and between 0.643 and 0.691 across the simulations. The compression is a design heuristic, not a proof.

The review then exhibited a two-scheme palette meeting all six constraints with light L from 0.48 to 0.69:

```text
light  #3791ff #d28204 #2b6d48 #881bbd #c70f09 #1f7fae #fe1ce0 #959396
dark   #63d2fc #f9c309 #78aa6f #bf37be #e42129 #4574fa #ee5ec3 #7e7c80
```

It lay outside the boxes my what-if runs had searched. What it costs is chroma: its magenta has chroma 0.30, its red 0.21 and its purple 0.23, and a hue shift sits at 29.97°.

## How the refit was done

1. **Wider boxes, exact search.** `fit.mjs` with light floors at L 0.44–0.48 and chroma up to 0.18–0.22 (`configs/even-a.json`, `even-c.json`). Both now require analytic and byte-rounded pairwise distances and both byte models for fills. No palette was found within 300 s. That is a timeout, not a proof.
2. **Annealing.** `anneal.mjs` searches the same grids by minimising the total shortfall. I checked it first on a known-feasible neighbourhood: it recovered the review's palette. From random starts it found feasible light sets only once the boxes were split into tiers: blue, orange and slate near 3:1, red and cyan in the middle, green, purple and magenta lower (`configs/tier-44-free.json`). It found nothing with every color at L 0.46 or above (`configs/tier-46-cr.json`).
3. **Dark against that light set.** The searches with the old focus token failed: `dark-a2.json` (annealing) and `dark-n2.json` (exact; best blue L 0.55). Moving the dark focus to near-white let annealing find a set with a light dark-mode blue and a deeper purple (`configs/dark-c.json`).
4. **Polish.** `configs/fit-final.json` puts small boxes around both results and adds the solver margins. Both exact searches complete, so the run is deterministic and reproduces the shipped arrays: `node research/palette/fit.mjs --config=research/palette/configs/fit-final.json --seconds=300`.
5. **Explorer fixed.** `explore.mjs orders` now keeps three outcomes per order (feasible, proved infeasible, timed out). It prunes only on a completed proof and prints all three. The first version's family and order statistics came from the faulty explorer, and I did not rerun them in full, so they are withdrawn.

## Tried and failed

Each line below means "not found". Only searches that complete prove anything, and those are marked.

- **A lighter, calmer slot-3 green** (L 0.46 or above, chroma 0.11 or below), with restrained chroma elsewhere (`configs/green-a.json`; `green-b.json`, which also allowed a saturated red): nothing. The shortfalls were green against red under protanopia, and magenta against cyan and slate. The review's palette does have such a green (`#2b6d48`). It pays for it with a near-3:1 magenta at chroma 0.30, which the walk below could not bring down.
- **Walking from the review's palette toward lower chroma** while staying feasible (`configs/walk-b.json`): the green and red calmed down, but the magenta stayed at chroma 0.28 or more (`#fd26e0`).
- **The review's tier structure with chroma held at 0.22 or less** (`configs/cx-a.json`): nothing; magenta was always the shortfall.
- **Red third**, as in Tableau 10 (`configs/red3-a.json`): nothing; red was short against green under protanopia.
- **Magenta fourth instead of purple**, to relieve the dark blue (`configs/mag4-a.json`): feasible on white. Its dark set was proved infeasible with the old focus token (exact search, `configs/dark-n2-m4.json`), and annealing found none with the new one (`configs/dark-b2-m4.json`).
- **Fills at the worst case within one byte per channel**: never met together with the other goals. The shipped palette's worst case is 0.056 in both schemes, short by 0.004.
- **A palette with every light color at L 0.48 or above that also keeps chroma at 0.22 or less**: none found. As far as I can tell, the lightness-for-chroma trade the review's palette makes is real. What is not proved is that a better point does not exist; the searches above were limited in time and in boxes.

## Additions beyond the six constraints

- **Muted token** in constraint 5 (tested). The donut's "Other" slice.
- **Byte-level checks** (tested): byte-rounded simulation; fills on both 8-bit raster models; Chrome's drawn pixels within one byte of the model and 0.06 apart.
- **Ring closure and deficiency-simulated fills** (recorded only). At 25% the donut's closing pairs go down to 0.032 (light 8–1) and 0.037 (dark 6–1). Neighbours under simulation go down to 0.024 (light, deuteranopia). Slices are opaque in Axylo, so constraint 2 covers them.
- **Solver margins** as listed above; the tests use the decision's limits.

## For the owner

- **Is the light set's weight acceptable?** Three colors (green, purple, magenta at L 0.43–0.49) are much darker than the three at 3:1. In the 3-series chart the green line is clearly the heaviest. I could not remove that at restrained chroma. The review's palette is more even and noticeably louder; its magenta reads as hot pink.
- **The dark focus ring becomes near-white `#e3e8f0`** (light stays blue). This is a visible UI change, made to free the dark blue. The alternative is to keep `#79a8ff` and accept a dark blue near L 0.55.
- **The dark set mixes very light green, cyan and pink** (L 0.79–0.86) with a deep purple (0.54) and a mid red (0.58). Purple and red are the dimmest (3.26 and 3.86:1).
- **Slot hues moved within each family.** The light red is a coral (hue 18), the dark red a brick (hue 32). That 13.6° shift is the largest.

## Reference palettes (measured)

These are read from the installed d3-scale-chromatic 3.1.1 (`research/harness/node_modules`) by `research/palette/references.mjs` and scored with the same code (`research/palette/references.json`). Minima are over the first eight colors.

| Scheme | Below 3:1 on white | Min ΔE normal / protan / deutan / tritan (closest slots) |
|---|---|---|
| schemeTableau10 | 5 of 10 | 0.129 / 0.016 / 0.007 (3–5, red–green) / 0.064 |
| schemeObservable10 | 6 of 10 | 0.113 / 0.059 / 0.020 / 0.046 |
| schemeCategory10 (D3's default, Plotly's) | 4 of 10 | 0.113 / 0.007 (2–3) / 0.039 / 0.042 |
| schemeDark2 | 2 of 8 | 0.099 / 0.018 / 0.017 / 0.049 |
| schemeSet1 | 5 of 9 | 0.130 / 0.031 / 0.035 / 0.066 |

Library defaults as rendered are in R7 (docs/01-landscape.md). That table has eight displayed six-slice rows. Recharts' row uses its documentation's authored colors, the D3 chart is authored, uPlot has no default palette, and ECharts was read from its options. What I took from these: the blue-then-orange opening (Tableau 10, Category 10), a quiet neutral last, and the evidence that the familiar sets put adjacent hues that deuteranopia merges (Tableau 10's red and green at 0.007). The first version also drew on palettes recalled from memory (IBM Carbon, Okabe–Ito, Paul Tol). No arrays for them are installed here, so they are not cited.

## Not verified

- The browser suites that sample palette colors were not run, because they need `npm run build`.
  - `render.browser.test.ts` and `theme.browser.test.ts` read the colors from `palette.ts`, so they should follow; that is inferred.
  - `keyboard.browser.test.ts` checks the light focus only, and that token is unchanged.
  - Any browser test that checks the dark focus ring's color would see `#e3e8f0` now.
- Raster checks cover isolated fills over the background. A 25% area over another 25% area (overlapping areas) is not scored.
- The simulation is Machado at severity 1.0 only.
- Strokes and fills were measured in headless Chrome 157 on Linux only.
- Nobody with a color-vision deficiency has looked at the previews.

## Files

- `packages/axylo/src/theme/palette.ts`: both series sets and the dark focus token. Exported names and shapes are unchanged.
- `packages/axylo/test/theme/palette.test.ts`: constraints 1–6, analytic and in bytes; Chrome fill pixels; the record at written precision; stroke-record validation.
- `research/palette/`: `color.mjs`, `fit.mjs`, `anneal.mjs`, `explore.mjs`, `score.mjs`, `raster.mjs`, `strokes.mjs`, `preview.mjs`, `references.mjs`, `configs/`, `palette.json`, `raster.json`, `strokes.json`, `references.json`, `preview.html` and the two PNGs. See the README there.
