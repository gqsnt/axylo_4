Fixed findings 1–13 and 15–18, plus F11 scatter handling. Preserved the existing `scale/zone` import as directed for finding 14. All **106 data and diagnostics tests passed**, and the owned files passed a scoped TypeScript check. The work required no contract changes.

Changes are in [data source](/home/canarit/projects/axylo/packages/axylo/src/data) and [diagnostics source](/home/canarit/projects/axylo/packages/axylo/src/diagnostics). Coverage is in [review.test.ts](/home/canarit/projects/axylo/packages/axylo/test/data/review.test.ts), [normalize.test.ts](/home/canarit/projects/axylo/packages/axylo/test/data/normalize.test.ts), [store.test.ts](/home/canarit/projects/axylo/packages/axylo/test/data/store.test.ts), and [registry.test.ts](/home/canarit/projects/axylo/packages/axylo/test/diagnostics/registry.test.ts).

| Finding | Reproduced | Fixed | Coverage |
|---|---|---|---|
| 1 | Yes | Yes | Sparse grids in normalization and streaming, both cap thresholds, and eviction of sparse hints |
| 2 | Yes | Yes | UTC calendar days from `Date`, epoch milliseconds, and offset strings across viewer zones |
| 3 | Yes | Yes | Leading junk, the category threshold, and streaming re-inference |
| 4 | Yes | Yes | Space-separated date-times with and without offsets |
| 5 | Yes | Yes | A missing wall-clock hour across a DST transition |
| 6 | Yes | Yes | Unknown-zone fallback, `utc` canonicalization, and non-throwing validation |
| 7 | Yes | Yes | All four invalid option literals, their suggestions, and defaults |
| 8 | Yes | Yes | Eviction of unplaceable rows, diagnostics, empty series, and unused categories |
| 9 | Yes | Yes | Shared-x append avoids copying series buffers and preserves older values, states, and provenance indexes |
| 10 | Yes | Yes | AX101 on empty-start and later batches that lack a field |
| 11 | Yes | Yes | AX134 above 20 million slots in normalization and streaming, including a batch that fits after `keep` |
| 12 | Yes | Yes | Valid message overrides and a compile-time check against every `Messages` key |
| 13 | Yes | Yes | One disclosure count per omitted slot, skipped value checks, and AX105 with effect `none` |
| 14 | Yes, by inspection | No, as directed | The existing `scale/zone` import remains |
| 15 | Yes | Yes | Unique row samples, full counts, formatted positions, series names, message outcomes, and suggestion limits |
| 16 | Yes | Yes | One slot for a shared fractional gap and identical grids in streaming and normalization |
| 17 | Yes | Yes | Donut zero imputation for null and absent values |
| 18 | Yes | Yes | Broader properties, DST and AX111 cases, deduplicated fixture expectations, and a warmed five-run median below 100 ms |
| F11 scatter | Yes | Yes | Shared x and coincident points all remain drawable in x-then-y order, without AX108 |

For tied recognized x kinds, I used the fixed order `date`, `time`, `wall`, `number`. Unplaceable rows are anchored to the latest observed x and capped at twice `keep`, or at `keep` when no x is observed. Reading an older frame’s still-open shared-x series can materialize a copy on demand. Its slot arrays stay immutable, and evicted source rows return `null` under the existing `RowSource` contract.

Repository-wide `npm run typecheck` reported errors outside the owned files in donut view, lookup and reader fixtures, and browser chart tests. All 35 failures in the final `npm test` run also reproduced with the baseline data and diagnostics modules. Browser behavior, including AX132 presentation, was outside this verification.

```text
 Test Files  3 failed | 30 passed (33)
      Tests  35 failed | 438 passed (473)
   Start at  02:56:34
   Duration  1.76s (tests 73%, transform 15%, import 11%, worker 1%)
```