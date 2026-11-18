Implemented [messages](/home/canarit/projects/axylo/packages/axylo/src/messages/index.ts), [lookup](/home/canarit/projects/axylo/packages/axylo/src/lookup/index.ts), and [reader](/home/canarit/projects/axylo/packages/axylo/src/reader/index.ts) in pure TypeScript. All 28 focused tests passed, including the million-row table lookup, the 200,000-point scatter pick, and the fast-check traversal properties.

The final `npm test` run reported 17 failures in [layout.test.ts](/home/canarit/projects/axylo/packages/axylo/test/layout/layout.test.ts).

```text
Test Files  1 failed | 25 passed (26)
     Tests  17 failed | 326 passed (343)
```

`npm run typecheck` reported argument-count errors in [labels.ts](/home/canarit/projects/axylo/packages/axylo/src/layout/labels.ts:331) and a `LayoutInput` type error in [layout.test.ts](/home/canarit/projects/axylo/packages/axylo/test/layout/layout.test.ts:399). The API examples passed a separate typecheck. Browser behavior remains unverified.

Aligned ordinals use x-then-series order for value slots. `next` and `previous` stay within the active series, while series switches can land on missing slots. Table captions use the chart name, and reference labels appear in the summary.

An evicted scatter ref returns `null`. To choose its replacement by x, the point variant of `DatumRef` needs `readonly x: number` alongside its source row. Scatter picking also depends on the upstream normalizer keeping same-series duplicate x values drawable. The fixed interfaces were left intact.