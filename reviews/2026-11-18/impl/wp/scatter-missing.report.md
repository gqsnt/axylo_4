<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ed0e-abe6-7561-8964-d8d894728748). -->

Both F2 scatter acceptance tests pass. The requested combined run had no remaining acceptance failures.

- Static normalization and `PointStore` now preserve valid x positions with missing y. With `missing: 'zero'`, those observations become zero-valued points and keep their source rows. Eligible ordered appends share the `missingX` buffer, `keep` advances its offset, and retirement releases evicted source rows. [normalize.ts](/home/canarit/projects/axylo/packages/axylo/src/data/normalize.ts:348) · [store-unaligned.ts](/home/canarit/projects/axylo/packages/axylo/src/data/store-unaligned.ts:87)
- The scatter table pages in-range omissions as `messages.noData` and leaves them out of summary statistics. At a shared x, plotted points come first, followed by omissions in series order. Typed-column `NaN` and empty strings follow the existing missing-value rules. [table.ts](/home/canarit/projects/axylo/packages/axylo/src/reader/table.ts:29)
- The only diagnostic change is scatter y-field `AX102` with `missing: 'zero'`. It remains a warning with the same count and row indexes. Its effect changes from `omitted` to `changed`, and its message says “Shown as zeros.” [values.ts](/home/canarit/projects/axylo/packages/axylo/src/data/values.ts:80)

Tests cover **missing y in gap and zero modes**, **typed-column `NaN`**, **shared storage, offset keep, and retirement**, **absent fields through re-encoding and replacement**, and **in-range table merging, summary statistics, and page boundaries**. The 1,000-run scatter streaming model now checks `missingX`. All 26 streaming-storage tests passed with `--expose-gc`. [Normalization tests](/home/canarit/projects/axylo/packages/axylo/test/data/normalize.test.ts:251) · [Streaming tests](/home/canarit/projects/axylo/packages/axylo/test/data/streaming-storage.test.ts:200) · [Reader tests](/home/canarit/projects/axylo/packages/axylo/test/reader/index.test.ts:221)

```text
 Test Files  22 passed (22)
      Tests  650 passed (650)
   Start at  06:12:04
   Duration  13.55s (tests 87%, transform 8%, import 5%)
```

Scoped TypeScript checking passed. Repository-wide typechecking reported errors in two browser acceptance files. Browser tests were not run. [a1-names.browser.test.ts](/home/canarit/projects/axylo/packages/axylo/test/browser/acceptance/a1-names.browser.test.ts:45) · [text.ts](/home/canarit/projects/axylo/packages/axylo/test/browser/acceptance/text.ts:54)

**Cross-module follow-up.** The view’s `scatterX` needs to include `missingX` in the automatic x domain so the default table can reach omissions beyond the plotted endpoints. The controller’s `latestX` needs the same input for streaming follow. Lookup and keyboard traversal already follow the contract by visiting plotted points only. No contract change is needed. [View](/home/canarit/projects/axylo/packages/axylo/src/view/index.ts:220) · [Controller](/home/canarit/projects/axylo/packages/axylo/src/core/controller.ts:212)