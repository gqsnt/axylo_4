Implemented `buildView` and `buildScene` for line, area, bar, scatter, and donut charts. Added 40 fixture and fast-check tests, including shared stacked-area boundaries and per-column extrema for a 100,000-point line at DPR 1 and 2. [View](/home/canarit/projects/axylo/packages/axylo/src/view/index.ts) · [Scene](/home/canarit/projects/axylo/packages/axylo/src/scene/index.ts) · [View tests](/home/canarit/projects/axylo/packages/axylo/test/view/view.test.ts) · [Scene tests](/home/canarit/projects/axylo/packages/axylo/test/scene/scene.test.ts)

**Verification**

Focused TypeScript checking passed. The focused test run ended with:

```text
 Test Files  2 passed (2)
      Tests  40 passed (40)
```

Root `npm run typecheck` failed with TS2322 in the layout tests. All 11 failures in the latest root `npm test` run were in that same file. Earlier simplification and time-scale failures cleared on rerun. [Layout tests](/home/canarit/projects/axylo/packages/axylo/test/layout/layout.test.ts:399)

```text
 Test Files  1 failed | 25 passed (26)
      Tests  11 failed | 333 passed (344)
```

**Decisions and limits**

Marker spacing uses projected x distance. Missing stacked-area components pinch to zero thickness and break the series stroke. The Float32 area path reuses the line simplifier’s selected vertices for the zero baseline, so it can use the borrowed column directly. Very thin stacked bars retain their height when a separator would erase them. Browser rendering and pixel contrast were unverified.

Equal-endpoint reference bands are omitted with AX150. Supporting those bands would require a `kind: 'line' | 'band'` discriminator on `ResolvedReference`. [Fixed contract](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts)