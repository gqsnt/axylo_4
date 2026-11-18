Implemented the [diagnostic registry and collector](/home/canarit/projects/axylo/packages/axylo/src/diagnostics/index.ts), [options resolution and normalization](/home/canarit/projects/axylo/packages/axylo/src/data/index.ts), [streaming store](/home/canarit/projects/axylo/packages/axylo/src/data/store.ts), and [DOM-free validation](/home/canarit/projects/axylo/packages/axylo/src/data/validate.ts).

`npm run typecheck` passed. All 60 data and diagnostics tests passed. The focused million-point test finished in 37 ms and confirmed that normalization borrowed the caller’s x and y buffers.

The root `npm test` run reported one failure in the [scale category-tick review test](/home/canarit/projects/axylo/packages/axylo/test/scale/review.test.ts:198). It expected zero category reads before a tick set was accessed and observed 265,909.

```text
Test Files  1 failed | 17 passed (18)
     Tests  1 failed | 236 passed (237)
```

I applied F11’s duplicate-x rule to scatter: points stay sorted in the frame and the affected series is disabled. Tail appends share buffers while capacity permits. A same-x append that fills a slot already exposed by an earlier frame copies the affected series to preserve that revision. Avoiding that copy would require chunked `Series` buffers in the fixed contract.

Browser rendering and public `validate()` wiring were outside this verification.