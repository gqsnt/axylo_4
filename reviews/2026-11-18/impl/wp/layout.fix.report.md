Reproduced and fixed all 14 findings. The 40 layout and simplification tests pass.

Changed [layout/index.ts](/home/canarit/projects/axylo/packages/axylo/src/layout/index.ts), [layout/labels.ts](/home/canarit/projects/axylo/packages/axylo/src/layout/labels.ts), [simplify/index.ts](/home/canarit/projects/axylo/packages/axylo/src/simplify/index.ts), and their [layout](/home/canarit/projects/axylo/packages/axylo/test/layout/layout.test.ts) and [simplification](/home/canarit/projects/axylo/packages/axylo/test/simplify/simplify.test.ts) tests.

| Finding | Reproduced | Fixed | Regression coverage |
|---|---|---|---|
| 1. Label fitting cost | Yes | Yes | One measurement per string at 1,000 categories and an evenly spread layout at 100,000 |
| 2. Unreadable truncation | Yes | Yes | Truncation keeps at least two graphemes on each side |
| 3. Ambiguous truncation | Yes | Yes | Shared prefixes and suffixes, including a case that requires an asymmetric split |
| 4. Horizontal-bar margins | Yes | Yes | Titled bars at 240 px retain all four labels and a plot at least 120 px wide |
| 5. Non-finite sizes | Yes | Yes | NaN and both infinities on either dimension return `unmeasured` |
| 6. Last rotated tick | Yes | Yes | The last continuous tick remains visible inside the container |
| 7. Message overflow | Yes | Yes | Inset wrapping, ellipsis on the last fitting line, and no lines in a tiny tile |
| 8. Range-edge isolation | Yes | Yes | Joins across `SLOT_NO_ROW` outside either draw-range edge, including shared area boundaries |
| 9. Redundant x mapping | Yes | Yes | Sparse inputs make zero mapper calls. Dense runs map once, and affine selection and packing agree with the function form |
| 10. Timing threshold | Yes | Yes | The old code failed at 41.9 ms. The test now asserts a seven-run wall-clock median below 30 ms after warmup |
| 11. Layout property coverage | Yes | Yes | Generated plot kinds, axes, sizes, feasible minimum plots, and label attribution |
| 12. Simplification oracle | Yes | Yes | Independent device-column enumeration, Float32 y, off-plot x, five pixel ratios, and joined neighbours outside the range |
| 13. Blank and duplicate labels | Yes | Yes | Blank labels and later duplicates count as hidden on both axes without triggering remedies |
| 14. Repeated diagnostics | Yes | Yes | Repeated layouts leave the legacy sink untouched and return the counts and layout kind |

`computeLayout` no longer reads or writes a diagnostics sink. The optional `diagnostics` field remains accepted and is documented as ignored. Callers can derive AX142 and AX143 from the existing `Layout` result. No shared contract change is needed. Truncation counts user-visible graphemes and assumes measured width grows as text is added. The existing F5 break and `SLOT_NO_ROW` behavior is covered by the simplification tests.

**Measured performance**

The 1,000-category case made 438 measurer calls. The 100,000-category case took 47.0 ms in the focused run.

| Plot width | DPR 1 wall / CPU | DPR 2 wall / CPU |
|---|---:|---:|
| 97 px | 5.4 / 5.9 ms | 5.4 / 6.0 ms |
| 320 px | 6.1 / 6.0 ms | 6.1 / 6.0 ms |
| 877 px | 5.6 / 6.0 ms | 6.1 / 6.0 ms |

**Verification**

The scoped TypeScript check and API examples check passed. Root `npm run typecheck` reported one error in the [scatter lookup fixture](/home/canarit/projects/axylo/packages/axylo/test/lookup/scatter.test.ts:10), which omits the required `DatumRef.x` field. All five root test failures came from that same out-of-scope file. Browser tests were outside this run.

```text
 Test Files  1 failed | 25 passed (26)
      Tests  5 failed | 340 passed (345)
   Start at  02:39:13
   Duration  1.53s (tests 74%, transform 15%, import 10%, worker 1%)
```