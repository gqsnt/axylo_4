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
| `preview.mjs` | Standalone HTML preview (swatches, mock charts, simulated deficiencies, grayscale) and, with `--shot`, one PNG per scheme. |
| `strokes.mjs` | Contrast of a 2 px line as Chrome antialiases it. Writes `strokes.json`. |
| `raster.mjs` | The pixels Chrome draws for 25% and 80% fills (canvas and SVG). Writes `raster.json`. |
| `score.mjs` | Scores what ships and writes `palette.json`. It folds in `strokes.json` and `raster.json` only when they describe exactly the shipped colors and backgrounds, and lists what it refused. |
| `references.mjs` | Scores the categorical schemes installed with d3-scale-chromatic (Tableau 10, Observable 10, Category 10, Dark2, Set1). Writes `references.json`. |
| `search.mjs`, `feasibility.json` | The earlier, unconstrained feasibility search of finding R7 (kept as it was). |

Reproduce the shipped palette and its record:

```sh
node research/palette/fit.mjs --config=research/palette/configs/fit-final.json --seconds=300   # both searches complete in seconds
# copy candidates/fit-final.json's light and dark arrays into packages/axylo/src/theme/palette.ts, then
node research/palette/strokes.mjs
node research/palette/raster.mjs
node research/palette/score.mjs --md
node research/palette/preview.mjs --shot      # preview.html, preview-light.png, preview-dark.png
npx vitest run packages/axylo/test/theme
```

What the unit test checks against `palette.json`: the shipped hex values; per color its OKLCH (3, 3 and 1 decimals),
contrast (2 decimals) and light/dark hue shift (1 decimal); every pairwise and prefix minimum with its pair, analytic
and in bytes; token distances with their slots; fill neighbours (ideal, byte model, worst case within one byte, and
Chrome's canvas and SVG pixels); and that the stroke record names exactly the shipped colors and backgrounds, that
its swatch contrasts are right and that its statistics are ordered as antialiasing allows. It does not re-render the
strokes or the fills; those numbers come from Chrome through `strokes.mjs` and `raster.mjs`.
