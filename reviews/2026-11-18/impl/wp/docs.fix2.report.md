<!-- Author: Claude Opus 5.5 (requested effort xhigh), Agent-tool subagent a04bfe28413f07034, resumed. Saved by the coordinator from the hand-back. -->

## Docs maintenance pass: the site builds on the restructured library and all docs tests pass (nothing committed)

Library rebuilt with `npm run build` at 11:32 CET on commit **5dc837e**. My `apps/docs` changes are uncommitted. The revision guard held through every run.

**Last lines of the four runs:**
| Configuration | Result | Started |
|---|---|---|
| Root config, unit (`npx vitest run apps/docs`) | Test Files 4 passed (4), Tests 223 passed (223) | 11:32:28 |
| Docs config, unit (`--config apps/docs/vitest.config.ts`) | Test Files 4 passed (4), Tests 223 passed (223) | 11:32:29 |
| Root config, browser (`AXYLO_BROWSER=1 npx vitest run apps/docs`) | Test Files 6 passed (6), Tests 167 passed (167), 95.16 s | 11:32:33 |
| Docs config, browser (`AXYLO_BROWSER=1 … --config apps/docs/vitest.config.ts`) | Test Files 6 passed (6), Tests 167 passed (167), 94.95 s | 11:34:12 |

The site build produced 19 pages (16,879 words), 29 diagnostic pages and 51 examples. The root config now includes `apps/docs`, so both configurations run the same files; the unit count went from 222 to 223 because of the new minified-stylesheet test.

### 1. Build guard and theme reader
- **Guard:** `checkSameRevision` in `lib/site.mjs` now takes everything it compares from `scripts/build.mjs`:
  - the installed `axylo.css` must equal `stylesheets().minified`;
  - the in-memory rebuild of the development bundle uses the build's own `DEVELOPMENT` constants, so `__BENCH__` matches too;
  - `importSource` uses `DEVELOPMENT` as well.
- **Theme reader:** `block()` in `lib/theme.mjs` now finds `selector{` with or without a space and splits declarations on `;`, so the last declaration of a minified block is read too.
- **Check:** the readable stylesheet and the shipped minified one give identical defaults (14 names in each scheme). That is now a unit test in `theming.test.ts`, which minifies with `src/theme/minify.ts` and compares the two readings.

### 2. Palette
- **Tables:** the theming page's token and palette tables are generated from the packed stylesheet and now show the adopted colours (slot 1 is `#2b97ee` light, `#5d9afd` dark).
- **Limits paragraph:** I checked it against the rewritten decision 0003 and it is still true for palette B. The order is blue, orange, green, purple, red, cyan, magenta, slate. All values meet the limits: lowest contrast 3.10 light and 3.07 dark; pairs at least 0.102 under every simulation, byte-rounded too; first four at least 0.143 after byte rounding; at least 0.102 from the focus, reference and muted colours; fills at least 0.063. The near-white dark focus colour is unchanged.
- **Replaced sentence:** the old "a proposal … the refit has not been reviewed" now says:
  - the owner adopted the palette on 2026-11-18, and why;
  - the costs the record states: louder light red and purple, dimmer dark purple, tighter dark margins to focus and muted, deeper dark first blue;
  - the replaced palette is kept under "Superseded";
  - an independent recomputation found all 16 colours within the limits. That review is linked and published as a source page.
- **Old colours:** no example or test expects one. The examples that set colours use their own brand values, and the painted-colour test reads the defaults from the packed stylesheet.

### 3. Size
No page mentions bundle size or tree-shaking; "size" only ever means the chart's layout size. I changed nothing for this point.

### 4. Hooks
None of my tests or examples use `__bench` or `__dev`. They wait on frames and on what the page shows.

### One thing for you to decide
The decision record still says at line 14, "Nobody other than me has reviewed candidate B". That is out of date: `reviews/2026-11-18/impl/wp/palette-b.review.md` recomputes palette B, and the theming page now cites that review. The record is not my file, so I left it.

`scripts/size.mjs` shows as modified in the working tree; that is not my change.

