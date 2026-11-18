Updated `layout`, `view`, and `scene` and added regression tests before the fixes. All 111 tests in those modules passed.

| # | Done | Regression coverage |
|---|---|---|
| 1. Wrap before rotating | Yes | The seven-bar chart wraps only the long category to three lines. The existing two-line case still passes. [Layout tests](/home/canarit/projects/axylo/packages/axylo/test/layout/layout.test.ts:223) |
| 2. Use up to 40% for rotated labels | Yes | The same rotated label stays whole in a tall container and truncates in a shorter one. [Layout test](/home/canarit/projects/axylo/packages/axylo/test/layout/layout.test.ts:251) |
| 3. Keep tick labels 6 px from axes | Yes | Checks both axes in both bar orientations. [Layout test](/home/canarit/projects/axylo/packages/axylo/test/layout/layout.test.ts:269) |
| 4. Place reference labels | Yes in layout | Tests cover line and band placement, overlap, clipping, and middle truncation. Core still needs to pass `view.references` and `view.xDomain` into layout and include references in the layout cache key. This needs no shared contract change. [Layout tests](/home/canarit/projects/axylo/packages/axylo/test/layout/layout.test.ts:280) |
| 5. Order horizontal bars top to bottom | Yes | Checks that the first, middle, and last bars align with their category labels. [Scene test](/home/canarit/projects/axylo/packages/axylo/test/scene/scene.test.ts:161) |
| 6. Round numeric scatter x outward | Yes | Checks `[10, 998]` becomes `[0, 1000]` and covers positive-only data, author bounds, zoom, and dates. [View test](/home/canarit/projects/axylo/packages/axylo/test/view/view.test.ts:137) |
| 7. Style reference rules above marks | No, partially done | Tests confirm that rules draw over bars and areas with a 1.5 px stroke and `[4, 3]` dashes. The `[6, 3]` contrast pattern needs `RuleMark.dash` widened to accept `DashStyle` and both renderers updated to select the active pattern. [Scene tests](/home/canarit/projects/axylo/packages/axylo/test/scene/scene.test.ts:250) |

Category wrapping uses word boundaries. A band spanning the plot gets a label just inside its edge when both outside positions are clipped.

`npm run typecheck` passed. The first full test run failed on an out-of-scope linear-scale property test with seed `243009428`. The rerun passed. Browser and gallery output remain unverified. [Scale test](/home/canarit/projects/axylo/packages/axylo/test/scale/linear.test.ts:130)

```text
 Test Files  33 passed (33)
      Tests  495 passed (495)
   Start at  03:20:34
   Duration  2.25s (tests 81%, transform 9%, import 9%, worker 1%)
```