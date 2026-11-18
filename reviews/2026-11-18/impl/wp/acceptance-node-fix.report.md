<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ed5c-3882-70a3-95a7-ec73a934e521). -->

The release checker now blocks on stale provenance, failed suites, skipped citations, and missing evidence. The strengthened Node suite exposed **seven failures in the current library**. Its report separates those failures from the failures introduced by each mutation. [Acceptance report](/home/canarit/projects/axylo/acceptance/report.md) · [Mutation report with exact failing test titles](/home/canarit/projects/axylo/packages/axylo/test/acceptance/REPORT.md)

### Mutation proofs

| Finding | Mutation | Additional failures |
|---|---|---:|
| 1 | Bypass dense simplification. The tests supply at least 10 values per device column and require the drawing to discard vertices. | 8 |
| 2 | Keep the first sample instead of the per-column minimum. The tests check both extrema, including on cumulative area boundaries. | 8 |
| 3 | Default instants and invalid-zone fallback to UTC. The tests vary the viewer zone across UTC, Los Angeles, and Kolkata. | 21 |
| 4 | Drop AX103 and AX106 rows from scatter tables. Static data and appends now retain those rows as “No data,” including with `missing: 'zero'`. Diagnostic counts stayed the same. | 6 |
| 5 | Choose the stack side from the first value in each series. The geometry properties vary signs per cell and include zero and missing values. | 4 |
| 6 | Force small percent and ratio maxima to half scale. The tests check the first enclosing ticks and the 4% fixture. | 10 |
| 12 | Remove forced isolated markers. Both line and area fail the coordinate check below 12 px spacing. | 2 |

### Failures left in place

- **F7, four tests.** The automatic domain must end at the first tick at or beyond each extreme. With a maximum reference of `0.1`, the first eligible drawn tick is `0.1`, but the domain ends at `0.2` for line, area, bar, and scatter. The likely source is domain rounding and tick selection. [domain.ts](/home/canarit/projects/axylo/packages/axylo/src/scale/domain.ts:77) · [axes.ts](/home/canarit/projects/axylo/packages/axylo/src/core/axes.ts:101)
- **F8, one test.** I counted zero and null entries as slices because F8 calls them slices. Nine entries should trigger AX121 and group two as `Other (2)`. The fixture emits no diagnostic because grouping counts positive arcs. [donut.ts](/home/canarit/projects/axylo/packages/axylo/src/view/donut.ts:33)
- **F10, two tests.** The axis covers both totals and the geometry checks pass. F10 explicitly requires both totals on the axis and leaves the mixed-sign readout ambiguous. I chose to expose both signed totals to the reader. Area and bar report `4` for `+9/−5` and `0 (incomplete)` for `+5/−5`. [aligned.ts](/home/canarit/projects/axylo/packages/axylo/src/lookup/aligned.ts:109)

### Evidence and verification

- Findings 7–10, 13–14, and 21 are covered by checker tests for explicit waivers, provenance, suite failures, forbidden modifiers, duplicate titles, helper registrations under prefixes, decorated spec IDs, and stable report order. No waivers were granted. Only `--write` changes the report.
- For finding 11, **L1** uses browser evidence for line, area, bar, and scatter. **L3** uses browser evidence for all five full chart types. **C3** uses browser evidence for all compact kinds. **L8 and AX142** now vary container and caption sizes. **AX143** varies text metrics and width. The only additions I made to `host.ts` were optional viewer zone, locale, text width, and caption line height settings, with the existing defaults. [host.ts](/home/canarit/projects/axylo/packages/axylo/test/core/host.ts)
- Findings 15–19 added exact diagnostic sets, AX105 boundary cases, all-string AX106, production AX140, broader generators, compact kind metadata, and checks just above and below 12 px. For findings 20 and 22, the matrix separates Chrome accessibility-tree evidence from screen-reader rehearsal, makes **I2/donut** applicable because donut has a legend, and makes **A7/compact** applicable because data can arrive without point focus. The Node quiet-append test passes. Donut toggling, compact browser announcements, screen-reader rehearsal, current browser and packed distribution results, and performance workloads remain unverified.

| Checker inputs | Pass | Fail | Weak | No evidence | Not run | Cannot verify | N/A |
|---|---:|---:|---:|---:|---:|---:|---:|
| Reviewer’s archived run | 117 | 11 | 128 | 18 | 21 | 15 | 266 |
| Updated checker, archived results | 72 | 23 | 121 | 18 | 63 | 15 | 264 |
| Updated checker, fresh Node results | 5 | 13 | 129 | 18 | 132 | 15 | 264 |

The requested Vitest run ended with `Test Files 3 failed | 19 passed (22)` and `Tests 7 failed | 661 passed (668)`. Checker tests passed **19/19**, and typecheck passed. The release check exited **1** and recorded that the shared working tree changed during Vitest. I verified that running the checker without `--write` left the report byte-for-byte intact.

Scratch files were removed, no test processes were left running, and no project commits or contract changes were made.