<!-- Author: Claude Opus 5.5 (requested effort xhigh), Agent-tool subagent abc842fd0288bc675, resumed. Saved by the coordinator from the hand-back. -->

## Report: candidate B, the focus token, and findings 2–4

Candidate B is built, measured and written up in decision 0003 as awaiting the owner's choice. `palette.ts` series are unchanged; its only diff is the source comment from finding 4. Nothing is committed.

### 1. Candidate B
```
light  #2b97ee #cf8020 #0b6c49 #812cc4 #be1506 #0380a8 #8c1382 #8e948f
dark   #5d9afd #dc772f #ade4ba #9443a9 #ba4f1f #38c7fe #d991b8 #6d736e
```
It keeps the shipped backgrounds and every token.

**How it differs from the reviewer's pair:**
- Slot 6 moved from a second blue to cyan/teal. The reviewer's slot 6 was 2° of hue from slot 1 in light and 9° in dark. B's is 19° light and 30° dark.
- Both eighths are neutral: chroma 0.010 light, 0.011 dark.
- Dark red and orange are held at chroma 0.15 or less. The reviewer's dark red `#fe573f` was C 0.207.

**Reproduction:** `research/palette/configs/candidate-b.json` uses small boxes with the solver margins. Both exact searches complete with cost 0 and reproduce `candidates/candidate-b.json` (ran). The searches I cite are saved as `configs/b-*.json`, each with its outcome in its note.

**Measured (ran).** Record: `research/palette/palette-b.json`, written by `score.mjs --palette=` from B's own Chrome records. Nothing was refused. Pairwise cells are normal / protan / deutan / tritan.

| Check | Light | Dark |
|---|---|---|
| 1. lowest contrast | 3.10 (slate) | 3.07 (purple) |
| 2. all 8, analytic | .113/.102/.102/.102 | .115/.105/.102/.103 |
| 2. all 8, bytes | .113/.103/.102/.102 | .115/.105/.102/.103 |
| 2. all 8, preview PNG pixels | .113/.103/.102/.102 | .115/.105/.102/.103 |
| 3. first 4, worst vision (analytic; bytes) | .144 tritan; .143 | .162 deutan; .164 |
| 3. first 3 / 5 / 6, worst vision | .149 / .102 / .102 | .188 / .113 / .105 |
| 4. largest hue shift | 14.1° | 14.1° |
| 5. focus / reference / muted | .116 / .121 / .111 | .104 / .107 / .102 |
| 6. 25% fills: ideal / byte models / Chrome canvas / Chrome SVG | .065/.064/.064/.064 | .064/.064/.063/.063 |
| 6. 80% fills: ideal / byte models / Chrome | .223/.224/.224 | .175/.174/.175 |
| 25% fills, worst within one byte (recorded only) | .060 | .057 |

- **One-byte edits that still meet every check:** 44/48 light, 48/48 dark.
- **Strokes:** lowest weighted p10 at DPR 1 is 2.42 light and 2.43 dark (shipped: 2.38 and 2.55).

**Images:**
- `research/palette/compare-light.png` and `compare-dark.png`: the same seven panels, shipped above and B below, normal vision.
- `research/palette/preview-b-light.png` and `preview-b-dark.png`: B under all five vision rows.

I looked at all four images.

**Recommendation: adopt B; the owner decides.** Reasons you can check in the compare images:
- **Calmer first three in light ("3 lines").** Ochre instead of a hot orange, and a lighter green.
- **A neutral swatch 8 in both schemes.** The shipped one reads lavender-grey (C 0.026/0.031, hue 283/274).
- **Slot 6 is clearly a teal or cyan** against the slot-1 blue.
- **No dark colour dominates.** The pink is dusty and the red is brick.

**What B costs, and what I searched:**
- **Louder light red and purple.** Red `#be1506` (C 0.20) is the loudest light line, and purple is at C 0.220. Capping purple at 0.207 is proved infeasible near B (`b-purple-207.json`, exact search completes with no solution). Red at 0.18 or 0.17 forces purple to 0.23 (`b-red-18.json`, `b-red-17.json`); red at 0.16 is proved infeasible (`b-red-16.json`).
- **Light floor at 0.45, not 0.46.** At 0.46 I found only a steel-blue sixth or nothing (`b-walk3.json`, `b-cyan.json`, `b-indigo.json`). That is a search result, not a proof.
- **Dark blue is `#5d9afd` (L 0.69), not `#64acfa`.** Keeping `#64acfa` was not found: the exact search timed out and annealing over 16 seeds found nothing (`b-dark-blue.json`).
- **Dimmer dark purple and tighter dark margins.** Dark purple is 3.07:1. Dark focus distance is 0.104 and muted 0.102.
- **Dark cyan at C 0.14.** I asked for 0.115.

**Tooling added for this:**
- `--palette=` on `raster.mjs` and `strokes.mjs`, and `--palette/--raster/--preview/--strokes/--strokes-raw/--out` on `score.mjs`. A candidate run refuses to start without `--out`, so the shipped records can't be overwritten. I ran the default `score.mjs` again and `palette.json` came out byte-identical.
- The README now has candidate-B reproduction steps. I also fixed its shipped reproduce order: `preview.mjs` before `score.mjs`.

### 2. Focus token (finding 1)
This is the decision section "Focus token under a two-tone ring":
- **What it must satisfy:** under a two-tone ring, the focus color must reach 3:1 against the background. Light `#1f5fcc` is 5.89:1 and dark `#e3e8f0` is 14.43:1; the L2 test asserts it.
- **The surround needs nothing new:** it is background-colored, so its 3:1 against marks is constraint 1 (B: 3.10 / 3.07).
- **Focus against series:** no contrast is needed. The section lists the measured single-ink failures.
- **Is constraint 5 still needed?** Not for contrast. It buys identity: the old `#79a8ff` is 0.024 from the dark blue. I recommend keeping it; that is the owner's call.
- **Candidate B changes no token.**

### 3. Findings 2–4 (done before this phase, tests ran)
- **Finding 2:**
  - The decision now separates the rounding model from the preview image: light tritan slot 7 is `#b30f41` in the image and `#b20f41` in the model, 0.1005 against 0.102. There is a new "2, image" row.
  - `preview.mjs --shot` writes `preview-pixels.json`, and `score.mjs` folds it in as check `2i`.
  - Test: `${name}: the preview PNG itself (donut slices read back from each row) matches the palette and keeps 0.10 apart`.
- **Finding 3:**
  - The record test now covers tokens, lightness and largest chroma, all-vision composites with ring closures, and both raster models.
  - Stroke statistics and coverage counts are recomputed from the new raw record `strokes-raw.json.gz`.
  - The one-byte-edit count is recounted.
  - `score.mjs` applies limits before rounding.
  - The README lists exactly which fields are verified.
  - Tests:
    - `${name}: the research record holds these colors, its tokens, and the measured fields listed in research/palette/README.md at their written precision`
    - `${name}: the 2 px stroke record is these colors, and every statistic in it follows from the raw pixel record`
    - `${name}: the one-byte-edit count in the record is what every check gives for every one-byte edit`
    - `${name}: 6. the same on an 8-bit raster, with alpha quantised by rounding and by flooring`
  - Mutations that each failed a test: false stroke 1.01/1.02, token, protan composite, lightness, edit count, preview min, coverage count.
- **Finding 4:**
  - The stroke table is labelled by renderer: 4 renderers × 16 rows.
  - Coverage counts come from the raw record: 575 of 576 columns at DPR 1, 1152 of 1152 at DPR 2.
  - The canvas/SVG gap is stated as up to 0.09 (dark green, 8.32 against 8.23).
  - The dark first-three pair is corrected to 2–3 at 0.251.
  - The `palette.ts` comment now says "bounded searches … (a search limit, not a proof)".
- **New candidate-B tests:**
  - `meets every required check of constraints 1–6, analytic and in bytes, against the shipped tokens`
  - `the fills Chrome drew for it (research/palette/raster-b.json) are its colors and stay 0.06 apart`
  - `its preview PNG (…, donut slices read back) keeps 0.10 apart in every row`
  - Two mutations of a B color made them fail (ran), and I restored the file.

### Theme test run (last lines)
```
 Test Files  3 passed (3)
      Tests  58 passed (58)
```
`palette.test.ts` alone: 42 passed. `npx tsc -p packages/axylo --noEmit` printed nothing.

### Not verified
- Nobody independent has reviewed candidate B.
- B has not been through the browser suites (they read `palette.ts` and need `npm run build`, which I did not run).
- Chrome was headless Chrome 157 on Linux only.
- The two-tone ring is not built or measured here; it belongs to core.

### Files
- **Decision and source:** `docs/decisions/0003-default-palette.md` (new section "Candidate B (awaiting the owner's choice)", status, owner, not-verified and files lists) and `packages/axylo/src/theme/palette.ts` (comment only).
- **Test:** `packages/axylo/test/theme/palette.test.ts` (new candidate-B block).
- **Scripts:** `research/palette/{score,raster,strokes}.mjs` and `README.md`.
- **New candidate-B files in `research/palette/`:**
  - `configs/candidate-b.json` and `configs/b-*.json`
  - `candidates/candidate-b.json`
  - `palette-b.json`, `raster-b.json`, `strokes-b.json`, `strokes-b-raw.json.gz`
  - `preview-b.html`, `preview-b-light.png`, `preview-b-dark.png`, `preview-b-pixels.json`
  - `compare.html`, `compare-light.png`, `compare-dark.png`

Search scratch is under `/tmp/claude-1000/-home-canarit--claude-spares-spare-6ClT4i/23402a37-81bb-469c-a14a-8bf7f048d066/scratchpad/candb/`, not needed to reproduce.
