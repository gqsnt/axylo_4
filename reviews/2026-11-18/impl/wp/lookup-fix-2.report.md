<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ed1f-7080-7323-b685-1c7c5afa7fdc). -->

Fixed scatter picking at plot edges and bounded the work for repeated points at the same screen position.

- **Plot edges.** In Node, the reversed y scale rounded EU (20 kB, 140 ms) just above the plot, so the lookup discarded it. A separate rounding error could put right and bottom edge points in cells the search skipped. The lookup now uses exact scale endpoints and clamps cell indices consistently. Tests cover all four edges and corners, exact and offset picks, and 1,500 fast-check cases against a brute-force oracle for in-plot pointers. [Geometry](/home/canarit/projects/axylo/packages/axylo/src/lookup/geometry.ts) · [Lookup tests](/home/canarit/projects/axylo/packages/axylo/test/lookup/scatter.test.ts)
- **Dense coincidence.** The previous tree could split identical positions across leaves. The grid now groups them before splitting, preserving the later-row tie-break, full count, and eight-ref limit. On 200,000 points with 10,000 at one position, visits fell from **37 to 10** at that position and from **27 to 9** at a neighboring point exactly 0.5 px away. Both picks reported 10,001 matches. The general worst case for distinct positions remains open. The separate ring fixture still took 200,008 visits. [Scatter grid](/home/canarit/projects/axylo/packages/axylo/src/lookup/scatter-grid.ts)

**Interaction follow-up.** For the earliest of ten coincident rows, `resolve` returns the original ref, `ordinal` returns `0`, and `datum` returns the row’s text. Picking at its anchor returns eight refs and `count: 10`. `keyboardTarget` should keep that count even when the focused ref is absent from the displayed eight, and retain the focused ref separately for keyboard focus and selection. [Scatter lookup](/home/canarit/projects/axylo/packages/axylo/src/lookup/scatter.ts) · [Keyboard caller](/home/canarit/projects/axylo/packages/axylo/src/dom/interaction.ts:332)

The requested Node run and `npm run typecheck` passed. Browser behavior remains unverified. No contract changes were needed.

```text
 Test Files  19 passed (19)
      Tests  527 passed (527)
   Start at  06:32:50
   Duration  13.24s (tests 83%, transform 10%, import 6%)
```