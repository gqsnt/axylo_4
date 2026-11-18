<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ed73-8b95-7322-b27b-dc54eaae084d). -->

Fixed findings **2, 3, 5–13, 15, and 16** in the owned modules. Finding 1 was already fixed in `1bbdf6f`. Finding 4 improved but still exceeds P7, and finding 14 requires a contract change. No commit or browser run.

| Finding | Change and verification |
|---|---|
| 2 | Protected a preview’s interior slot from later tail writes. [Transaction tests](/home/canarit/projects/axylo/packages/axylo/test/data/transactions.test.ts) re-read the discarded preview after the accepted append. Removing the competing-write guard fails the regression. |
| 3 | Shared-x fills claim unread tails. Four separate prepare-and-commit calls dropped from **1,560,101 B to 101 B** of typed-array allocation. The store comment documents that a fill after a draw can copy the affected series window. |
| 4 | Column rows now use implicit indexes within blocks, ordered typed columns share a typed position index, and initial capacity is `end + max(16, ceil(end / 8))`. Retained typed-array storage fell from **69,437,168 B to 24,750,128 B** beyond the caller’s columns. The **16,000,000 B** P7 assertion remains failing. Exact contiguous x, y, and slot views alone require **17,000,017 B** for the fixture after one append. Meeting P7 for that case requires segmented frame columns and readers that consume them without flattening. |
| 5, 8, 9 | [Reader tests](/home/canarit/projects/axylo/packages/axylo/test/reader/index.test.ts) cover language runs, mid-sentence placeholders, brackets, bidi marks, and both compact incomplete-stack templates. |
| 6, 12, 13 | [Scatter tests](/home/canarit/projects/axylo/packages/axylo/test/lookup/scatter.test.ts) shuffle source rows, exercise coincident and equidistant cross-series picks, exclude off-plot points, and reproduce reversed-scale rounding. Removing the later-row tie-break, choosing the first coincident representative, or removing plot clipping each fails a test. |
| 7, 11 | [Streaming tests](/home/canarit/projects/axylo/packages/axylo/test/data/streaming-storage.test.ts) compare lazy and eager snapshots across competing previews and verify release on the first dead source read. All three surviving mutations now fail. They bypass protection for a claimed tail, disable compaction, and ignore the label write cursor. |
| 10, 15, 16 | Tests verify inclusive retirement clamped to the current revision, the data-to-lookup import boundary, and AX143 advice limited to vertical category bars. |

Both F10 acceptance cases pass. Tooltips and keyboard value text use `totalMixed`, and the table marks the affected row `2 (incomplete)` as the fixture requires. The amended F8 test verifies that zero and null stay separate and that the grouped case draws seven individual arcs plus the `Other (2)` arc.

**Finding 14.** The 200,000-point ring visited **9 coarse cells and 200,045 candidates or rows**, with 1,591 coincident hits. The exact-pick contract blocks lattice merging. The proposed bound is `(ceil(49 × dpr) + 1)²` lattice cells plus up to eight sampled rows, or 9,801 cells at DPR 2. A full device-pixel lattice moves each point by at most 0.707 device px, or 0.354 CSS px at DPR 2. Suggested contract sentence:

> Scatter pointer picks may compare projected positions rounded to the nearest device-pixel lattice point, with ties going to the later source row. Returned datum values remain exact.

**Controller and Vitest.** Use `import { seriesNotDrawnSentence } from '../reader'` and pass AX143 details `chartType: view.kind`, `xKind: view.frame.x.kind`, and `horizontal: view.horizontal` for bars. The registry handles absent details. For the installed Vitest 5, add these lines inside `test` in the root config:

```ts
pool: 'forks',
execArgv: ['--expose-gc'],
```

`npm run typecheck` passed. The requested suite failed only where forced GC was unavailable. Running the streaming file with `--pool=forks --execArgv=--expose-gc` left only P7 failing.

```text
Requested suite
Test Files  1 failed | 26 passed (27)
     Tests  15 failed | 739 passed (754)

Streaming storage with forced GC
Test Files  1 failed (1)
     Tests  1 failed | 39 passed (40)
```