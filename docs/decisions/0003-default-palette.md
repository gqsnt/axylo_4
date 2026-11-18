# Decision 0003: the default categorical palette

Status: **proposed**, palette agent, 2026-11-18. The hard constraints below are measured and enforced by `packages/axylo/test/theme/palette.test.ts`. Whether the result is good to look at is the owner's call (see "Taste questions"). Nobody else has reviewed this work.

Spec: A5 (palette thresholds, provisional), L2 (3:1 for marks), F9 (eight series, no shared color). Finding R7 (docs/01-landscape.md): none of the ten measured libraries meets 3:1 and the 0.10 color-vision threshold together, and the earlier search that did (`research/palette/feasibility.json`) produced the placeholder this replaces: purples, maroons and one orange-red.

## The palette

Slot order is blue, orange, green, purple, red, cyan, magenta, slate. The non-series tokens (axis, grid, muted, reference, focus) are unchanged.

| Slot | Family | Light | OKLCH | Contrast on #ffffff | Dark | OKLCH | Contrast on #16181d | Hue shift |
|---|---|---|---|---|---|---|---|---|
| 1 | blue | `#4395ea` | 0.66 0.150 252 | 3.12 | `#1c73c5` | 0.55 0.150 252 | 3.64 | 0° |
| 2 | orange | `#e77412` | 0.68 0.170 52 | 3.04 | `#d77939` | 0.67 0.140 52 | 5.65 | 0° |
| 3 | green | `#085e01` | 0.42 0.140 142 | 8.04 | `#b0e391` | 0.86 0.121 134 | 12.04 | 8° |
| 4 | purple | `#5f2083` | 0.39 0.159 310 | 10.39 | `#bf93f1` | 0.74 0.139 305 | 7.32 | 5° |
| 5 | red | `#ba5f50` | 0.59 0.120 31 | 4.34 | `#bc5145` | 0.57 0.141 29 | 3.72 | 2° |
| 6 | cyan | `#087ca6` | 0.55 0.110 231 | 4.73 | `#71daff` | 0.84 0.110 224 | 11.14 | 8° |
| 7 | magenta | `#a12c63` | 0.49 0.160 356 | 6.87 | `#fa93b5` | 0.78 0.129 359 | 8.38 | 3° |
| 8 | slate | `#8f9299` | 0.66 0.011 267 | 3.12 | `#82828f` | 0.61 0.019 286 | 4.68 | 19° |

The slate's hue shift is large only because it has almost no chroma (0.01–0.02), so its hue is barely defined; the seven chromatic slots move at most 8°.

![Light scheme preview](../../research/palette/preview-light.png)

![Dark scheme preview](../../research/palette/preview-dark.png)

Each preview shows the swatches with hex, contrast and nearest neighbour; lines with 3, 5 and 8 series at 2 px with Axylo's end markers; three overlapping areas at 25%; eight stacked areas at 80% with 1 px background separators; an eight-slice donut; grouped bars with six series. The same mocks follow under simulated protanopia, deuteranopia and tritanopia (the Machado matrices as SVG color matrices in linear RGB; a check against the scoring code found at most 1/255 difference per channel) and in grayscale (WCAG luminance). Source: `research/palette/preview.html`.

## Constraints, measured

All values are computed on the 8-bit hex values that ship, by `research/palette/score.mjs` (record: `research/palette/palette.json`) and again, with independent code, by the unit test. ΔE is the Euclidean distance in OKLab; protan, deutan and tritan are the Machado et al. (2009) simulations at severity 1.0, applied in linear RGB and clamped, as in `research/harness/palette.mjs`.

| Constraint | Check | Limit | Light | Dark |
|---|---|---|---|---|
| 1 | lowest contrast on background | ≥ 3 | 3.04 | 3.64 |
| 2 | min pairwise ΔE, all 8, normal | ≥ 0.10 | 0.116 | 0.114 |
| 2 | min pairwise ΔE, all 8, protan | ≥ 0.10 | 0.100 | 0.101 |
| 2 | min pairwise ΔE, all 8, deutan | ≥ 0.10 | 0.101 | 0.101 |
| 2 | min pairwise ΔE, all 8, tritan | ≥ 0.10 | 0.103 | 0.101 |
| 3 | first 4, worst vision (tritan light, protan dark) | ≥ 0.14 | 0.141 | 0.146 |
| 3 | first 3, 5, 6, worst vision | ≥ 0.10 | see below | see below |
| 4 | largest light/dark OKLCH hue difference per slot | ≤ 30° | 18.5° (slate), 8° chromatic | same pairs |
| 5 | nearest series color to focus (`#1f5fcc` / `#79a8ff`) | ≥ 0.10 | 0.108 (cyan) | 0.101 (purple) |
| 5 | nearest series color to reference (`#474b55` / `#bcc0c9`) | ≥ 0.10 | 0.148 (purple) | 0.106 (cyan) |
| 5+ | nearest series color to muted (`#62666f` / `#9da2ad`), my addition | ≥ 0.10 | 0.106 (cyan) | 0.101 (slate) |
| 6 | min neighbour (k, k+1) ΔE at 25% over the background, normal | ≥ 0.06 | 0.061 | 0.060 |
| 6 | min neighbour (k, k+1) ΔE at 80% over the background, normal | ≥ 0.06 | 0.194 | 0.174 |

Composites are source-over in gamma-encoded sRGB, as browsers blend, then converted to OKLab.

### Prefix minima (constraint 3)

| Prefix | Vision | Light (closest slots) | Dark (closest slots) |
|---|---|---|---|
| first 3 | normal | 0.316 (1–2) | 0.258 (2–3) |
| first 3 | protan | 0.169 (2–3) | 0.236 (1–2) |
| first 3 | deutan | 0.281 (2–3) | 0.187 (2–3) |
| first 3 | tritan | 0.254 (1–3) | 0.283 (2–3) |
| first 4 | normal | 0.299 (3–4) | 0.230 (1–4) |
| first 4 | protan | 0.169 (2–3) | 0.146 (1–4) |
| first 4 | deutan | 0.201 (3–4) | 0.187 (2–3) |
| first 4 | tritan | 0.141 (3–4) | 0.152 (3–4) |
| first 5 | normal | 0.116 (2–5) | 0.114 (2–5) |
| first 5 | protan | 0.102 (3–5) | 0.122 (2–5) |
| first 5 | deutan | 0.119 (2–5) | 0.107 (2–5) |
| first 5 | tritan | 0.103 (2–5) | 0.101 (2–5) |
| first 6 | normal | 0.116 (2–5) | 0.114 (2–5) |
| first 6 | protan | 0.102 (3–5) | 0.122 (2–5) |
| first 6 | deutan | 0.118 (1–6) | 0.102 (4–6) |
| first 6 | tritan | 0.103 (2–5) | 0.101 (3–6) |
| all 8 | normal | 0.116 (2–5) | 0.114 (2–5) |
| all 8 | protan | 0.100 (6–8) | 0.101 (4–7) |
| all 8 | deutan | 0.101 (5–8) | 0.101 (5–8) |
| all 8 | tritan | 0.103 (2–5) | 0.101 (1–8) |

### What is close to its limit

Almost everything. Within 5% of the limit in at least one scheme: contrast (light orange 3.04, blue and slate 3.12); constraint 2 under all three deficiencies in both schemes (0.100–0.103); the first four (light 0.141 under tritanopia, dark 0.146 under protanopia); the first five and six (0.101–0.103); focus and muted in dark (0.101); the 25% neighbours (light 0.061 for slots 4–5 and 5–6, dark 0.060 for slots 7–8). Only normal-vision distances, the first three, the reference token in light and the 80% composites have real room. This is what the constraints cost, not an accident of the search: the solver pushes every color as close to its target as the limits allow, so the limits end up binding. The consequence for maintenance is that a hand edit of almost any color will fail a test; change colors through `fit.mjs` and regenerate the record (`research/palette/README.md`).

The new tests fail on the placeholder palette (six failures: first four under protanopia and tritanopia, light/dark hue match, 25% neighbours in both schemes, dark focus), so they are not vacuous.

## Thin lines

`research/palette/strokes.mjs` draws each color as a 2 px random-walk polyline in headless Chrome 157 (Linux), through the canvas and through SVG, at device pixel ratio 1 and 2, and reads the pixels back. Per pixel column it takes the most covered pixel (core) and the coverage-weighted mean of the pixels the stroke touches, which is roughly what the eye sees when it cannot resolve the antialiased edge. Canvas and SVG agree to 0.01–0.05.

| | Swatch | Core, median | Weighted, DPR 1 (p10 / median) | Weighted, DPR 2 (p10 / median) |
|---|---|---|---|---|
| light blue `#4395ea` | 3.12 | 3.12 | 2.48 / 2.57 | 2.75 / 2.84 |
| light orange `#e77412` | 3.04 | 3.04 | 2.47 / 2.55 | 2.73 / 2.79 |
| light slate `#8f9299` | 3.12 | 3.12 | 2.43 / 2.52 | 2.72 / 2.79 |
| light red `#ba5f50` | 4.34 | 4.34 | 3.18 / 3.35 | 3.67 / 3.80 |
| light cyan `#087ca6` | 4.73 | 4.73 | 3.42 / 3.60 | 3.99 / 4.15 |
| light green, purple, magenta | 6.9–10.4 | same | 4.67 and up | 5.66 and up |
| dark blue `#1c73c5` | 3.64 | 3.64 | 2.82 / 2.95 | 3.19 / 3.29 |
| dark red `#bc5145` | 3.72 | 3.72 | 2.84 / 2.99 | 3.23 / 3.33 |
| dark slate `#82828f` | 4.68 | 4.68 | 3.52 / 3.69 | 4.02 / 4.18 |
| dark orange, purple, magenta, cyan, green | 5.7–12.0 | same | 4.13 and up | 4.80 and up |

So a 2 px line always keeps a fully covered core pixel (in at least 90% of columns its core has the swatch's contrast), but its averaged color is lighter: about 2.5:1 for the three light colors at the 3:1 floor on a standard-density screen, 2.8:1 on a high-density one, and about 2.9–3.0:1 for the dark blue and red. Every series also has a marker at its last point and at sparse intervals (spec A5), drawn at full color.

## Why the light set looks the way it does

Two facts decide most of the design.

1. **3:1 on white caps lightness.** WCAG relative luminance at most 0.30 means OKLab L at most about 0.64 for greens and teals, 0.66–0.67 for blues and grays, and 0.68–0.69 for oranges, reds, pinks and purples. Every light-scheme color lives between that ceiling and whatever darkness one accepts. On #16181d the floor is about L 0.53–0.58 and the ceiling is open, which is why the dark set has more room.
2. **Each simulated deficiency removes one chromatic axis.** Protanopia and deuteranopia keep lightness and the blue–yellow axis (OKLab b) and flatten red–green (a); tritanopia keeps lightness and red–green and flattens blue–yellow. Two colors of similar lightness must differ by about 0.10 on *both* axes, or they collapse in one of the simulations. Lightness is the only cue all four visions keep.

So the eight colors have to spread over lightness, and colors that share a lightness must sit diagonally opposite on the hue wheel (blue against orange, green against purple, a neutral between). Within the L 0.39–0.69 band on white that leaves room for about three colors near the 3:1 ceiling (blue, orange, slate), two in the middle (red, cyan) and three deep ones (green, purple, magenta). The first four must also be 0.14 apart, which forces them into two tiers: blue and orange at the top, a green and a purple deep enough to clear both by 0.14 in every simulation.

What-if runs say this structure is not an artefact of one threshold:

- With the first-four limit relaxed to 0.12 or 0.10, or the pairwise limit to 0.09 or 0.08, the best palettes found still had a deep green, purple and magenta (`fit.mjs --prefix4=`, `--minDelta=` on `configs/fit-c.json` and `fit-f.json`; best within 60 s, not proven optimal).
- Keeping the green at L 0.50 or above and the purple and magenta at 0.48 or above (`configs/whatif-no-deep-light.json`, the `fit-k.json` boxes for the other slots) is proven infeasible on the grid at pairwise 0.10 and 0.09, and at 0.09 with the first four at 0.12; no palette was found within 60 s at 0.08 or 0.07.
- A lighter, calmer green (chroma at most 0.14, hue 145–165, L at least 0.44, with the other boxes of `configs/fit-k.json`) is proven infeasible. A calmer green near the current colors (chroma at most 0.13, `configs/fit-o.json`) was found only at L 0.40, darker still.

## How it was constructed

1. **Scoring first.** `research/palette/color.mjs` reimplements the study's metric and measures every constraint on rounded hex values.
2. **Annealing, dropped.** A simulated-annealing solver over OKLCH with taste penalties, the method of the study's `search.mjs` extended with hue families and both schemes at once, found feasible palettes in a minority of seeds and only in orders nobody would choose (orange in slot 8, gray in slot 3), and could not tell an impossible order from a hard one. It was removed.
3. **Exact search on a grid.** `fit.mjs` takes a target color per slot and scheme and a box around it (lightness, chroma, hue range), lays a grid over the box (L step 0.01, C 0.01, hue 2°), keeps the grid colors that pass contrast (with a 0.02 margin) and the token distances on their own, and runs branch and bound over the slots with forward checking on the pairwise constraints. The cost is the squared distance from the target, so the answer is the feasible palette nearest to what was asked for, and a search that completes without an answer proves the request impossible on that grid. The light scheme is solved first; the dark scheme's hue boxes are clipped to within 28° of the light result per slot.
4. **Which families.** `explore.mjs sets` tried the 99 sets of eight families that contain a blue, an orange, a purple, a green or teal, and a red, pink or magenta, drawn from a pool that also had cyan, gold, brown and slate, with the blue held at L 0.58 or above (so it can be the single-series color and stay clear of the focus token, `#1f5fcc` at L 0.51). Without order constraints, 34 sets were feasible, 12 were proven infeasible and 53 were undecided after 3 s each.
5. **Which order.** `explore.mjs orders` then tried orders of four promising sets, skipping orders whose first four cannot reach 0.14 (the runs were stopped after 10–46 feasible orders per set, so they are samples, not exhaustive). Every feasible order found put at least one deep color (L 0.50 or below) next to the blue in the first four. The cheapest orders of the sets built on teal with brown or gold needed either a very dark brown (`#5e3905`, `#60370b`, L ≈ 0.35) somewhere in the eight or an orange darkened to rust (`#a55112`); the set with green, cyan and red keeps the orange bright. In that set the order blue, orange, green, purple, red, cyan, magenta, slate puts the familiar first five first and the neutral last.
6. **Targets, then looking.** I wrote targets per slot and scheme, fitted, rendered the preview, and changed targets where the result looked wrong: tighter chroma caps (proven infeasible: `configs/fit-f.json`), a lighter and bluer green (`fit-k.json`, infeasible), the red ahead of the cyan (`fit-g.json`), the 0.02 contrast margin (`fit-l.json`), and for dark a full medium blue near L 0.58 with green and purple as the light pair (`fit-n.json`). The dark boxes of `fit-k.json` (blue at L 0.60–0.66, green and purple above 0.72) were proven infeasible. My reading of why (inferred from the binding pairs, not proven): blue and purple are both in the first four and the simulations leave them mostly lightness, so the purple must sit about 0.14 above the blue, and the cyan must clear both.
7. **Shipped run.** `configs/fit-final.json` refits small boxes around the `fit-l.json` light result and uses the `fit-n.json` dark boxes; both searches complete (proven optimal on their grids), so the run is deterministic: `node research/palette/fit.mjs --config=research/palette/configs/fit-final.json --seconds=400`.

## What was traded

- **Three deep colors on white.** Green (L 0.42), purple (0.39) and magenta (0.49) are much darker than blue, orange and slate (0.66–0.68). It reads as a deliberate light/deep rhythm in the 5- and 8-series mocks, but in the 3-series chart the deep green is clearly the heaviest line.
- **The 3:1 tier sits on the floor.** Blue 3.12, orange 3.04 and slate 3.12 on white; a 2 px line of them averages about 2.5:1.
- **The green is saturated.** At L 0.42 and chroma 0.14 the green sits on two binding pairs (the red under protanopia, the purple under tritanopia); the calmer greens the solver found were darker still.
- **The light red is muted** (chroma 0.12 against the orange's 0.17). The orange–red pair is the closest pair under tritanopia (0.103), which turns both into pinks; a stronger red at that lightness would close it further (inferred).
- **The dark blue is darker than dark-mode blues usually are** (`#1c73c5`, L 0.55, 3.64:1). A light dark-mode blue (L 0.72–0.84) with the dark focus token changed to white found no palette within 150 s (`configs/whatif-dark-blue-high.json`).
- **The dark green and cyan are the brightest colors** (L 0.86 and 0.84). The targets asked for about 0.80; the solver moved them up, by my reading because of the first four and because the cyan has to clear the blue under tritanopia and the purple under deuteranopia. Their chroma is held to 0.11–0.12 so they are pale rather than neon.
- **Red is fifth, not third.** Red cannot sit in the first four next to a bright orange at 0.14 (tritanopia merges them), so the first four are blue, orange, green, purple.

## Additions beyond the six constraints

- **Muted token (tested).** The donut draws its "Other" slice in the muted token (`scene/index.ts`), next to series slices, so the solver and the test also keep every series color 0.10 from muted, the rule of constraint 5. If the owner disagrees, drop the muted line from test 5.
- **Ring closure (recorded only).** A donut of n slices puts slice n next to slice 1. Slices are opaque in Axylo, so constraint 2 covers them; `palette.json` records the closing pairs at 25% and 80% (`ringClosures`) without requiring them. At 25% three are below 0.06 (light 6–1 0.033 and 8–1 0.035, dark 8–1 0.048).
- **Composites under deficiencies (recorded only).** Constraint 6 asks for normal vision. Under the simulations the 25% neighbours drop to 0.023–0.046 and the 80% neighbours to 0.081–0.131 (`palette.json`, `composites`).
- **Contrast margin in the solver.** `fit.mjs` only proposes colors at 3.02:1 or more; the test requires 3:1, as specified.

## An alternative I would prefer

I did not find one that is close. The palette I would have liked has no light color darker than about L 0.48, so that the eight colors have even weight; the what-ifs above show that this needs the pairwise limit below 0.08 and the first-four limit below 0.12 at the same time, which is not a small relaxation, and I did not construct such a palette. Simply lifting the green to L 0.50 and the purple to 0.47 in the shipped set (`#21763c`, `#723d9a`) breaks constraint 2 badly (protanopia 0.028 between green and red, deuteranopia 0.051, tritanopia 0.070), the first four (protanopia 0.098) and the 25% neighbours (0.047).

## Taste questions for the owner

- Do the three deep colors on white read as deliberate (in the way of IBM Carbon's categorical set) or as uneven?
- Is the slate right as the eighth series? It is kept apart from the muted gray of the donut's "Other" slice. Eight chromatic colors would need a brown or gold in slot 8, which the exploration found harder to place.
- Is the dark blue (`#1c73c5`) acceptable as the dark-mode single-series color, or is a lighter blue worth reopening the dark focus token and the dark tiers for?
- The dark scheme mirrors the light one by visual weight rather than by lightness: the colors that are deep on white (green, purple, magenta) are the light ones on dark. Is that the right reading of "a series must not change identity"?

## Palettes studied (from memory)

I had these in mind, recalled from memory rather than looked up, so any hex values I used for them may be slightly off:

- **Tableau 10** (the 2016 redesign): blue first, orange second, medium chroma, a warm gray as the quiet last color. Taken: the blue-then-orange opening and a neutral in the last slot. Not taken: its lightness (most of it is below 3:1 on white) and its red next to green, which deuteranopia merges.
- **Observable 10**: a medium blue first, modern and slightly brighter. Taken: the azure-leaning blue. Not taken: its yellow, pastel blue and pink, far below 3:1.
- **IBM Carbon categorical**: built for 3:1 on white, with alternating deep and light colors so neighbours differ in lightness. Taken: deep, saturated colors as the price of contrast plus color-vision separation on white. Not taken: its darkest slots (L below 0.35) and its near-twin teals.
- **Okabe–Ito** and **Paul Tol** (bright, muted): designed for color-vision deficiency. Taken: blue against orange as the opening pair, the axis every simulation keeps, and red and green separated by lightness. Not taken: the yellows and sky blues that fail 3:1 on white.

Scored as I recall them, none of these meets constraints 1 and 2 together either, so this palette is constructed rather than adapted.

## Not verified

- The browser tests that sample palette colors (`test/browser/render/*`, `test/browser/chart/render.browser.test.ts`) were not run: they need `npm run build`, which another agent was using. They read the colors from `palette.ts`, so they should follow, but that is inferred.
- Simulation is Machado at severity 1.0 only; anomalous trichromacy at lower severity was not scored.
- Stroke contrast was measured in headless Chrome 157 on Linux only (canvas and SVG), not in Firefox or Safari, and not on Windows.
- No person with a color-vision deficiency looked at the previews; the simulations are the evidence.

## Files

- `packages/axylo/src/theme/palette.ts`: the two sets (names and shapes unchanged; tokens unchanged).
- `packages/axylo/test/theme/palette.test.ts`: constraints 1–6 (and muted), with its own scoring code, cross-checked against `research/palette/palette.json`.
- `research/palette/`: scripts, configs, `palette.json`, `strokes.json`, `preview.html`, `preview-light.png`, `preview-dark.png`; see its README.
