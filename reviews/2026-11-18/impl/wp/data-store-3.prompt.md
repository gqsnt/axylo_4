# Work package: the streaming store must append without copying

Read `AGENTS.md` first; its rules apply. You own `packages/axylo/src/data/**` and `packages/axylo/test/data/**` and nothing else. Do not commit. You wrote this module (work packages `data`, `data.fix`, `data-store-2` in `reviews/2026-11-18/impl/wp/`).

## The defect

An independent review of the chart controller (`reviews/2026-11-18/impl/wp/core3.controller.review.md`, finding 11; read it) measured, in Node:

- A one-row append on a 50,001-row line chart **replaced both numeric buffers despite spare capacity** (`src/data/store-buffers.ts` near line 52, the buffer fork).
- After `keep: 2`, and after an explicit data replacement, **the original caller columns stayed reachable** until an unrelated change rebuilt a cache.

`docs/03-plan-typescript-release.md` section 2.2, the frame ownership comments in `packages/axylo/src/core/contracts.ts` and the hot-path rule in `AGENTS.md` require appends to be incremental: cost proportional to the rows appended, not to the rows retained, and no reference kept to data the window has dropped. Budget P3 (spec section 5: 2 ms per update on a 600-point window) and P7 (memory) depend on it. The profile of the first benchmark pointed at this module for most of the gap to uPlot, though that attribution is not yet established.

## What to do

1. Reproduce both measurements as tests first (count buffer identity across appends with spare capacity; hold a `WeakRef` to dropped caller columns and assert collection after `global.gc()`, run with `--expose-gc` if the suite allows it, otherwise assert on the store's own references).
2. Make `prepareAppend` / `commit` share storage between the displayed frame and the prepared one: a prepared frame is a view over the same growing buffers with its own length (and offset, for `keep`), and buffers are replaced only when capacity is exhausted (amortised doubling) or when the window has slid far enough to compact. The contract that a frame handed out earlier still reads its own rows must hold: read the frame and store contracts in `contracts.ts` (comments on `AlignedFrame`, `Series`, `RowSource`, `retire`) and say in your report exactly what a holder of an older frame may still read after a later commit, and until when. If the current contract makes zero-copy impossible, describe the smallest contract change and stop that part; do not edit `contracts.ts`.
3. After `keep` slides the window, or after `replace`, nothing in the store may reference dropped caller rows or columns once the older revision is retired.
4. A property test (fast-check, at least 1,000 runs): for random sequences of append / keep / replace / reencode / retire, every live frame reads exactly the rows a naive array-of-rows model says it should, and the bytes allocated per append are bounded by a constant times the rows appended plus amortised growth (count allocations through a wrapper around the typed-array constructors the store uses, not by timing).
5. The point store and the donut store: same checks.

The chart controller (`packages/axylo/src/core/controller.ts`) is being changed by its author at the same time to keep an explicit displayed snapshot and to retire revisions that were never displayed; do not edit it, but keep `retire`, `prepareAppend`, `prepareReplace`, `prepareReencode`, `fromFrame` and `retainedRowCount` source-compatible, and list any behavioural change a caller must know.

Run `timeout 300 npx vitest run packages/axylo/test/data`. You cannot launch a browser. Never leave a process running. One existing test, "borrows one million ascending typed values with a warmed median under 100 ms", has failed intermittently on this loaded machine (125 ms once); do not change its threshold; if you can make the path faster, do.

Report: what you built, the before and after counts (buffers replaced per append, bytes allocated per appended row), the last lines of the test run, what a holder of an older frame may rely on, any contract change you need, and what you could not verify.
