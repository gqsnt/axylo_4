<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ed01-7b40-7d93-8469-0f0dda830c3b). -->

Ordinary in-order appends now share backing buffers between the current and prepared frames. `keep` advances the view’s offset, and storage grows or compacts as needed. I updated the [aligned store](/home/canarit/projects/axylo/packages/axylo/src/data/store.ts), [point and donut stores](/home/canarit/projects/axylo/packages/axylo/src/data/store-unaligned.ts), and [row retention](/home/canarit/projects/axylo/packages/axylo/src/data/store-rows.ts).

| Store | Numeric buffers replaced per append | Typed-array bytes per appended row |
|---|---:|---:|
| Line | 2 → 0 | 2,986,586 → 26 |
| Scatter | 2 → 0 | 1,400,077 → 21 |
| Donut | 1 → 0 | 10,572 → 30 |

These measurements used one-row appends with spare capacity. The isolated stores already passed the original caller-column GC probe. Additional probes found that partially retained blocks could pin dropped objects and a caller’s backing buffer. Both are now collectible after retirement.

**Frame lifetime.** A committed frame keeps its normalized values, labels, and row indexes for as long as it is held. Its `source.rowAt()` can return its own retained rows until `retire()` reaches its revision, then returns `null`. A superseded, uncommitted preview keeps its normalized values and loses access to source rows. Spare bytes outside a frame’s typed-array views may change during preparation. The requested store signatures and shared contracts need no changes. Competing previews and writes to an already captured last-x slot can require separate storage. Grouped scatter and changes that require renormalization still use the full-update path.

**Verification.** The [new suite](/home/canarit/projects/axylo/packages/axylo/test/data/streaming-storage.test.ts) passed all 24 tests with `--expose-gc`, including 1,000 model runs per store and 2,000 appends per 600-row window. The million-point normalization test, scoped typecheck, and 39 Node controller tests passed. Repository-wide typechecking reported errors in browser acceptance files. Browser P3, the full P7 heap budget, and the uPlot attribution remain unverified.

The requested data run ended with one existing failure. Its assertion compares the entire backing buffer, including the spare bytes written during preparation. I left it intact.

```text
Test Files  1 failed | 4 passed (5)
     Tests  1 failed | 125 passed (126)
  Start at  06:07:07
  Duration  2.51s (tests 93%, import 4%, transform 2%)
```