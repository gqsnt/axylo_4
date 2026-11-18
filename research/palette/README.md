# Default palette research (decision 0003)

Plain Node scripts, no dependencies beyond `playwright-core` and system Chrome for the two that render. The
decision record is [`docs/decisions/0003-default-palette.md`](../../docs/decisions/0003-default-palette.md).

| File | What it is |
| --- | --- |
| `color.mjs` | Color math and the measurement of every hard constraint (pure, shared by all scripts). Same formulas as `research/harness/palette.mjs`. |
| `theme-file.mjs` | Reads the shipped colors from `packages/axylo/src/theme/palette.ts`. |
| `explore.mjs` | Which hue families, and which orders of them, can meet the constraints at all (light scheme). |
| `fit.mjs` | Nearest feasible palette to a hand-written target per slot (`configs/*.json`): a grid per slot plus branch and bound. Writes `candidates/<config>.json`. `--prefix4=`, `--minDelta=`, `--composite=`, `--token=` are what-if overrides; `--light=#…,…` solves only the dark scheme against a given light set. |
| `configs/` | `fit-final.json` reproduces the shipped palette (both searches complete). The others are the iterations the decision record cites, and two what-ifs. |
| `preview.mjs` | Standalone HTML preview (swatches, mock charts, simulated deficiencies, grayscale) and, with `--shot`, one PNG per scheme. |
| `strokes.mjs` | Contrast of a 2 px line as Chrome antialiases it. Writes `strokes.json`. |
| `score.mjs` | Scores what ships and writes `palette.json`, the record the decision quotes and the unit test cross-checks. |
| `search.mjs`, `feasibility.json` | The earlier, unconstrained feasibility search of finding R7 (kept as it was). |

Reproduce the shipped palette and its record:

```sh
node research/palette/fit.mjs --config=research/palette/configs/fit-final.json --seconds=400   # about 2–3 minutes
# copy candidates/fit-final.json's light and dark arrays into packages/axylo/src/theme/palette.ts, then
node research/palette/strokes.mjs
node research/palette/score.mjs --md
node research/palette/preview.mjs --shot      # preview.html, preview-light.png, preview-dark.png
npx vitest run packages/axylo/test/theme
```

Change a color by hand only together with `score.mjs`: the unit test compares the shipped colors with
`palette.json` and fails until the record is regenerated.
