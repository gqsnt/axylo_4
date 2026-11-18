You wrote the `data` module of Axylo in this repository. The chart core now composes it, and a review of the core (`reviews/2026-11-18/impl/wp/core1.review.md`, findings 2, 3, 7 and 17) found gaps that can only be closed with more support from your streaming stores. Read `AGENTS.md` again, then those four findings, then `docs/03-plan-typescript-release.md` section 1.5 (commit contract) and 1.2 (ownership: typed columns are borrowed).

You own only: `packages/axylo/src/data/**`, `packages/axylo/src/diagnostics/**` and their test directories. The chart core (`packages/axylo/src/core/chart.ts`) calls `resolveOptions`, `normalize`, `AlignedStore` and `validateOptions` today and is being changed by another agent right now: do not rename or remove any exported function, method, parameter or result field. Everything below is an addition.

Build, each with tests written first:

1. **Transactional append.** A way to compute what an append would produce without committing it: `store.prepareAppend(rows, options) → { frame, diagnostics, commit(): void }` (or an equivalent shape you document). Until `commit()` is called the store is unchanged: a later `append` behaves as if the prepared one never happened, and frames handed out earlier are untouched. The existing `append` keeps working (prepare then commit). This is what lets a `strict` chart reject an append after looking at the resulting view.

2. **Re-encoding the retained rows.** `store.reencode(resolvedOptions, version) → Frame`: rebuild from the rows the store currently retains (after `keep`, including appended rows, excluding evicted ones), with a different encoding (another y field, another x field, long instead of wide), giving a new epoch. Row indexes in the new frame and its diagnostics are the same source indexes as before. Also `store.replace(data, resolvedOptions, version)` for an explicit data replacement after streaming. For typed-column input the retained rows are the retained ranges of the columns, without materializing row objects.

3. **Rows stay readable for as long as a frame can address them.** Today, after an append that evicts, an older frame's `source.rowAt(i)` returns null for a row that frame still shows. Add reference counting by revision: every frame the store hands out keeps the rows it can address alive until the caller says that frame is no longer displayed, through `store.retire(revision)` (retiring a revision also retires all older ones). Memory stays bounded: at most the rows of the frames not yet retired. Test: hold frame A, append with eviction to get frame B, `A.source.rowAt` still returns every row A addresses; after `retire(A.revision)` those rows are released (assert through a counter or `rowAt` returning null) and B is unaffected.

4. **Static frames stay borrowed.** Make sure there is a path for a chart that never appends to use `normalize` output (which borrows ascending typed columns) and to create a store only when the first append arrives: `AlignedStore.fromFrame(frame, resolvedOptions, data)` or equivalent, which takes over from an existing normalized frame without re-reading rows it has already normalized where that is possible, and copies borrowed columns only at that moment. State clearly in your report how the core should use it.

5. **Stores for scatter and donut** with the same shape as the aligned one (`append`, `prepareAppend`, `reencode`, `replace`, `retire`):
   - Scatter (`PointStore`): `keep` retains the latest distinct x positions per plan 1.5 (appending x = 5 to points at 10 and 20 with `keep: 2` keeps 10 and 20 and raises AX151 for the out-of-order row); rows keep their source indexes; a `NaN` already present in a typed column stays a silent missing value after an append of clean rows (no AX103 appears for old data); points sharing an x are ordinary.
   - Donut (`DonutStore`): `append` adds categories or, for a label that already exists, raises AX108 as normalization does; `keep` counts labels.
   Both must give the same frame as normalizing all retained rows at once (property test).

6. **A standalone x parser on the module index.** Export one function the view and reader modules can use instead of reaching into `data/x`: `createXParser(xColumnOrAxisMeta, environment) → { position(value: XValue): number | null; reports }` (name it as you see fit), documented, with the kind-specific rules you already implement. Keep the internal exports the other modules currently import working.

Property tests required: prepare without commit leaves the store byte-for-byte unchanged (compare frames from a subsequent identical append on a fresh store); re-encode equals normalizing the retained rows with the new encoding; streaming with random retire calls never loses a row an unretired frame addresses and never keeps more than those; the scatter and donut stores match full normalization.

Run `npm run typecheck` and `npm test` from the repository root. Failures in files you do not own are not yours.

Report: each item done or not, the exact signatures you added, how the chart core should use them, and what you could not do without a contract change.
