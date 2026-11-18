<!-- Author: Claude Opus 5.5 (high), agent a5e106319fe97c022; saved by the coordinator -->

## Stacked no-row slots: test rewritten to the owner's rule, two scene changes made

The test now follows the decided rule: a weekly series in a stack is a missing component on the days it has no row, so those days are "incomplete", its band has zero height there and its line now breaks with the band; bars get no mark for a no-row slot. All of it passes, the Node suite is green, and the change costs 90 B gzipped for everything. Nothing committed; the shared build was not touched.

### Failing assertions before the code change
The rewritten `packages/axylo/test/view/stack-no-row.test.ts` has 11 tests, with expected values taken from F2, F5 and F10. Against the old code, 3 failed:
- **Stacked area, weekly line:** "line, day 1: expected 66.67 not to be close to 66.67". The stroke was joined at the weekly value (100) across days 1–6 while its fill had zero height there.
- **Stacked bars:** the weekly series had 12 "no data" marks on the days it has no row; expected 0.
- **Grouped bars:** the same 12 marks; expected 0.

These already passed on the old code and still do:
- The incomplete flags and the totals with "(incomplete)" on days 3 and 10, for area and bar. These are the three expectations I flipped from my previous version of the test.
- The weekly band at zero height on the days between its rows.
- D's explicit null on day 7: still incomplete, total "100 (incomplete)".
- The unstacked line and area: the weekly line is still one segment, (day 0, 100) → (day 7, 100) → (day 14, 100). This is the guard that the stacked rule does not leak outside stacks.

### What changed
1. **`src/scene/areas.ts`, the stroke of a stacked series.**
   - The stroke is drawn with slots it has no row for treated as missing, so it is not joined across them and follows its band.
   - Days 0, 7 and 14 of the weekly series then become visible points, per F2's isolated-value rule.
   - The fill is unchanged, and so is anything outside stacks.
   - A second rule in the same place: outside the view, the stroke keeps only a slot right next to it, and only when the adjacent slot inside the view has a value, so the segment still reaches the plot's edge. Without this, a value further out, now unjoined, drew a marker outside the plot. The existing scene property test "keeps generated geometry finite and clipped" caught that on my first attempt.
2. **`src/scene/bars.ts`.**
   - A slot whose series has no row now gets no bar and no "no data" mark, in stacked and grouped bars alike.
   - Nulls, absent expected steps and invalid values keep the mark.
   - The readout still says "No observation" there, and the stack is still "incomplete".

**Stacked-area simplification (F5):** unchanged. The fills are still simplified on the cumulative sums, and the existing simplify and scene tests pass with no edits.

**Not changed:** `lookup.anchor()` for a no-row bar slot still returns a box at the baseline, where no mark is drawn now. It is outside this brief; tell me if you want it aligned.

### Size
Analysis method, HEAD against HEAD plus the two scene files, gzip level 9:

| Bundle | Before | After | Difference |
|---|---:|---:|---:|
| everything | 118,428 B | 118,518 B | +90 B |
| line | 99,131 B | 99,135 B | +4 B |
| area | 101,017 B | 101,091 B | +74 B |
| bar | 99,512 B | 99,540 B | +28 B |

That leaves about 267 B of the 357 B margin.

### Browser tests
I read the tests in `test/browser/acceptance` and `test/browser/chart` that involve no-row slots:
- I1 "a series with no row at the pointed x reads No observation" measures series A's marks, not B's.
- A6–A10 already expects a no-row stack to read as incomplete.
- F2 `missing: 'zero'` concerns absent steps, not no-row slots.

None asserts a joined stroke in a stack or a no-row bar mark, so there is nothing to hand to their author.

I also ran `render/` and `chart/` against a private development bundle through `AXYLO_BUNDLE`, then removed it: `Test Files  1 failed | 28 passed | 1 skipped (30)`, `Tests  1 failed | 376 passed | 1 skipped (378)`. The failure is "works with the stylesheet applied through ensureStyles (no linked axylo.css)". It is about how the stylesheet is applied, not stacks or bars; my unconfirmed guess is that it comes from the private bundle injecting `axylo.css` as a style tag. The acceptance suites cannot take `AXYLO_BUNDLE`, so I did not run them.

### Runs
- `npm run typecheck`: no errors.
- `npx vitest run packages/axylo/test/{view,scene,reader,simplify}`: `Tests  169 passed (169)`.
- Whole Node suite: `Test Files  71 passed (71)`, `Tests  1524 passed (1524)`.
