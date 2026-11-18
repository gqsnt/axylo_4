# Default palette research (decision 0003)

Plain Node scripts, no dependencies beyond `playwright-core` and system Chrome for the three that render. The
decision record is [`docs/decisions/0003-default-palette.md`](../../docs/decisions/0003-default-palette.md).

| File | What it is |
| --- | --- |
| `color.mjs` | Color math and the measurement of every hard constraint, analytic and in bytes (pure, shared by all scripts). Same formulas as `research/harness/palette.mjs`. |
| `theme-file.mjs` | Reads the shipped colors from `packages/axylo/src/theme/palette.ts`. |
| `explore.mjs` | Which hue families, and which orders of them, can meet the constraints (light scheme). Every line has one of three outcomes: feasible, proved infeasible, timed out. |
| `fit.mjs` | Nearest feasible palette to a hand-written target per slot (`configs/*.json`): a grid per slot plus branch and bound. Writes `candidates/<config>.json`. `--prefix4=`, `--minDelta=`, `--composite=`, `--token=` are what-if overrides; `--box=1` also requires fills at the worst case within one byte; `--light=#…,…` solves only the dark scheme against a given light set. |
| `anneal.mjs` | Feasibility search on the same grids by simulated annealing on the amount of violation (`--start=` walks from a given palette, `--scheme=dark --light=…` solves the dark set). Finds palettes the exact search cannot reach in time; proves nothing. |
| `configs/` | `fit-final.json` reproduces the shipped palette (solver margins in `solverLimits`). The others are the searches the decision record cites, including the ones that failed. |
| `preview.mjs` | Standalone HTML preview (swatches, mock charts, simulated deficiencies, grayscale) and, with `--shot`, one PNG per scheme plus `<name>-pixels.json` (donut slices read back from the PNG). `--compare=b.json` renders two palettes one above the other. |
| `strokes.mjs` | Contrast of a 2 px line as Chrome antialiases it. Writes `strokes.json` and the raw pixel bytes `strokes-raw.json.gz`. `--palette=` measures a candidate instead (needs `--out=` and `--raw=`). |
| `raster.mjs` | The pixels Chrome draws for 25% and 80% fills (canvas and SVG). Writes `raster.json`. `--palette=` measures a candidate instead (needs `--out=`). |
| `score.mjs` | Scores what ships and writes `palette.json`. It folds in `strokes.json`, `strokes-raw.json.gz`, `raster.json` and `preview-pixels.json` only when they describe exactly the scored colors and backgrounds, and lists what it refused. `--palette=` scores a candidate from its own records (named with `--raster=`, `--preview=`, `--strokes=`, `--strokes-raw=`) and needs `--out=`. |
| `candidates/candidate-b.json`, `*-b*` | Candidate B, awaiting the owner's choice (decision 0003, "Candidate B"): `configs/candidate-b.json` reproduces it; `palette-b.json`, `raster-b.json`, `strokes-b.json`, `strokes-b-raw.json.gz`, `preview-b-*.png`, `preview-b-pixels.json` are its record; `compare-light.png` and `compare-dark.png` put it under the shipped palette. |
| `references.mjs` | Scores the categorical schemes installed with d3-scale-chromatic (Tableau 10, Observable 10, Category 10, Dark2, Set1). Writes `references.json`. |
| `search.mjs`, `feasibility.json` | The earlier, unconstrained feasibility search of finding R7 (kept as it was). |

Reproduce the shipped palette and its record:

```sh
node research/palette/fit.mjs --config=research/palette/configs/fit-final.json --seconds=300   # both searches complete in seconds
# copy candidates/fit-final.json's light and dark arrays into packages/axylo/src/theme/palette.ts, then
node research/palette/strokes.mjs
node research/palette/raster.mjs
node research/palette/preview.mjs --shot      # preview.html, preview-light.png, preview-dark.png, preview-pixels.json
node research/palette/score.mjs --md          # after the three browser records, which it folds in
npx vitest run packages/axylo/test/theme
```

Reproduce candidate B and its record without touching `palette.ts`:

```sh
node research/palette/fit.mjs --config=research/palette/configs/candidate-b.json --seconds=300   # writes candidates/candidate-b.json
B=research/palette/candidates/candidate-b.json
node research/palette/raster.mjs --palette=$B --out=research/palette/raster-b.json
node research/palette/strokes.mjs --palette=$B --out=research/palette/strokes-b.json --raw=research/palette/strokes-b-raw.json.gz
node research/palette/preview.mjs --palette=$B --name=preview-b --shot
node research/palette/preview.mjs --compare=$B --name=compare --shot      # compare-light.png, compare-dark.png
node research/palette/score.mjs --palette=$B --raster=research/palette/raster-b.json --preview=research/palette/preview-b-pixels.json \
  --strokes=research/palette/strokes-b.json --strokes-raw=research/palette/strokes-b-raw.json.gz --out=research/palette/palette-b.json --md
```

To adopt it, copy its arrays into `palette.ts` and rerun the first block; the unit test's candidate-B block then
checks the same colors as the shipped block.

What the unit test checks against `palette.json`, each against its own recomputation and at the precision written:
the shipped hex values and token colors; per color its OKLCH (3, 3 and 1 decimals), contrast (2 decimals) and
light/dark hue shift (1 decimal); the lightness range, first-three spread and largest chroma; every pairwise and prefix
minimum with its pair, analytic and in bytes; token distances with their slots; fills under all four visions
(neighbours, their minimum and pair, and the ring closures), on both byte models, at the worst case within one byte,
and as Chrome's canvas and SVG pixels (each within one byte of the model); the preview PNG's donut pixels (normal row
equal to the palette, simulated rows within one byte of the rounding model, 0.10 apart); every stroke statistic and
both column counts, recomputed from the raw pixel bytes in `strokes-raw.json.gz`; and the one-byte-edit count,
recounted by running every required check on every one-byte edit. It does not re-render anything: the browser
records come from `strokes.mjs`, `raster.mjs` and `preview.mjs --shot`.
