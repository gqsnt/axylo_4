Updated [lookup](/home/canarit/projects/axylo/packages/axylo/src/lookup), [reader](/home/canarit/projects/axylo/packages/axylo/src/reader), [messages](/home/canarit/projects/axylo/packages/axylo/src/messages), and their tests. The regression run failed 21 tests before the implementation changes. The final owned run passed all 46 tests. No contract changes were needed.

| Finding | Reproduced | Fixed | Coverage |
|---|---|---|---|
| 1. Stale focus | Yes | Yes | Hidden and zoomed-out refs in aligned and scatter views, including stepping from the replacement. |
| 2. Position | Yes | Yes in owned code | Visible-slot ordinal property with two visible series and a hidden middle series. `pointOf` uses the formatted ordinal plus one and count. |
| 3. Table caption | Yes | Yes in owned code | `labelledBy` with supplied heading text and with the generated fallback. |
| 4. Disclosures | Yes | Yes | Separate omitted and changed sentences, combined notes, and formatter-supplied counts. |
| 5. Localization | Yes | Yes | Message overrides for chart types and headers, plus field-name fallback. |
| 6. Missing stack total | Yes | Yes | All-missing stack reads “No data.” |
| 7. Empty ranges | Yes | Yes | One no-data sentence per series, no unavailable value range, and an empty zoom. |
| 8. Donut summary | Yes | Yes | Drawn-slice count, total, formatted shares, and grouped categories named only through Other. |
| 9. Undrawable series | Yes | Yes | Duplicate-x series appears in the summary even when absent from the visibility mask. |
| 10. References | Yes | Yes | Lines and bands use their axis formatters and appear in both summary and caption. |
| 11. Scatter steps | Yes | Yes | Recreated refs with shuffled source rows and a binary-search window for switching series. |
| 12. Scatter scaling | Yes | No, partial | Successor search, distant table paging, and clustered picking are covered by counters. The worst-case pointer candidate cap remains open. |
| 13. Parsing and formatting | Yes | Yes | Supplied percentage formatter plus calendar, instant, and wall-clock jumps. The data index lacks a standalone x-position parser, so the adapter uses its exported one-row normalization path. |
| 14. End steps and folded slices | Yes | Yes | Steps that cannot move return `null`. Folded refs resolve through Other’s members. |
| 15. Regression coverage | Yes | Yes | Widened properties use partial ranges, hidden series, and hand-built duplicate-x scatter frames. Reversed irregular-time picking already passed before the fix. |

Scatter ref lookup costs `O(log n + k)` for an equal-x run of length `k`. Next and previous use one binary search per visible series. A 100-row page across 500 series took one seek and 100 heap advances. Pointer picks visit at most 16 grid cells once, and the tested dense fixtures stayed below 3,000 point-distance checks. A separate ring fixture straddling the 0.5 px coincidence boundary took 200,033 checks. Exact coincidence counting can still visit every leaf that intersects that boundary.

The chart caller still needs to pass the external heading text as `caption` and connect the `pointOf` helper to keyboard announcements. Browser integration was outside the owned files and was unverified. For scatter, I interpreted a hidden ref’s primary replacement as the first visible point at the same x in x-then-y order.

`npm run typecheck` failed in `test/browser/chart` with no errors in the owned files. The full `npm test` failures were in `test/scene/scene.test.ts`, `test/scale/time.test.ts`, `test/view/review.test.ts`, and `test/view/view.test.ts`. Its last lines were:

```text
 Test Files  4 failed | 29 passed (33)
      Tests  30 failed | 450 passed (480)
   Start at  02:59:26
   Duration  1.70s (tests 77%, import 12%, transform 10%, worker 1%)
```