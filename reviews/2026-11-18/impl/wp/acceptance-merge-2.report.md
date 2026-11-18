<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ed9f-8dbf-7060-a78b-55c527e6d9b1). -->

Re-merged all 576 cells in the [acceptance matrix](/home/canarit/projects/axylo/acceptance/matrix.json) and regenerated the [release report](/home/canarit/projects/axylo/acceptance/report.md). The checker found no citation errors. With `--release`, it exited `1` and reported **“provenance does not match the working tree”** for all four `d8b4150` runs.

| Status | Before | After |
|---|---:|---:|
| Pass | 5 | 135 |
| Fail | 13 | 42 |
| Weak | 129 | 85 |
| No evidence | 18 | 18 |
| Not run | 132 | 21 |
| Cannot be verified here | 15 | 10 |
| Not applicable | 264 | 265 |

- **130 cells moved to pass.** Restored citations accounted for 100. Stronger dense-drawing, contrast, zoom, motion, and accessibility checks closed 24 gaps. The revised domain and mixed-sign stack evidence cleared six earlier failures.
- **35 cells moved to fail.** The report groups tooltip placement, focus clearance, and target size under decision 0004 revision 2. It also identifies historical failures from superseded L8 and A10 assertions. DX7 still fails at **99.47 KiB against 40 KiB** for everything. The proposed targets await the owner’s decision.
- **Donut I2 moved to not applicable.** I treated I2 as a series-toggle requirement and the static slice legend as F8 evidence. The report lists every changed cell and its reason. [Status changes](/home/canarit/projects/axylo/acceptance/report.md:285)

The archived runs contain **37 browser acceptance failures, two packed-browser note serialization failures, and one Node memory-bound failure**. I used chart-scoped describe prefixes for I1, I4, L8, and A10. The report records the SVG, emulated zoom, and sampled-color limits, and lists the negative controls separately. P1–P8 await a quiet-machine run. The revised browser assertions and concurrent fixes have no fresh results in this report.

```text
node --test                 ℹ pass 1   ℹ fail 0
node --test, no isolation    ℹ pass 20  ℹ fail 0
Checker tail                not run · 21  |  cannot be verified here · 10  |  not applicable · 265
```

Changes are confined to `acceptance/`. No contract changes were needed, and nothing was committed.