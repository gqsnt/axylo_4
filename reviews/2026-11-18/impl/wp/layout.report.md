Implemented both modules in the owned directories.

- [Simplified drawing](/home/canarit/projects/axylo/packages/axylo/src/simplify/index.ts) preserves run breaks, isolated points, and per-column extrema. It packs line, point, and area geometry and lets adjacent bands share a packed boundary when their projections and slot states match.
- [Plot layout](/home/canarit/projects/axylo/packages/axylo/src/layout/index.ts) computes projections, fits tick labels and titles, and reports `AX142` for small plots and `AX143` for hidden labels. It also handles compact, ring, message, and unmeasured layouts.
- Added [simplification tests](/home/canarit/projects/axylo/packages/axylo/test/simplify/simplify.test.ts) and [layout tests](/home/canarit/projects/axylo/packages/axylo/test/layout/layout.test.ts) with fixed fixtures and fast-check properties.

`npm run typecheck` passed. The million-slot cases took **20.0–25.2 ms** across three widths at DPR 1 and 2. The full `npm test` run ended with:

```text
 Test Files  12 passed (12)
      Tests  135 passed (135)
   Start at  02:11:01
   Duration  1.76s (tests 79%, transform 12%, import 7%, worker 1%)
```

The density calculation counts partially covered device columns. The four-sample cap applies once simplification starts, as sparse series keep every value. The fixed slot join rule governs gaps even across empty columns. `fit.hidden` counts labels omitted after candidate thinning.

No contract changes are needed. Browser rendering, resize behavior, and accessibility were outside the Node verification.