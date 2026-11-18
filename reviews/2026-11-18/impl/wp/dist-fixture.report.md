<!-- Author: Claude Opus 5.5 (high), agent a61d95e46b3f0f3aa; saved by the coordinator -->

## Text tests' scatter fixture: report (nothing committed)

The browser run of `tests/dist` now passes in full, 26 of 26. The Node run has one failure, in `licence.test.ts`. It is caused by another author's uncommitted edit to `src/theme/css.ts`, not by this change. I did not rebuild the library.

### What I changed
**`tests/dist/pages/sentinels.ts`**
- The scatter's x values now run from 0 to 100 exactly, instead of 10 to 65. They come from a new exported helper, `scatterSize(i) = Math.round(100 * i / 11)`, which gives 0, 9, 18, 27, 36, 45, 55, 64, 73, 82, 91, 100. The y values, the series and the sentinel texts are unchanged.
- A comment in the fixture gives the reason:
  - An automatic numeric x domain ends on drawn ticks (spec F7).
  - For [0, 100] the coarsest tick set has step 50: three ticks, 0, 50 and 100.
  - Three labels of about 26 characters fit side by side in the 760 px chart (`.chart.tall` in `page.css`). L1's first remedy, thinning, is then enough, so no label is wrapped, rotated or truncated.
  - The old range made the domain [0, 80], with only steps 10 and 20 offered. That gave five or more labels 134 to 219 px apart, which L1 rotates and then cuts in the middle.

**`tests/dist/text.browser.test.ts`, line 229**
- The scatter table check repeated the fixture's old formula: row x equal to `10 + 5 * i`.
- It now reads the same value from the fixture: `S(id.xFormat!, String(scatterSize(i)))`.
- It is still an exact check of every row's x as the whole sentinel, so nothing is weakened. Without this, the fixture change failed it ("row 0 x: expected …>0</u> to be …>10</u>").
- No other assertion changed.

### How I chose the values
I tried several x ranges in a 760 × 520 chart on the current shared build (d33df71), with the text page's own scatter options: the same sentinel `tickFormat`, `format`, labels and unit. I listed the x tick labels as drawn:

| x range | x tick labels |
|---|---|
| 10..65 (old) | 0, 20, 40, 60, 80 — all rotated; 4 of 5 cut, e.g. `<u data-axs…-xt">20</u>` |
| 0..100 (chosen) | 0, 50, 100 — whole and horizontal |
| 0..40 | 0, 20, 40 — whole |
| 100..300 | 100, 200, 300 — whole |
| 0..200 and 0..1000 | 2 labels each — whole |

The probe file is deleted.

### What the assertion at line 314 needs
It runs `clean(t)` on every text node and every attribute value on the page. That check removes every whole sentinel `<u data-axs="…">…</u>` and fails if any `<`, `>` or `data-axs` is left.

- **Fails:** any cut sentinel (a middle-truncated label), and a label wrapped at its one space. Wrapped lines join with no space, giving `<udata-axs…`, which an earlier probe showed at 1000 px.
- **Passes:** a rotated label, because its text node still holds the whole sentinel.

Line 168 needs at least two labels that contain `data-axs="s-xt"` and match the whole sentinel with a number body. A cut label does not count, which is why only one was found before.

### Last lines (real tree, shared build d33df71)
- **Browser** (`AXYLO_BROWSER=1 npx vitest run --config tests/dist/vitest.config.ts`): `Test Files 5 passed (5)` / `Tests 26 passed (26)` / `Duration 37.10s`.
- **Node** (`npx vitest run --config tests/dist/vitest.config.ts`): `Test Files 1 failed | 10 passed (11)` / `Tests 1 failed | 89 passed (90)`.
  - The failure is `licence.test.ts`, "gives each file an origin that holds, and a license": "axylo/dist/axylo.css is a string packages/axylo/src/theme/css.ts exports, through …/minify.ts: expected false to be true".
  - That test compares the built `axylo.css` with what the working-tree source exports. `git diff` shows another author's uncommitted edit to `packages/axylo/src/theme/css.ts` (1 insertion, 3 deletions), which the d33df71 build does not contain.
  - It should pass once that edit is committed and the shared dist rebuilt; I did not verify this. Your 90-of-90 run predates the edit.
- `tsc -p tests/dist --noEmit` reports no errors.

**Files changed:** `tests/dist/pages/sentinels.ts`, `tests/dist/text.browser.test.ts`.
