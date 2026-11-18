<!-- Author: Claude Opus 5.5 (high), agent a5e106319fe97c022; saved by the coordinator -->

## Rotated scatter x labels on the text page: L1 behaviour, not a layout defect

The layout is doing what spec L1 prescribes, so I changed nothing. The result changed with 6ebdb6f (the controller's scatter x domain), not with my 2bbef28; the text test's premise is out of date and its fixture needs adjusting.

### 1. Which commit changed it
I laid out the text page's scatter in the Node recording host, built privately at each commit, with the options from `tests/dist/pages/sentinels.ts`, 7 px per character, at 760, 900 and 1,100 px wide by 520 high.

| Commit | x domain | x ticks | Remedies |
|---|---|---|---|
| 6ebdb6f~1 | [0, 80] | [0, 50] | thinned, horizontal |
| 6ebdb6f | [0, 80] | [0, 20, 40, 60, 80] | wrapped, rotated (and truncated at 760) |
| d9dd81e (just before 2bbef28) | same as 6ebdb6f | same | same |
| HEAD | same as 6ebdb6f | same | same |

- **6ebdb6f** ("Controller, eighth pass") made a scatter's automatic numeric x domain end on drawn ticks (amended F7: both axes of scatter are value axes). From then on, only tick sets that end at both ends of the domain are offered. For [0, 80] that means steps 10 and 20; [0, 40, 80] is not among the "nice" sets, and [0, 50] no longer ends at 80.
- Before 6ebdb6f the axis thinned to [0, 50], so no label sat on the plot's edge, but the domain then did not end on a tick, which F7 forbids.
- **2bbef28** (mine) changes nothing here. Its coarser-domain path runs only when truncation drops ticks, and here every tick is kept.

### 2. What L1 requires, and what the layout did
L1's remedies, in order: thin, wrap to at most three lines, rotate up to 45°, truncate in the middle. No overlap, no clipping, and nothing disappears without the reader being told.

**Edge labels.** End labels are already aligned inward: `bottomLabel` in `labels.ts` clamps a horizontal label into the figure. The last label, about 175 px wide, therefore moves about 83 px left of its tick at the plot's right edge.
- With the sentinel y axis, the plot is 537 / 677 / 877 px wide, so the ticks are 134 / 169 / 219 px apart.
- After the shift, the last label overlaps the "60" label at all three widths. Horizontal placement would need about 266 px between ticks.

**Each remedy:**
- **Thin:** tried. No sparser set ending on both ends exists (F7).
- **Wrap:** tried. The labels contain one space; two lines are still too wide.
- **Rotate:** applied.
- **Truncate in the middle:** only at 760 px, where the rotated labels exceed the room below the plot. L1 allows it with the full text in tooltip and table.

No remedy was skipped. An existing layout test, "keeps a rotated label at the last continuous tick", expects exactly this choice for a label on the last tick.

**One option, not a defect fix.** I tried reserving right-hand room for the last label, the way the y axis keeps half a line above its top tick. Only 1,100 px became horizontal; 760 and 900 still rotate because of F7's tick sets. It also changed three existing layout tests, including the rotated-last-tick one and two narrow F7 cases. I reverted it. Whether value x axes should get such room is a design decision for you or the owner, not something L1 asks for.

### Runs
- `npx vitest run packages/axylo/test/layout`: `Tests  47 passed (47)`.
- `npm run typecheck`: no errors.

The private build directory is removed and `src/layout` and its tests are unchanged.
