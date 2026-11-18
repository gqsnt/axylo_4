<!-- Author: Claude Opus 5.5, agent abc842fd0288bc675; observed model in transcript: claude-opus-5-5; saved by the coordinator -->

## Report: palette-B review findings 1–6

I applied all six findings; I checked each one against the files first and agree with every one. No colour changed, `palette.ts` is untouched, and no test expected value was edited. Nothing is committed. The `dist` folder was not touched.

Line 14 of the decision now cites `reviews/2026-11-18/impl/wp/palette-b.review.md` (it reviewed commit 9861f54; its header records Codex gpt-6.2-astra at effort xhigh, read-only, observed in the session rollout). It says all 16 colours meet A5 and that the findings were record corrections. The "Not verified → Review" bullet is updated to match.

### Per finding
1. **Surround claim is wrong for translucent fills.** Agreed; I reproduced it from `raster.json`.
   - At 25%, all 16 fills are under 3:1 against the background (lowest 1.27 light slate, 1.24 dark purple).
   - At 80%, 6 of 16 are under it: light blue, orange, slate at 2.38–2.45; dark purple, red, slate at 2.38–2.77.
   - In the decision, item 2 now says "against opaque marks". It gives the fill numbers and explains why the ring still keeps its contrast: both rings put a 2 px focus band between 1 px background bands (datum ring in `core/focus.ts`, plot ring in `theme/css.ts`, both read-only).
   - It states plainly that the outer edge between a background band and a fill is under 3:1.
   - I also updated two stale lines saying the two-tone ring "is being built": it is in the core now.
2. **"Red at 0.17 needs purple at 0.23" is wrong.** Agreed.
   - The reviewer's pair passes every check in my `color.mjs` (light contrast 3.02, hue shift 14.8°).
   - My own exact search on that grid with purple capped at 0.22 completes with red at 0.170 and purple at 0.2195. That light set differs from the reviewer's only in slots 6 and 8. Its dark search timed out at 300 s.
   - The cost text now says why my searches returned 0.23: they minimise distance to targets, not purple's chroma. It quotes the counterexample as unrendered and not adopted.
   - The "For the owner" bullet is corrected.
   - Config notes are fixed in `b-red-17.json` and `b-red-18.json`, and the new search is saved as `configs/b-red-17-p22.json`.
3. **Single-ink example names the wrong surfaces.** Agreed: `#707070` gives 3.59:1 on the background and 3.44:1 on the green.
   - The text now says no ink clears the background, purple and green together: it would need at least 9.22:1 on the background, and the green allows at most 4.11:1 or at least 37.0:1, while white reaches only 17.76:1.
   - It also gives `#707070` as the counterexample for the green-and-background case.
4. **Tests passed with unreadable browser records and false summary fields.** Agreed.
   - `preview.mjs` now records each sample's PNG coordinates in `preview-pixels.json` under `samples`. I re-ran it: both PNGs and `preview.html` came out byte-identical.
   - New test `${name}: the browser records on disk (raster.json, strokes.json, preview-pixels.json and the preview PNG) are what the research record folded in`. It compares each file with its folded copy and decodes both PNGs with a small zlib-based PNG decoder in the test, reading every sample in all five rows.
   - New test `${name}: the record's check list, pass flags and tight list (within 5% of a limit) follow from the measurements`. It recomputes every check's label, limit, value and ok flag, and the tight list.
   - The record test now also checks the raster `minModel` and `minWorstWithinOneByte`.
   - Mutation runs: a changed `raster.json` pixel, an unreadable `raster.json`, a false `strokes.json` p10, a sample value that disagrees with the PNG, a missing PNG, a false ok flag, an empty tight list and a zeroed `minModel` each made a test fail. All files were restored and compared afterwards.
   - The README's list of verified fields is updated.
5. **Tight list and closing pairs omit values.** Agreed.
   - `score.mjs` now builds both the check list and the tight list after the browser checks are added, using unrounded values.
   - `palette.json` gained exactly the 7 missing entries (3 light and 2 dark preview rows, plus dark Chrome 25% canvas and SVG at 0.0628). That was additions only; nothing else in the file changed.
   - The decision's tight list now includes them.
   - The closing-pair line now gives the all-vision minima as well: 0.024 (light 6–1, tritanopia) and 0.029 (dark 6–1, deuteranopia).
6. **Slot names and the 0.15 wording.** Agreed.
   - The decision now says the family names describe the light scheme. By eye, dark slot 5 reads as rust (41.9°, 10.1° from the dark orange and 11.8° from the light red; also the dark scheme's closest pair, 2–5 at 0.115). Dark slot 7 reads as dusty pink (chroma 0.190 in light, 0.100 in dark).
   - It lists all eight hue shifts.
   - "Held at 0.15 or less" is replaced with what the searches actually did: the wide searches capped orange at 0.15 and red at 0.16. Both ended at 0.1503 and 0.1505.
   - I fixed the same wording in the notes of `fit-final.json` and `candidate-b.json`. Changing a note does not change what the fit runs output.

### Verification (ran)
- A default `node research/palette/score.mjs` run reproduces the regenerated `palette.json` byte for byte.
- `npx vitest run packages/axylo/test/theme`:
```
 Test Files  4 passed (4)
      Tests  61 passed (61)
```
  `palette.test.ts` alone: 40 passed.
- `npm run typecheck` (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist`) exited 0 with no errors.

### Files changed
- **Decision:** `docs/decisions/0003-default-palette.md`
- **Test:** `packages/axylo/test/theme/palette.test.ts`
- **In `research/palette/`:**
  - scripts and docs: `score.mjs`, `preview.mjs`, `README.md`
  - records: `palette.json`, `preview-pixels.json`
  - config notes: `configs/fit-final.json`, `candidate-b.json`, `b-red-17.json`, `b-red-18.json`
  - new: `configs/b-red-17-p22.json`

The `docs/decisions/0004-*` diff in the tree is another agent's.

### Not verified
- **The reviewer's red-at-0.17 pair** has not been rendered in Chrome.
- **The rendered focus ring:** its pixels have not been measured. The contrasts in the decision are computed from the token colours.
