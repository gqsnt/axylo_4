<!-- Author: Claude Opus 5.5 (requested effort xhigh), Agent-tool subagent abc842fd0288bc675. Saved by the coordinator from the hand-back. -->

I've replaced the placeholder with a new light set and dark set. Constraints 1–6 hold in both schemes, `npx vitest run packages/axylo/test/theme` passes (37/37), and `npx tsc -p packages/axylo --noEmit` exits 0. The new tests catch real violations: the old placeholder fails six of them. Nothing is committed, and no one else has reviewed this work.

**The palette** (slot order blue, orange, green, purple, red, cyan, magenta, slate; exported names and shapes in `palette.ts` unchanged; axis, grid, muted, reference and focus tokens unchanged):
- Light: `#4395ea #e77412 #085e01 #5f2083 #ba5f50 #087ca6 #a12c63 #8f9299`
- Dark: `#1c73c5 #d77939 #b0e391 #bf93f1 #bc5145 #71daff #fa93b5 #82828f`

**Measured values (light / dark):**

| Constraint | Light | Dark | Limit |
|---|---|---|---|
| 1. Lowest contrast | 3.04 | 3.64 | 3 |
| 2. Smallest pairwise difference, normal vision | 0.116 | 0.114 | 0.10 |
| 2. Same, protanopia / deuteranopia / tritanopia | 0.100 / 0.101 / 0.103 | 0.101 / 0.101 / 0.101 | 0.10 |
| 3. First four, worst vision | 0.141 (tritanopia) | 0.146 (protanopia) | 0.14 |
| 3. First three, five, six, worst vision | 0.169 / 0.102 / 0.102 | 0.187 / 0.101 / 0.101 | 0.10 |
| 4. Largest light/dark hue difference | 18.5° (the near-gray slate); 8° for the seven colored slots | same pairs | 30° |
| 5. Nearest to focus / reference / muted | 0.108 / 0.148 / 0.106 | 0.101 / 0.106 / 0.101 | 0.10 |
| 6. Neighbour difference at 25% / 80% opacity | 0.061 / 0.194 | 0.060 / 0.174 | 0.06 |

Almost every constraint sits within 5% of its limit, so a hand edit of almost any color will fail a test. Change colors by refitting with `fit.mjs` and regenerating `palette.json`; the README shows how.

**2 px lines:** the most covered pixel always keeps the swatch's contrast, but the averaged line color is lighter. The three light colors at the 3:1 floor (blue, orange, slate) come out at about 2.5:1 at pixel ratio 1 and 2.8:1 at pixel ratio 2. The dark blue and dark red come out at about 2.95–3.0:1. Canvas and SVG agree.

**How I built it:** I measured that deficiency simulation leaves only lightness plus one color axis, so on white the eight colors have to spread across lightness. That forces two light colors and two deep ones into the first four. An annealing solver only found palettes in orders nobody would pick, so I replaced it with an exact grid search (branch and bound) that returns the feasible palette closest to a target. I also wrote an exploration script that tried 99 hue-family sets and sampled orders of four of them. I looked at the previews and adjusted targets until it looked right. The final config runs to completion for both schemes, so the result is reproducible.

**Previews:** `research/palette/preview-light.png` and `preview-dark.png` (about 296 KB each), with the source in `preview.html`. Both PNGs are embedded in the decision record.

Things I'm unsure about or added:
- **Three deep colors on white.** Green (L 0.42, quite saturated), purple (0.39) and magenta (0.49) are much darker than the rest. In a 3-series chart the deep green is the heaviest line. What-if runs suggest this is forced by constraints 2 and 3, not by one threshold: lifting those colors stayed infeasible or found nothing even with the thresholds lowered to 0.08 and 0.12. So I could not build an alternative I'd prefer that misses a constraint by only a little, and the record says so. This is the main thing for the owner to judge.
- **Dark slot 1 is a medium blue** (`#1c73c5`, 3.64:1), darker than a typical dark-mode blue. A lighter dark blue, even with the dark focus token changed to white, found no palette within 150 s.
- **Additions beyond your six constraints:**
  - The tests also keep every series color 0.10 away from the muted token, because the donut draws its "Other" slice in muted next to series slices. Drop that one line if you disagree.
  - The solver only proposes colors at 3.02:1 or more; the tests still require 3:1 as specified.
  - I recorded, without enforcing, the donut's closing pair (last slice next to slice 1) at 25%, where three pairs fall below 0.06, and the neighbour distances under the deficiency simulations.
- **Browser tests were not run**, since they need `npm run build`. They read colors from `palette.ts`, so they should follow, but that is inferred. The focus token is unchanged, so the hardcoded `rgb(31, 95, 204)` in `keyboard.browser.test.ts` still matches.
- **The reference palettes** (Tableau 10, Observable 10, IBM Carbon, Okabe–Ito, Paul Tol) are from memory, and the record says so.
- **Independent review:** none done. Rule 6 calls for one (Codex `gpt-6.1-sol` xhigh by default) before anyone treats this as accepted.

Files are in `/home/canarit/projects/axylo`:
- `packages/axylo/src/theme/palette.ts`
- `packages/axylo/test/theme/palette.test.ts`
- `docs/decisions/0003-default-palette.md` (new)
- `research/palette/`: `README.md`, `color.mjs`, `theme-file.mjs`, `explore.mjs`, `fit.mjs`, `configs/` (`fit-final.json` is the one that reproduces the shipped palette), `candidates/fit-final.json`, `preview.mjs`, `preview.html`, `preview-light.png`, `preview-dark.png`, `strokes.mjs`, `strokes.json`, `score.mjs`, `palette.json`. `search.mjs` and `feasibility.json` are kept unchanged.
