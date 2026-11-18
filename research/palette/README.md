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
| `configs/` | `fit-final.json` reproduces the shipped palette, candidate B, adopted on 2026-11-18 (solver margins in `solverLimits`). `fit-superseded.json` reproduces the palette it replaced (the refit of 52bbdf0). The others are the searches the decision record cites, including the ones that failed. |
| `preview.mjs` | Standalone HTML preview (swatches, mock charts, simulated deficiencies, grayscale) and, with `--shot`, one PNG per scheme plus `<name>-pixels.json` (donut slices read back from the PNG, with the pixel coordinates they were read at in `samples`). `--compare=b.json` renders two palettes one above the other. |
| `strokes.mjs` | Contrast of a 2 px line as Chrome antialiases it. Writes `strokes.json` and the raw pixel bytes `strokes-raw.json.gz`. `--palette=` measures a candidate instead (needs `--out=` and `--raw=`). |
| `raster.mjs` | The pixels Chrome draws for 25% and 80% fills (canvas and SVG). Writes `raster.json`. `--palette=` measures a candidate instead (needs `--out=`). |
| `score.mjs` | Scores what ships and writes `palette.json`. It folds in `strokes.json`, `strokes-raw.json.gz`, `raster.json` and `preview-pixels.json` only when they describe exactly the scored colors and backgrounds, and lists what it refused. `--palette=` scores a candidate from its own records (named with `--raster=`, `--preview=`, `--strokes=`, `--strokes-raw=`) and needs `--out=`. |
| `candidates/candidate-b.json`, `*-b*`, `compare*` | The record of the owner's choice (decision 0003, "How B was made and why it was chosen"). `configs/candidate-b.json` is the candidate's config (same slots as today's `fit-final.json`). `palette-b.json`, `raster-b.json`, `strokes-b.json`, `strokes-b-raw.json.gz`, `preview-b-*.png` and `preview-b-pixels.json` are its records as written before adoption; the regenerated shipped records are identical to them. `compare-light.png` and `compare-dark.png` are the images the owner chose from: the superseded palette above, B below. |
| `references.mjs` | Scores the categorical schemes installed with d3-scale-chromatic (Tableau 10, Observable 10, Category 10, Dark2, Set1). Writes `references.json`. |
| `search.mjs`, `feasibility.json` | The earlier, unconstrained feasibility search of finding R7 (kept as it was). |

Reproduce the shipped palette and its record:

```sh
node research/palette/fit.mjs --config=research/palette/configs/fit-final.json --seconds=300   # both searches complete in seconds
# write candidates/fit-final.json's light and dark arrays into packages/axylo/src/theme/palette.ts, then
node research/palette/strokes.mjs
node research/palette/raster.mjs
node research/palette/preview.mjs --shot      # preview.html, preview-light.png, preview-dark.png, preview-pixels.json
node research/palette/score.mjs --md          # after the three browser records, which it folds in
npx vitest run packages/axylo/test/theme
```

Score any other palette without touching `palette.ts` (this is how candidate B was measured before adoption):

```sh
node research/palette/fit.mjs --config=research/palette/configs/fit-superseded.json --seconds=300   # writes candidates/fit-superseded.json
X=research/palette/candidates/fit-superseded.json
node research/palette/raster.mjs --palette=$X --out=raster-x.json
node research/palette/strokes.mjs --palette=$X --out=strokes-x.json --raw=strokes-x-raw.json.gz
node research/palette/preview.mjs --palette=$X --name=preview-x --out=. --shot
node research/palette/score.mjs --palette=$X --raster=raster-x.json --preview=preview-x-pixels.json \
  --strokes=strokes-x.json --strokes-raw=strokes-x-raw.json.gz --out=palette-x.json --md
```

The comparison images were made before adoption, with `preview.mjs --compare=candidates/candidate-b.json --name=compare --shot`
while `palette.ts` still held the superseded arrays. To redraw them now, name both palettes:
`preview.mjs --palette=candidates/fit-superseded.json --compare=candidates/candidate-b.json --labels='superseded,candidate B' --name=compare --shot`
(this overwrites the committed images, which are the record of the choice).

What the unit test checks against `palette.json`, each against its own recomputation and at the precision written:
the shipped hex values and token colors; per color its OKLCH (3, 3 and 1 decimals), contrast (2 decimals) and
light/dark hue shift (1 decimal); the lightness range, first-three spread and largest chroma; every pairwise and prefix
minimum with its pair, analytic and in bytes; token distances with their slots; fills under all four visions
(neighbours, their minimum and pair, and the ring closures), on both byte models with their minima, at the worst
case within one byte with its minimum, and as Chrome's canvas and SVG pixels (each within one byte of the model); the
preview PNG's donut pixels (normal row equal to the palette, simulated rows within one byte of the rounding model,
0.10 apart); every stroke statistic and both column counts, recomputed from the raw pixel bytes in
`strokes-raw.json.gz`; the check list (labels, limits, values and pass flags) and the tight list (every check within
5% of its limit, browser rows included); and the one-byte-edit count, recounted by running every required check on
every one-byte edit. It also checks that the browser records on disk are the ones folded in: `raster.json`,
`strokes.json` and `preview-pixels.json` against their copies in `palette.json`, and the PNGs `preview-light.png`
and `preview-dark.png`, decoded by the test, at every sample coordinate of every row. It does not re-render
anything: the browser records come from `strokes.mjs`, `raster.mjs` and `preview.mjs --shot`. Fields not listed here,
such as `thresholds`, are not recomputed; `refused` must be empty.
